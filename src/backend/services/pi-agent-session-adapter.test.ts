// @vitest-environment node

import { describe, expect, it } from "vitest";

import { PiAgentSessionAdapter } from "./pi-agent-session-adapter.js";

function createAdapter() {
  return new PiAgentSessionAdapter(
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
}

describe("PiAgentSessionAdapter", () => {
  it("exposes idle runtime state before a session is created", () => {
    const adapter = createAdapter();

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

  it("falls back to assistant message usage cost when session stats report zero", () => {
    const adapter = createAdapter();

    (adapter as unknown as { session: unknown }).session = {
      getSessionStats: () => ({
        tokens: {
          input: 220,
          output: 44,
          cacheRead: 100,
          cacheWrite: 0,
          total: 364,
        },
        cost: 0,
      }),
      getContextUsage: () => ({
        tokens: 364,
        contextWindow: 400000,
        percent: 0.1,
      }),
      model: {
        id: "gpt-5.3-codex",
        contextWindow: 400000,
      },
      modelRegistry: {
        isUsingOAuth: () => false,
      },
      autoCompactionEnabled: true,
      messages: [
        {
          role: "user",
        },
        {
          role: "assistant",
          usage: {
            cost: {
              total: 0.00041,
            },
          },
        },
        {
          role: "assistant",
          usage: {
            cost: {
              total: 0.00032,
            },
          },
        },
      ],
    };

    expect(adapter.getUsageSummary()).toEqual({
      inputTokens: 220,
      outputTokens: 44,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      totalTokens: 364,
      totalCost: 0.00073,
      contextTokens: 364,
      contextWindow: 400000,
      contextPercent: 0.1,
      modelId: "gpt-5.3-codex",
      usingSubscription: false,
      autoCompactEnabled: true,
    });
  });

  it("keeps direct session stats cost when available", () => {
    const adapter = createAdapter();

    (adapter as unknown as { session: unknown }).session = {
      getSessionStats: () => ({
        tokens: {
          input: 10,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          total: 18,
        },
        cost: 0.124,
      }),
      getContextUsage: () => null,
      model: {
        id: "gpt-5.4-nano",
        contextWindow: 200000,
      },
      modelRegistry: {
        isUsingOAuth: () => true,
      },
      autoCompactionEnabled: false,
      messages: [
        {
          role: "assistant",
          usage: {
            cost: {
              total: 0.001,
            },
          },
        },
      ],
    };

    expect(adapter.getUsageSummary()).toEqual({
      inputTokens: 10,
      outputTokens: 8,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 18,
      totalCost: 0.124,
      contextTokens: null,
      contextWindow: 200000,
      contextPercent: null,
      modelId: "gpt-5.4-nano",
      usingSubscription: true,
      autoCompactEnabled: false,
    });
  });
});
