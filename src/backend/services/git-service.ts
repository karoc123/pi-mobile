import type { DiffFile, DiffHunk, SelectedRepo } from "../../shared/contracts.js";

import { runCommand } from "../utils/process.js";

type GitIdentity = {
  name: string;
  email: string;
};

export class GitService {
  private readonly gitEnv?: NodeJS.ProcessEnv;

  constructor(identity?: GitIdentity) {
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
    const { stdout } = await this.runGit(repo, [
      "diff",
      "--no-ext-diff",
      "--patch",
      "--unified=3",
      "--no-color",
    ]);
    return parseUnifiedDiff(stdout);
  }

  async revertHunk(repo: SelectedRepo, diff: string) {
    const normalizedDiff = diff.endsWith("\n") ? diff : `${diff}\n`;
    await this.runGit(
      repo,
      ["apply", "-R", "--recount", "--whitespace=nowarn", "-"],
      {
        input: normalizedDiff,
      },
    );
  }

  async commit(repo: SelectedRepo, message: string) {
    const trimmed = message.trim();

    if (!trimmed) {
      throw new Error("Commit message is required.");
    }

    await this.runGit(repo, ["add", "--all"]);
    const { stdout: status } = await this.runGit(repo, ["status", "--porcelain"]);

    if (!status.trim()) {
      throw new Error("No changes to commit.");
    }

    try {
      await this.runGit(repo, ["commit", "-m", trimmed]);
    } catch (error) {
      if (isMissingIdentityError(error)) {
        throw new Error(
          "Git author identity is missing. Set GIT_USER_NAME and GIT_USER_EMAIL in your environment or configure the repository's git config.",
        );
      }

      throw error;
    }

    const { stdout: commitSha } = await this.runGit(repo, ["rev-parse", "HEAD"]);

    return commitSha.trim();
  }

  private runGit(repo: SelectedRepo, args: string[], options: { input?: string } = {}) {
    return runCommand(
      "git",
      ["-C", repo.absolutePath, ...args],
      {
        ...options,
        env: this.gitEnv,
      },
    );
  }
}

function isMissingIdentityError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("please tell me who you are") || message.includes("unable to auto-detect email address");
}

export function parseUnifiedDiff(input: string): DiffFile[] {
  if (!input.trim()) {
    return [];
  }

  return input
    .split(/(?=^diff --git )/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(parseDiffBlock);
}

function parseDiffBlock(block: string): DiffFile {
  const lines = block.split("\n");
  const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@ "));
  const headerLines = firstHunkIndex === -1 ? lines : lines.slice(0, firstHunkIndex);
  const oldPath = extractDiffPath(headerLines, "--- ");
  const newPath = extractDiffPath(headerLines, "+++ ");
  const hunks = parseHunks(lines, headerLines);

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

function parseHunks(lines: string[], headerLines: string[]) {
  const hunks: DiffHunk[] = [];
  let currentHunk: string[] = [];

  const pushHunk = () => {
    if (currentHunk.length === 0) {
      return;
    }

    const addedLines = currentHunk.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removedLines = currentHunk.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;

    hunks.push({
      id: `${currentHunk[0] ?? "@@"}:${hunks.length}`,
      header: currentHunk[0] ?? "@@",
      diff: `${[...headerLines, ...currentHunk].join("\n").trimEnd()}\n`,
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
