// @vitest-environment node

import { describe, expect, it } from "vitest";

import { PiAgentSessionAdapter } from "./pi-agent-session-adapter.js";

describe("PiAgentSessionAdapter", () => {
  it("exposes idle runtime state before a session is created", () => {
    const adapter = new PiAgentSessionAdapter(
      {
        nodeEnv: "test",
        host: "127.0.0.1",
        port: 3000,
        appPassword: "secret-pass",
        workspaceRoot: "/tmp",
        defaultRepo: undefined,
        gitUserName: undefined,
        gitUserEmail: undefined,
        costsDbPath: "/tmp/.pi-mobile/costs.sqlite",
        logsDirPath: "/tmp/.pi-mobile/logs",
        logLevel: "debug",
        sessionCookieName: "pi_mobile_session",
        sessionCookieSecure: false,
        piAgentDir: undefined,
        piProvider: undefined,
        piModel: undefined,
        piSessionDir: undefined,
        piThinkingLevel: undefined,
        piMockMode: false,
      },
      {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      () => undefined,
    );

    expect(adapter.getSession()).toBeNull();
    expect(adapter.getUsageSummary()).toBeNull();
    expect(adapter.getRuntimeState()).toEqual({
      isStreaming: false,
      runtimePhase: "idle",
      pendingMessageCount: 0,
      isCompacting: false,
      isRetrying: false,
      isBashRunning: false,
    });
  });
});
