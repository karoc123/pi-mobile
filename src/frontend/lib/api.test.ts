import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  api,
  apiFetch,
  ApiRequestError,
  run,
  setUnauthorizedHandler,
  toErrorMessage,
} from './api.js';
import { toast } from './toast.svelte.js';

describe('apiFetch and api', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setUnauthorizedHandler(null);
    toast.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on successful 200 response', async () => {
    const mockData = { ok: true, repos: ['repo-a'] };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    });

    const result = await apiFetch<typeof mockData>('/api/repos');
    expect(result).toEqual(mockData);
  });

  it('returns undefined on 204 No Content response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiFetch('/api/logout', { method: 'POST' });
    expect(result).toBeUndefined();
  });

  it('automatically sets Content-Type application/json when body is present', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await apiFetch('/api/test', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    });

    const calledInit = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(calledInit.headers.get('Content-Type')).toBe('application/json');
  });

  it('invokes unauthorized handler on 401 response', async () => {
    const unauthorizedSpy = vi.fn();
    setUnauthorizedHandler(unauthorizedSpy);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'unauthorized', message: 'Session expired' },
      }),
    });

    await expect(apiFetch('/api/protected')).rejects.toThrow(ApiRequestError);
    expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
  });

  it('parses structured ApiErrorResponse on failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 'bad_request',
          message: 'Custom validation message',
          requestId: 'req-123',
          retriable: false,
        },
      }),
    });

    await expect(apiFetch('/api/fail')).rejects.toThrowError(ApiRequestError);

    try {
      await apiFetch('/api/fail');
    } catch (err) {
      const error = err as ApiRequestError;
      expect(error.status).toBe(400);
      expect(error.code).toBe('bad_request');
      expect(error.message).toBe('Custom validation message');
      expect(error.requestId).toBe('req-123');
      expect(error.retriable).toBe(false);
    }
  });

  it('falls back to default message if error response is not JSON', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    await expect(apiFetch('/api/bad-gateway')).rejects.toThrow('Request failed with status 502.');
  });

  it('provides get, post, put, and del helper methods', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await api.get('/api/test-get');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe('GET');

    await api.post('/api/test-post', { foo: 'bar' });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].method).toBe('POST');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body).toBe(
      JSON.stringify({ foo: 'bar' }),
    );

    await api.put('/api/test-put', { bar: 'baz' });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[2][1].method).toBe('PUT');

    await api.del('/api/test-del');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[3][1].method).toBe('DELETE');
  });
});

describe('toErrorMessage', () => {
  it('formats ApiRequestError with requestId if present', () => {
    const error = new ApiRequestError('Repository not found.', {
      status: 404,
      requestId: 'req-abc',
    });
    expect(toErrorMessage(error)).toBe('Repository not found. (request req-abc)');
  });

  it('formats ApiRequestError without requestId', () => {
    const error = new ApiRequestError('General error.', { status: 500 });
    expect(toErrorMessage(error)).toBe('General error.');
  });

  it('formats standard Error and unknown values', () => {
    expect(toErrorMessage(new Error('Network disconnected'))).toBe('Network disconnected');
    expect(toErrorMessage('some string')).toBe('Unexpected error.');
  });
});

describe('run helper', () => {
  beforeEach(() => {
    toast.clear();
  });

  it('executes action, toggles busy flag, and shows success toast', async () => {
    const busyStates: boolean[] = [];
    const busySetter = (state: boolean) => busyStates.push(state);

    const result = await run(
      async () => {
        return { count: 42 };
      },
      'Action completed successfully.',
      busySetter,
    );

    expect(result).toEqual({ count: 42 });
    expect(busyStates).toEqual([true, false]);
    expect(toast.message).toBe('Action completed successfully.');
    expect(toast.tone).toBe('success');
  });

  it('catches errors, triggers error toast with request id, resets busy, and returns null', async () => {
    const busyStates: boolean[] = [];
    const busySetter = (state: boolean) => busyStates.push(state);

    const result = await run(
      async () => {
        throw new ApiRequestError('Commit failed.', {
          status: 400,
          requestId: 'req-456',
        });
      },
      {
        okText: 'Never shown',
        busy: busySetter,
      },
    );

    expect(result).toBeNull();
    expect(busyStates).toEqual([true, false]);
    expect(toast.message).toBe('Commit failed. (request req-456)');
    expect(toast.tone).toBe('error');
  });

  it('supports function for okText derived from result', async () => {
    const result = await run(
      async () => ({ branch: 'feature/test' }),
      (res) => `Switched to ${res.branch}.`,
    );

    expect(result).toEqual({ branch: 'feature/test' });
    expect(toast.message).toBe('Switched to feature/test.');
  });

  it('rethrows when rethrow option is true', async () => {
    await expect(
      run(
        async () => {
          throw new Error('Fatal error');
        },
        { rethrow: true },
      ),
    ).rejects.toThrow('Fatal error');
  });
});
