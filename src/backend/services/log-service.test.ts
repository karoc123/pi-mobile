// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { LogService } from "./log-service.js";

describe("LogService", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("stores filtered entries and redacts sensitive fields", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-log-service-"));

    const service = new LogService({
      logDirPath: path.join(tempDir, "logs"),
      minLevel: "debug",
    });

    service.info("Request completed.", {
      source: "http",
      details: {
        requestPath: "/api/test",
        authToken: "abc123",
      },
    });

    service.error("Runtime failed.", {
      source: "pi-agent",
      details: {
        password: "secret",
      },
    });

    await service.flush();

    const all = service.queryLogs({ limit: 50 });
    const errors = service.queryLogs({ limit: 50, level: "error" });

    expect(all.entries).toHaveLength(2);
    expect(errors.entries).toHaveLength(1);
    expect(errors.entries[0].message).toBe("Runtime failed.");

    const redacted = all.entries[0].details as { authToken?: string };
    expect(redacted.authToken).toBe("[REDACTED]");
  });
});
