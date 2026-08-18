/**
 * Per-turn chat session — the NON-persistent counterpart to `chat-session.ts`.
 *
 * claude drives the chat UI with ONE long-lived bidirectional stream-json
 * process (`ChatSession`). codex / opencode / pi have no such persistent stdin
 * loop — their structured modes are one-shot: they consume a prompt, stream JSON
 * events, and EXIT at the turn boundary. So chat for them is implemented here as
 * a fresh one-shot headless spawn PER user message, resuming the previous turn's
 * session id so context carries across turns:
 *
 *   send(msg) → spawn `adapter.composeChatTurn` (resume last session id)
 *             → stream stdout, `adapter.createChatNormalizer` maps each line to
 *               the SAME Claude-style envelope `ChatView` already renders
 *             → child exits → we synthesize a `result` event → wait for next msg.
 *
 * The visible WS protocol (attached / history / event / error) is identical to
 * `ChatSession`, so the frontend can't tell the two transports apart. Unlike
 * `ChatSession`, a child exit here is a TURN boundary, not the end of the
 * session: `alive` stays true and NO `exit` frame is sent — only `dispose()`
 * ends the session.
 *
 * Windows note: opencode/pi are npm `.cmd` shims → their spawn routes through
 * `cmd.exe /d /c` (`win-command.ts`). We deliver the user message per the
 * adapter's `ChatTurnPlan.deliver`: `'stdin'` for those shims (the message never
 * touches the cmd.exe-parsed argv — no injection surface), `'arg'` only for
 * native-exe agents (codex).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { WebSocket } from 'ws';

import type { CliAdapter } from './cli-adapter.js';
import type { ChatEvent, ChatImage, ChatServerMessage } from './chat-protocol.js';
import { parseChatClientMessage } from './chat-protocol.js';
import type { ChatTranscriptStore } from './chat-transcript-store.js';
import type { ChatSessionLike } from './chat-session.js';
import type { Logger } from './logger.js';
import { resolveLaunchCommand } from './win-command.js';

const MAX_TRANSCRIPT_EVENTS = 4000;
const SCAN_LINE_MAX_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 4_000;
/** Watchdog: kill a single turn that never exits (a hung one-shot run). */
const TURN_TIMEOUT_MS = 15 * 60_000;

/** Marker the UI recognizes to render "stopped" instead of an error bubble. */
const INTERRUPT_MARKER = '[Request interrupted by user]';

export interface PerTurnChatSessionOpts {
  readonly recordId: string;
  readonly wsId: string;
  /** The per-turn adapter (must expose `composeChatTurn` + `createChatNormalizer`). */
  readonly adapter: CliAdapter;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly logger: Logger;
  readonly transcriptStore?: ChatTranscriptStore;
  readonly initialTranscript?: readonly ChatEvent[];
  /** Agent session id from a prior run (record.resumeHint) — resumed on turn 1. */
  readonly resumeSessionId?: string | null;
  /** Fired the first time an agent session id is resolved (persist as resumeHint). */
  readonly onAgentSessionId?: (recordId: string, agentSessionId: string) => void;
  /** Fired at each turn boundary (child exit) — lets the caller bump lastActiveAt. */
  readonly onTurnEnd?: (recordId: string) => void;
}

export class PerTurnChatSession implements ChatSessionLike {
  readonly recordId: string;
  readonly wsId: string;
  readonly startedAt = Date.now();
  private readonly adapter: CliAdapter;
  private readonly cwd: string;
  private readonly env: Readonly<Record<string, string>>;
  private readonly logger: Logger;
  private readonly transcriptStore?: ChatTranscriptStore;
  private readonly onAgentSessionId?: (recordId: string, agentSessionId: string) => void;
  private readonly onTurnEnd?: (recordId: string) => void;

  private readonly transcript: ChatEvent[] = [];
  private transcriptTruncated = false;
  private ws: WebSocket | null = null;
  private child: ChildProcess | null = null;
  private stdoutBuf = '';
  /** Whole-turn stdout accumulator for `capabilities.chatPlainText` adapters. */
  private plainBuf = '';
  /** Line buffer for stderr session-id scanning (`headlessSessionIdOnStderr`). */
  private stderrBuf = '';
  private disposed = false;
  /** Session id to resume the next turn with (mints across turns). */
  private currentSessionId: string | null;
  /** Stable id for create-or-reopen CLIs (pi) that never mint their own. */
  private readonly assignedFallbackId = randomUUID();
  /** Messages awaiting their turn (per-turn CLIs run one at a time). */
  private readonly queue: string[] = [];
  /** Set while a turn is being killed by `interrupt`, so its exit is swallowed. */
  private interruptedTurn = false;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: PerTurnChatSessionOpts) {
    this.recordId = opts.recordId;
    this.wsId = opts.wsId;
    this.adapter = opts.adapter;
    this.cwd = opts.cwd;
    this.env = opts.env;
    this.logger = opts.logger;
    if (opts.transcriptStore) this.transcriptStore = opts.transcriptStore;
    if (opts.onAgentSessionId) this.onAgentSessionId = opts.onAgentSessionId;
    if (opts.onTurnEnd) this.onTurnEnd = opts.onTurnEnd;
    this.currentSessionId = opts.resumeSessionId ?? null;
    if (opts.initialTranscript?.length) this.transcript.push(...opts.initialTranscript);
  }

  /** A per-turn session is ready to talk until disposed — there's no persistent
   *  process to be "dead". Between turns the child is null but the session lives. */
  get alive(): boolean {
    return !this.disposed;
  }

  get agentSessionId(): string | null {
    return this.currentSessionId;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  send(text: string, images: readonly ChatImage[] = []): void {
    if (this.disposed) {
      this.sendToWs({ type: 'error', message: 'Chat session ended — start a new one.' });
      return;
    }
    // Echo the user's bubble (text + any images) so it appears in the transcript
    // and replays on reconnect — the CLI never echoes the input back.
    const content: unknown[] = [
      ...images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data },
      })),
      { type: 'text', text },
    ];
    this.appendTranscript({ type: 'user', message: { role: 'user', content } });
    this.sendToWs({ type: 'event', event: { type: 'user', message: { role: 'user', content } } });

    // Per-turn CLIs take no Anthropic image blocks — surface that instead of
    // silently sending text-only (the user pasted a screenshot for a reason).
    if (images.length > 0) {
      const note: ChatEvent = {
        type: 'system',
        subtype: 'note',
        text: '📎 Gambar belum didukung untuk agent ini — hanya teks yang dikirim.',
      };
      this.appendTranscript(note);
      this.sendToWs({ type: 'event', event: note });
    }

    this.queue.push(text);
    this.drainIfIdle();
  }

  private drainIfIdle(): void {
    if (this.disposed || this.child || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.spawnTurn(next);
  }

  private spawnTurn(text: string): void {
    const assignedSessionId = this.currentSessionId ?? this.assignedFallbackId;
    let plan;
    try {
      if (!this.adapter.composeChatTurn) throw new Error('adapter has no composeChatTurn');
      plan = this.adapter.composeChatTurn({
        cwd: this.cwd,
        env: this.env,
        resumeSessionId: this.currentSessionId,
        assignedSessionId,
      });
    } catch (err) {
      this.logger.error('chat.turn.compose_failed', { recordId: this.recordId, err });
      this.emitTurnResult(true, `Failed to compose the turn command: ${(err as Error).message}`);
      return;
    }

    const resolved = resolveLaunchCommand(plan.command, { env: this.env });
    // Defense in depth: never append an untrusted message onto a cmd.exe-wrapped
    // argv. Adapters declare 'stdin' for their `.cmd` shims, so this only trips
    // on a mis-declaration — fail loudly rather than open an injection hole.
    if (resolved.viaShell && plan.deliver === 'arg') {
      this.logger.error('chat.turn.unsafe_arg_delivery_win32', {
        recordId: this.recordId,
        agent: this.adapter.id,
      });
      this.emitTurnResult(
        true,
        `win32: cannot deliver the message as an argv positional to a .cmd shim ` +
          `("${this.adapter.id}") — that would route through cmd.exe. The adapter must ` +
          `declare deliver:'stdin'.`,
      );
      return;
    }

    let argv = [...resolved.argv];
    if (plan.deliver === 'arg') argv = [...argv, text];
    const [file, ...args] = argv;
    if (!file) {
      this.emitTurnResult(true, 'Empty turn command.');
      return;
    }

    const stdinMode = plan.deliver === 'stdin' ? 'pipe' : 'ignore';
    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        cwd: this.cwd,
        env: this.env as NodeJS.ProcessEnv,
        stdio: [stdinMode, 'pipe', 'pipe'],
      });
    } catch (err) {
      this.logger.error('chat.turn.spawn_failed', { recordId: this.recordId, err });
      this.emitTurnResult(true, `Failed to start the agent: ${(err as Error).message}`);
      return;
    }
    this.child = child;
    this.stdoutBuf = '';
    this.plainBuf = '';
    this.stderrBuf = '';
    this.interruptedTurn = false;
    this.logger.info('chat.turn.spawned', {
      recordId: this.recordId,
      wsId: this.wsId,
      agent: this.adapter.id,
      pid: child.pid,
      resume: this.currentSessionId,
      deliver: plan.deliver,
      command: plan.command,
    });

    if (plan.deliver === 'stdin' && child.stdin) {
      try {
        child.stdin.write(text);
        child.stdin.end();
      } catch (err) {
        this.logger.error('chat.turn.stdin_write_failed', { recordId: this.recordId, err });
      }
    }

    const normalize = this.adapter.createChatNormalizer?.() ?? (() => []);
    child.stdout?.on('data', (d: Buffer) => this.onStdout(d, normalize));
    child.stderr?.on('data', (d: Buffer) => {
      this.logger.warn('chat.turn.stderr', {
        recordId: this.recordId,
        chunk: d.toString('utf8').slice(0, 2000),
      });
      // Some CLIs (hermes) announce their session id on STDERR — mirror the
      // headless runner's gated stderr scan so the next turn can resume.
      if (this.adapter.headlessSessionIdOnStderr && this.adapter.extractHeadlessSessionId) {
        this.stderrBuf += d.toString('utf8');
        let nl: number;
        while ((nl = this.stderrBuf.indexOf('\n')) !== -1) {
          const line = this.stderrBuf.slice(0, nl).trim();
          this.stderrBuf = this.stderrBuf.slice(nl + 1);
          if (!line) continue;
          const id = this.adapter.extractHeadlessSessionId(line);
          if (id && id !== this.currentSessionId) {
            this.currentSessionId = id;
            this.onAgentSessionId?.(this.recordId, id);
          }
        }
        if (this.stderrBuf.length > SCAN_LINE_MAX_BYTES) this.stderrBuf = '';
      }
    });
    child.once('exit', (code, signal) => this.onTurnExit(code, signal));
    child.once('error', (err) => {
      this.logger.error('chat.turn.child_error', { recordId: this.recordId, err });
      this.onTurnExit(-1, null);
    });

    this.turnTimer = setTimeout(() => {
      this.logger.warn('chat.turn.timeout', { recordId: this.recordId });
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, KILL_GRACE_MS).unref();
    }, TURN_TIMEOUT_MS);
    this.turnTimer.unref();
  }

  /** Newline-buffered NDJSON scan of a turn's stdout. */
  private onStdout(chunk: Buffer, normalize: (line: string) => ChatEvent[]): void {
    // Plain-text adapters (hermes -Q): no NDJSON to scan — accumulate the
    // whole turn and emit one assistant bubble at the turn boundary.
    if (this.adapter.capabilities.chatPlainText) {
      this.plainBuf += chunk.toString('utf8');
      if (this.plainBuf.length > SCAN_LINE_MAX_BYTES) {
        this.plainBuf = this.plainBuf.slice(-SCAN_LINE_MAX_BYTES);
      }
      return;
    }
    this.stdoutBuf += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      this.handleLine(line, normalize);
    }
    if (this.stdoutBuf.length > SCAN_LINE_MAX_BYTES) this.stdoutBuf = '';
  }

  private handleLine(line: string, normalize: (line: string) => ChatEvent[]): void {
    // Capture the agent's own session id so the NEXT turn resumes it (and a
    // restart can rehydrate the agent's memory, not just the transcript).
    if (this.adapter.extractHeadlessSessionId) {
      const id = this.adapter.extractHeadlessSessionId(line);
      if (id && id !== this.currentSessionId) {
        this.currentSessionId = id;
        this.onAgentSessionId?.(this.recordId, id);
      }
    }
    let events: ChatEvent[];
    try {
      events = normalize(line);
    } catch (err) {
      this.logger.warn('chat.turn.normalize_failed', { recordId: this.recordId, err });
      return;
    }
    for (const ev of events) {
      this.appendTranscript(ev);
      this.sendToWs({ type: 'event', event: ev });
    }
  }

  private onTurnExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    this.child = null;
    this.logger.info('chat.turn.exit', { recordId: this.recordId, code, signal });
    if (this.interruptedTurn) {
      // `interrupt()` already emitted the marker + swallowed result.
      this.interruptedTurn = false;
    } else {
      const isError = code !== 0 && code !== null;
      // Plain-text mode: the turn's whole stdout is the assistant's answer.
      if (this.adapter.capabilities.chatPlainText) {
        const filtered = this.adapter.filterChatPlainText?.(this.plainBuf) ?? this.plainBuf;
        // Defensive: drop a stray `session_id: …` line if the CLI ever moves
        // it to stdout — it's session plumbing, not answer text.
        const text = filtered
          .split('\n')
          .filter((l) => !/^session_id:\s*\S+\s*$/.test(l.trim()))
          .join('\n')
          .trim();
        this.plainBuf = '';
        if (text) {
          const ev: ChatEvent = {
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text }] },
          };
          this.appendTranscript(ev);
          this.sendToWs({ type: 'event', event: ev });
        }
      }
      this.emitTurnResult(
        isError,
        isError ? `Agent turn ended (exit ${code ?? `signal ${signal}`}).` : undefined,
      );
    }
    this.onTurnEnd?.(this.recordId);
    // Deliver the next queued message, if any.
    this.drainIfIdle();
  }

  /** Synthesize the Claude-style `result` that closes a turn (clears the UI's
   *  busy state). Success emits no bubble; an error surfaces one. */
  private emitTurnResult(isError: boolean, message?: string): void {
    const result: ChatEvent = {
      type: 'result',
      subtype: isError ? 'error_during_execution' : 'success',
      is_error: isError,
      ...(isError && message ? { result: message } : {}),
    };
    this.appendTranscript(result);
    this.sendToWs({ type: 'event', event: result });
  }

  interrupt(): void {
    if (this.disposed) return;
    const child = this.child;
    if (!child) return; // nothing running
    this.interruptedTurn = true;
    this.queue.length = 0; // drop anything queued behind the killed turn
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, KILL_GRACE_MS);
    hard.unref();
    // Emit the same shape claude produces on interrupt so the UI shows
    // "Dihentikan" and swallows the following error result.
    const marker: ChatEvent = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: INTERRUPT_MARKER }] },
    };
    this.appendTranscript(marker);
    this.sendToWs({ type: 'event', event: marker });
    this.emitTurnResult(true);
    this.logger.info('chat.turn.interrupt', { recordId: this.recordId });
  }

  attach(ws: WebSocket): void {
    if (this.ws && this.ws !== ws) {
      try { this.ws.close(4001, 'superseded by a newer attach'); } catch { /* ignore */ }
    }
    this.ws = ws;
    this.sendToWs({ type: 'attached', sessionId: this.recordId, alive: this.alive });
    this.sendToWs({ type: 'history', events: this.transcript.slice(), truncated: this.transcriptTruncated });
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) return;
      const textData = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString();
      const msg = parseChatClientMessage(textData);
      if (!msg) return;
      if (msg.type === 'user') this.send(msg.text, msg.images ?? []);
      else if (msg.type === 'interrupt') this.interrupt();
    });
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
    });
  }

  private appendTranscript(event: ChatEvent): void {
    this.transcript.push(event);
    if (this.transcript.length > MAX_TRANSCRIPT_EVENTS) {
      this.transcript.shift();
      this.transcriptTruncated = true;
    }
    this.transcriptStore?.append(this.recordId, event);
  }

  private sendToWs(msg: ChatServerMessage): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      this.logger.warn('chat.turn.ws_send_failed', { recordId: this.recordId, err });
    }
  }

  dispose(reason: string): void {
    this.logger.info('chat.turn.dispose', { recordId: this.recordId, reason });
    this.disposed = true;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    const child = this.child;
    if (child) {
      try { child.stdin?.end(); } catch { /* ignore */ }
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, KILL_GRACE_MS);
      hard.unref();
    }
    if (this.ws) {
      try { this.ws.close(1001, 'session disposed'); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}
