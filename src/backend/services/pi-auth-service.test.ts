// @vitest-environment node

import os from 'node:os';
import { once } from 'node:events';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import request from 'supertest';
import { createApp } from '../app.js';
import { AuthService } from './auth-service.js';

import type { AppConfig } from '../config.js';
import { PiAuthService } from './pi-auth-service.js';

describe('PiAuthService', () => {
  let tempDir = '';
  let oauthService: PiAuthService | null = null;

  afterEach(async () => {
    await oauthService?.dispose();
    oauthService = null;
    vi.restoreAllMocks();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('persists token auth and reports provider status', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-pi-auth-'));
    const config = createConfig(tempDir);
    const service = new PiAuthService(config);

    const before = await service.getStatus();
    expect(before.providers.length).toBeGreaterThan(0);

    const provider = 'anthropic';

    expect(provider).toBeTruthy();

    if (!provider) {
      return;
    }

    const loginResult = await service.loginToken(provider, 'token-123');
    expect(loginResult).toEqual({ ok: true, provider, configured: true });

    const persistedService = new PiAuthService(config);
    const after = await persistedService.getStatus();
    const providerState = after.providers.find((entry) => entry.provider === provider);
    expect(providerState?.configured).toBe(true);

    const logoutResult = await persistedService.logout(provider);
    expect(logoutResult).toEqual({ ok: true, provider, configured: false });

    const afterLogout = await new PiAuthService(config).getStatus();
    expect(afterLogout.providers.find((entry) => entry.provider === provider)?.configured).toBe(
      false,
    );
  });

  async function createOAuthService(rejected = false) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-oauth-'));
    const config = createConfig(tempDir);
    const runtime = await ModelRuntime.create({
      authPath: path.join(tempDir, 'auth.json'),
      modelsPath: path.join(tempDir, 'models.json'),
    });
    const provider = runtime.getProvider('openai-codex')!;
    runtime.registerNativeProvider({
      ...provider,
      auth: {
        oauth: {
          name: 'ChatGPT test',
          isSubscription: true,
          login: async (interaction) => {
            interaction.notify({
              type: 'device_code',
              userCode: 'ABCD-EFGH',
              verificationUri: 'https://auth.openai.com/codex/device',
            });
            await interaction.prompt({ type: 'text', message: 'Confirm test sign-in' });
            if (rejected) throw new Error('denied: secret-provider-error');
            return {
              type: 'oauth',
              access: 'private-access',
              refresh: 'private-refresh',
              expires: Date.now() + 3600_000,
              accountId: 'test-account',
            };
          },
          refresh: async (credential) => credential,
          toAuth: async (credential) => ({ apiKey: credential.access }),
        },
      },
    });
    const factory = vi.spyOn(ModelRuntime, 'create').mockResolvedValue(runtime);
    const changed = vi.fn(async () => {});
    const service = new PiAuthService(config, changed);
    oauthService = service;
    return { service, changed, factory, config, runtime };
  }

  it('persists OAuth via the SDK, isolates the owner, and refreshes the agent before success', async () => {
    const { service, changed, factory, config } = await createOAuthService();
    const state = await service.startLogin('owner', 'openai-codex', 'device_code');
    await vi.waitFor(() => expect(service.getLogin('owner')?.state.prompt).toBeDefined());
    const flow = service.getLogin('owner')!;
    expect(service.getLogin('other-session')).toBeNull();
    await expect(service.startLogin('other', 'openai-codex', 'device_code')).rejects.toMatchObject({
      code: 'login_conflict',
    });
    await expect(service.logout('openai-codex')).rejects.toMatchObject({ code: 'login_conflict' });
    await expect(service.loginToken('openai', 'key')).rejects.toMatchObject({
      code: 'login_conflict',
    });
    await service.cancelLogin('other-session');
    expect(flow.active).toBe(true);
    expect(flow.answer(flow.state.prompt!.id, 'confirm')).toBe(true);
    await vi.waitFor(() => expect(state.status).toBe('succeeded'));
    expect(changed).toHaveBeenCalledOnce();
    const stored = JSON.parse(await readFile(path.join(tempDir, 'auth.json'), 'utf8'));
    expect(stored['openai-codex']).toMatchObject({ type: 'oauth', refresh: 'private-refresh' });
    expect(JSON.stringify(state)).not.toContain('private-');
    factory.mockRestore();
    const persisted = await new PiAuthService(config).getStatus();
    expect(persisted.providers.find((entry) => entry.provider === 'openai-codex')).toMatchObject({
      configured: true,
      authMethod: 'oauth',
      subscription: true,
    });
  });

  it('preserves existing credentials when a provider needs more than an API token', async () => {
    const { service, runtime } = await createOAuthService();
    await service.loginToken('anthropic', 'saved-token');
    const provider = runtime.getProvider('anthropic')!;
    const apiKey = provider.auth.apiKey!;
    runtime.registerNativeProvider({
      ...provider,
      auth: {
        apiKey: {
          ...apiKey,
          login: async (interaction) => {
            const key = await interaction.prompt({ type: 'secret', message: 'API token' });
            await interaction.prompt({ type: 'text', message: 'Account ID' });
            return { type: 'api_key', key };
          },
        },
      },
    });
    await expect(service.loginToken('anthropic', 'new-token')).rejects.toMatchObject({
      code: 'invalid_token',
    });
    const stored = JSON.parse(await readFile(path.join(tempDir, 'auth.json'), 'utf8'));
    expect(stored.anthropic.key).toBe('saved-token');
    await expect(service.loginToken('openai-codex', 'api-token')).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('cancels SDK work on logout/disposal and reports denial without provider secrets', async () => {
    const { service } = await createOAuthService(true);
    await service.startLogin('owner', 'openai-codex', 'device_code');
    await vi.waitFor(() => expect(service.getLogin('owner')?.state.prompt).toBeDefined());
    const flow = service.getLogin('owner')!;
    flow.answer(flow.state.prompt!.id, 'confirm');
    await vi.waitFor(() => expect(flow.state.status).toBe('failed'));
    expect(flow.state.message).not.toContain('secret-provider-error');
    await service.startLogin('owner', 'openai-codex', 'device_code');
    const second = service.getLogin('owner')!;
    await service.cancelLogin('owner');
    expect(second.state.status).toBe('cancelled');
    await service.startLogin('owner', 'openai-codex', 'device_code');
    const third = service.getLogin('owner')!;
    await service.dispose();
    expect(third.controller.signal.aborted).toBe(true);
    expect(service.getLogin('owner')).toBeNull();
  });

  it('protects all OAuth endpoints and rejects responses from another app session', async () => {
    const { service, config } = await createOAuthService();
    const authService = new AuthService(config.appPassword);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const app = createApp({
      config,
      authService,
      piAuthService: service,
      logService: { ...logger, child: () => logger } as never,
      workspaceService: { getCurrentRepo: () => null } as never,
      fileService: {} as never,
      gitService: {} as never,
      resourceHealthService: {} as never,
      piAgentService: {} as never,
      serverStartedAt: new Date(),
    });
    for (const endpoint of ['/api/pi/auth/oauth', '/api/pi/auth/oauth/stream?id=x']) {
      expect((await request(app).get(endpoint)).status).toBe(401);
    }
    for (const endpoint of [
      '/api/pi/auth/oauth',
      '/api/pi/auth/oauth/respond',
      '/api/pi/auth/oauth/cancel',
    ]) {
      expect((await request(app).post(endpoint).send({})).status).toBe(401);
    }
    const owner = request.agent(app);
    const other = request.agent(app);
    const unlocked = await owner.post('/api/auth/login').send({ password: config.appPassword });
    await other.post('/api/auth/login').send({ password: config.appPassword });
    expect(
      (await owner.post('/api/pi/auth/oauth').send({ provider: 'openai-codex', method: 'invalid' }))
        .status,
    ).toBe(400);
    const started = await owner.post('/api/pi/auth/oauth').send({ provider: 'openai-codex' });
    expect(started.status).toBe(200);
    const resumed = await owner.get('/api/pi/auth/oauth');
    expect(resumed.body.login.id).toBe(started.body.id);
    expect((await other.get('/api/pi/auth/oauth')).body.login).toBeNull();
    expect((await other.get(`/api/pi/auth/oauth/stream?id=${started.body.id}`)).status).toBe(404);
    expect(
      (
        await other
          .post('/api/pi/auth/oauth/respond')
          .send({ id: started.body.id, promptId: resumed.body.login.prompt.id, answer: 'confirm' })
      ).status,
    ).toBe(400);
    expect(
      (await other.post('/api/pi/auth/oauth/cancel').send({ id: started.body.id })).status,
    ).toBe(404);
    expect(
      (
        await owner
          .post('/api/pi/auth/oauth/respond')
          .send({ id: started.body.id, promptId: 'stale', answer: 'confirm' })
      ).status,
    ).toBe(400);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const abort = new AbortController();
    try {
      const stream = await fetch(
        `http://127.0.0.1:${address.port}/api/pi/auth/oauth/stream?id=${started.body.id}`,
        {
          headers: { cookie: unlocked.headers['set-cookie'][0].split(';')[0] },
          signal: abort.signal,
        },
      );
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
      const reader = stream.body!.getReader();
      const initial = new TextDecoder().decode((await reader.read()).value);
      expect(initial).toContain('ABCD-EFGH');
      expect(initial).not.toContain('private-');
      expect((await owner.post('/api/auth/logout')).status).toBe(200);
      const final = new TextDecoder().decode((await reader.read()).value);
      expect(final).toContain('cancelled');
      expect(final).not.toContain('ABCD-EFGH');
      await reader.cancel();
    } finally {
      abort.abort();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect((await owner.get('/api/pi/auth/oauth')).status).toBe(401);
  });

  it('rejects unknown providers', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-pi-auth-'));
    const service = new PiAuthService(createConfig(tempDir));

    await expect(service.loginToken('unknown-provider', 'token-123')).rejects.toMatchObject({
      code: 'unknown_provider',
    });
  });
});

function createConfig(piAgentDir: string): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    appPassword: 'secret-pass',
    workspaceRoot: '/workspace',
    modelUsagePath: '/tmp/model-usage.json',
    logsDirPath: '/tmp/logs',
    logLevel: 'info',
    sessionCookieName: 'pi_mobile_session',
    sessionCookieSecure: false,
    piAgentDir,
    piSessionDir: path.join(piAgentDir, 'sessions'),
  };
}
