// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import { PiAuthService, PiAuthServiceError } from "./pi-auth-service.js";

describe("PiAuthService", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("persists token auth and reports provider status", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-pi-auth-"));
    const config = createConfig(tempDir);
    const service = new PiAuthService(config);

    const before = service.getStatus();
    expect(before.providers.length).toBeGreaterThan(0);

    const provider = before.providers[0]?.provider;

    expect(provider).toBeTruthy();

    if (!provider) {
      return;
    }

    const loginResult = await service.loginToken(provider, "token-123");
    expect(loginResult).toEqual({ ok: true, provider, configured: true });

    const persistedService = new PiAuthService(config);
    const after = persistedService.getStatus();
    const providerState = after.providers.find((entry) => entry.provider === provider);
    expect(providerState?.configured).toBe(true);

    const logoutResult = persistedService.logout(provider);
    expect(logoutResult).toEqual({ ok: true, provider, configured: false });

    const afterLogout = new PiAuthService(config).getStatus();
    expect(afterLogout.providers.find((entry) => entry.provider === provider)?.configured).toBe(false);
  });

  it("rejects unknown providers", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-pi-auth-"));
    const service = new PiAuthService(createConfig(tempDir));

    await expect(service.loginToken("unknown-provider", "token-123")).rejects.toMatchObject<PiAuthServiceError>({
      code: "unknown_provider",
    });
  });
});

function createConfig(piAgentDir: string): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 3000,
    appPassword: "secret-pass",
    workspaceRoot: "/workspace",
    costsDbPath: "/tmp/costs.sqlite",
    logsDirPath: "/tmp/logs",
    logLevel: "info",
    sessionCookieName: "pi_mobile_session",
    sessionCookieSecure: false,
    piAgentDir,
    piSessionDir: path.join(piAgentDir, "sessions"),
    piMockMode: false,
  };
}
