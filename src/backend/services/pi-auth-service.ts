import fs from 'node:fs';
import path from 'node:path';

import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent';

import type { PiAuthProviderState } from '../../shared/contracts.js';
import type { AppConfig } from '../config.js';

export type PiAuthErrorCode = 'unknown_provider' | 'invalid_token';

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

  constructor(config: AppConfig) {
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

  async getStatus() {
    const runtime = await this.getRuntime();
    await runtime.refresh({ allowNetwork: false });

    return {
      providers: this.resolveProviders(runtime),
    };
  }

  async loginToken(provider: string, token: string) {
    const normalizedProvider = provider.trim();
    const normalizedToken = token.trim();
    const runtime = await this.getRuntime();

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

    const authData = readAuthJson(this.authPath);
    const previousCredential = authData[normalizedProvider];

    authData[normalizedProvider] = {
      type: 'api_key',
      key: normalizedToken,
    };
    writeAuthJson(this.authPath, authData);

    await runtime.refresh({ allowNetwork: false });

    const auth = await runtime.getAuth(normalizedProvider);
    const resolvedApiKey = auth?.auth.apiKey;

    if (!resolvedApiKey || resolvedApiKey.trim().length === 0) {
      if (previousCredential !== undefined) {
        authData[normalizedProvider] = previousCredential;
      } else {
        delete authData[normalizedProvider];
      }
      writeAuthJson(this.authPath, authData);
      await runtime.refresh({ allowNetwork: false });
      throw new PiAuthServiceError(
        'invalid_token',
        `Token validation for provider '${normalizedProvider}' failed.`,
      );
    }

    return {
      ok: true as const,
      provider: normalizedProvider,
      configured: true as const,
    };
  }

  async logout(provider: string) {
    const normalizedProvider = provider.trim();
    const runtime = await this.getRuntime();

    if (!this.isKnownProvider(runtime, normalizedProvider)) {
      throw new PiAuthServiceError(
        'unknown_provider',
        `Provider '${normalizedProvider}' is not registered.`,
      );
    }

    const authData = readAuthJson(this.authPath);
    delete authData[normalizedProvider];
    writeAuthJson(this.authPath, authData);

    await runtime.logout(normalizedProvider).catch(() => undefined);
    await runtime.refresh({ allowNetwork: false });

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
        label: provider.name,
        configured: runtime.getProviderAuthStatus(provider.id).configured,
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

function writeAuthJson(authPath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(authPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(authPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
}
