import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { toPosixPath } from "../utils/path-utils.js";
import type { LogChannel } from "./log-service.js";

type WatcherServiceOptions = {
  ignoredAbsolutePaths?: string[];
  ignoredRelativeRoots?: string[];
};

const defaultIgnoredRoots = [".git", "node_modules", "dist", "coverage", ".pi-mobile", ".pi"];

export class WatcherService {
  private watcher: FSWatcher | null = null;
  private readonly ignoredAbsolutePaths: string[];
  private readonly ignoredRelativeRoots: string[];

  constructor(
    private readonly onChange: (payload: { path: string; kind: "add" | "change" | "unlink" }) => void,
    private readonly logger?: LogChannel,
    options: WatcherServiceOptions = {},
  ) {
    this.ignoredAbsolutePaths = [...new Set((options.ignoredAbsolutePaths ?? []).map((entry) => normalizeAbsolutePath(entry)).filter((entry) => entry.length > 0))];
    this.ignoredRelativeRoots = [...new Set([...defaultIgnoredRoots, ...(options.ignoredRelativeRoots ?? [])].map((entry) => normalizeRelativeRoot(entry)).filter((entry) => entry.length > 0))];
  }

  async watch(repoPath: string | null) {
    await this.dispose();

    if (!repoPath) {
      return;
    }

    this.watcher = chokidar.watch(repoPath, {
      ignoreInitial: true,
      ignored: (candidatePath) => this.isIgnoredPath(repoPath, candidatePath),
    });

    this.logger?.info("Started repository watcher.", {
      event: "watcher_started",
      repo: repoPath,
    });

    this.watcher.on("add", (filePath) => {
      this.emitIfVisible(repoPath, filePath, "add");
    });
    this.watcher.on("change", (filePath) => {
      this.emitIfVisible(repoPath, filePath, "change");
    });
    this.watcher.on("unlink", (filePath) => {
      this.emitIfVisible(repoPath, filePath, "unlink");
    });
    this.watcher.on("error", (error) => {
      this.logger?.error("Repository watcher failed.", {
        event: "watcher_error",
        repo: repoPath,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }

  async dispose() {
    if (this.watcher) {
      this.logger?.info("Stopping repository watcher.", {
        event: "watcher_stopped",
      });
    }

    await this.watcher?.close();
    this.watcher = null;
  }

  private emitIfVisible(repoPath: string, filePath: string, kind: "add" | "change" | "unlink") {
    if (this.isIgnoredPath(repoPath, filePath)) {
      return;
    }

    const relativePath = toPosixPath(path.relative(repoPath, filePath));

    if (relativePath.length === 0 || relativePath === "." || relativePath.startsWith("../")) {
      return;
    }

    this.onChange({ path: relativePath, kind });
  }

  private isIgnoredPath(repoPath: string, candidatePath: string) {
    const absolutePath = normalizeAbsolutePath(candidatePath);

    for (const ignoredAbsolutePath of this.ignoredAbsolutePaths) {
      if (absolutePath === ignoredAbsolutePath || absolutePath.startsWith(`${ignoredAbsolutePath}/`)) {
        return true;
      }
    }

    const relativePath = toPosixPath(path.relative(repoPath, absolutePath));

    if (relativePath === "" || relativePath === "." || relativePath.startsWith("../")) {
      return false;
    }

    return this.ignoredRelativeRoots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`));
  }
}

function normalizeAbsolutePath(input: string) {
  return toPosixPath(path.resolve(input)).replace(/\/+$/, "");
}

function normalizeRelativeRoot(input: string) {
  return toPosixPath(input).replace(/^\/+/, "").replace(/\/+$/, "");
}
