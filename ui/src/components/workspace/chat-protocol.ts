/**
 * Frontend mirror of `src/workspaces/chat-protocol.ts`. Kept as a separate file
 * (same convention as `protocol.ts`) so the UI and server build independently.
 *
 * The chat WS carries PARSED agent events (one JSON object per frame) instead of
 * the PTY's opaque bytes, so the client can render a real transcript.
 */

/** One agent stream-json event, forwarded verbatim. See server mirror. */
export type ChatEvent = Record<string, unknown>;

export interface ChatAttachedMessage {
  readonly type: 'attached';
  readonly sessionId: string;
  readonly alive: boolean;
}

export interface ChatHistoryMessage {
  readonly type: 'history';
  readonly events: readonly ChatEvent[];
  readonly truncated: boolean;
}

export interface ChatEventMessage {
  readonly type: 'event';
  readonly event: ChatEvent;
}

export interface ChatExitMessage {
  readonly type: 'exit';
  readonly code: number | null;
  readonly signal: string | null;
}

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
 * A pasted screenshot. `data` is RAW base64 (no `data:` prefix) — the server
 * forwards it straight into the agent's `image` content block.
 */
export interface ChatImage {
  readonly mediaType: string;
  readonly data: string;
}

/** Media types the agent's vision input accepts. */
export const SUPPORTED_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/** Mirrors the server cap (`chat-protocol.ts`); extras are dropped there anyway. */
export const MAX_IMAGES_PER_MESSAGE = 8;

/**
 * Server-side per-image base64 cap (`chat-protocol.ts` `MAX_IMAGE_BASE64_CHARS`,
 * ~5MB decoded). Mirrored here so the composer can downscale (or reject with a
 * clear message) BEFORE sending — the server silently drops anything over this,
 * which is exactly how a big screenshot used to vanish with no feedback.
 */
export const MAX_IMAGE_BASE64_CHARS = 7_000_000;

/** The user typed a message and hit send. */
export interface ChatUserMessage {
  readonly type: 'user';
  readonly text: string;
  readonly images?: readonly ChatImage[];
}

/**
 * Stop the turn in flight (Esc in the composer). The server turns this into a
 * stream-json `control_request{subtype:'interrupt'}`; the agent survives and
 * accepts the next message.
 */
export interface ChatInterruptMessage {
  readonly type: 'interrupt';
}

export type ChatClientMessage = ChatUserMessage | ChatInterruptMessage;

export function parseChatServerMessage(text: string): ChatServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  switch (v['type']) {
    case 'attached':
      if (typeof v['sessionId'] === 'string' && typeof v['alive'] === 'boolean') {
        return { type: 'attached', sessionId: v['sessionId'], alive: v['alive'] };
      }
      return null;
    case 'history':
      if (Array.isArray(v['events']) && typeof v['truncated'] === 'boolean') {
        return { type: 'history', events: v['events'] as ChatEvent[], truncated: v['truncated'] };
      }
      return null;
    case 'event':
      if (typeof v['event'] === 'object' && v['event'] !== null) {
        return { type: 'event', event: v['event'] as ChatEvent };
      }
      return null;
    case 'exit':
      return {
        type: 'exit',
        code: typeof v['code'] === 'number' ? v['code'] : null,
        signal: typeof v['signal'] === 'string' ? v['signal'] : null,
      };
    case 'error':
      if (typeof v['message'] === 'string') return { type: 'error', message: v['message'] };
      return null;
    default:
      return null;
  }
}
