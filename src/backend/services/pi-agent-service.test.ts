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
        logsDirPath: path.join(tempDir, ".pi-mobile", "logs"),
        logLevel: "debug",
        sessionCookieName: "pi_mobile_session",
        sessionCookieSecure: false,
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

  it("wires mock prompt and command-state through the mock adapter seam", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-agent-wiring-"));

    const events: string[] = [];
    const costService = new CostService(path.join(tempDir, ".pi-mobile", "costs.sqlite"));
    const service = new PiAgentService(
      {
        nodeEnv: "test",
        host: "127.0.0.1",
        port: 3000,
        appPassword: "secret-pass",
        workspaceRoot: tempDir,
        costsDbPath: path.join(tempDir, ".pi-mobile", "costs.sqlite"),
        logsDirPath: path.join(tempDir, ".pi-mobile", "logs"),
        logLevel: "debug",
        sessionCookieName: "pi_mobile_session",
        sessionCookieSecure: false,
        piMockMode: true,
      },
      (event) => {
        events.push(event.type);
      },
      costService,
    );

    await service.selectRepo({
      name: "repo-b",
      relativePath: "repo-b",
      absolutePath: path.join(tempDir, "repo-b"),
    });

    await service.prompt("single word done");

    const stateAfterPrompt = await service.getCommandState();
    const snapshotAfterPrompt = service.getSnapshot();

    expect(stateAfterPrompt.session?.totalMessages).toBe(2);
    expect(snapshotAfterPrompt.messages.at(-1)?.text).toBe("DONE");
    expect(snapshotAfterPrompt.messages.at(-1)?.status).toBe("complete");
    expect(events.filter((type) => type === "chat_message_added").length).toBe(2);
    expect(events.includes("chat_message_updated")).toBe(true);

    await service.executeCommand({ command: "new-session" });

    const stateAfterReset = await service.getCommandState();
    expect(stateAfterReset.session?.totalMessages).toBe(0);
  });
});
