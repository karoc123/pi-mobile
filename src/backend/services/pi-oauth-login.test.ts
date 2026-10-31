// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PiOAuthLogin } from './pi-oauth-login.js';

describe('PiOAuthLogin', () => {
  afterEach(() => vi.useRealTimers());

  it('chooses device-code login and publishes a safe verification link', async () => {
    const flow = new PiOAuthLogin('owner', 'openai-codex', 'device_code');
    const answer = await flow.interaction.prompt({
      type: 'select',
      message: 'Method',
      options: [
        { id: 'browser', label: 'Browser' },
        { id: 'device_code', label: 'Device' },
      ],
    });
    expect(answer).toBe('device_code');
    flow.interaction.notify({
      type: 'device_code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.openai.com/codex/device',
    });
    expect(flow.state).toMatchObject({
      userCode: 'ABCD-EFGH',
      url: 'https://auth.openai.com/codex/device',
    });
    flow.interaction.notify({ type: 'auth_url', url: 'javascript:alert(1)' });
    expect(flow.state.url).toBeUndefined();
    flow.cancel();
    expect(flow.state.userCode).toBeUndefined();
  });

  it('requires the complete OpenAI callback URL with matching OAuth state', async () => {
    const flow = new PiOAuthLogin('owner', 'openai-codex', 'browser');
    flow.interaction.notify({
      type: 'auth_url',
      url: 'https://auth.openai.com/oauth/authorize?state=expected',
    });
    const response = flow.interaction.prompt({ type: 'manual_code', message: 'Paste callback' });
    const id = flow.state.prompt!.id;
    expect(flow.answer(id, 'bare-code')).toBe(false);
    expect(flow.answer(id, 'http://localhost:1455/auth/callback?code=abc&state=wrong')).toBe(false);
    const url = 'http://localhost:1455/auth/callback?code=abc&state=expected';
    expect(flow.answer(id, url)).toBe(true);
    await expect(response).resolves.toBe(url);
    expect(flow.answer(id, url)).toBe(false);
    flow.cancel();
  });

  it('rejects invalid selections and cancels SDK prompts without keeping them alive', async () => {
    const flow = new PiOAuthLogin('owner', 'another-provider', 'browser');
    const abort = new AbortController();
    const prompt = flow.interaction.prompt({
      type: 'select',
      message: 'Choose',
      options: [{ id: 'a', label: 'A' }],
      signal: abort.signal,
    });
    const rejected = expect(prompt).rejects.toThrow('cancelled');
    expect(flow.answer(flow.state.prompt!.id, 'b')).toBe(false);
    abort.abort();
    await rejected;
    expect(flow.state.prompt).toBeUndefined();
    expect(flow.active).toBe(true);
    flow.cancel();
  });

  it('expires at the device-code deadline and aborts the SDK flow', async () => {
    vi.useFakeTimers();
    const flow = new PiOAuthLogin('owner', 'openai-codex', 'device_code');
    flow.interaction.notify({
      type: 'device_code',
      userCode: '123',
      verificationUri: 'https://example.com',
      expiresInSeconds: 2,
    });
    await vi.advanceTimersByTimeAsync(2001);
    expect(flow.state.status).toBe('failed');
    expect(flow.controller.signal.aborted).toBe(true);
    expect(flow.state.userCode).toBeUndefined();
  });
});
