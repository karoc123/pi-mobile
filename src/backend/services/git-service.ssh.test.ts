// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCommandMock } = vi.hoisted(() => ({
  runCommandMock: vi.fn(),
}));

vi.mock("../utils/process.js", () => ({
  runCommand: runCommandMock,
}));

import { GitService } from "./git-service.js";

describe("GitService SSH policy", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
  });

  it("reuses the configured git ssh policy for pull and push", async () => {
    const gitEnv = {
      GIT_SSH_COMMAND: "ssh -i '/home/node/.ssh/id_ed25519' -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile='/data/db/known_hosts'",
      GIT_AUTHOR_NAME: "Pi Mobile",
      GIT_AUTHOR_EMAIL: "pi-mobile@example.com",
      GIT_COMMITTER_NAME: "Pi Mobile",
      GIT_COMMITTER_EMAIL: "pi-mobile@example.com",
    } as NodeJS.ProcessEnv;

    runCommandMock.mockResolvedValueOnce({ stdout: "Already up to date.\n", stderr: "" }).mockResolvedValueOnce({ stdout: "", stderr: "Everything up-to-date\n" });

    const service = new GitService(undefined, gitEnv);
    const repo = { name: "repo", relativePath: ".", absolutePath: "/workspace/repo" };

    await service.pull(repo);
    await service.push(repo);

    expect(runCommandMock).toHaveBeenNthCalledWith(1, "git", ["-C", "/workspace/repo", "pull"], {
      env: gitEnv,
    });
    expect(runCommandMock).toHaveBeenNthCalledWith(2, "git", ["-C", "/workspace/repo", "push"], {
      env: gitEnv,
    });
  });
});
