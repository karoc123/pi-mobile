// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runCommandMock } = vi.hoisted(() => ({
  runCommandMock: vi.fn(),
}));

vi.mock("../utils/process.js", () => ({
  runCommand: runCommandMock,
}));

import { WorkspaceService } from "./workspace-service.js";

describe("WorkspaceService", () => {
  let tempDir = "";

  beforeEach(() => {
    runCommandMock.mockReset();
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("uses the configured git ssh policy when cloning repositories", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-workspace-"));

    const gitEnv = {
      GIT_SSH_COMMAND: "ssh -i '/home/node/.ssh/id_ed25519' -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile='/data/db/known_hosts'",
    } as NodeJS.ProcessEnv;

    runCommandMock.mockResolvedValueOnce({ stdout: "", stderr: "" }).mockResolvedValueOnce({ stdout: `${path.join(tempDir, "repo-clone")}\n`, stderr: "" });

    const service = new WorkspaceService(tempDir, undefined, gitEnv);

    const repo = await service.cloneRepo("git@github.com:example/repo.git", "repo-clone");

    expect(repo.name).toBe("repo-clone");
    expect(runCommandMock).toHaveBeenNthCalledWith(1, "git", ["clone", "git@github.com:example/repo.git", path.join(tempDir, "repo-clone")], {
      env: gitEnv,
    });
  });
});
