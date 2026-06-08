import type { DiffFile, DiffHunk, GitRemoteSyncStatus, SelectedRepo } from "../../shared/contracts.js";

import { runCommand } from "../utils/process.js";

type GitIdentity = {
  name: string;
  email: string;
};

const DIFF_ARGS = ["--no-ext-diff", "--patch", "--unified=3", "--no-color"];

export class GitService {
  private readonly gitEnv?: NodeJS.ProcessEnv;

  constructor(identity?: GitIdentity, gitEnv?: NodeJS.ProcessEnv) {
    if (gitEnv) {
      this.gitEnv = gitEnv;
      return;
    }

    if (identity) {
      this.gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email,
      };
    }
  }

  async getDiff(repo: SelectedRepo) {
    const [stagedDiff, unstagedDiff, untrackedDiff] = await Promise.all([this.getStagedDiff(repo), this.getUnstagedDiff(repo), this.getUntrackedDiff(repo)]);

    const stagedFiles = parseUnifiedDiff(stagedDiff, { staged: true, idPrefix: "staged" });
    const unstagedFiles = parseUnifiedDiff([unstagedDiff, untrackedDiff].filter(Boolean).join("\n"), {
      staged: false,
      idPrefix: "unstaged",
    });

    return mergeDiffFiles(stagedFiles, unstagedFiles);
  }

  async getRemoteSyncStatus(repo: SelectedRepo): Promise<GitRemoteSyncStatus> {
    try {
      await this.runGit(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    } catch {
      return {
        ahead: 0,
        behind: 0,
        hasUpstream: false,
      };
    }

    const { stdout } = await this.runGit(repo, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
    const [behind, ahead] = parseLeftRightCommitCounts(stdout);

    return {
      ahead,
      behind,
      hasUpstream: true,
    };
  }

  async revertHunk(repo: SelectedRepo, diff: string) {
    const normalizedDiff = normalizePatch(diff);
    await this.runGit(repo, ["apply", "-R", "--recount", "--whitespace=nowarn", "-"], {
      input: normalizedDiff,
    });
  }

  async stageHunk(repo: SelectedRepo, diff: string) {
    await this.runGit(repo, ["apply", "--cached", "--recount", "--whitespace=nowarn", "-"], {
      input: normalizePatch(diff),
    });
  }

  async unstageHunk(repo: SelectedRepo, diff: string) {
    await this.runGit(repo, ["apply", "-R", "--cached", "--recount", "--whitespace=nowarn", "-"], {
      input: normalizePatch(diff),
    });
  }

  async stageAll(repo: SelectedRepo) {
    await this.runGit(repo, ["add", "--all"]);
  }

  async unstageAll(repo: SelectedRepo) {
    if (await this.hasHeadCommit(repo)) {
      await this.runGit(repo, ["reset", "HEAD", "--", "."]);
      return;
    }

    await this.runGit(repo, ["read-tree", "--empty"]);
  }

  async commit(repo: SelectedRepo, message: string) {
    const trimmed = message.trim();

    if (!trimmed) {
      throw new Error("Commit message is required.");
    }

    const { stdout: status } = await this.runGit(repo, ["diff", "--cached", "--name-only"]);

    if (!status.trim()) {
      throw new Error("No staged changes to commit.");
    }

    try {
      await this.runGit(repo, ["commit", "-m", trimmed]);
    } catch (error) {
      if (isMissingIdentityError(error)) {
        throw new Error("Git author identity is missing. Set GIT_USER_NAME and GIT_USER_EMAIL in your environment or configure the repository's git config.");
      }

      throw error;
    }

    const { stdout: commitSha } = await this.runGit(repo, ["rev-parse", "HEAD"]);

    return commitSha.trim();
  }

  async pull(repo: SelectedRepo) {
    const result = await this.runGit(repo, ["pull"]);
    return summarizeSyncOutput("Pull completed.", result.stdout, result.stderr);
  }

  async push(repo: SelectedRepo) {
    const result = await this.runGit(repo, ["push"]);
    return summarizeSyncOutput("Push completed.", result.stdout, result.stderr);
  }

  private async getStagedDiff(repo: SelectedRepo) {
    const { stdout } = await this.runGit(repo, ["diff", "--cached", ...DIFF_ARGS]);
    return stdout;
  }

  private async getUnstagedDiff(repo: SelectedRepo) {
    const { stdout } = await this.runGit(repo, ["diff", ...DIFF_ARGS]);
    return stdout;
  }

  private async getUntrackedDiff(repo: SelectedRepo) {
    const { stdout } = await this.runGit(repo, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const untrackedPaths = stdout
      .split("\0")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (untrackedPaths.length === 0) {
      return "";
    }

    const diffs = await Promise.all(
      untrackedPaths.map(async (relativePath) => {
        const result = await this.runGit(repo, ["diff", ...DIFF_ARGS, "--", "/dev/null", relativePath], { allowedExitCodes: [0, 1] });
        return result.stdout;
      }),
    );

    return diffs.join("\n");
  }

  private async hasHeadCommit(repo: SelectedRepo) {
    try {
      await this.runGit(repo, ["rev-parse", "--verify", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  private runGit(repo: SelectedRepo, args: string[], options: { input?: string; allowedExitCodes?: number[] } = {}) {
    return runCommand("git", ["-C", repo.absolutePath, ...args], {
      ...options,
      env: this.gitEnv,
    });
  }
}

function normalizePatch(diff: string) {
  return diff.endsWith("\n") ? diff : `${diff}\n`;
}

function isMissingIdentityError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("please tell me who you are") || message.includes("unable to auto-detect email address");
}

function summarizeSyncOutput(fallback: string, stdout: string, stderr: string) {
  const output = `${stdout}\n${stderr}`.trim();

  if (!output) {
    return fallback;
  }

  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? fallback;
}

function parseLeftRightCommitCounts(rawOutput: string): [behind: number, ahead: number] {
  const [behindRaw = "0", aheadRaw = "0"] = rawOutput.trim().split(/\s+/);
  const behind = Number.parseInt(behindRaw, 10);
  const ahead = Number.parseInt(aheadRaw, 10);

  return [Number.isFinite(behind) ? behind : 0, Number.isFinite(ahead) ? ahead : 0];
}

type ParseDiffOptions = {
  staged: boolean;
  idPrefix: string;
};

const defaultParseDiffOptions: ParseDiffOptions = {
  staged: false,
  idPrefix: "hunk",
};

export function parseUnifiedDiff(input: string, options: Partial<ParseDiffOptions> = {}): DiffFile[] {
  if (!input.trim()) {
    return [];
  }

  const resolvedOptions: ParseDiffOptions = {
    ...defaultParseDiffOptions,
    ...options,
  };

  return input
    .split(/(?=^diff --git )/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, blockIndex) => parseDiffBlock(block, resolvedOptions, blockIndex));
}

function parseDiffBlock(block: string, options: ParseDiffOptions, blockIndex: number): DiffFile {
  const lines = block.split("\n");
  const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@ "));
  const headerLines = firstHunkIndex === -1 ? lines : lines.slice(0, firstHunkIndex);
  const oldPath = extractDiffPath(headerLines, "--- ");
  const newPath = extractDiffPath(headerLines, "+++ ");
  const hunks = parseHunks(lines, headerLines, options, blockIndex);

  return {
    path: newPath === "/dev/null" ? oldPath : newPath,
    oldPath,
    newPath,
    status: inferStatus(headerLines),
    diff: `${block.trimEnd()}\n`,
    hunks,
    addedLines: hunks.reduce((sum, hunk) => sum + hunk.addedLines, 0),
    removedLines: hunks.reduce((sum, hunk) => sum + hunk.removedLines, 0),
  };
}

function parseHunks(lines: string[], headerLines: string[], options: ParseDiffOptions, blockIndex: number) {
  const hunks: DiffHunk[] = [];
  let currentHunk: string[] = [];

  const pushHunk = () => {
    if (currentHunk.length === 0) {
      return;
    }

    const addedLines = currentHunk.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removedLines = currentHunk.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;

    hunks.push({
      id: `${options.idPrefix}:${blockIndex}:${hunks.length}`,
      header: currentHunk[0] ?? "@@",
      diff: `${[...headerLines, ...currentHunk].join("\n").trimEnd()}\n`,
      staged: options.staged,
      addedLines,
      removedLines,
    });

    currentHunk = [];
  };

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      pushHunk();
      currentHunk = [line];
      continue;
    }

    if (currentHunk.length > 0) {
      currentHunk.push(line);
    }
  }

  pushHunk();

  return hunks;
}

function mergeDiffFiles(...groups: DiffFile[][]): DiffFile[] {
  const merged = new Map<string, DiffFile>();
  const orderedKeys: string[] = [];

  for (const files of groups) {
    for (const file of files) {
      const key = `${file.path}\u0000${file.oldPath}\u0000${file.newPath}`;
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          ...file,
          hunks: [...file.hunks],
        });
        orderedKeys.push(key);
        continue;
      }

      existing.hunks = [...existing.hunks, ...file.hunks];
      existing.addedLines += file.addedLines;
      existing.removedLines += file.removedLines;
      existing.diff = `${existing.diff.trimEnd()}\n${file.diff.trimStart()}`.trimEnd() + "\n";
    }
  }

  return orderedKeys.map((key) => merged.get(key)).filter((file): file is DiffFile => Boolean(file));
}

function extractDiffPath(headerLines: string[], prefix: "--- " | "+++ ") {
  const line = headerLines.find((entry) => entry.startsWith(prefix));

  if (!line) {
    return "unknown";
  }

  const value = line.slice(prefix.length).trim();
  if (value === "/dev/null") {
    return value;
  }

  return value.replace(/^[ab]\//, "");
}

function inferStatus(headerLines: string[]): DiffFile["status"] {
  if (headerLines.some((line) => line.startsWith("new file mode "))) {
    return "added";
  }

  if (headerLines.some((line) => line.startsWith("deleted file mode "))) {
    return "deleted";
  }

  if (headerLines.some((line) => line.startsWith("rename from "))) {
    return "renamed";
  }

  return "modified";
}
