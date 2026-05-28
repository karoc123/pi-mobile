// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { CostService } from "./cost-service.js";

describe("CostService", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("upserts session cost snapshots and preserves model history", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-costs-"));

    const service = new CostService(path.join(tempDir, ".pi-mobile", "costs.sqlite"));

    service.recordSession({
      sessionKey: "repo-a:session-1",
      sessionId: "session-1",
      sessionFile: "/workspace/repo-a/.pi/sessions/session-1.json",
      repoName: "repo-a",
      repoRelativePath: "repo-a",
      repoAbsolutePath: "/workspace/repo-a",
      modelId: "openai/gpt-5",
      startedAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:00:00.000Z",
      endedAt: null,
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 165,
      totalCost: 1.25,
      contextTokens: 165,
      contextWindow: 200000,
      contextPercent: 0.1,
      usingSubscription: false,
      autoCompactEnabled: true,
    });

    service.recordSession({
      sessionKey: "repo-a:session-1",
      sessionId: "session-1",
      sessionFile: "/workspace/repo-a/.pi/sessions/session-1.json",
      repoName: "repo-a",
      repoRelativePath: "repo-a",
      repoAbsolutePath: "/workspace/repo-a",
      modelId: "anthropic/claude-sonnet-4",
      startedAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:05:00.000Z",
      endedAt: null,
      inputTokens: 240,
      outputTokens: 95,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      totalTokens: 355,
      totalCost: 2.75,
      contextTokens: 355,
      contextWindow: 200000,
      contextPercent: 0.2,
      usingSubscription: true,
      autoCompactEnabled: true,
    });

    service.finalizeSession("repo-a:session-1", "2026-05-01T10:06:00.000Z");

    const report = service.getReport({});

    expect(report.summary.totalSessions).toBe(1);
    expect(report.summary.totalCost).toBe(2.75);
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0]).toMatchObject({
      sessionKey: "repo-a:session-1",
      repoRelativePath: "repo-a",
      modelId: "anthropic/claude-sonnet-4",
      startedAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:05:00.000Z",
      endedAt: "2026-05-01T10:06:00.000Z",
      usingSubscription: true,
      autoCompactEnabled: true,
    });
    expect(report.sessions[0].modelsUsed).toEqual(["anthropic/claude-sonnet-4", "openai/gpt-5"]);
    expect(report.filters.repos).toEqual([{ value: "repo-a", label: "repo-a" }]);
  });

  it("filters sessions by repository, model, and time range", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-costs-"));

    const service = new CostService(path.join(tempDir, ".pi-mobile", "costs.sqlite"));

    service.recordSession({
      sessionKey: "repo-a:session-1",
      sessionId: "session-1",
      sessionFile: "/workspace/repo-a/.pi/sessions/session-1.json",
      repoName: "repo-a",
      repoRelativePath: "repo-a",
      repoAbsolutePath: "/workspace/repo-a",
      modelId: "openai/gpt-5",
      startedAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:10:00.000Z",
      endedAt: "2026-05-01T10:12:00.000Z",
      inputTokens: 500,
      outputTokens: 250,
      cacheReadTokens: 25,
      cacheWriteTokens: 0,
      totalTokens: 775,
      totalCost: 4.2,
      contextTokens: 775,
      contextWindow: 200000,
      contextPercent: 0.4,
      usingSubscription: false,
      autoCompactEnabled: false,
    });

    service.recordSession({
      sessionKey: "repo-b:session-2",
      sessionId: "session-2",
      sessionFile: "/workspace/repo-b/.pi/sessions/session-2.json",
      repoName: "repo-b",
      repoRelativePath: "repo-b",
      repoAbsolutePath: "/workspace/repo-b",
      modelId: "anthropic/claude-sonnet-4",
      startedAt: "2026-05-03T08:00:00.000Z",
      updatedAt: "2026-05-03T08:15:00.000Z",
      endedAt: "2026-05-03T08:16:00.000Z",
      inputTokens: 300,
      outputTokens: 180,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      totalTokens: 490,
      totalCost: 2.1,
      contextTokens: 490,
      contextWindow: 200000,
      contextPercent: 0.2,
      usingSubscription: true,
      autoCompactEnabled: true,
    });

    const filtered = service.getReport({
      repo: "repo-a",
      model: "openai/gpt-5",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-02T00:00:00.000Z",
    });

    expect(filtered.summary.totalSessions).toBe(1);
    expect(filtered.summary.totalCost).toBe(4.2);
    expect(filtered.summary.totalTokens).toBe(775);
    expect(filtered.sessions).toHaveLength(1);
    expect(filtered.sessions[0].repoRelativePath).toBe("repo-a");
    expect(filtered.sessions[0].modelsUsed).toEqual(["openai/gpt-5"]);
    expect(filtered.filters.models).toEqual([
      { value: "anthropic/claude-sonnet-4", label: "anthropic/claude-sonnet-4" },
      { value: "openai/gpt-5", label: "openai/gpt-5" },
    ]);
  });
});
