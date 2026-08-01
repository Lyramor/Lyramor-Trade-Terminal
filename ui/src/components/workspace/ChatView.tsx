/**
 * Chat-transport view — the structured counterpart to `Terminal.tsx`.
 *
 * Instead of an xterm PTY, this connects to `/api/workspaces/chat` and renders
 * the agent's stream-json events as a real chat transcript (user / assistant
 * bubbles, tool-use chips) with a composer at the bottom. Only claude sessions
 * spawned with `transport: 'chat'` land here.
 *
 * The composer deliberately mimics the muscle memory of the claude TUI, because
 * that's what users coming from the terminal expect: Esc (or Ctrl+C on an empty
 * selection) stops the running turn, ArrowUp/ArrowDown walk prompt history, `/`
 * opens the slash-command palette, and typing while the agent is busy QUEUES the
 * message instead of locking the box.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent as ReactChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
} from 'react';
import { ArrowUp, Paperclip, Square, Wrench, X } from 'lucide-react';

import {
  parseChatServerMessage,
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BASE64_CHARS,
  SUPPORTED_IMAGE_TYPES,
  type ChatClientMessage,
  type ChatEvent,
  type ChatImage,
} from './chat-protocol';
import { MarkdownContent } from '../MarkdownContent';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'ended';

interface ChatViewProps {
  readonly wsId: string;
  readonly sessionId: string;
  readonly label?: string;
}

interface RenderItem {
  readonly key: string;
  readonly role: 'user' | 'assistant' | 'tool' | 'system' | 'error';
  readonly text?: string;
  readonly toolName?: string;
  readonly toolInput?: string;
  /** Ready-to-use `data:` URLs for images the user attached to this message. */
  readonly images?: readonly string[];
}

/**
 * Slash commands offered by the palette.
 *
 * Hardcoded on purpose: the CLI has no way to enumerate them over stream-json
 * (a `control_request{subtype:'supported_commands'}` is rejected as an
 * unsupported subtype — verified against claude 2.1.x). The commands themselves
 * need no client support — claude parses them straight out of the user text and
 * answers with a synthetic assistant message — so this list is purely
 * discoverability, and an unlisted command still works if typed in full.
 *
 * Deliberately excludes the TUI-only ones (`/login`, `/vim`, `/terminal-setup`,
 * …): they assume an interactive terminal we don't have.
 */
const SLASH_COMMANDS: readonly { readonly name: string; readonly hint: string }[] = [
  { name: '/model', hint: 'Lihat atau ganti model (sonnet, opus, haiku, fable)' },
  { name: '/context', hint: 'Rincian pemakaian context window' },
  { name: '/cost', hint: 'Biaya dan token sesi ini' },
  { name: '/usage', hint: 'Sisa kuota pemakaian' },
  { name: '/clear', hint: 'Kosongkan ingatan percakapan' },
  { name: '/compact', hint: 'Ringkas percakapan agar hemat context' },
  { name: '/status', hint: 'Status, versi, dan akun' },
  { name: '/mcp', hint: 'Daftar MCP server yang tersambung' },
  { name: '/agents', hint: 'Daftar subagent yang tersedia' },
  { name: '/memory', hint: 'Lihat file memory' },
  { name: '/todos', hint: 'Daftar todo sesi ini' },
  { name: '/init', hint: 'Buat CLAUDE.md untuk project ini' },
  { name: '/review', hint: 'Review perubahan kode' },
  { name: '/doctor', hint: 'Diagnosa instalasi Claude Code' },
  { name: '/help', hint: 'Bantuan' },
];

/** How many past prompts ArrowUp can walk back through. */
const MAX_PROMPT_HISTORY = 100;

/** Marker claude emits as a `user` event when a turn is interrupted. */
const INTERRUPT_MARKER = '[Request interrupted by user]';

// ── small typed accessors over the loosely-typed event records ────────────────
function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function summarizeInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  let s: string;
  try {
    s = typeof input === 'string' ? input : JSON.stringify(input);
  } catch {
    return '';
  }
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
}

/**
 * Slash-command output arrives as a `user` event whose content is a bare string
 * wrapped in `<local-command-stdout>` (e.g. `/model haiku` → "Set model to
 * haiku"). It's the CLI talking, not the user — unwrap it and show it as a
 * status chip rather than a user bubble.
 */
function localCommandOutput(content: unknown): string | null {
  const s = asStr(content);
  if (!s) return null;
  const m = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/.exec(s.trim());
  if (!m) return null;
  const inner = (m[1] ?? '').trim();
  return inner.length > 0 ? inner : null;
}

/** Flatten the raw event stream into render items (bubbles + tool chips). */
function deriveItems(events: readonly ChatEvent[]): RenderItem[] {
  const items: RenderItem[] = [];
  // An interrupt closes the turn with `result{subtype:'error_during_execution',
  // is_error:true}` — technically an error, but the user pressed the button, so
  // surfacing a red bubble would be lying to them. The marker event always
  // precedes that result, so it arms this flag to swallow exactly one.
  let interrupted = false;
  events.forEach((ev, i) => {
    const type = asStr(ev['type']);
    if (type === 'system') {
      if (asStr(ev['subtype']) === 'init') {
        const model = asStr(ev['model']);
        items.push({ key: `s${i}`, role: 'system', text: `Sesi dimulai${model ? ` · ${model}` : ''}` });
      } else {
        // Backend-synthesized notices (e.g. the per-turn transports' "images not
        // supported for this agent" note) ride a `system` event carrying `text`.
        const note = asStr(ev['text']) ?? asStr(ev['message']);
        if (note) items.push({ key: `s${i}`, role: 'system', text: note });
      }
      return;
    }
    if (type === 'assistant') {
      const msg = asRecord(ev['message']);
      const content = msg ? msg['content'] : undefined;
      if (Array.isArray(content)) {
        content.forEach((raw, j) => {
          const b = asRecord(raw);
          if (!b) return;
          const bt = asStr(b['type']);
          if (bt === 'text' && asStr(b['text'])) {
            items.push({ key: `a${i}-${j}`, role: 'assistant', text: asStr(b['text']) });
          } else if (bt === 'tool_use') {
            items.push({
              key: `a${i}-${j}`,
              role: 'tool',
              toolName: asStr(b['name']) ?? 'tool',
              toolInput: summarizeInput(b['input']),
            });
          }
        });
      }
      return;
    }
    if (type === 'user') {
      const msg = asRecord(ev['message']);
      const content = msg ? msg['content'] : undefined;
      if (Array.isArray(content)) {
        const texts: string[] = [];
        const images: string[] = [];
        for (const raw of content) {
          const b = asRecord(raw);
          if (!b) continue;
          const bt = asStr(b['type']);
          if (bt === 'text' && asStr(b['text'])) texts.push(asStr(b['text'])!);
          else if (bt === 'image') {
            // Rebuild the `data:` URL the browser needs from the wire shape the
            // agent takes — that's why the transcript can replay screenshots
            // after a restart without us storing them anywhere else.
            const src = asRecord(b['source']);
            const mt = src ? asStr(src['media_type']) : undefined;
            const d = src ? asStr(src['data']) : undefined;
            if (mt && d) images.push(`data:${mt};base64,${d}`);
          }
          // tool_result blocks feed the next assistant turn — not shown as a bubble.
        }
        const joined = texts.join('\n');
        if (joined === INTERRUPT_MARKER) {
          interrupted = true;
          items.push({ key: `u${i}`, role: 'system', text: 'Dihentikan' });
        } else if (joined.length || images.length) {
          items.push({
            key: `u${i}`,
            role: 'user',
            text: joined,
            ...(images.length ? { images } : {}),
          });
        }
      } else if (asStr(content)) {
        const cmdOut = localCommandOutput(content);
        if (cmdOut !== null) items.push({ key: `u${i}`, role: 'system', text: cmdOut });
        else items.push({ key: `u${i}`, role: 'user', text: asStr(content) });
      }
      return;
    }
    if (type === 'result') {
      const isError = ev['is_error'] === true || asStr(ev['subtype'])?.startsWith('error');
      if (isError && interrupted) {
        interrupted = false;
        return;
      }
      if (isError) {
        items.push({
          key: `r${i}`,
          role: 'error',
          text: asStr(ev['result']) ?? 'Agent mengakhiri turn dengan error.',
        });
      }
      // success: the assistant text already rendered — no extra bubble.
    }
  });
  return items;
}

/**
 * Client-side base64 budget for one attached image. Kept a margin under the
 * server's hard `MAX_IMAGE_BASE64_CHARS` so a big screenshot gets DOWNSCALED
 * before send rather than silently dropped server-side — the root cause of
 * "image upload doesn't work" for high-res / Retina screenshots.
 */
const CLIENT_IMAGE_BUDGET = Math.min(4_000_000, MAX_IMAGE_BASE64_CHARS);
/** Anthropic's recommended long-edge cap — larger buys no quality, just tokens. */
const MAX_IMAGE_DIM = 1568;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode_failed'));
    img.src = dataUrl;
  });
}

/**
 * Re-encode an oversized image down to fit the budget: cap the long edge at
 * `MAX_IMAGE_DIM`, then step JPEG quality down until the base64 fits. Returns a
 * fresh `ChatImage` (always `image/jpeg` after re-encode) or null if the canvas
 * path is unavailable.
 */
async function downscaleToBudget(dataUrl: string, budget: number): Promise<ChatImage | null> {
  const img = await loadImage(dataUrl);
  const longEdge = Math.max(img.width, img.height) || 1;
  const scale = Math.min(1, MAX_IMAGE_DIM / longEdge);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const cx = canvas.getContext('2d');
  if (!cx) return null;
  cx.drawImage(img, 0, 0, w, h);
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const out = canvas.toDataURL('image/jpeg', q);
    const b64 = out.slice(out.indexOf(',') + 1);
    if (b64.length > 0 && b64.length <= budget) return { mediaType: 'image/jpeg', data: b64 };
  }
  return null;
}

/**
 * Turn a pasted/picked file into a ready-to-send `ChatImage`, downscaling if it
 * exceeds the budget. Returns a `{ error }` (never a silent drop) when the image
 * can't be made to fit.
 */
async function fileToChatImage(file: File): Promise<ChatImage | { error: string }> {
  let dataUrl: string;
  try {
    dataUrl = await readAsDataUrl(file);
  } catch {
    return { error: 'Gagal membaca gambar.' };
  }
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return { error: 'Format gambar tidak dikenali.' };
  const raw = dataUrl.slice(comma + 1);
  if (raw.length <= CLIENT_IMAGE_BUDGET) return { mediaType: file.type, data: raw };
  // Too big — downscale so it isn't silently dropped by the server cap.
  try {
    const scaled = await downscaleToBudget(dataUrl, CLIENT_IMAGE_BUDGET);
    if (scaled) return scaled;
  } catch {
    /* fall through to the raw-fits check */
  }
  if (raw.length <= MAX_IMAGE_BASE64_CHARS) return { mediaType: file.type, data: raw };
  return { error: 'Gambar terlalu besar untuk dikirim, bahkan setelah diperkecil.' };
}

function defaultChatWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (
    import.meta.env.DEV &&
    typeof __OPENALICE_DEV_BACKEND_PORT__ === 'number' &&
    __OPENALICE_DEV_BACKEND_PORT__ > 0
  ) {
    return `${proto}//${window.location.hostname}:${__OPENALICE_DEV_BACKEND_PORT__}/api/workspaces/chat`;
  }
  return `${proto}//${window.location.host}/api/workspaces/chat`;
}

export function ChatView({ wsId, sessionId, label }: ChatViewProps): ReactElement {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /**
   * Messages typed during a turn, delivered one-per-turn as the agent frees up.
   * Carries its own images: a queued message must keep the screenshots it was
   * composed with, not whatever happens to be in the composer when it drains.
   */
  const [queue, setQueue] = useState<readonly { text: string; images: readonly ChatImage[] }[]>([]);
  /** Past prompts, newest last. ArrowUp walks backwards from the end. */
  const [history, setHistory] = useState<readonly string[]>([]);
  /** Index into `history` while recalling; null = composing a fresh message. */
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  /** Highlighted row in the slash palette. */
  const [paletteIdx, setPaletteIdx] = useState(0);
  /** Screenshots pasted into the composer, not yet sent. */
  const [attached, setAttached] = useState<readonly ChatImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Draft stashed when history recall started, restored on ArrowDown past the end. */
  const stashedDraft = useRef('');

  const items = useMemo(() => deriveItems(events), [events]);

  // The palette is open only while the draft is a bare command token (`/mod`) —
  // once there's a space the user is typing arguments and the list is noise.
  const paletteMatches = useMemo(() => {
    if (!/^\/[a-z-]*$/i.test(draft)) return [];
    const q = draft.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
  }, [draft]);
  const paletteOpen = paletteMatches.length > 0;

  useEffect(() => {
    setPaletteIdx(0);
  }, [draft]);

  const sendFrame = useCallback((msg: ChatClientMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  // Connect (with light reconnect/backoff — the server replays history on
  // re-attach, so a transient drop self-heals).
  useEffect(() => {
    let teardown = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const url = `${defaultChatWsUrl()}?session=${encodeURIComponent(sessionId)}`;

    const connect = (): void => {
      if (teardown) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus(attempts === 0 ? 'connecting' : 'reconnecting');

      ws.addEventListener('open', () => {
        attempts = 0;
        setStatus('connected');
      });
      ws.addEventListener('message', (ev) => {
        if (typeof ev.data !== 'string') return;
        const msg = parseChatServerMessage(ev.data);
        if (!msg) return;
        switch (msg.type) {
          case 'attached':
            if (!msg.alive) setStatus('ended');
            break;
          case 'history':
            setEvents(msg.events.slice());
            // A replayed transcript is a finished conversation, never a turn in
            // flight: re-attaching mid-turn still ends with a `result`, and a
            // rehydrated session hasn't started one. Clearing `busy` here keeps
            // a reconnect from wedging the composer behind a turn that already
            // ended while the socket was away.
            setBusy(false);
            break;
          case 'event':
            setEvents((prev) => [...prev, msg.event]);
            if (asStr(msg.event['type']) === 'result') setBusy(false);
            break;
          case 'exit':
            setStatus('ended');
            setBusy(false);
            break;
          case 'error':
            setErrorMsg(msg.message);
            setBusy(false);
            break;
        }
      });
      ws.addEventListener('close', (e) => {
        if (teardown) return;
        wsRef.current = null;
        // 4404 = session gone server-side; 4001 = kicked by a newer attach.
        if (e.code === 4404 || e.code === 4001) {
          setStatus('ended');
          return;
        }
        if (attempts >= 8) {
          setStatus('closed');
          return;
        }
        attempts += 1;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, Math.min(500 * 2 ** (attempts - 1), 8000));
      });
      ws.addEventListener('error', () => {
        /* close handler drives reconnect */
      });
    };

    connect();
    return () => {
      teardown = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch { /* ignore */ }
      wsRef.current = null;
    };
  }, [sessionId]);

  // Autoscroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, busy, queue.length]);

  // Drain the queue: one message per free turn. Runs whenever the agent goes
  // idle, so a burst typed during a long turn is delivered in order.
  useEffect(() => {
    if (busy || queue.length === 0 || status !== 'connected') return;
    const next = queue[0]!;
    if (!sendFrame({ type: 'user', text: next.text, ...(next.images.length ? { images: next.images } : {}) })) return;
    setQueue((q) => q.slice(1));
    setBusy(true);
  }, [busy, queue, status, sendFrame]);

  const resetTextareaHeight = (): void => {
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  /**
   * Shared attach path for BOTH Ctrl+V paste and the paperclip file picker.
   * Each file is read, and downscaled if it would exceed the server's image cap,
   * so a big screenshot lands as a real attachment instead of being silently
   * dropped downstream. Errors are surfaced (never a silent no-op).
   */
  const attachFiles = useCallback((files: readonly File[]): void => {
    const images = files.filter((f) => SUPPORTED_IMAGE_TYPES.includes(f.type));
    if (images.length === 0) {
      if (files.length > 0) setAttachError('Hanya PNG, JPEG, GIF, atau WebP yang didukung.');
      return;
    }
    const room = MAX_IMAGES_PER_MESSAGE - attached.length;
    if (room <= 0) {
      setAttachError(`Maksimal ${MAX_IMAGES_PER_MESSAGE} gambar per pesan.`);
      return;
    }
    setAttachError(null);
    for (const file of images.slice(0, room)) {
      void fileToChatImage(file).then((res) => {
        if ('error' in res) {
          setAttachError(res.error);
          return;
        }
        setAttached((prev) => (prev.length >= MAX_IMAGES_PER_MESSAGE ? prev : [...prev, res]));
      });
    }
  }, [attached.length]);

  /** Ctrl+V of a screenshot. */
  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (f) files.push(f);
    }
    // No file in the clipboard → let the default text paste happen.
    if (files.length === 0) return;
    e.preventDefault();
    attachFiles(files);
  };

  /** Paperclip → OS file picker. */
  const onPickFiles = (e: ReactChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) attachFiles(files);
    // Reset so picking the SAME file again re-fires change.
    e.target.value = '';
  };

  const removeAttached = (idx: number): void => {
    setAttached((prev) => prev.filter((_, i) => i !== idx));
    setAttachError(null);
  };

  /**
   * Accept a message. Never blocked by `busy`: a message typed mid-turn is
   * queued and drained when the agent frees up, so the composer stays usable —
   * waiting for the agent before you're allowed to type is the single most
   * grating thing about a chat UI.
   */
  const submit = (): void => {
    const text = draft.trim();
    const images = attached;
    // A screenshot with no caption is a perfectly good message ("look at this").
    if (!text && images.length === 0) return;
    if (status !== 'connected') return;
    if (text) setHistory((h) => [...h, text].slice(-MAX_PROMPT_HISTORY));
    setHistoryIdx(null);
    setDraft('');
    setAttached([]);
    setAttachError(null);
    setErrorMsg(null);
    resetTextareaHeight();
    if (busy) {
      setQueue((q) => [...q, { text, images }]);
      return;
    }
    if (sendFrame({ type: 'user', text, ...(images.length ? { images } : {}) })) setBusy(true);
  };

  /** Stop the running turn and drop anything still queued behind it. */
  const interrupt = (): void => {
    if (!busy) return;
    sendFrame({ type: 'interrupt' });
    setQueue([]);
  };

  const recallHistory = (dir: -1 | 1): void => {
    if (history.length === 0) return;
    if (dir === -1) {
      const next = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      if (historyIdx === null) stashedDraft.current = draft;
      setHistoryIdx(next);
      setDraft(history[next] ?? '');
      return;
    }
    if (historyIdx === null) return;
    const next = historyIdx + 1;
    if (next >= history.length) {
      // Walked past the newest entry — hand back whatever was being composed.
      setHistoryIdx(null);
      setDraft(stashedDraft.current);
      return;
    }
    setHistoryIdx(next);
    setDraft(history[next] ?? '');
  };

  const applyPalette = (idx: number): void => {
    const cmd = paletteMatches[idx];
    if (!cmd) return;
    // Trailing space: most of these take an argument (`/model haiku`), and for
    // the ones that don't it's harmless — claude trims.
    setDraft(`${cmd.name} `);
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget;

    if (paletteOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPaletteIdx((i) => (i + 1) % paletteMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPaletteIdx((i) => (i - 1 + paletteMatches.length) % paletteMatches.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applyPalette(paletteIdx);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDraft('');
        return;
      }
    }

    // Esc stops the turn — the TUI reflex. Only meaningful while busy; otherwise
    // let the key fall through (blur, close a parent overlay, …).
    if (e.key === 'Escape' && busy) {
      e.preventDefault();
      interrupt();
      return;
    }

    // Ctrl+C mirrors the terminal: it interrupts, but ONLY with no selection —
    // with text selected it must stay Copy, or we'd break the most common
    // shortcut on the page to serve the rarer one.
    if (e.key === 'c' && (e.ctrlKey || e.metaKey) && busy) {
      const hasSelection = ta.selectionStart !== ta.selectionEnd;
      if (!hasSelection) {
        e.preventDefault();
        interrupt();
        return;
      }
    }

    // Shell-style history: ArrowUp recalls only from the very start of the box,
    // ArrowDown only from the very end, so arrows still navigate a multi-line
    // draft normally.
    if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      e.preventDefault();
      recallHistory(-1);
      return;
    }
    if (
      e.key === 'ArrowDown' &&
      ta.selectionStart === draft.length &&
      ta.selectionEnd === draft.length &&
      historyIdx !== null
    ) {
      e.preventDefault();
      recallHistory(1);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const composerDisabled = status === 'ended' || status === 'closed';
  const canSubmit = status === 'connected' && (draft.trim().length > 0 || attached.length > 0);

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg">
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary/40 shrink-0">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            status === 'connected'
              ? 'bg-green'
              : status === 'ended' || status === 'closed'
                ? 'bg-text-muted/50'
                : 'bg-yellow-500'
          }`}
          aria-hidden="true"
        />
        <span className="text-[12px] text-text-muted font-medium truncate">{label ?? 'Chat'}</span>
        <span className="text-[11px] text-text-muted/50 ml-auto">
          {status === 'connecting' && 'menghubungkan…'}
          {status === 'reconnecting' && 'menyambungkan ulang…'}
          {status === 'closed' && 'koneksi terputus'}
          {status === 'ended' && 'sesi berakhir'}
          {status === 'connected' && (busy ? 'Alice sedang mengetik… (Esc untuk stop)' : 'siap')}
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {items.length === 0 && status === 'connected' && (
          <div className="h-full flex flex-col items-center justify-center text-center text-text-muted/60 gap-2">
            <p className="text-sm">{label ? `Mulai percakapan dengan ${label}.` : 'Mulai percakapan.'}</p>
            <p className="text-[12px]">Ketik pesan di bawah, tekan Enter untuk kirim. Lampirkan gambar dengan tombol klip atau Ctrl+V.</p>
          </div>
        )}
        {items.map((it) => (
          <ChatBubble key={it.key} item={it} />
        ))}
        {busy && <TypingIndicator />}
        {queue.map((q, i) => (
          <PendingBubble key={`q${i}`} text={q.text} imageCount={q.images.length} />
        ))}
        {errorMsg && (
          <div className="mx-auto max-w-2xl text-[12px] text-red bg-red/10 border border-red/30 rounded-lg px-3 py-2">
            {errorMsg}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-bg-secondary/30 px-3 py-3">
        <div className="max-w-3xl mx-auto relative">
          {paletteOpen && (
            <div className="absolute bottom-full mb-2 left-0 right-0 rounded-xl border border-border bg-bg-secondary shadow-lg overflow-hidden z-10">
              {paletteMatches.map((cmd, i) => (
                <button
                  key={cmd.name}
                  type="button"
                  onMouseDown={(e) => {
                    // mousedown, not click: click fires after blur, which would
                    // close the palette before the handler ran.
                    e.preventDefault();
                    applyPalette(i);
                  }}
                  onMouseEnter={() => setPaletteIdx(i)}
                  className={`w-full text-left px-3 py-2 flex items-baseline gap-2 ${
                    i === paletteIdx ? 'bg-bg-tertiary' : ''
                  }`}
                >
                  <span className="text-[12px] font-mono text-accent shrink-0">{cmd.name}</span>
                  <span className="text-[11px] text-text-muted truncate">{cmd.hint}</span>
                </button>
              ))}
            </div>
          )}
          {attached.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attached.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={`data:${img.mediaType};base64,${img.data}`}
                    alt={`Lampiran ${i + 1}`}
                    className="h-16 w-16 object-cover rounded-lg border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttached(i)}
                    aria-label={`Hapus lampiran ${i + 1}`}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-bg-tertiary border border-border text-text-muted hover:text-red hover:border-red/60 flex items-center justify-center"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachError && <p className="mb-1.5 text-[11px] text-red">{attachError}</p>}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              onChange={onPickFiles}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={composerDisabled || attached.length >= MAX_IMAGES_PER_MESSAGE}
              aria-label="Lampirkan gambar"
              title="Lampirkan gambar (atau Ctrl+V tempel screenshot)"
              className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-bg-tertiary border border-border text-text-muted hover:text-text hover:border-accent/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Paperclip size={16} strokeWidth={2} />
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              placeholder={
                composerDisabled
                  ? 'Sesi berakhir — mulai chat baru.'
                  : busy
                    ? 'Ketik pesan berikutnya… (akan diantre)'
                    : 'Ketik pesan…  /  perintah  ·  Ctrl+V tempel screenshot'
              }
              disabled={composerDisabled}
              className="flex-1 resize-none rounded-xl border border-border bg-bg px-3 py-2.5 text-[13px] text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent/60 disabled:opacity-50 leading-relaxed max-h-[180px]"
            />
            {busy ? (
              <button
                type="button"
                onClick={interrupt}
                aria-label="Hentikan"
                title="Hentikan (Esc)"
                className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-bg-tertiary border border-border text-text hover:border-red/60 hover:text-red transition-colors"
              >
                <Square size={14} strokeWidth={2.5} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                aria-label="Kirim pesan"
                className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-accent text-white transition-opacity disabled:opacity-30 hover:opacity-90"
              >
                <ArrowUp size={18} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <p className="max-w-3xl mx-auto mt-1.5 text-[10px] text-text-muted/40">
          Enter kirim · Shift+Enter baris baru · ↑↓ riwayat · / perintah · Esc stop
        </p>
      </div>
    </div>
  );
}

function ChatBubble({ item }: { item: RenderItem }): ReactElement | null {
  if (item.role === 'system') {
    return (
      <div className="text-center">
        <span className="inline-block text-[11px] text-text-muted/70 bg-bg-tertiary/50 rounded-full px-2.5 py-0.5 whitespace-pre-wrap text-left max-w-2xl">
          {item.text}
        </span>
      </div>
    );
  }
  if (item.role === 'error') {
    return (
      <div className="mx-auto max-w-2xl text-[12px] text-red bg-red/10 border border-red/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
        {item.text}
      </div>
    );
  }
  if (item.role === 'tool') {
    return (
      <div className="flex justify-start">
        <div className="max-w-2xl inline-flex items-start gap-1.5 text-[11px] text-text-muted bg-bg-tertiary/60 border border-border/50 rounded-lg px-2.5 py-1.5 font-mono">
          <Wrench size={12} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span className="break-all">
            <span className="text-text/80">{item.toolName}</span>
            {item.toolInput ? <span className="text-text-muted/70"> {item.toolInput}</span> : null}
          </span>
        </div>
      </div>
    );
  }
  if (item.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed break-words bg-accent text-white rounded-br-md">
          {item.images && item.images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {item.images.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer">
                  <img
                    src={src}
                    alt={`Gambar ${i + 1}`}
                    className="max-h-48 rounded-lg border border-white/25"
                  />
                </a>
              ))}
            </div>
          )}
          {item.text ? <span className="whitespace-pre-wrap">{item.text}</span> : null}
        </div>
      </div>
    );
  }
  // Assistant: render markdown so headings, tables, bold and lists come out
  // formatted instead of raw `#`/`|`/`**` — the whole point of a chat UI for
  // non-technical users (raw markdown reads as line-noise). Wide tables scroll
  // inside the bubble rather than breaking the layout.
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-3xl rounded-2xl px-4 py-3 bg-bg-secondary border border-border/60 text-text rounded-bl-md overflow-x-auto">
        <MarkdownContent text={item.text ?? ''} />
      </div>
    </div>
  );
}

/** A message the user sent mid-turn, waiting its turn to be delivered. */
function PendingBubble({ text, imageCount }: { text: string; imageCount: number }): ReactElement {
  return (
    <div className="flex justify-end">
      <div className="max-w-2xl rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed break-words bg-accent/40 text-white/80 rounded-br-md border border-dashed border-white/30">
        {text ? <span className="whitespace-pre-wrap">{text}</span> : null}
        {imageCount > 0 && (
          <span className="block text-[11px] text-white/70">
            {imageCount} gambar terlampir
          </span>
        )}
        <span className="block mt-1 text-[10px] text-white/60">menunggu giliran…</span>
      </div>
    </div>
  );
}

function TypingIndicator(): ReactElement {
  return (
    <div className="flex justify-start">
      <div className="bg-bg-secondary border border-border/60 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 animate-bounce" />
      </div>
    </div>
  );
}
