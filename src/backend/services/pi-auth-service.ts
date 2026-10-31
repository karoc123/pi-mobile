import fs from 'node:fs';
import path from 'node:path';

import {
  getAgentDir,
  ModelRuntime,
  CredentialSynchronizationError,
} from '@earendil-works/pi-coding-agent';

import type { PiAuthProviderState } from '../../shared/contracts.js';
import type { AppConfig } from '../config.js';
import { PiOAuthLogin } from './pi-oauth-login.js';

export type PiAuthErrorCode = 'unknown_provider' | 'invalid_token' | 'login_conflict';

export class PiAuthServiceError extends Error {
  constructor(
    readonly code: PiAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PiAuthServiceError';
  }
}

export class PiAuthService {
  private readonly authPath: string;
  private readonly modelsPath?: string;
  private runtimePromise: Promise<ModelRuntime> | null = null;

  private loginFlow: PiOAuthLogin | null = null;
  private loginTask: Promise<void> | null = null;
  private retentionTimer?: ReturnType<typeof setTimeout>;

  constructor(
    config: AppConfig,
    private readonly onAuthChanged: () => Promise<void> = async () => {},
  ) {
    this.authPath = config.piAgentDir
      ? path.join(config.piAgentDir, 'auth.json')
      : path.join(getAgentDir(), 'auth.json');
    this.modelsPath = config.piAgentDir ? path.join(config.piAgentDir, 'models.json') : undefined;
  }

  private async getRuntime(): Promise<ModelRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = ModelRuntime.create({
        authPath: this.authPath,
        modelsPath: this.modelsPath,
      });
    }
    return this.runtimePromise;
  }

  getLogin(owner: string) {
    return this.loginFlow?.owner === owner ? this.loginFlow : null;
  }

  async startLogin(owner: string, provider: string, method: 'device_code' | 'browser') {
    const runtime = await this.getRuntime();
    if (!runtime.getProvider(provider)?.auth?.oauth) {
      throw new PiAuthServiceError(
        'unknown_provider',
        'This provider does not support account sign-in.',
      );
    }
    if (this.loginTask) {
      throw new PiAuthServiceError(
        'login_conflict',
        'Another sign-in is running. Finish or cancel it first.',
      );
    }
    clearTimeout(this.retentionTimer);
    const flow = new PiOAuthLogin(owner, provider, method);
    this.loginFlow = flow;
    this.loginTask = Promise.resolve().then(() => this.runLogin(runtime, flow));
    return flow.state;
  }

  private async runLogin(runtime: ModelRuntime, flow: PiOAuthLogin) {
    try {
      try {
        await runtime.login(flow.state.provider, 'oauth', flow.interaction);
      } catch (error) {
        if (!(error instanceof CredentialSynchronizationError)) throw error;
      }
      try {
        await this.onAuthChanged();
        flow.finish('succeeded', 'Connected. You can now select a model from this provider.');
      } catch {
        flow.finish(
          'succeeded',
          'Credentials saved. Reload the workspace to refresh the model list.',
        );
      }
    } catch (error) {
      if (flow.active) {
        const message = error instanceof Error ? error.message : '';
        flow.finish(
          'failed',
          message.includes('device code login is not enabled')
            ? 'Device-code sign-in is unavailable. Enable it in your account settings or try browser sign-in.'
            : 'Sign-in failed or was denied. Start again, or try browser sign-in.',
        );
      }
    } finally {
      this.loginTask = null;
      this.retentionTimer = setTimeout(() => {
        if (this.loginFlow === flow) this.loginFlow = null;
      }, 5 * 60_000);
      this.retentionTimer.unref();
    }
  }

  async cancelLogin(owner: string) {
    const flow = this.getLogin(owner);
    if (!flow) return;
    flow.cancel();
    await this.loginTask;
  }

  async dispose() {
    this.loginFlow?.cancel();
    await this.loginTask;
    clearTimeout(this.retentionTimer);
    this.loginFlow = null;
  }

  private requireNoLogin() {
    if (this.loginTask) {
      throw new PiAuthServiceError(
        'login_conflict',
        'Finish or cancel the current account sign-in first.',
      );
    }
  }

  async getStatus() {
    const runtime = await this.getRuntime();
    await runtime.refresh({ allowNetwork: false });

    return {
      providers: this.resolveProviders(runtime),
    };
  }

  async loginToken(provider: string, token: string) {
    this.requireNoLogin();
    const normalizedProvider = provider.trim();
    const normalizedToken = token.trim();
    const runtime = await this.getRuntime();
    this.requireNoLogin();

    if (!this.isKnownProvider(runtime, normalizedProvider)) {
      throw new PiAuthServiceError(
        'unknown_provider',
        `Provider '${normalizedProvider}' is not registered.`,
      );
    }

    if (!normalizedToken) {
      throw new PiAuthServiceError(
        'invalid_token',
        `Token validation for provider '${normalizedProvider}' failed.`,
      );
    }

    if (!runtime.getProvider(normalizedProvider)?.auth?.apiKey?.login) {
      throw new PiAuthServiceError(
        'invalid_token',
        'This provider requires account sign-in or external credential setup.',
      );
    }
    let suppliedToken = false;
    await runtime.login(normalizedProvider, 'api_key', {
      prompt: async (prompt) => {
        if (suppliedToken || prompt.type !== 'secret') {
          throw new PiAuthServiceError(
            'invalid_token',
            'This provider requires additional setup. Use Pi CLI /login with the same agent directory.',
          );
        }
        suppliedToken = true;
        return normalizedToken;
      },
      notify: () => {},
    });

    await this.onAuthChanged();

    return {
      ok: true as const,
      provider: normalizedProvider,
      configured: true as const,
    };
  }

  async logout(provider: string) {
    this.requireNoLogin();
    const normalizedProvider = provider.trim();
    const runtime = await this.getRuntime();
    this.requireNoLogin();

    if (!this.isKnownProvider(runtime, normalizedProvider)) {
      throw new PiAuthServiceError(
        'unknown_provider',
        `Provider '${normalizedProvider}' is not registered.`,
      );
    }

    await runtime.logout(normalizedProvider);
    await runtime.refresh({ allowNetwork: false });

    await this.onAuthChanged();

    return {
      ok: true as const,
      provider: normalizedProvider,
      configured: false as const,
    };
  }

  private resolveProviders(runtime: ModelRuntime): PiAuthProviderState[] {
    const providerMap = new Map<string, PiAuthProviderState>();

    for (const provider of runtime.getProviders()) {
      providerMap.set(provider.id, {
        provider: provider.id,
        label:
          provider.id === 'openai'
            ? 'OpenAI API'
            : provider.id === 'openai-codex'
              ? 'OpenAI Codex / ChatGPT subscription'
              : provider.name,
        configured: runtime.getProviderAuthStatus(provider.id).configured,
        supportsOAuth: Boolean(provider.auth?.oauth),
        supportsApiKey: Boolean(provider.auth?.apiKey?.login),
        authMethod: runtime.isUsingOAuth(provider.id)
          ? 'oauth'
          : runtime.hasConfiguredAuth(provider.id)
            ? 'api_key'
            : null,
        subscription: runtime.isUsingSubscription(provider.id),
      });
    }

    for (const model of runtime.getModels()) {
      if (!providerMap.has(model.provider)) {
        providerMap.set(model.provider, {
          provider: model.provider,
          label: runtime.getProvider(model.provider)?.name ?? model.provider,
          configured: runtime.getProviderAuthStatus(model.provider).configured,
        });
      }
    }

    const authData = readAuthJson(this.authPath);
    for (const provider of Object.keys(authData)) {
      if (!providerMap.has(provider)) {
        providerMap.set(provider, {
          provider,
          label: runtime.getProvider(provider)?.name ?? provider,
          configured: runtime.getProviderAuthStatus(provider).configured,
        });
      }
    }

    return [...providerMap.values()].sort((left, right) => left.label.localeCompare(right.label));
  }

  private isKnownProvider(runtime: ModelRuntime, provider: string) {
    if (!provider) {
      return false;
    }

    return (
      runtime.getProvider(provider) !== undefined ||
      this.resolveProviders(runtime).some((candidate) => candidate.provider === provider)
    );
  }
}

function readAuthJson(authPath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(authPath)) {
      return {};
    }
    const raw = fs.readFileSync(authPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
