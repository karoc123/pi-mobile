// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../utils/process.js";
import { GitService } from "./git-service.js";

describe("GitService", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("reverts a single hunk without discarding unrelated changes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));

    await runCommand("git", ["init"], { cwd: tempDir });
    await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await runCommand("git", ["config", "user.name", "PiMobile Test"], { cwd: tempDir });

    const filePath = path.join(tempDir, "notes.txt");
    const original = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu"].join("\n") + "\n";
    const modified = ["alpha", "beta-changed", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda-changed", "mu"].join("\n") + "\n";

    await writeFile(filePath, original, "utf8");
    await runCommand("git", ["add", "notes.txt"], { cwd: tempDir });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: tempDir });
    await writeFile(filePath, modified, "utf8");

    const service = new GitService();
    const repo = { name: "repo", relativePath: ".", absolutePath: tempDir };
    const diffFiles = await service.getDiff(repo);

    expect(diffFiles).toHaveLength(1);
    expect(diffFiles[0].hunks).toHaveLength(2);

    await service.revertHunk(repo, diffFiles[0].hunks[0].diff);

    const updatedContent = await readFile(filePath, "utf8");

    expect(updatedContent).toContain("beta\n");
    expect(updatedContent).not.toContain("beta-changed");
    expect(updatedContent).toContain("lambda-changed");
  });

  it("commits all working tree changes with the provided message", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));

    await runCommand("git", ["init"], { cwd: tempDir });
    await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await runCommand("git", ["config", "user.name", "PiMobile Test"], { cwd: tempDir });

    const notesPath = path.join(tempDir, "notes.txt");
    await writeFile(notesPath, "line a\n", "utf8");
    await runCommand("git", ["add", "notes.txt"], { cwd: tempDir });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: tempDir });

    await writeFile(notesPath, "line a\nline b\n", "utf8");
    const extraPath = path.join(tempDir, "extra.txt");
    await writeFile(extraPath, "extra content\n", "utf8");

    const service = new GitService();
    const repo = { name: "repo", relativePath: ".", absolutePath: tempDir };
    const commitSha = await service.commit(repo, "Add more notes");

    expect(commitSha).toMatch(/^[0-9a-f]{40}$/);

    const { stdout: subject } = await runCommand("git", ["-C", tempDir, "log", "-1", "--pretty=%s"]);
    expect(subject.trim()).toBe("Add more notes");

    const { stdout: newFileContent } = await runCommand("git", ["-C", tempDir, "show", `${commitSha}:extra.txt`]);
    expect(newFileContent).toContain("extra content");

    const { stdout: status } = await runCommand("git", ["-C", tempDir, "status", "--porcelain"]);
    expect(status.trim()).toBe("");
  });

  it("uses the configured identity when the repository lacks git user info", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      await runCommand("git", ["init"], { cwd: tempDir });
      const notesPath = path.join(tempDir, "notes.txt");
      await writeFile(notesPath, "line a\n", "utf8");

      const service = new GitService({ name: "Env User", email: "env@example.com" });
      const repo = { name: "repo", relativePath: ".", absolutePath: tempDir };
      const commitSha = await service.commit(repo, "Initial commit via env");

      expect(commitSha).toMatch(/^[0-9a-f]{40}$/);

      const { stdout: author } = await runCommand("git", ["-C", tempDir, "log", "-1", "--pretty=%an <%ae>"]);
      expect(author.trim()).toBe("Env User <env@example.com>");
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("throws a helpful error when nothing changed", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));

    await runCommand("git", ["init"], { cwd: tempDir });
    await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await runCommand("git", ["config", "user.name", "PiMobile Test"], { cwd: tempDir });

    const notesPath = path.join(tempDir, "notes.txt");
    await writeFile(notesPath, "line a\n", "utf8");
    await runCommand("git", ["add", "notes.txt"], { cwd: tempDir });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: tempDir });

    const service = new GitService();
    const repo = { name: "repo", relativePath: ".", absolutePath: tempDir };

    await expect(service.commit(repo, "No-op")).rejects.toThrow("No changes to commit.");
  });
});
