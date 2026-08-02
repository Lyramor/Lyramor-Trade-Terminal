/**
 * POST /quick-chat — the loginless-runtime credential injection (opencode/pi).
 * claude/codex carry their own CLI login and must NOT be injected; opencode/pi
 * are seeded from the vault before spawn, and dead-end (no compatible cred) with
 * a 400 the composer turns into a "configure a provider" bounce.
 *
 * core/config is partial-mocked so we can drive the vault per-test without
 * touching the real ai-provider-manager.json.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createWorkspaceRoutes } from './workspaces.js';
import { readCredentials, setCredentialLastModel, type Credential } from '../../core/config.js';
import type { WorkspaceService } from '../../workspaces/service.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock('../../core/config.js', async (importActual) => {
  const actual = await importActual<typeof import('../../core/config.js')>();
  return { ...actual, readCredentials: vi.fn(), setCredentialLastModel: vi.fn(async () => {}) };
});

const openaiKey: Credential = {
  vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa', wires: { 'openai-chat': '' },
};

function build(opts: { workspaces?: any[] } = {}) {
  const META = { id: 'ws-1', dir: '/w', agents: ['claude', 'opencode'], template: 'chat', tag: 'chat-x' };
  // `capabilities.chat` decides the TRANSPORT quick-chat spawns into: a
  // chat-capable runtime (claude) lands in the chat UI, everything else keeps
  // the PTY. opencode has no stream-json chat mode, so it stays on `pool.spawn`.
  const opencode = {
    id: 'opencode',
    namePrefix: 'o',
    capabilities: { chat: false },
    writeAiConfig: vi.fn(async () => {}),
    readAiConfig: vi.fn(async () => null), // workspace has no prior config
  };
  const claude = {
    id: 'claude',
    namePrefix: 'c',
    capabilities: { chat: true },
    composeChatCommand: vi.fn(() => ['claude']),
  };
  const adapters: Record<string, any> = { opencode, claude };
  const spawn = vi.fn(() => ({
    recordId: 'rec-1', wsId: 'ws-1', name: 'o1', pid: 1, agentSessionId: null, startedAt: 1,
  }));
  const chatSend = vi.fn();
  const spawnChatSession = vi.fn(() => ({
    recordId: 'rec-c', wsId: 'ws-1', name: 'c1', pid: 2, agentSessionId: null, startedAt: 1,
    send: chatSend,
  }));
  const creator = { create: vi.fn(async () => ({ ok: true, workspace: META })) };
  const svc = {
    // Default []: today's tag never matches → creator.create path. Tests that
    // exercise targetWsId pass the workspace in so registry resolves it by id.
    registry: { list: () => opts.workspaces ?? [] },
    creator,
    resolveAdapter: (_m: any, agentId?: string) => adapters[agentId ?? 'claude'] ?? claude,
    adapters: { get: (id: string) => adapters[id] },
    sessionRegistry: {
      ensureLoaded: vi.fn(async () => {}),
      nextName: () => 'o1',
      create: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
    pool: { spawn },
    spawnChatSession,
    publicMeta: vi.fn(async () => META),
    config: { launcherRepoRoot: '/repo' },
  } as unknown as WorkspaceService;
  return { app: createWorkspaceRoutes(svc), opencode, spawn, creator, spawnChatSession, chatSend };
}

async function quickChat(app: any, body: unknown) {
  const res = await app.request('/quick-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeEach(() => {
  vi.mocked(readCredentials).mockReset();
  vi.mocked(setCredentialLastModel).mockClear();
});

describe('POST /quick-chat — loginless credential injection', () => {
  it('opencode + empty vault → 400 no_ai_credential, no inject, no spawn', async () => {
    vi.mocked(readCredentials).mockResolvedValue({});
    const { app, opencode, spawn } = build();
    const r = await quickChat(app, { prompt: 'hi', agent: 'opencode' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('no_ai_credential');
    expect(r.body.settingsTarget).toBe('ai-provider'); // the composer's bounce target
    expect(opencode.writeAiConfig).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('opencode + compatible cred → injects it (flagship model) then spawns', async () => {
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });
    const { app, opencode, spawn } = build();
    const r = await quickChat(app, { prompt: 'hi', agent: 'opencode' });
    expect(r.status).toBe(201);
    expect(opencode.writeAiConfig).toHaveBeenCalledOnce();
    const cred = (opencode.writeAiConfig.mock.calls[0] as any[])[1];
    expect(cred.apiKey).toBe('sk-oa');
    expect(cred.wireShape).toBe('openai-chat');
    expect(cred.model).toBe('gpt-5.5'); // vendor flagship — no lastModel yet
    // model remembered on the cred for next time
    expect(vi.mocked(setCredentialLastModel)).toHaveBeenCalledWith('openai-1', 'gpt-5.5');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('honors an explicit credentialSlug pick', async () => {
    vi.mocked(readCredentials).mockResolvedValue({
      'openai-1': openaiKey,
      'openai-2': { ...openaiKey, apiKey: 'sk-second', lastModel: 'gpt-5.5-mini' },
    });
    const { app, opencode } = build();
    await quickChat(app, { prompt: 'hi', agent: 'opencode', credentialSlug: 'openai-2' });
    const cred = (opencode.writeAiConfig.mock.calls[0] as any[])[1];
    expect(cred.apiKey).toBe('sk-second');
    expect(cred.model).toBe('gpt-5.5-mini'); // remembered lastModel wins over flagship
  });

  it('claude is never injected (own CLI login) — vault is not even read', async () => {
    const { app, spawnChatSession } = build();
    const r = await quickChat(app, { prompt: 'hi', agent: 'claude' });
    expect(r.status).toBe(201);
    expect(vi.mocked(readCredentials)).not.toHaveBeenCalled();
    expect(spawnChatSession).toHaveBeenCalledOnce();
  });

  // Transport routing: Ask Alice is the front door for people who don't want a
  // terminal, so a chat-capable runtime must land in the chat UI — and the seed
  // prompt has to arrive over stdin, since chat mode takes no prompt positional.
  it('claude → chat transport, seeded with the prompt (never the PTY pool)', async () => {
    const { app, spawn, spawnChatSession, chatSend } = build();
    const r = await quickChat(app, { prompt: 'analisa BBCA', agent: 'claude' });
    expect(r.status).toBe(201);
    expect(spawnChatSession).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
    expect(chatSend).toHaveBeenCalledWith('analisa BBCA');
    expect(r.body.session.title).toBe('analisa BBCA');
  });

  // Seed-prompt caps split by transport: the chat path delivers over stdin (no
  // argv limit), so a long paste that would overflow a command line is fine;
  // the interactive/PTY path keeps the conservative argv-safe cap.
  it('claude → chat accepts a long prompt over the argv cap (stdin delivery)', async () => {
    const long = 'x'.repeat(20000); // > MAX_SEED_PROMPT (16000), < MAX_CHAT_SEED_PROMPT
    const { app, spawnChatSession, chatSend } = build();
    const r = await quickChat(app, { prompt: long, agent: 'claude' });
    expect(r.status).toBe(201);
    expect(spawnChatSession).toHaveBeenCalledOnce();
    expect(chatSend).toHaveBeenCalledWith(long);
  });

  it('claude → chat still rejects an absurd prompt over the chat cap', async () => {
    const huge = 'x'.repeat(100001); // > MAX_CHAT_SEED_PROMPT (100000)
    const { app, spawnChatSession } = build();
    const r = await quickChat(app, { prompt: huge, agent: 'claude' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('prompt_too_long');
    expect(spawnChatSession).not.toHaveBeenCalled();
  });

  it('opencode (PTY/argv) rejects a prompt over the argv cap', async () => {
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });
    const long = 'x'.repeat(20000); // fine for chat, too long for the argv path
    const { app, spawn } = build();
    const r = await quickChat(app, { prompt: long, agent: 'opencode' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('prompt_too_long');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('opencode has no chat mode → still the PTY pool', async () => {
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });
    const { app, spawn, spawnChatSession } = build();
    const r = await quickChat(app, { prompt: 'hi', agent: 'opencode' });
    expect(r.status).toBe(201);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawnChatSession).not.toHaveBeenCalled();
  });

  // targetWsId — the chat sidebar's per-workspace "+": spawn INTO the given
  // workspace, not today's (so no creator.create).
  it('targetWsId spawns into the given workspace, skipping find-or-create', async () => {
    const { app, spawnChatSession, creator } = build({
      workspaces: [{ id: 'ws-1', dir: '/w', agents: ['claude'], template: 'chat', tag: 'chat-x' }],
    });
    const r = await quickChat(app, { prompt: 'hi', agent: 'claude', targetWsId: 'ws-1' });
    expect(r.status).toBe(201);
    expect(creator.create).not.toHaveBeenCalled(); // reused, not created
    expect(spawnChatSession).toHaveBeenCalledOnce();
    expect((spawnChatSession.mock.calls[0] as any[])[0]).toBe('ws-1'); // spawned into the target
  });

  it('unknown targetWsId → 404 workspace_not_found, no spawn', async () => {
    const { app, spawn, creator } = build();
    const r = await quickChat(app, { prompt: 'hi', targetWsId: 'nope' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('workspace_not_found');
    expect(creator.create).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
