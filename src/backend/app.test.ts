// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { AuthService } from "./services/auth-service.js";
import { WorkspaceService } from "./services/workspace-service.js";
import { runCommand } from "./utils/process.js";

describe("createApp", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-app-"));
    await runCommand("git", ["init"], { cwd: tempDir });
    await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await runCommand("git", ["config", "user.name", "PiMobile Test"], { cwd: tempDir });
    await writeFile(path.join(tempDir, "README.md"), "# temp repo\n", "utf8");
    await runCommand("git", ["add", "README.md"], { cwd: tempDir });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: tempDir });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("protects workspace routes until a valid login cookie is present", async () => {
    const config = {
      nodeEnv: "test" as const,
      host: "127.0.0.1",
      port: 3000,
      appPassword: "secret-pass",
      workspaceRoot: tempDir,
      costsDbPath: path.join(tempDir, ".pi-mobile", "costs.sqlite"),
      sessionCookieName: "pi_mobile_session",
      sessionCookieSecure: false,
    };
    const authService = new AuthService(config.appPassword);
    const workspaceService = new WorkspaceService(tempDir);
    await workspaceService.initializeDefaultRepo();
    const getCommandState = vi.fn(async () => ({
      session: null,
      models: [],
      thinkingLevels: [],
      autoCompactEnabled: false,
      resumeSessions: [],
      treeEntries: [],
      forkEntries: [],
    }));
    const executeCommand = vi.fn(async () => ({
      message: "Started a new session.",
      prompt: null,
    }));
    const getCostReport = vi.fn(() => ({
      summary: {
        totalSessions: 1,
        totalCost: 2.75,
        totalTokens: 355,
        inputTokens: 240,
        outputTokens: 95,
        cacheReadTokens: 20,
        cacheWriteTokens: 0,
      },
      sessions: [
        {
          sessionKey: "repo-a:session-1",
          sessionId: "session-1",
          sessionFile: "/workspace/repo-a/.pi/sessions/session-1.json",
          repoName: path.basename(tempDir),
          repoRelativePath: path.basename(tempDir),
          repoAbsolutePath: tempDir,
          modelId: "anthropic/claude-sonnet-4",
          modelsUsed: ["anthropic/claude-sonnet-4"],
          startedAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-01T10:05:00.000Z",
          endedAt: "2026-05-01T10:06:00.000Z",
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
        },
      ],
      filters: {
        repos: [{ value: path.basename(tempDir), label: path.basename(tempDir) }],
        models: [{ value: "anthropic/claude-sonnet-4", label: "anthropic/claude-sonnet-4" }],
      },
    }));

    const app = createApp({
      config,
      authService,
      workspaceService,
      repositoryRuntimeService: {
        selectRepo: vi.fn(async (relativePath: string) => workspaceService.selectRepo(relativePath)),
      } as never,
      fileService: {
        browse: vi.fn(async () => []),
        readFile: vi.fn(async () => ({ path: "README.md", content: "# temp repo\n" })),
        writeFile: vi.fn(async () => undefined),
      } as never,
      gitService: {
        getDiff: vi.fn(async () => []),
        revertHunk: vi.fn(async () => undefined),
      } as never,
      costService: {
        getReport: getCostReport,
      } as never,
      piAgentService: {
        getSnapshot: vi.fn(() => ({ repo: workspaceService.getCurrentRepo(), isConfigured: true, isStreaming: false, messages: [], tools: [], lastError: null })),
        getCommandState,
        executeCommand,
        prompt: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      } as never,
    });

    const unauthorized = await request(app).get("/api/workspaces/browse");

    expect(unauthorized.status).toBe(401);

    const login = await request(app).post("/api/auth/login").send({ password: "secret-pass" });

    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]).toBeDefined();
    expect(login.headers["set-cookie"][0]).not.toContain("Secure");

    const cookie = login.headers["set-cookie"];
    const authorized = await request(app).get("/api/workspaces/browse").set("Cookie", cookie);
    const commandStateResponse = await request(app).get("/api/agent/command-state").set("Cookie", cookie);
    const commandExecuteResponse = await request(app).post("/api/agent/command").set("Cookie", cookie).send({ command: "new-session" });
    const costResponse = await request(app).get("/api/costs?repo=repo-a&model=anthropic%2Fclaude-sonnet-4&from=2026-05-01T00%3A00%3A00.000Z&to=2026-05-02T00%3A00%3A00.000Z").set("Cookie", cookie);

    expect(authorized.status).toBe(200);
    expect(authorized.body.entries).toEqual([]);
    expect(authorized.body.currentRepo.name).toBe(path.basename(tempDir));
    expect(commandStateResponse.status).toBe(200);
    expect(commandStateResponse.body).toEqual({
      session: null,
      models: [],
      thinkingLevels: [],
      autoCompactEnabled: false,
      resumeSessions: [],
      treeEntries: [],
      forkEntries: [],
    });
    expect(getCommandState).toHaveBeenCalledTimes(1);
    expect(commandExecuteResponse.status).toBe(200);
    expect(commandExecuteResponse.body).toEqual({
      message: "Started a new session.",
      prompt: null,
    });
    expect(executeCommand).toHaveBeenCalledWith({ command: "new-session" });
    expect(costResponse.status).toBe(200);
    expect(costResponse.body.summary.totalCost).toBe(2.75);
    expect(getCostReport).toHaveBeenCalledWith({
      repo: "repo-a",
      model: "anthropic/claude-sonnet-4",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-02T00:00:00.000Z",
    });
  });
});
