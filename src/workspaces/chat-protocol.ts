/**
 * Wire protocol for the structured "chat" transport (parallel to the raw-byte
 * PTY transport in `protocol.ts`). Where the PTY WS pumps opaque terminal bytes,
 * the chat WS carries PARSED agent events — one JSON object per frame — so the
 * frontend can render a real chat transcript (bubbles) instead of a terminal.
 *
 * The agent (Claude Code today) is spawned with
 * `--input-format stream-json --output-format stream-json`; each stdout line is
 * a self-describing event ({type:'system'|'assistant'|'user'|'result'|…}). We
 * forward those verbatim inside a `ChatEvent` envelope and let the client
 * interpret them — the backend stays agent-agnostic.
 *
 * Kept as a standalone module (mirrored in
 * `ui/src/components/workspace/chat-protocol.ts`) so the two build
 * independently, same convention as `protocol.ts`.
 */

/**
 * A single agent stream-json event, forwarded verbatim. Loosely typed on
 * purpose: the shape is the CLI's contract, not ours, and the client only
 * reads a few well-known fields (`type`, `message.content`, `result`,
 * `session_id`). Adding partial-token streaming later just means more `type`
 * values flowing through untouched.
 */
export type ChatEvent = Record<string, unknown>;

// ── server → client ─────────────────────────────────────────────────────────

/** Sent once when a socket attaches, before any history. */
export interface ChatAttachedMessage {
  readonly type: 'attached';
  readonly sessionId: string;
  /** Whether the agent process is still alive (vs. attaching to a dead record). */
  readonly alive: boolean;
}

/** Replay of the transcript so far — sent right after `attached`. */
export interface ChatHistoryMessage {
  readonly type: 'history';
  readonly events: readonly ChatEvent[];
  /** True when older events were dropped to stay under the buffer cap. */
  readonly truncated: boolean;
}

/** A live agent event (assistant text, tool use, tool result, run result, …). */
export interface ChatEventMessage {
  readonly type: 'event';
  readonly event: ChatEvent;
}

/** The agent process exited (turn loop ended / stdin closed / crash). */
export interface ChatExitMessage {
  readonly type: 'exit';
  readonly code: number | null;
  readonly signal: string | null;
}

/** A transport-level error (spawn failure, bad frame, …). */
export interface ChatErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

export type ChatServerMessage =
  | ChatAttachedMessage
  | ChatHistoryMessage
  | ChatEventMessage
  | ChatExitMessage
  | ChatErrorMessage;

// ── client → server ─────────────────────────────────────────────────────────

/**
 * One pasted/attached image. `data` is RAW base64 — no `data:image/png;base64,`
 * prefix — matching the shape the agent's `image` content block wants, so the
 * session layer forwards it without re-encoding.
 */
export interface ChatImage {
  /** IANA media type; must be one of `SUPPORTED_IMAGE_TYPES`. */
  readonly mediaType: string;
  readonly data: string;
}

/** What the agent's vision input accepts. Anything else is dropped at parse. */
export const SUPPORTED_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/** Per-message image cap — a paste of a whole album is a mistake, not intent. */
export const MAX_IMAGES_PER_MESSAGE = 8;

/**
 * Per-image base64 cap (~5MB decoded, the agent's own per-image limit). Base64
 * inflates by 4/3, so the encoded string is bounded a bit above that.
 */
export const MAX_IMAGE_BASE64_CHARS = 7_000_000;

/** The user typed a message and hit send. */
export interface ChatUserMessage {
  readonly type: 'user';
  readonly text: string;
  /**
   * Screenshots pasted into the composer. Verified end-to-end against claude
   * 2.1.x: a base64 `image` block on stdin is read by the model (it echoed back
   * text rendered inside a PNG).
   */
  readonly images?: readonly ChatImage[];
}

/**
 * Stop the turn in flight (the chat equivalent of Ctrl+C / Esc in the TUI).
 * The server translates this into a stream-json `control_request`
 * `{subtype:'interrupt'}` on the agent's stdin. Verified against claude 2.1.x:
 * the CLI answers `control_response{subtype:'success'}`, emits a `user` event
 * reading `[Request interrupted by user]`, then closes the turn with a
 * `result{subtype:'error_during_execution'}` — the process stays alive and
 * accepts the next message.
 */
export interface ChatInterruptMessage {
  readonly type: 'interrupt';
}

export type ChatClientMessage = ChatUserMessage | ChatInterruptMessage;

// ── parser (client-frame validation, used server-side) ───────────────────────

/**
 * Validate the optional `images` array off a client frame.
 *
 * Silently DROPS bad entries rather than rejecting the whole message: the text
 * the user typed is the important part, and losing their sentence because one
 * attachment was oversized would be a worse failure than losing the attachment.
 * The socket is admin-gated, so this is shape hygiene (and a bound on what we
 * shovel into the agent's stdin), not a trust boundary.
 */
function parseImages(raw: unknown): ChatImage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatImage[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_IMAGES_PER_MESSAGE) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const mediaType = e['mediaType'];
    const data = e['data'];
    if (typeof mediaType !== 'string' || !SUPPORTED_IMAGE_TYPES.includes(mediaType)) continue;
    if (typeof data !== 'string' || data.length === 0 || data.length > MAX_IMAGE_BASE64_CHARS) continue;
    out.push({ mediaType, data });
  }
  return out;
}

export function parseChatClientMessage(text: string): ChatClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v['type'] === 'user' && typeof v['text'] === 'string') {
    const images = parseImages(v['images']);
    return { type: 'user', text: v['text'], ...(images.length ? { images } : {}) };
  }
  if (v['type'] === 'interrupt') {
    return { type: 'interrupt' };
  }
  return null;
}
