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

  it('no extractHeadlessSessionId: hermes prints session_id to stderr, the headless runner never sees it', () => {
    // Hermes hardcodes `print(f"\nsession_id: …", file=sys.stderr)` and the
    // headless-task runner feeds only STDOUT lines to extractHeadlessSessionId
    // — so the adapter must NOT claim id harvesting it cannot deliver.
    expect(hermesAdapter.extractHeadlessSessionId).toBeUndefined();
  });

  it('no per-workspace AI-config writer (Hermes reads its global ~/.hermes config)', () => {
    expect(hermesAdapter.writeAiConfig).toBeUndefined();
    expect(hermesAdapter.readAiConfig).toBeUndefined();
  });
});