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
      sessionCookieName: "pi_mobile_session",
    };
    const authService = new AuthService(config.appPassword);
    const workspaceService = new WorkspaceService(tempDir);
    await workspaceService.initializeDefaultRepo();

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
      piAgentService: {
        getSnapshot: vi.fn(() => ({ repo: workspaceService.getCurrentRepo(), isConfigured: true, isStreaming: false, messages: [], tools: [], lastError: null })),
        prompt: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      } as never,
    });

    const unauthorized = await request(app).get("/api/workspaces/browse");

    expect(unauthorized.status).toBe(401);

    const login = await request(app).post("/api/auth/login").send({ password: "secret-pass" });

    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]).toBeDefined();

    const cookie = login.headers["set-cookie"];
    const authorized = await request(app).get("/api/workspaces/browse").set("Cookie", cookie);

    expect(authorized.status).toBe(200);
    expect(authorized.body.entries).toEqual([]);
    expect(authorized.body.currentRepo.name).toBe(path.basename(tempDir));
  });
});
