/**
 * Chat-transport session — the structured-JSON counterpart to
 * `persistent-session.ts` (raw-byte PTY).
 *
 * Spawns an agent CLI in bidirectional stream-json mode
 * (`--input-format stream-json --output-format stream-json`, from
 * `adapter.composeChatCommand`) on a plain pipe. Unlike the one-shot headless
 * runner (`headless-task.ts`), the process STAYS ALIVE: each user message is
 * written to stdin as one NDJSON line, and every stdout line is parsed and
 * forwarded to the attached WebSocket as a discrete chat event. The turn loop
 * ends at each `result` event but the process keeps waiting for the next user
 * message until stdin closes.
 *
 * Why not node-pty (like the PTY path): a PTY mangles the JSON stream with
 * terminal control bytes — the same reason `headless-task.ts` uses
 * `child_process.spawn`. Why not `SessionPool`/`PersistentSession`: its
 * respawn-on-exit circuit is anti-semantic here (a crashed agent should
 * surface, not silently respawn mid-conversation).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type { WebSocket } from 'ws';

import type { Logger } from './logger.js';
import { resolveLaunchCommand } from './win-command.js';
import type { ChatEvent, ChatImage, ChatServerMessage } from './chat-protocol.js';
import { parseChatClientMessage } from './chat-protocol.js';
import type { ChatTranscriptStore } from './chat-transcript-store.js';
import { PerTurnChatSession, type PerTurnChatSessionOpts } from './per-turn-chat-session.js';

/**
 * The surface the WS route + service + manager use, shared by both chat
 * transports: `ChatSession` (claude's persistent bidirectional stream-json
 * process) and `PerTurnChatSession` (codex/opencode/pi — a fresh one-shot
 * headless spawn per user message). Lets the registry hold either behind one
 * type without the claude path knowing the per-turn one exists.
 */
export interface ChatSessionLike {
  readonly recordId: string;
  readonly wsId: string;
  readonly startedAt: number;
  get alive(): boolean;
  get agentSessionId(): string | null;
  get pid(): number | null;
  send(text: string, images?: readonly ChatImage[]): void;
  interrupt(): void;
  attach(ws: WebSocket): void;
  dispose(reason: string): void;
}

/** Transcript cap — a long conversation drops its oldest events past this. */
const MAX_TRANSCRIPT_EVENTS = 4000;
/** A stdout "line" longer than this without a newline is not a valid event; drop it. */
const SCAN_LINE_MAX_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 4_000;

export interface ChatSessionOpts {
  readonly recordId: string;
  readonly wsId: string;
  /** Full argv from `adapter.composeChatCommand` (bidirectional stream-json). */
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly logger: Logger;
  /** Adapter hook to pull the agent's own session id out of a stream line. */
  readonly extractSessionId?: (line: string) => string | null;
  /** Fired when the child exits (natural turn-loop end, crash, or kill). */
  readonly onExit?: (recordId: string) => void;
  /**
   * Durable transcript. Every event we append in memory is mirrored here so the
   * conversation survives a server restart (see `chat-transcript-store.ts`).
   */
  readonly transcriptStore?: ChatTranscriptStore;
  /**
   * Prior events replayed into memory on rehydration. Seeded from the store, so
   * they are NOT re-appended to disk — the file already holds them.
   */
  readonly initialTranscript?: readonly ChatEvent[];
  /**
   * Don't spawn the agent in the constructor — wait for the first `send()`.
   * Used when rehydrating after a restart: opening a chat tab should show the
   * transcript instantly without paying for a `claude` process the user may
   * never talk to. A deferred session reports `alive` (it's ready, not dead).
   */
  readonly deferStart?: boolean;
  /**
   * Fired the first time the agent's own session id is resolved, so the caller
   * can persist it as a `resumeHint` — without it a restart can restore the
   * transcript but not the agent's context.
   */
  readonly onAgentSessionId?: (recordId: string, agentSessionId: string) => void;
}

/**
 * One live chat process. Single-attach like the PTY session: a new socket
 * kicks the previous one (close 4001) so two tabs don't fight over one stdin.
 */
export class ChatSession implements ChatSessionLike {
  readonly recordId: string;
  readonly wsId: string;
  private readonly logger: Logger;
  private child: ChildProcessWithoutNullStreams | null = null;
  private ws: WebSocket | null = null;
  private readonly transcript: ChatEvent[] = [];
  private transcriptTruncated = false;
  private stdoutBuf = '';
  private exited = false;
  private exitCode: number | null = null;
  private exitSignal: string | null = null;
  private _agentSessionId: string | null = null;
  readonly startedAt = Date.now();
  private readonly extractSessionId?: (line: string) => string | null;
  private readonly onExit?: (recordId: string) => void;
  private readonly transcriptStore?: ChatTranscriptStore;
  private readonly onAgentSessionId?: (recordId: string, agentSessionId: string) => void;
  /** Spawn inputs, retained so a deferred session can start on first send. */
  private readonly spawnInputs: {
    readonly command: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  };
  /** False until the child has actually been spawned (see `deferStart`). */
  private started = false;
  /** Monotonic id for control_request frames (interrupt). */
  private controlSeq = 0;

  constructor(opts: ChatSessionOpts) {
    this.recordId = opts.recordId;
    this.wsId = opts.wsId;
    this.logger = opts.logger;
    if (opts.extractSessionId) this.extractSessionId = opts.extractSessionId;
    if (opts.onExit) this.onExit = opts.onExit;
    if (opts.transcriptStore) this.transcriptStore = opts.transcriptStore;
    if (opts.onAgentSessionId) this.onAgentSessionId = opts.onAgentSessionId;
    this.spawnInputs = { command: opts.command, cwd: opts.cwd, env: opts.env };
    if (opts.initialTranscript?.length) {
      // Memory-only seed: these lines are already on disk.
      this.transcript.push(...opts.initialTranscript);
    }
    if (!opts.deferStart) this.startNow();
  }

  /**
   * A deferred session that hasn't spawned yet is ALIVE (ready to talk), not
   * dead — the UI must offer a composer, not a "session ended" wall. Only an
   * actual child exit flips this false.
   */
  get alive(): boolean {
    if (this.exited) return false;
    return this.child !== null || !this.started;
  }

  /** Spawn the child if it hasn't been spawned yet. Idempotent. */
  private startNow(): void {
    if (this.started) return;
    this.started = true;
    this.start(this.spawnInputs.command, this.spawnInputs.cwd, this.spawnInputs.env);
  }

  get agentSessionId(): string | null {
    return this._agentSessionId;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  private start(command: readonly string[], cwd: string, env: Readonly<Record<string, string>>): void {
    // win32: claude is a native .exe → resolves to a direct path (viaShell:false).
    // Shim agents (opencode/pi → .cmd) would route through cmd.exe, a prompt
    // shell-injection surface — same refusal the headless runner makes. Chat only
    // supports claude for now, so this is defensive.
    const resolved = resolveLaunchCommand(command, { env });
    if (resolved.viaShell) {
      this.exited = true;
      this.exitCode = -1;
      this.logger.error('chat.win32_shim_unsupported', { command: command[0] });
      return;
    }
    const [file, ...args] = resolved.argv;
    if (!file) {
      this.exited = true;
      this.exitCode = -1;
      this.logger.error('chat.empty_command');
      return;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(file, args, {
        cwd,
        env: env as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.exited = true;
      this.exitCode = -1;
      this.logger.error('chat.spawn_failed', { err });
      return;
    }
    this.child = child;
    child.stdout.on('data', (d: Buffer) => this.onStdout(d));
    child.stderr.on('data', (d: Buffer) => {
      // stderr is diagnostics only (claude logs progress/errors here); tail-log it.
      this.logger.warn('chat.stderr', { recordId: this.recordId, chunk: d.toString('utf8').slice(0, 2000) });
    });
    child.once('exit', (code, signal) => this.onChildExit(code, signal));
    child.once('error', (err) => {
      this.logger.error('chat.child_error', { recordId: this.recordId, err });
      this.onChildExit(this.exitCode ?? -1, null);
    });
    this.logger.info('chat.spawned', { recordId: this.recordId, wsId: this.wsId, pid: child.pid, command });
  }

  /** Newline-buffered NDJSON scanner over stdout: one parsed event per line. */
  private onStdout(chunk: Buffer): void {
    this.stdoutBuf += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      this.handleLine(line);
    }
    // A pathological unterminated line (never a valid event) is discarded so
    // the buffer can't grow without bound.
    if (this.stdoutBuf.length > SCAN_LINE_MAX_BYTES) this.stdoutBuf = '';
  }

  private handleLine(line: string): void {
    let event: ChatEvent;
    try {
      event = JSON.parse(line) as ChatEvent;
    } catch {
      // Non-JSON noise on stdout (rare with stream-json). Ignore.
      return;
    }
    if (this.extractSessionId) {
      const id = this.extractSessionId(line);
      // Track the LATEST id, not just the first: a `--resume` run can be handed
      // a fresh session id by the CLI, and the resumeHint must follow it or the
      // next restart would resume the stale one.
      if (id && id !== this._agentSessionId) {
        this._agentSessionId = id;
        this.onAgentSessionId?.(this.recordId, id);
      }
    }
    this.appendTranscript(event);
    this.sendToWs({ type: 'event', event });
  }

  /**
   * NOTE: pasted images ride the transcript as inline base64, so a conversation
   * with screenshots costs real memory here and real bytes on disk. Fine for the
   * typical case (a screenshot is a few hundred KB) but it's the thing to fix
   * first if transcripts ever get heavy — spill image blocks to files under the
   * chat state dir and keep a reference in the event.
   */
  private appendTranscript(event: ChatEvent): void {
    this.transcript.push(event);
    if (this.transcript.length > MAX_TRANSCRIPT_EVENTS) {
      this.transcript.shift();
      this.transcriptTruncated = true;
    }
    // Mirror to disk so the conversation outlives the process. In-memory is
    // capped; the file is not (it's the audit trail) — `read()` bounds the replay.
    this.transcriptStore?.append(this.recordId, event);
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.exitSignal = signal;
    this.logger.info('chat.exited', { recordId: this.recordId, code, signal });
    this.sendToWs({ type: 'exit', code, signal });
    this.onExit?.(this.recordId);
  }

  /**
   * Send a user message into the running turn loop. Synthesizes a `user` event
   * into the transcript first — the CLI does NOT echo the input back over
   * stream-json, so without this the sender's own bubble would be missing on
   * reconnect.
   */
  send(text: string, images: readonly ChatImage[] = []): void {
    const trimmed = text;
    // A rehydrated session spawns on demand — the user talking is what proves
    // the tab was worth an agent process.
    if (!this.started) this.startNow();

    // Images FIRST, then the text: the prompt usually refers to the screenshot
    // ("what's wrong here?"), so the model should have seen it by the time it
    // reads the question.
    const content: unknown[] = [
      ...images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data },
      })),
      { type: 'text', text: trimmed },
    ];

    // Echo into transcript + live stream so the user's bubble appears.
    const userEvent: ChatEvent = {
      type: 'user',
      message: { role: 'user', content },
    };
    this.appendTranscript(userEvent);
    this.sendToWs({ type: 'event', event: userEvent });

    if (!this.child || this.exited || !this.child.stdin.writable) {
      this.sendToWs({ type: 'error', message: 'Agent process is not running — start a new chat session.' });
      return;
    }
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
    try {
      this.child.stdin.write(line);
    } catch (err) {
      this.logger.error('chat.stdin_write_failed', { recordId: this.recordId, err });
      this.sendToWs({ type: 'error', message: 'Failed to deliver message to the agent.' });
    }
  }

  /**
   * Stop the turn in flight (Esc / Ctrl+C in the UI) without killing the agent.
   *
   * Writes a stream-json `control_request{subtype:'interrupt'}` to stdin. The
   * CLI acks with a `control_response`, emits a `user` event reading
   * `[Request interrupted by user]`, and ends the turn with
   * `result{subtype:'error_during_execution'}` — the process survives and takes
   * the next message (verified against claude 2.1.x). No-op on a session that
   * was never started or has already exited: there is no turn to stop.
   */
  interrupt(): void {
    if (!this.started || this.exited) return;
    if (!this.child || !this.child.stdin.writable) return;
    this.controlSeq += 1;
    const line = JSON.stringify({
      type: 'control_request',
      request_id: `int_${this.controlSeq}`,
      request: { subtype: 'interrupt' },
    }) + '\n';
    try {
      this.child.stdin.write(line);
      this.logger.info('chat.interrupt', { recordId: this.recordId });
    } catch (err) {
      this.logger.warn('chat.interrupt_failed', { recordId: this.recordId, err });
    }
  }

  /**
   * Attach a WebSocket. Single-attach: kicks any previous socket with 4001,
   * replays the transcript, then streams live events. Handles inbound user
   * frames.
   */
  attach(ws: WebSocket): void {
    if (this.ws && this.ws !== ws) {
      try { this.ws.close(4001, 'superseded by a newer attach'); } catch { /* ignore */ }
    }
    this.ws = ws;
    this.sendToWs({ type: 'attached', sessionId: this.recordId, alive: this.alive });
    this.sendToWs({ type: 'history', events: this.transcript.slice(), truncated: this.transcriptTruncated });
    if (this.exited) {
      this.sendToWs({ type: 'exit', code: this.exitCode, signal: this.exitSignal });
    }
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) return;
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : data.toString();
      const msg = parseChatClientMessage(text);
      if (!msg) return;
      if (msg.type === 'user') this.send(msg.text, msg.images ?? []);
      else if (msg.type === 'interrupt') this.interrupt();
    });
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
    });
  }

  private sendToWs(msg: ChatServerMessage): void {
    const ws = this.ws;
    if (!ws) return;
    // ws.OPEN === 1; avoid importing the enum.
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      this.logger.warn('chat.ws_send_failed', { recordId: this.recordId, err });
    }
  }

  /** Kill the agent and detach. Idempotent. */
  dispose(reason: string): void {
    this.logger.info('chat.dispose', { recordId: this.recordId, reason });
    const child = this.child;
    if (child && !this.exited) {
      try { child.stdin.end(); } catch { /* ignore */ }
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const hard = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, KILL_GRACE_MS);
      hard.unref();
    }
    if (this.ws) {
      try { this.ws.close(1001, 'session disposed'); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}

/**
 * Registry of live chat sessions, keyed by SessionRegistry record id — the
 * chat-transport analogue of `SessionPool`. Deliberately thin: no respawn
 * circuit (a crashed agent should surface, not silently restart mid-conversation).
 *
 * Sessions are NOT durable here — the durability lives one layer out: the
 * service seeds `transcriptStore` + `initialTranscript` + `deferStart` so a
 * record whose process died with the server rehydrates from disk on first
 * attach and re-spawns (with `--resume`) on first send.
 */
export class ChatSessionManager {
  private readonly sessions = new Map<string, ChatSessionLike>();

  constructor(private readonly logger: Logger) {}

  create(opts: ChatSessionOpts): ChatSession {
    const existing = this.sessions.get(opts.recordId);
    if (existing) existing.dispose('replaced by a new spawn');
    const session = new ChatSession({
      ...opts,
      onExit: (id) => {
        opts.onExit?.(id);
        // Keep the dead session around so a late attach can replay the final
        // transcript + exit; it's pruned on explicit stop / workspace delete.
      },
    });
    this.sessions.set(opts.recordId, session);
    return session;
  }

  /**
   * Per-turn chat (codex/opencode/pi): a fresh one-shot headless spawn per user
   * message, resuming the prior turn's session id. Same registry slot / durable
   * transcript as `create`, but the session has no persistent process — it
   * spawns on each `send` and exits at the turn boundary.
   */
  createPerTurn(opts: PerTurnChatSessionOpts): PerTurnChatSession {
    const existing = this.sessions.get(opts.recordId);
    if (existing) existing.dispose('replaced by a new spawn');
    const session = new PerTurnChatSession(opts);
    this.sessions.set(opts.recordId, session);
    return session;
  }

  get(recordId: string): ChatSessionLike | undefined {
    return this.sessions.get(recordId);
  }

  has(recordId: string): boolean {
    return this.sessions.has(recordId);
  }

  /** Record ids whose agent process is still alive. */
  liveIds(): string[] {
    const out: string[] = [];
    for (const [id, s] of this.sessions) if (s.alive) out.push(id);
    return out;
  }

  stop(recordId: string): boolean {
    const s = this.sessions.get(recordId);
    if (!s) return false;
    s.dispose('explicit stop');
    this.sessions.delete(recordId);
    return true;
  }

  disposeAll(reason: string): void {
    for (const s of this.sessions.values()) s.dispose(reason);
    this.sessions.clear();
    this.logger.info('chat.dispose_all', { reason });
  }
}
