import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { SelectedRepo, WorkspaceEntry } from "../../shared/contracts.js";

import { relativeFrom, resolveWithin } from "../utils/path-utils.js";
import { runCommand } from "../utils/process.js";

export class WorkspaceService {
  private currentRepo: SelectedRepo | null = null;

  constructor(
    private readonly rootPath: string,
    private readonly defaultRepo?: string,
  ) {}

  async initializeDefaultRepo() {
    if (this.defaultRepo) {
      this.currentRepo = await this.resolveRepo(this.defaultRepo);
      return this.currentRepo;
    }

    if (await isGitRepo(this.rootPath)) {
      this.currentRepo = createSelectedRepo(this.rootPath, this.rootPath);
      return this.currentRepo;
    }

    return null;
  }

  async browse(relativePath = ".") {
    const absolutePath = resolveWithin(this.rootPath, relativePath);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules" && entry.name !== ".pi-mobile")
      .sort((left, right) => left.name.localeCompare(right.name));

    return Promise.all(
      directories.map(async (entry): Promise<WorkspaceEntry> => {
        const entryPath = path.join(absolutePath, entry.name);
        return {
          name: entry.name,
          relativePath: relativeFrom(this.rootPath, entryPath),
          kind: "directory",
          isGitRepo: await isGitRepo(entryPath),
        };
      }),
    );
  }

  getCurrentRepo() {
    return this.currentRepo;
  }

  async selectRepo(relativePath: string) {
    this.currentRepo = await this.resolveRepo(relativePath);
    return this.currentRepo;
  }

  async cloneRepo(remoteUrl: string, destinationPath?: string) {
    const normalizedRemoteUrl = remoteUrl.trim();

    if (!normalizedRemoteUrl) {
      throw new Error("Remote URL is required.");
    }

    const relativeDestinationPath = resolveCloneDestinationPath(normalizedRemoteUrl, destinationPath);
    const absoluteDestinationPath = resolveWithin(this.rootPath, relativeDestinationPath);

    if (await pathExists(absoluteDestinationPath)) {
      throw new Error("Destination path already exists.");
    }

    await runCommand("git", ["clone", normalizedRemoteUrl, absoluteDestinationPath]);

    const { root: repositoryRoot, errorMessage } = await getGitRootWithDiagnostics(absoluteDestinationPath);

    if (!repositoryRoot) {
      const hint = errorMessage ? `\n\nGit error:\n${errorMessage}` : "";
      throw new Error(`Cloned directory is not a Git repository.${hint}`);
    }

    resolveWithin(this.rootPath, relativeFrom(this.rootPath, repositoryRoot));
    return createSelectedRepo(this.rootPath, repositoryRoot);
  }

  requireCurrentRepo() {
    if (!this.currentRepo) {
      throw new Error("No repository is currently selected.");
    }

    return this.currentRepo;
  }

  private async resolveRepo(relativePath: string) {
    const absolutePath = resolveWithin(this.rootPath, relativePath);
    const entryStats = await stat(absolutePath);

    if (!entryStats.isDirectory()) {
      throw new Error("Selected path is not a directory.");
    }

    const { root: repositoryRoot, errorMessage } = await getGitRootWithDiagnostics(absolutePath);

    if (!repositoryRoot) {
      const hint = errorMessage ? `\n\nGit error:\n${errorMessage}` : "";
      throw new Error(`Selected directory is not a Git repository.${hint}`);
    }

    resolveWithin(this.rootPath, relativeFrom(this.rootPath, repositoryRoot));

    return createSelectedRepo(this.rootPath, repositoryRoot);
  }
}

function createSelectedRepo(rootPath: string, absolutePath: string): SelectedRepo {
  return {
    name: path.basename(absolutePath),
    relativePath: relativeFrom(rootPath, absolutePath),
    absolutePath,
  };
}

async function isGitRepo(candidatePath: string) {
  if (await pathExists(path.join(candidatePath, ".git"))) {
    return true;
  }

  return (await getGitRoot(candidatePath)) !== null;
}

async function getGitRoot(candidatePath: string): Promise<string | null> {
  return (await getGitRootWithDiagnostics(candidatePath)).root;
}

async function getGitRootWithDiagnostics(candidatePath: string): Promise<{ root: string | null; errorMessage?: string }> {
  try {
    const { stdout } = await runCommand("git", ["-C", candidatePath, "rev-parse", "--show-toplevel"]);
    return { root: stdout.trim() };
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
    const unsafeRepositoryPath = extractUnsafeRepositoryPath(message);

    if (unsafeRepositoryPath) {
      try {
        await runCommand("git", ["config", "--global", "--add", "safe.directory", unsafeRepositoryPath]);
        const { stdout } = await runCommand("git", ["-C", candidatePath, "rev-parse", "--show-toplevel"]);
        return { root: stdout.trim() };
      } catch (configError) {
        const configMessage = configError instanceof Error ? configError.message : String(configError);
        const combinedMessage = [message, `Attempted to run \`git config --global --add safe.directory "${unsafeRepositoryPath}"\` automatically but it failed:`, configMessage].join("\n");

        return { root: null, errorMessage: combinedMessage };
      }
    }

    return { root: null, errorMessage: message };
  }
}

function extractUnsafeRepositoryPath(message: string) {
  const patterns = [/detected dubious ownership in repository at '([^']+)'/, /unsafe repository \('([^']+)'/];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

async function pathExists(candidatePath: string) {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function resolveCloneDestinationPath(remoteUrl: string, destinationPath?: string) {
  const providedDestinationPath = destinationPath?.trim();

  if (providedDestinationPath && providedDestinationPath.length > 0) {
    if (providedDestinationPath === "." || providedDestinationPath === "..") {
      throw new Error("Destination path must point to a subdirectory.");
    }

    return providedDestinationPath;
  }

  return deriveCloneDirectoryName(remoteUrl);
}

function deriveCloneDirectoryName(remoteUrl: string) {
  const normalized = remoteUrl.trim().replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf(":"));
  const rawName = (separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized).replace(/\.git$/i, "").trim();
  const sanitized = rawName.replace(/[<>:"|?*\u0000]/g, "-").replace(/[\\/]/g, "-");

  if (sanitized.length === 0 || sanitized === "." || sanitized === "..") {
    return "cloned-repo";
  }

  return sanitized;
}
