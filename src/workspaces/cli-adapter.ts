/**
 * Capability-described handle on a coding-agent CLI (claude, codex, shell, …).
 *
 * The pool, watcher, and discovery layers consult an adapter to:
 *   1. Translate a spawn intent (`resume`?) into the CLI's native command flags.
 *   2. Decide whether/how to discover on-disk transcripts for this CLI.
 *   3. Provide CLI-specific env strips/sets and one-time bootstrap (writing
 *      config files, registering MCP servers in the CLI's native format, etc.).
 *
 * In v2.M1 only `claude` is registered; the interface exists so v2.M2+ can
 * land codex/shell without touching the core PTY/protocol/UI plumbing.
 */

import type { WireShape } from '../ai-providers/preset-catalog.js';
import type { ChatEvent } from './chat-protocol.js';

export interface OnDiskSession {
  readonly sessionId: string;
  readonly file: string;
  readonly mtime: string;
  readonly sizeBytes: number;
}

export interface SpawnContext {
  readonly resume?: 'last' | { readonly sessionId: string };
  /** Workspace cwd; lets adapters read e.g. `<cwd>/.mcp.json`. */
  readonly cwd: string;
  /**
   * Final env the PTY will be spawned with (after `spawn-env.ts`). Adapters
   * use this for `${VAR}` placeholder expansion when translating a
   * cross-CLI MCP definition into their own native command flags.
   */
  readonly env: Readonly<Record<string, string>>;
  /**
   * Seed a freshly-spawned INTERACTIVE TUI with a first user message — the
   * "quick chat" launch ("type a message → you're in, agent already working").
   * Unlike `composeHeadlessCommand`'s prompt (one-shot, exits at the turn
   * boundary), this rides the interactive `composeCommand`: each agent CLI
   * accepts a first prompt that opens the TUI and auto-submits it (claude/codex
   * positional after `--`; opencode `--prompt`; pi trailing positional).
   *
   * ONLY honored on a FRESH spawn (`resume` undefined) — seeding a prompt while
   * also resuming is ambiguous on codex's `resume <id>` subcommand and pi's
   * `--session-id`, so adapters MUST ignore it when resuming. `shell` ignores
   * it entirely (no agent to receive a prompt).
   */
  readonly initialPrompt?: string;
}

/**
 * Inputs for composing ONE per-turn chat spawn (the non-persistent chat path
 * used by codex / opencode / pi — see `composeChatTurn`). Each user message is a
 * fresh one-shot headless run that resumes the previous turn's session id so
 * context carries across turns.
 */
export interface ChatTurnContext {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /**
   * Agent session id to resume so this turn keeps the prior turns' context;
   * `null` on the very first turn (fresh conversation). For CLIs that MINT their
   * own id (opencode `ses_…`, codex `thread_id`) this is captured post-spawn via
   * `extractHeadlessSessionId` and fed back here next turn.
   */
  readonly resumeSessionId: string | null;
  /**
   * A stable launcher-owned id for CLIs whose session-id flag is
   * create-or-reopen (pi `--session-id`): pass it every turn and the CLI creates
   * it on turn 1, reopens it after. Equals `resumeSessionId` once one is known,
   * else a freshly minted uuid the launcher persists as the resume hint.
   */
  readonly assignedSessionId: string;
}

/**
 * A per-turn chat spawn plan: the argv (WITHOUT the user message) plus how the
 * message is delivered to the child.
 */
export interface ChatTurnPlan {
  readonly command: readonly string[];
  /**
   * Message delivery:
   *  - `'stdin'` — write the message to the child's stdin, then end it. REQUIRED
   *    for npm-`.cmd`-shim agents on win32 (opencode/pi), whose spawn routes
   *    through `cmd.exe /d /c` (see `win-command.ts`): a message on the argv
   *    would be re-parsed by cmd.exe (BatBadBut / CVE-2024-27980). Off the argv,
   *    off the injection surface.
   *  - `'arg'` — append the message as the final positional. Safe ONLY for
   *    native-exe agents (codex), which never route through cmd.exe. When the
   *    argv should end-of-options-terminate first, end `command` with `'--'`.
   */
  readonly deliver: 'stdin' | 'arg';
}

export interface BootstrapContext {
  readonly wsId: string;
  readonly cwd: string;
  /** Absolute path to the launcher repo, so adapters can compose tool paths. */
  readonly launcherRepoRoot: string;
}

/**
 * Per-workspace AI-provider override (endpoint / key / model). The launcher
 * owns the *contract* — one shape, dispatched uniformly across CLIs — while
 * each adapter owns the *format* (claude → `.claude/settings.local.json`,
 * codex → `.codex/config.toml` + `.codex/env.json`). Superset shape: `authMode`
 * is claude-only (which header carries the key), `wireApi` is codex-only
 * (Responses vs Chat Completions). Fields are optional/nullable so the same
 * shape serves both the write-input (absent ⇒ unset) and the read-output
 * (null ⇒ not present in the file).
 */
export interface WorkspaceAiCred {
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
  /**
   * The wire protocol the endpoint speaks — anthropic Messages / OpenAI Chat
   * Completions / OpenAI Responses. The cross-CLI generalization of the
   * codex-only `wireApi`: each adapter renders it into its native config
   * (opencode → which @ai-sdk package, pi → `api` field, codex → `wire_api`).
   * Carried on the central credential and threaded through here so a runtime
   * actually uses the shape the credential was created + tested with.
   */
  wireShape?: WireShape | null;
  /** Codex only — legacy/explicit wire_api; superseded by wireShape when set. */
  wireApi?: 'chat' | 'responses' | null;
  /** Claude only. */
  authMode?: 'x-api-key' | 'bearer';
}

export interface EnvOverrides {
  /**
   * Substrings that, when found anywhere in an env var name, cause the var to
   * be stripped from the spawn env. Layered on top of `spawn-env.ts`'s
   * baseline list. The substring match is the same `STRIP_TOKENS` semantics
   * used by `buildSpawnEnv`.
   */
  readonly strip?: readonly string[];
  readonly set?: Readonly<Record<string, string>>;
}

export interface CliAdapter {
  readonly id: string;                          // 'claude' | 'codex' | 'shell'
  readonly displayName: string;
  /**
   * Canonical PATH binary name this adapter spawns (`claude`, `codex`,
   * `opencode`, `pi`). Consumed by `agent-detect.ts` to tell the frontend
   * whether the runtime is actually installed on the host. Omit for adapters
   * that always resolve (e.g. `shell` runs `$SHELL`, present on any box) —
   * those are reported as installed unconditionally.
   */
  readonly binary?: string;
  /**
   * Short prefix used to name sessions (e.g. `c1`, `x1`, `sh1`). Helps scan a
   * mixed sidebar tree. Defaults to `id[0]` if omitted, but adapters whose
   * first character collides with another adapter (claude / codex both 'c')
   * MUST set this explicitly.
   */
  readonly namePrefix?: string;
  readonly capabilities: {
    readonly parallelPerCwd: boolean;
    readonly resumeLast: boolean;
    readonly resumeById: boolean;
    readonly transcriptDiscovery: 'fs-watch' | 'subprocess' | 'none';
    /**
     * The adapter mints its OWN session id at spawn. On a FRESH spawn the
     * launcher generates a uuid, threads it through `composeCommand`'s resume
     * `{sessionId}` intent (the CLI creates-or-reopens that id), and persists
     * it as `resumeHint` immediately — so a later reattach resumes BY ID, not
     * via fragile `--continue`/last. Requires the CLI's session-id flag to
     * create-if-missing (e.g. pi `--session-id`). Adapters that instead harvest
     * the id post-spawn (fs-watch / subprocess discovery) leave this falsy.
     */
    readonly assignsSessionId?: boolean;
    /**
     * The adapter exposes a one-shot HEADLESS mode (consumes a positional
     * prompt, exits at the turn boundary) via `composeHeadlessCommand`. The
     * launcher dispatches automation tasks through it — spawn → run → the agent
     * reports via `inbox_push` → exit, no human attached. The four agent CLIs
     * set this; `shell` does not (no agent-turn concept).
     */
    readonly headless?: boolean;
    /**
     * The adapter exposes a bidirectional structured-JSON CHAT mode (via
     * `composeChatCommand`) — the process stays alive, reads user messages from
     * stdin as stream-json and emits agent events on stdout. Drives the chat-UI
     * transport (`chat-session.ts`), a parallel to the PTY. Only claude sets
     * this today.
     */
    readonly chat?: boolean;
  };

  /**
   * Translate the base command (from `WEB_TERMINAL_COMMAND` / template) +
   * resume intent into the final argv. For claude:
   *   base + 'last'    → [...base, '--continue']
   *   base + { id }    → [...base, '--resume', id]
   * For codex (M2):
   *   base + 'last'    → [...base, 'resume', '--last']
   *   base + { id }    → [...base, 'resume', id]
   *
   * On a FRESH spawn (`resume` undefined) with `ctx.initialPrompt` set, the
   * adapter ALSO appends the prompt at the CLI's interactive-seed position so
   * the TUI opens already working on it (claude/codex positional after `--`;
   * opencode `--prompt`; pi trailing positional). Ignored when resuming; `shell`
   * ignores it always.
   */
  composeCommand(base: readonly string[], ctx: SpawnContext): readonly string[];

  /**
   * One-shot HEADLESS argv for an automation task — like `composeCommand`, but
   * the process consumes `prompt` and EXITS at the turn boundary (vs the
   * interactive TUI that waits for input). The adapter places `prompt` at the
   * CLI-correct position (claude right after `-p`; codex/opencode/pi trailing).
   * MUST keep the SAME MCP injection as `composeCommand` so the agent can reach
   * `inbox_push`. Present iff `capabilities.headless` is true.
   *   claude:   [...base, -p, <prompt>, --output-format, json]   // never --bare
   *   codex:    [codex, -c mcp…, exec, --json, <prompt>]
   *   opencode: [opencode, run, --format, json, <prompt>]
   *   pi:       [pi, -p, --mode, json, <prompt>]
   */
  composeHeadlessCommand?(base: readonly string[], ctx: SpawnContext, prompt: string): readonly string[];

  /**
   * Bidirectional CHAT argv — the process stays alive and speaks stream-json on
   * BOTH stdin (user messages) and stdout (agent events), driving the chat-UI
   * transport. Like `composeHeadlessCommand` it MUST keep the same MCP injection
   * as `composeCommand` so the agent reaches `inbox_push`. No prompt arg (the
   * first message arrives over stdin). Present iff `capabilities.chat`.
   *   claude: [...base, --input-format stream-json, --output-format stream-json, --verbose, -p]
   */
  composeChatCommand?(base: readonly string[], ctx: SpawnContext): readonly string[];

  /**
   * PER-TURN chat spawn — the non-persistent chat path (codex / opencode / pi).
   * Unlike claude's `composeChatCommand` (one long-lived bidirectional
   * stream-json process), these CLIs have NO persistent stdin loop, so chat is a
   * fresh one-shot headless run PER user message that resumes the prior turn's
   * session id to carry context. Returns the argv (message excluded) + how to
   * deliver the message (`ChatTurnPlan`). The launcher pairs this with
   * `createChatNormalizer` to map the CLI's JSON events onto the Claude-style
   * envelope `ChatView` renders. Mutually exclusive with `composeChatCommand`
   * (an adapter is EITHER persistent-chat OR per-turn-chat). Present iff
   * `capabilities.chat` and `composeChatCommand` is absent.
   *   opencode: opencode run --format json [--session <ses>]   (message on stdin)
   *   codex:    codex -c … exec [resume <id>] --json --         (message as arg)
   *   pi:       pi -p --mode json --session-id <id>             (message on stdin)
   */
  composeChatTurn?(ctx: ChatTurnContext): ChatTurnPlan;

  /**
   * Factory for a STATEFUL per-turn normalizer: maps one raw stdout line from a
   * `composeChatTurn` spawn to zero-or-more Claude-style `ChatEvent`s — assistant
   * text as `{type:'assistant',message:{content:[{type:'text',text}]}}` and tool
   * calls as a `tool_use` block. The per-turn session synthesizes the closing
   * `{type:'result'}` itself on process exit, so the normalizer never emits one.
   * Stateful across a turn (dedupe streaming part ids, emit only finalized text);
   * a fresh instance per turn. Present iff `composeChatTurn` is.
   */
  createChatNormalizer?(): (line: string) => ChatEvent[];

  /**
   * Extract the agent's OWN session id from one line of headless stdout.
   * All four agent CLIs announce their session id in the first line(s) of
   * their structured headless output (verified 2026-06-11):
   *   claude:   every stream-json event carries `session_id`
   *   codex:    `{"type":"thread.started","thread_id":…}` — equals the rollout
   *             `session_meta.id`, resumable via `codex resume <id>`
   *   opencode: every event carries top-level `sessionID` (`ses_…`)
   *   pi:       line 1 is `{"type":"session","id":…}` (echoes --session-id)
   * The runner calls this per complete line until it returns non-null; the id
   * is recorded on the task so a finished headless run can be REOPENED as a
   * normal interactive session (resume-by-id). Present iff
   * `capabilities.headless` (shell excluded).
   */
  extractHeadlessSessionId?(line: string): string | null;

  /** Optional per-CLI env adjustments on top of `spawn-env.ts`'s baseline. */
  envOverrides?(parent: NodeJS.ProcessEnv): EnvOverrides;

  /**
   * Optional per-spawn env contribution. Unlike `envOverrides` (static, no
   * spawn context), this receives the full `SpawnContext` so adapters can
   * compute env values that depend on the workspace cwd — e.g. `CODEX_HOME`
   * pointing at `<cwd>/.codex`. Merged into the spawn env AFTER
   * `envOverrides` so this takes precedence for overlapping keys.
   *
   * Intentionally narrow: this is *launcher plumbing* (where to find files),
   * NOT a back-door for injecting provider config (keys/URLs) — those live
   * in the workspace's own files (`.claude/settings*.json`,
   * `.codex/config.toml`) and are read by the CLI directly.
   */
  composeEnv?(ctx: SpawnContext): Record<string, string>;

  /**
   * Workspace-creation hook. The launcher calls this once for every adapter
   * enabled on a workspace. Responsible for technical wiring (writing
   * `.mcp.json`, adding trust entries to global config, etc.) — NOT for
   * instruction files like CLAUDE.md / AGENTS.md (template README covers
   * the cross-CLI guidance).
   */
  bootstrap?(ctx: BootstrapContext): Promise<void>;

  /**
   * Read/write the workspace's per-CLI AI-provider override. The launcher
   * dispatches uniformly; each adapter renders the shared `WorkspaceAiCred`
   * into (and parses it out of) its own native config files. An empty cred
   * resets — the adapter deletes its config so the CLI falls back to global.
   * Absent on adapters with no configurable provider (shell).
   */
  writeAiConfig?(cwd: string, cred: WorkspaceAiCred): Promise<void>;
  readAiConfig?(cwd: string): Promise<WorkspaceAiCred | null>;

  // ── Transcript detection (used only when capabilities.transcriptDiscovery === 'fs-watch')
  transcriptDir?(cwd: string): string;
  transcriptFileRe?: RegExp;
  extractSessionId?(filename: string): string | null;

  /** Subprocess discovery (capabilities.transcriptDiscovery === 'subprocess'). */
  listOnDisk?(cwd: string): Promise<readonly OnDiskSession[]>;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, CliAdapter>();
  private defaultId: string | null = null;

  register(adapter: CliAdapter, opts: { default?: boolean } = {}): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
    if (opts.default || this.defaultId === null) this.defaultId = adapter.id;
  }

  get(id: string): CliAdapter | undefined {
    return this.adapters.get(id);
  }

  /** Returns the registered adapter for `id`, falling back to the default. */
  resolve(id: string | null | undefined): CliAdapter {
    if (id) {
      const a = this.adapters.get(id);
      if (a) return a;
    }
    const fallback = this.defaultId ? this.adapters.get(this.defaultId) : undefined;
    if (!fallback) {
      throw new Error('AdapterRegistry has no adapters registered');
    }
    return fallback;
  }

  list(): readonly CliAdapter[] {
    return Array.from(this.adapters.values());
  }
}
