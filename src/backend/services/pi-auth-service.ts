import path from "node:path";

import { AuthStorage, ModelRegistry, type AuthCredential } from "@earendil-works/pi-coding-agent";

import type { PiAuthProviderState } from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";

export type PiAuthErrorCode = "unknown_provider" | "invalid_token";

export class PiAuthServiceError extends Error {
  constructor(
    readonly code: PiAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PiAuthServiceError";
  }
}

export class PiAuthService {
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;

  constructor(config: AppConfig) {
    this.authStorage = config.piAgentDir ? AuthStorage.create(path.join(config.piAgentDir, "auth.json")) : AuthStorage.create();
    this.modelRegistry = config.piAgentDir ? ModelRegistry.create(this.authStorage, path.join(config.piAgentDir, "models.json")) : ModelRegistry.create(this.authStorage);
  }

  getStatus() {
    return {
      providers: this.resolveProviders(),
    };
  }

  async loginToken(provider: string, token: string) {
    const normalizedProvider = provider.trim();
    const normalizedToken = token.trim();

    if (!this.isKnownProvider(normalizedProvider)) {
      throw new PiAuthServiceError("unknown_provider", `Provider '${normalizedProvider}' is not registered.`);
    }

    const previousCredential = this.authStorage.get(normalizedProvider);
    this.authStorage.set(normalizedProvider, {
      type: "api_key",
      key: normalizedToken,
    });

    const resolvedApiKey = await this.modelRegistry.getApiKeyForProvider(normalizedProvider);

    if (!resolvedApiKey || resolvedApiKey.trim().length === 0) {
      this.restorePreviousCredential(normalizedProvider, previousCredential);
      throw new PiAuthServiceError("invalid_token", `Token validation for provider '${normalizedProvider}' failed.`);
    }

    return {
      ok: true as const,
      provider: normalizedProvider,
      configured: true as const,
    };
  }

  logout(provider: string) {
    const normalizedProvider = provider.trim();

    if (!this.isKnownProvider(normalizedProvider)) {
      throw new PiAuthServiceError("unknown_provider", `Provider '${normalizedProvider}' is not registered.`);
    }

    this.authStorage.logout(normalizedProvider);

    return {
      ok: true as const,
      provider: normalizedProvider,
      configured: false as const,
    };
  }

  private resolveProviders(): PiAuthProviderState[] {
    const providerNames = new Set<string>();

    for (const model of this.modelRegistry.getAll()) {
      providerNames.add(model.provider);
    }

    for (const provider of this.authStorage.list()) {
      providerNames.add(provider);
    }

    return [...providerNames]
      .map((provider) => ({
        provider,
        label: this.modelRegistry.getProviderDisplayName(provider),
        configured: this.modelRegistry.getProviderAuthStatus(provider).configured,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  private isKnownProvider(provider: string) {
    if (!provider) {
      return false;
    }

    return this.resolveProviders().some((candidate) => candidate.provider === provider);
  }

  private restorePreviousCredential(provider: string, previousCredential: AuthCredential | undefined) {
    if (previousCredential) {
      this.authStorage.set(provider, previousCredential);
      return;
    }

    this.authStorage.remove(provider);
  }
}
