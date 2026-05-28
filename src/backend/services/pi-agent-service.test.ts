// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { CostService } from "./cost-service.js";
import { PiAgentService } from "./pi-agent-service.js";

describe("PiAgentService", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("persists mock-mode costs per session and finalizes them on reset", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-agent-costs-"));

    const costService = new CostService(path.join(tempDir, ".pi-mobile", "costs.sqlite"));
    const service = new PiAgentService(
      {
        nodeEnv: "test",
        host: "127.0.0.1",
        port: 3000,
        appPassword: "secret-pass",
        workspaceRoot: tempDir,
        costsDbPath: path.join(tempDir, ".pi-mobile", "costs.sqlite"),
        sessionCookieName: "pi_mobile_session",
        piMockMode: true,
      },
      () => undefined,
      costService,
    );

    await service.selectRepo({
      name: "repo-a",
      relativePath: "repo-a",
      absolutePath: path.join(tempDir, "repo-a"),
    });

    await service.prompt("Create a short README with project goals.");
    await service.startNewSession();
    await service.prompt("Summarize the architecture in one paragraph.");
    await service.dispose();

    const report = costService.getReport({});

    expect(report.summary.totalSessions).toBe(2);
    expect(report.summary.totalCost).toBeGreaterThan(0);
    expect(report.sessions).toHaveLength(2);
    expect(report.sessions.every((session) => session.repoRelativePath === "repo-a")).toBe(true);
    expect(report.sessions.every((session) => session.totalTokens > 0)).toBe(true);
    expect(report.sessions.every((session) => session.endedAt !== null)).toBe(true);
  });
});
