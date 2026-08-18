import { describe, expect, it } from 'vitest';

import { hermesAdapter } from './hermes.js';

const ctx = (extra: Partial<Parameters<typeof hermesAdapter.composeCommand>[1]> = {}) => ({
  cwd: '/tmp/ws',
  env: {},
  ...extra,
});

/**
 * Hermes adapter — argv plans + session-id extraction, fed the REAL output
 * shapes of `hermes chat` (verified 2026-08: interactive flags from
 * `hermes chat --help`, headless line `session_id: <id>` from a live run).
 */
describe('hermesAdapter', () => {
  it('id/displayName/binary are stable', () => {
    expect(hermesAdapter.id).toBe('hermes');
    expect(hermesAdapter.binary).toBe('hermes');
    expect(hermesAdapter.displayName).toBe('Hermes');
  });

  it('capabilities: interactive resume by id and last, headless, plain-text per-turn chat', () => {
    expect(hermesAdapter.capabilities).toMatchObject({
      resumeLast: true,
      resumeById: true,
      headless: true,
      chat: true,
      chatPlainText: true,
      transcriptDiscovery: 'none',
    });
  });

  it('composeChatTurn: first turn is a bare one-shot, message delivered as -q value', () => {
    const plan = hermesAdapter.composeChatTurn!({
      cwd: '/ws',
      env: {},
      resumeSessionId: null,
      assignedSessionId: 'ignored',
    });
    expect(plan.command).toEqual(['hermes', 'chat', '-Q', '-q']);
    expect(plan.deliver).toBe('arg');
  });

  it('composeChatTurn: later turns resume by id and pin cwd to the workspace', () => {
    const plan = hermesAdapter.composeChatTurn!({
      cwd: '/ws',
      env: {},
      resumeSessionId: '20260808_194633_641b80',
      assignedSessionId: '20260808_194633_641b80',
    });
    expect(plan.command).toEqual([
      'hermes', 'chat', '-Q',
      '--resume', '20260808_194633_641b80', '--no-restore-cwd',
      '-q',
    ]);
    expect(plan.deliver).toBe('arg');
  });

  it('filterChatPlainText: keeps only the LF-framed final response, drops CR streaming chrome', () => {
    // Shape captured live 2026-08-18 (hermes 0.20.3, reasoning model via -Q):
    // reasoning box + partials + consolidated reasoning are CR-terminated;
    // only the final response prints as clean LF lines.
    const raw = [
      '\r',
      '┌─ Reasoning ────────────────────┐\r',
      '\r',
      'Okay, the user asked for colors,\r',
      ' so the answer should be short.\r',
      '\r',
      'Okay, the user asked for colors, so the answer should be short.\r',
      'Merah, Biru, Hijau.',
      '',
    ].join('\n');
    expect(hermesAdapter.filterChatPlainText!(raw).trim()).toBe('Merah, Biru, Hijau.');
  });

  it('filterChatPlainText: drops startup warnings, keeps multi-line answers', () => {
    const raw = '⚠ tirith security scanner enabled but not available\nBaris satu.\nBaris dua.\n';
    expect(hermesAdapter.filterChatPlainText!(raw).trim()).toBe('Baris satu.\nBaris dua.');
  });

  it('composeCommand: fresh spawn opens the interactive TUI', () => {
    expect(hermesAdapter.composeCommand(['hermes'], ctx())).toEqual(['hermes', 'chat']);
  });

  it('composeCommand: quick-chat seed is intentionally dropped (Hermes has no TUI seed flag)', () => {
    expect(hermesAdapter.composeCommand(['hermes'], ctx({ initialPrompt: 'analyze XAU' }))).toEqual([
      'hermes',
      'chat',
    ]);
  });

  it('composeCommand: resume last → --continue', () => {
    expect(hermesAdapter.composeCommand(['hermes'], ctx({ resume: 'last' }))).toEqual([
      'hermes',
      'chat',
      '--continue',
    ]);
  });

  it('composeCommand: resume by id → --resume <id>', () => {
    expect(hermesAdapter.composeCommand(['hermes'], ctx({ resume: { sessionId: '20260808_163035_c7dbb2' } }))).toEqual(
      ['hermes', 'chat', '--resume', '20260808_163035_c7dbb2'],
    );
  });

  it('composeHeadlessCommand: one-shot quiet run', () => {
    expect(hermesAdapter.composeHeadlessCommand?.(['hermes'], ctx(), 'do the thing')).toEqual([
      'hermes',
      'chat',
      '-q',
      'do the thing',
      '-Q',
    ]);
  });

  it('extractHeadlessSessionId: parses the stderr session_id line', () => {
    // hermes hardcodes `print(f"\nsession_id: …", file=sys.stderr)` — the
    // adapter flags stderr scanning and the runner feeds stderr lines to the
    // extractor when headlessSessionIdOnStderr is set. Fixture captured live
    // 2026-08-08 (`hermes chat -q … -Q`).
    expect(hermesAdapter.headlessSessionIdOnStderr).toBe(true);
    expect(hermesAdapter.extractHeadlessSessionId?.('session_id: 20260808_194633_641b80')).toBe(
      '20260808_194633_641b80',
    );
    // Answer text on stderr / other lines must NOT match.
    expect(hermesAdapter.extractHeadlessSessionId?.('oke')).toBeNull();
    expect(hermesAdapter.extractHeadlessSessionId?.('{noise}')).toBeNull();
  });

  it('no per-workspace AI-config writer (Hermes reads its global ~/.hermes config)', () => {
    expect(hermesAdapter.writeAiConfig).toBeUndefined();
    expect(hermesAdapter.readAiConfig).toBeUndefined();
  });
});