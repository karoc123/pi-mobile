// @vitest-environment node

import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("treats blank optional environment values as unset", () => {
    const config = loadConfig({
      APP_PASSWORD: "secret-pass",
      WORKSPACE_ROOT: "/workspace",
      DEFAULT_REPO: "",
      PI_PROVIDER: "",
      PI_MODEL: "",
      PI_THINKING_LEVEL: "",
    });

    expect(config.defaultRepo).toBeUndefined();
    expect(config.piProvider).toBeUndefined();
    expect(config.piModel).toBeUndefined();
    expect(config.piThinkingLevel).toBeUndefined();
    expect(config.sessionCookieSecure).toBe(false);
  });

  it("defaults secure cookies only in production and allows overriding them", () => {
    const productionConfig = loadConfig({
      APP_PASSWORD: "secret-pass",
      WORKSPACE_ROOT: "/workspace",
      NODE_ENV: "production",
    });
    const overriddenConfig = loadConfig({
      APP_PASSWORD: "secret-pass",
      WORKSPACE_ROOT: "/workspace",
      NODE_ENV: "production",
      SESSION_COOKIE_SECURE: "false",
    });

    expect(productionConfig.sessionCookieSecure).toBe(true);
    expect(overriddenConfig.sessionCookieSecure).toBe(false);
  });

  it("uses container persistence defaults in production when explicit paths are missing", () => {
    const config = loadConfig({
      APP_PASSWORD: "secret-pass",
      WORKSPACE_ROOT: "/workspace",
      NODE_ENV: "production",
    });

    expect(config.costsDbPath).toBe("/data/db/costs.sqlite");
    expect(config.logsDirPath).toBe("/data/db/logs");
    expect(config.piAgentDir).toBe("/data/pi/agent");
    expect(config.piSessionDir).toBe("/data/pi/sessions");
    expect(config.sshPrivateKeyTarget).toBe("/home/node/.ssh/id_ed25519");
    expect(config.sshKnownHostsPath).toBe("/data/db/known_hosts");
  });
});
