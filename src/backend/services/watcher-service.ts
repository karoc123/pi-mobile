import chokidar, { type FSWatcher } from "chokidar";

import { toPosixPath } from "../utils/path-utils.js";
import type { LogChannel } from "./log-service.js";

export class WatcherService {
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly onChange: (payload: { path: string; kind: "add" | "change" | "unlink" }) => void,
    private readonly logger?: LogChannel,
  ) {}

  async watch(repoPath: string | null) {
    await this.dispose();

    if (!repoPath) {
      return;
    }

    this.watcher = chokidar.watch(repoPath, {
      ignoreInitial: true,
      ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/coverage/**"],
    });

    this.logger?.info("Started repository watcher.", {
      event: "watcher_started",
      repo: repoPath,
    });

    this.watcher.on("add", (filePath) => {
      this.onChange({ path: toPosixPath(filePath.slice(repoPath.length + 1)), kind: "add" });
    });
    this.watcher.on("change", (filePath) => {
      this.onChange({ path: toPosixPath(filePath.slice(repoPath.length + 1)), kind: "change" });
    });
    this.watcher.on("unlink", (filePath) => {
      this.onChange({ path: toPosixPath(filePath.slice(repoPath.length + 1)), kind: "unlink" });
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
}
