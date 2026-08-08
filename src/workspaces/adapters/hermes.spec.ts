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

  it('capabilities: interactive resume by id and last, headless, no chat transport', () => {
    expect(hermesAdapter.capabilities).toMatchObject({
      resumeLast: true,
      resumeById: true,
      headless: true,
      chat: false,
      transcriptDiscovery: 'none',
    });
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