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

  it("includes untracked files in the diff payload", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));

    await runCommand("git", ["init"], { cwd: tempDir });
    await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await runCommand("git", ["config", "user.name", "PiMobile Test"], { cwd: tempDir });

    await writeFile(path.join(tempDir, "tracked.txt"), "tracked\n", "utf8");
    await runCommand("git", ["add", "tracked.txt"], { cwd: tempDir });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: tempDir });

    await writeFile(path.join(tempDir, "new-note.md"), "# note\n", "utf8");

    const service = new GitService();
    const repo = { name: "repo", relativePath: ".", absolutePath: tempDir };
    const diffFiles = await service.getDiff(repo);

    expect(diffFiles).toHaveLength(1);
    expect(diffFiles[0].path).toBe("new-note.md");
    expect(diffFiles[0].status).toBe("added");
    expect(diffFiles[0].hunks.length).toBeGreaterThan(0);
  });

  it("commits only staged changes with the provided message", async () => {
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
    await runCommand("git", ["add", "notes.txt"], { cwd: tempDir });

    const service = new GitService();
    const repo = { name: "repo", relativePath: ".", absolutePath: tempDir };
    const commitSha = await service.commit(repo, "Add more notes");

    expect(commitSha).toMatch(/^[0-9a-f]{40}$/);

    const { stdout: subject } = await runCommand("git", ["-C", tempDir, "log", "-1", "--pretty=%s"]);
    expect(subject.trim()).toBe("Add more notes");

    const { stdout: committedNotes } = await runCommand("git", ["-C", tempDir, "show", `${commitSha}:notes.txt`]);
    expect(committedNotes).toContain("line b");

    const { stdout: status } = await runCommand("git", ["-C", tempDir, "status", "--porcelain"]);
    expect(status).toContain("?? extra.txt");
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
      await runCommand("git", ["add", "notes.txt"], { cwd: tempDir });

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

    await expect(service.commit(repo, "No-op")).rejects.toThrow("No staged changes to commit.");
  });

  it("stages and unstages a single hunk", async () => {
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

    const initialDiff = await service.getDiff(repo);
    expect(initialDiff).toHaveLength(1);
    expect(initialDiff[0].hunks).toHaveLength(2);

    await service.stageHunk(repo, initialDiff[0].hunks[0].diff);

    const stagedDiff = await service.getDiff(repo);
    const stagedHunks = stagedDiff[0].hunks.filter((hunk) => hunk.staged);
    const unstagedHunks = stagedDiff[0].hunks.filter((hunk) => !hunk.staged);

    expect(stagedHunks.length).toBeGreaterThan(0);
    expect(unstagedHunks.length).toBeGreaterThan(0);

    await service.unstageHunk(repo, stagedHunks[0].diff);

    const finalDiff = await service.getDiff(repo);
    expect(finalDiff[0].hunks.every((hunk) => !hunk.staged)).toBe(true);
  });

  it("stages and unstages all changes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));

    await runCommand("git", ["init"], { cwd: tempDir });
    await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await runCommand("git", ["config", "user.name", "PiMobile Test"], { cwd: tempDir });

    await writeFile(path.join(tempDir, "notes.txt"), "line a\n", "utf8");
    await runCommand("git", ["add", "notes.txt"], { cwd: tempDir });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: tempDir });

    await writeFile(path.join(tempDir, "notes.txt"), "line a\nline b\n", "utf8");
    await writeFile(path.join(tempDir, "new-note.md"), "# note\n", "utf8");

    const service = new GitService();
    const repo = { name: "repo", relativePath: ".", absolutePath: tempDir };

    await service.stageAll(repo);
    const stagedDiff = await service.getDiff(repo);
    expect(stagedDiff.flatMap((file) => file.hunks).every((hunk) => hunk.staged)).toBe(true);

    await service.unstageAll(repo);
    const unstagedDiff = await service.getDiff(repo);
    expect(unstagedDiff.flatMap((file) => file.hunks).some((hunk) => !hunk.staged)).toBe(true);
    expect(unstagedDiff.flatMap((file) => file.hunks).every((hunk) => hunk.staged)).toBe(false);
  });

  it("pulls remote changes into the current repository", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));
    const { remoteDir, primaryDir, secondaryDir } = await createRemoteFixture(tempDir);

    const notesPath = path.join(primaryDir, "notes.txt");
    await writeFile(notesPath, "line a\nline b\n", "utf8");
    await runCommand("git", ["add", "notes.txt"], { cwd: primaryDir });
    await runCommand("git", ["commit", "-m", "update from primary"], { cwd: primaryDir });
    await runCommand("git", ["push", "origin", "HEAD"], { cwd: primaryDir });

    const service = new GitService();
    const repo = { name: "secondary", relativePath: ".", absolutePath: secondaryDir };

    const summary = await service.pull(repo);
    const pulledContent = await readFile(path.join(secondaryDir, "notes.txt"), "utf8");

    expect(summary.length).toBeGreaterThan(0);
    expect(pulledContent).toContain("line b");

    // Keep the bare remote path referenced so fixture variables remain explicit for readability.
    expect(remoteDir).toContain("remote.git");
  });

  it("pushes local commits to the configured remote", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));
    const { primaryDir, secondaryDir } = await createRemoteFixture(tempDir);

    await writeFile(path.join(secondaryDir, "notes.txt"), "line a\nline pushed\n", "utf8");
    await runCommand("git", ["add", "notes.txt"], { cwd: secondaryDir });
    await runCommand("git", ["commit", "-m", "commit from secondary"], { cwd: secondaryDir });

    const service = new GitService();
    const repo = { name: "secondary", relativePath: ".", absolutePath: secondaryDir };

    const summary = await service.push(repo);

    await runCommand("git", ["pull", "origin", "HEAD"], { cwd: primaryDir });
    const primaryContent = await readFile(path.join(primaryDir, "notes.txt"), "utf8");

    expect(summary.length).toBeGreaterThan(0);
    expect(primaryContent).toContain("line pushed");
  });

  it("reports ahead/behind commit counts against upstream", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-mobile-git-"));
    const { primaryDir, secondaryDir } = await createRemoteFixture(tempDir);

    await writeFile(path.join(primaryDir, "notes.txt"), "line a\nline from primary\n", "utf8");
    await runCommand("git", ["add", "notes.txt"], { cwd: primaryDir });
    await runCommand("git", ["commit", "-m", "remote update"], { cwd: primaryDir });
    await runCommand("git", ["push", "origin", "HEAD"], { cwd: primaryDir });

    await runCommand("git", ["fetch", "origin"], { cwd: secondaryDir });

    await writeFile(path.join(secondaryDir, "notes.txt"), "line a\nline from secondary\n", "utf8");
    await runCommand("git", ["add", "notes.txt"], { cwd: secondaryDir });
    await runCommand("git", ["commit", "-m", "local update"], { cwd: secondaryDir });

    const service = new GitService();
    const repo = { name: "secondary", relativePath: ".", absolutePath: secondaryDir };
    const status = await service.getRemoteSyncStatus(repo);

    expect(status).toEqual({ ahead: 1, behind: 1, hasUpstream: true });
  });
});

async function createRemoteFixture(baseDir: string) {
  const remoteDir = path.join(baseDir, "remote.git");
  const primaryDir = path.join(baseDir, "primary");
  const secondaryDir = path.join(baseDir, "secondary");

  await runCommand("git", ["init", "--bare", remoteDir]);
  await runCommand("git", ["clone", remoteDir, primaryDir]);
  await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: primaryDir });
  await runCommand("git", ["config", "user.name", "PiMobile Test"], { cwd: primaryDir });

  await writeFile(path.join(primaryDir, "notes.txt"), "line a\n", "utf8");
  await runCommand("git", ["add", "notes.txt"], { cwd: primaryDir });
  await runCommand("git", ["commit", "-m", "initial"], { cwd: primaryDir });
  await runCommand("git", ["push", "origin", "HEAD"], { cwd: primaryDir });

  await runCommand("git", ["clone", remoteDir, secondaryDir]);
  await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: secondaryDir });
  await runCommand("git", ["config", "user.name", "PiMobile Test"], { cwd: secondaryDir });

  return { remoteDir, primaryDir, secondaryDir };
}
