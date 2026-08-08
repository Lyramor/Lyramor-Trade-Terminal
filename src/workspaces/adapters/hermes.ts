import type { CliAdapter, SpawnContext } from '../cli-adapter.js';

/**
 * Hermes Agent (github.com/NousResearch/hermes-agent; Apache-2.0). Open-source
 * personal agent CLI — the fifth workspace channel (after claude / codex /
 * opencode / pi), targeting users who already run Hermes for their own agent
 * work (it is the reference deployment of the agent core this workspace
 * launcher's sibling tooling grew out of).
 *
 * TOOL ACCESS: Hermes has its own toolsystem (terminal, web, delegation) and
 * reads AGENTS.md / CLAUDE.md from cwd automatically — it does NOT read
 * `.mcp.json`, `.claude/skills`, `.agents/skills`, or `.pi/skills`, so the
 * launcher's per-CLI skill injection does not apply to it. It reaches
 * OpenAlice purely through the `alice*` CLI shims on PATH (`service.ts`) +
 * the repo's AGENTS.md guidance (which it loads natively). The workspace
 * templates already ship AGENTS.md, so Hermes lands on the same
 * alice* / traderhub surface as every other agent.
 *
 * INTERACTIVE: `hermes chat` is the interactive TUI (no seed prompt — unlike
 * claude/codex/opencode/pi there is no "quick chat" argv; `-q` is the
 * one-shot mode). Resume is first-class: `--continue` (last) and
 * `--resume <session_id>` (by id).
 *
 * HEADLESS: `hermes chat -q <prompt> -Q` — non-interactive, quiet output:
 * exits at the turn boundary, prints the final response, and prints
 * `session_id: <id>` so the run can be reopened as a normal interactive
 * session (verified against hermes 2026-08).
 *
 * WORKING DIRECTORY (verified 2026-08): Hermes resolves cwd from its own
 * process state — a clean spawn in the workspace dir behaves correctly
 * (the launcher PTY spawns with its own env, so this is the normal path).
 * CAVEAT: if Hermes env vars are present in the spawn env (a Hermes session
 * spawned from inside another Hermes session — e.g. an agent-in-agent
 * integration test), it restores ITS session cwd instead of the workspace.
 * Lyramor's headless/interactive spawns use a clean env, so this does not
 * apply to launcher-driven runs; keep it in mind when reproducing manually.
 *
 * KNOWN LIMITATION — headless runs are NOT reopenable by id from the
 * launcher today: `hermes` prints `session_id: <id>` to STDERR
 * (`cli.py: print(f"\nsession_id: …", file=sys.stderr)` — hardcoded), and
 * the headless-task runner only feeds STDOUT lines to
 * `extractHeadlessSessionId`. The headless task itself runs fine and the
 * agent reports via `inbox_push`; only the "reopen a finished headless run
 * as an interactive session" path is unavailable for hermes (the resume
 * hint is never harvested). If Hermes ever moves the id to stdout, mount
 * `extractHeadlessSessionId` with `/^session_id:\s*(\S+)\s*$/`.
 *
 * PROVIDER override: none at the workspace level — Hermes reads its global
 * `~/.hermes/config.yaml` + `.env` for the provider/model, so
 * writeAiConfig/readAiConfig are intentionally absent (like `shell`).
 * A workspace AI-config pin would require Hermes-side support (there is
 * none today); per-run model tuning is possible via `-m`/`--provider`
 * flags when calling `hermes chat`.
 */
export const hermesAdapter: CliAdapter = {
  id: 'hermes',
  displayName: 'Hermes',
  // Hermes installs a `hermes` launcher on PATH (pipx / npm / git checkout
  // shim). agent-detect resolves it like the other native binaries.
  binary: 'hermes',
  // taken: c=claude, x=codex, o=opencode, p=pi, sh=shell; 'h' is free.
  namePrefix: 'h',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    // Sessions live under ~/.hermes and are NOT discoverable from the
    // workspace dir in a mtime pattern the launcher can harvest (same
    // limitation as shell); resume-by-id works because the launcher records
    // headless session ids as resume hints and Hermes `--resume` is by id.
    transcriptDiscovery: 'none',
    headless: true,
    // No persistent stream-json chat transport in the Hermes CLI (unlike
    // claude's stream-json); the interactive TUI is PTY-only. Same stance
    // as shell/pi.
    chat: false,
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    // Interactive TUI. Hermes has no interactive seed flag — `-q` is the
    // one-shot mode, so a fresh spawn never carries a prompt argument.
    // (The launcher's quick-chat seed therefore doesn't apply: open the TUI
    // unseeded. Documented in the header.)
    const head = ['hermes', 'chat'];
    if (ctx.resume === undefined) return head;
    if (ctx.resume === 'last') return [...head, '--continue'];
    return [...head, '--resume', ctx.resume.sessionId];
  },

  // Headless: `hermes chat -q <prompt> -Q` — one-shot, exits at the turn
  // boundary, quiet output (`-Q` strips banner/spinner). Rules/docs from
  // AGENTS.md in the cwd are loaded natively, so the agent sees the same
  // workspace instructions as every other channel.
  // NOTE: no extractHeadlessSessionId — hermes prints the id to stderr, which
  // the headless runner never reads (see KNOWN LIMITATION in the header).
  composeHeadlessCommand(_base: readonly string[], _ctx: SpawnContext, prompt: string): readonly string[] {
    return ['hermes', 'chat', '-q', prompt, '-Q'];
  },

  // Per-turn chat: not implemented (no JSON harness in Hermes CLI). The
  // interface is optional; this adapter is interactive+headless only.
};