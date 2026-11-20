/**
 * On-disk transcript for chat-transport sessions — the chat analogue of
 * `scrollback-store.ts` (which persists the PTY's raw xterm buffer).
 *
 * One append-only JSONL per session record at `${stateRoot}/chat/<recordId>.jsonl`,
 * one stream-json event per line. This is the ONLY history the chat UI has:
 * `claude --resume <id>` restores the AGENT's context but replays nothing over
 * stdout (verified — a resumed run emits a fresh `system init` and nothing else),
 * so without this file a restart leaves the user staring at an empty transcript
 * even though the agent still remembers the conversation.
 *
 * Writes are fire-and-forget but serialized per record: `append` chains onto the
 * record's in-flight write so two events can't interleave a partial line into
 * the file. A failed write is logged and dropped — losing a transcript line must
 * never take down a live conversation.
 */
import { mkdir, appendFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { Logger } from './logger.js';
import type { ChatEvent } from './chat-protocol.js';

/**
 * Cap on how many events are replayed into a rehydrated session. Matches
 * `MAX_TRANSCRIPT_EVENTS` in `chat-session.ts` — the file itself is allowed to
 * grow past this (it's an audit trail); only the replay is bounded.
 */
const MAX_REPLAY_EVENTS = 4000;

export class ChatTranscriptStore {
  private readonly dir: string;
  /** recordId → tail of the write chain, so appends stay ordered per record. */
  private readonly writeChains = new Map<string, Promise<void>>();
  private ready: Promise<void> | null = null;

  constructor(
    stateRoot: string,
    private readonly logger: Logger,
  ) {
    this.dir = join(stateRoot, 'chat');
  }

  private ensureDir(): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true }).then(() => undefined);
    return this.ready;
  }

  private fileFor(recordId: string): string {
    return join(this.dir, `${recordId}.jsonl`);
  }

  /** Queue one event onto the record's transcript. Never throws. */
  append(recordId: string, event: ChatEvent): void {
    let line: string;
    try {
      line = JSON.stringify(event) + '\n';
    } catch (err) {
      // A non-serializable event is a bug upstream, not a reason to die.
      this.logger.warn('chat_transcript.serialize_failed', { recordId, err });
      return;
    }
    const prev = this.writeChains.get(recordId) ?? Promise.resolve();
    const next = prev
      .then(() => this.ensureDir())
      .then(() => appendFile(this.fileFor(recordId), line, 'utf8'))
      .catch((err: unknown) => {
        this.logger.warn('chat_transcript.append_failed', { recordId, err });
      });
    this.writeChains.set(recordId, next);
  }

  /**
   * Read a record's transcript back. Returns the last `MAX_REPLAY_EVENTS`
   * events, or `[]` when the file is absent (a session that never spoke) or
   * unreadable. Corrupt lines — a torn write from a hard kill — are skipped
   * individually rather than failing the whole replay.
   */
  async read(recordId: string): Promise<ChatEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.fileFor(recordId), 'utf8');
    } catch {
      return [];
    }
    const out: ChatEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as ChatEvent);
      } catch {
        // torn / partial line — skip it
      }
    }
    return out.length > MAX_REPLAY_EVENTS ? out.slice(-MAX_REPLAY_EVENTS) : out;
  }

  /** Drop a record's transcript (explicit session delete / workspace delete). */
  async remove(recordId: string): Promise<void> {
    this.writeChains.delete(recordId);
    await rm(this.fileFor(recordId), { force: true }).catch((err: unknown) => {
      this.logger.warn('chat_transcript.remove_failed', { recordId, err });
    });
  }
}
