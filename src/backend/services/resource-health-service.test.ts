// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { ResourceHealthService } from "./resource-health-service.js";

describe("ResourceHealthService", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("reports required resources as accessible when directories are writable", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-health-"));
    const piAgentDir = path.join(tempDir, ".pi", "agent");
    const piSessionDir = path.join(piAgentDir, "sessions");

    await mkdir(piSessionDir, { recursive: true });

    const service = new ResourceHealthService({
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
      piAgentDir,
      piSessionDir,
      piMockMode: false,
    });

    const report = await service.check();

    expect(report.allRequiredAccessible).toBe(true);
    expect(report.checks.filter((check) => check.required && !check.ok)).toHaveLength(0);
  });
});
