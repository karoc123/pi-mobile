import chokidar, { type FSWatcher } from "chokidar";

import { toPosixPath } from "../utils/path-utils.js";

export class WatcherService {
  private watcher: FSWatcher | null = null;

  constructor(private readonly onChange: (payload: { path: string; kind: "add" | "change" | "unlink" }) => void) {}

  async watch(repoPath: string | null) {
    await this.dispose();

    if (!repoPath) {
      return;
    }

    this.watcher = chokidar.watch(repoPath, {
      ignoreInitial: true,
      ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/coverage/**"],
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
  }

  async dispose() {
    await this.watcher?.close();
    this.watcher = null;
  }
}
