/**
 * opencode per-turn chat: the argv plan + the stdout→Claude-envelope normalizer.
 *
 * The event shapes below were captured LIVE from `opencode run --format json`
 * (1.16.x) on 2026-08 — a plain reply, a tool call, and a streamed text part —
 * so this spec pins the mapping the `ChatView` renderer depends on.
 */
import { describe, expect, it } from 'vitest';

import { opencodeAdapter } from './opencode.js';

const ctx = (resumeSessionId: string | null) => ({
  cwd: '/w',
  env: {},
  resumeSessionId,
  assignedSessionId: 'assigned-1',
});

describe('opencodeAdapter.composeChatTurn', () => {
  it('fresh turn: reads the message from stdin (no positional → no cmd.exe injection)', () => {
    const plan = opencodeAdapter.composeChatTurn!(ctx(null));
    expect(plan.command).toEqual(['opencode', 'run', '--format', 'json']);
    expect(plan.deliver).toBe('stdin');
  });

  it('resume turn: threads the prior ses_ id via --session', () => {
    const plan = opencodeAdapter.composeChatTurn!(ctx('ses_abc'));
    expect(plan.command).toEqual(['opencode', 'run', '--format', 'json', '--session', 'ses_abc']);
    expect(plan.deliver).toBe('stdin');
  });
});

describe('opencodeAdapter.createChatNormalizer', () => {
  const line = (o: unknown) => JSON.stringify(o);

  it('maps a finalized text part to an assistant text envelope', () => {
    const n = opencodeAdapter.createChatNormalizer!();
    const out = n(line({ type: 'text', part: { id: 'prt_1', type: 'text', text: 'PONG', time: { start: 1, end: 2 } } }));
    expect(out).toEqual([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'PONG' }] } },
    ]);
  });

  it('suppresses a not-yet-finalized text part (no time.end), then emits once finalized', () => {
    const n = opencodeAdapter.createChatNormalizer!();
    expect(n(line({ type: 'text', part: { id: 'prt_1', type: 'text', text: 'PO' } }))).toEqual([]);
    const done = n(line({ type: 'text', part: { id: 'prt_1', type: 'text', text: 'PONG', time: { end: 2 } } }));
    expect(done).toHaveLength(1);
    // A duplicate of the same finalized part id does not double-emit.
    expect(n(line({ type: 'text', part: { id: 'prt_1', type: 'text', text: 'PONG', time: { end: 2 } } }))).toEqual([]);
  });

  it('maps a completed tool part to a tool_use envelope', () => {
    const n = opencodeAdapter.createChatNormalizer!();
    const out = n(
      line({ type: 'tool_use', part: { id: 'prt_t', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'x' } } } }),
    );
    expect(out).toEqual([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'read', input: { filePath: 'x' } }] } },
    ]);
  });

  it('ignores step_start / step_finish and non-JSON noise', () => {
    const n = opencodeAdapter.createChatNormalizer!();
    expect(n(line({ type: 'step_start', part: { type: 'step-start' } }))).toEqual([]);
    expect(n(line({ type: 'step_finish', part: { type: 'step-finish' } }))).toEqual([]);
    expect(n('not json')).toEqual([]);
  });
});
