import { randomUUID } from 'node:crypto';

import type { AuthEvent, AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai';

import type { PiAuthLoginState } from '../../shared/contracts.js';

export class PiOAuthLogin {
  readonly controller = new AbortController();
  readonly state: PiAuthLoginState;
  private readonly listeners = new Set<(state: PiAuthLoginState) => void>();
  private pending?: { id: string; resolve: (answer: string) => void };
  private timer: ReturnType<typeof setTimeout>;

  constructor(
    readonly owner: string,
    provider: string,
    private readonly method: 'device_code' | 'browser',
    timeoutMs = 15 * 60_000,
  ) {
    this.state = {
      id: randomUUID(),
      provider,
      status: 'pending',
      message: 'Starting sign-in…',
      expiresAt: Date.now() + timeoutMs,
    };
    this.timer = this.expiryTimer(timeoutMs);
  }

  private expiryTimer(timeoutMs: number) {
    const timer = setTimeout(() => {
      this.finish('failed', 'Sign-in expired. Start again to get a new code.');
      this.controller.abort();
    }, timeoutMs);
    timer.unref();
    return timer;
  }

  get active() {
    return this.state.status === 'pending';
  }

  subscribe(listener: (state: PiAuthLoginState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  readonly interaction: AuthInteraction = {
    signal: this.controller.signal,
    notify: (event) => this.notify(event),
    prompt: (prompt) => this.prompt(prompt),
  };

  private notify(event: AuthEvent) {
    if (!this.active) return;
    if (event.type === 'device_code') {
      this.state.userCode = event.userCode;
      this.state.url = safeAuthUrl(event.verificationUri);
      this.state.message = 'Open the sign-in page and enter this code. Keep this window open.';
      if (event.expiresInSeconds) {
        this.state.expiresAt = Math.min(
          this.state.expiresAt,
          Date.now() + event.expiresInSeconds * 1000,
        );
        clearTimeout(this.timer);
        this.timer = this.expiryTimer(Math.max(0, this.state.expiresAt - Date.now()));
      }
    } else if (event.type === 'auth_url') {
      this.state.url = safeAuthUrl(event.url);
      this.state.message = event.instructions ?? 'Open the sign-in page to continue.';
    } else {
      this.state.message = event.message;
      if (event.type === 'info' && event.links?.[0]) {
        this.state.url = safeAuthUrl(event.links[0].url);
      }
    }
    this.publish();
  }

  private prompt(prompt: AuthPrompt): Promise<string> {
    if (!this.active || prompt.signal?.aborted)
      return Promise.reject(new Error('Sign-in cancelled.'));
    if (
      this.state.provider === 'openai-codex' &&
      prompt.type === 'select' &&
      prompt.options.some((option) => option.id === 'device_code') &&
      prompt.options.some((option) => option.id === 'browser')
    ) {
      return Promise.resolve(this.method);
    }
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => {
        this.controller.signal.removeEventListener('abort', abort);
        prompt.signal?.removeEventListener('abort', abort);
        if (this.pending?.id === id) {
          this.pending = undefined;
          delete this.state.prompt;
          this.publish();
        }
      };
      const abort = () => {
        cleanup();
        reject(new Error('Sign-in cancelled.'));
      };
      this.pending = {
        id,
        resolve: (answer) => {
          cleanup();
          resolve(answer);
        },
      };
      this.state.prompt = {
        id,
        type: prompt.type,
        message: prompt.message,
        ...('placeholder' in prompt ? { placeholder: prompt.placeholder } : {}),
        ...(prompt.type === 'select' ? { options: prompt.options } : {}),
      };
      this.controller.signal.addEventListener('abort', abort, { once: true });
      prompt.signal?.addEventListener('abort', abort, { once: true });
      this.publish();
    });
  }

  answer(promptId: string, answer: string): boolean {
    const prompt = this.state.prompt;
    if (!this.active || !this.pending || this.pending.id !== promptId || !answer.trim())
      return false;
    if (prompt?.type === 'select' && !prompt.options?.some((option) => option.id === answer)) {
      return false;
    }
    if (this.state.provider === 'openai-codex' && prompt?.type === 'manual_code') {
      try {
        const redirect = new URL(answer);
        const expectedState = new URL(this.state.url ?? '').searchParams.get('state');
        if (
          redirect.origin !== 'http://localhost:1455' ||
          redirect.pathname !== '/auth/callback' ||
          !redirect.searchParams.get('code') ||
          !expectedState ||
          redirect.searchParams.get('state') !== expectedState
        )
          return false;
      } catch {
        return false;
      }
    }
    this.pending.resolve(answer);
    return true;
  }

  finish(status: Exclude<PiAuthLoginState['status'], 'pending'>, message: string) {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.state.status = status;
    this.state.message = message;
    delete this.state.prompt;
    delete this.state.userCode;
    delete this.state.url;
    this.publish();
  }

  cancel() {
    this.finish('cancelled', 'Sign-in cancelled. You can start again.');
    this.controller.abort();
  }

  private publish() {
    for (const listener of this.listeners) listener(this.state);
  }
}

function safeAuthUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
