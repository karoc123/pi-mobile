import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FileDocument, FileEntry, SelectedRepo } from "../../shared/contracts.js";

import { relativeFrom, resolveWithin } from "../utils/path-utils.js";

const ignoredEntries = new Set([".git", "node_modules", "dist", "coverage"]);

export class FileService {
  async browse(repo: SelectedRepo, relativePath = ".") {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    const entryStats = await stat(absolutePath);

    if (!entryStats.isDirectory()) {
      throw new Error("Selected path is not a directory.");
    }

    const entries = await readdir(absolutePath, { withFileTypes: true });

    return entries
      .filter((entry) => !ignoredEntries.has(entry.name))
      .map(
        (entry): FileEntry => ({
          name: entry.name,
          relativePath: relativeFrom(repo.absolutePath, path.join(absolutePath, entry.name)),
          kind: entry.isDirectory() ? "directory" : "file",
        }),
      )
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
  }

  async readFile(repo: SelectedRepo, relativePath: string): Promise<FileDocument> {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    return {
      path: relativePath,
      content: await readFile(absolutePath, "utf8"),
    };
  }

  async writeFile(repo: SelectedRepo, relativePath: string, content: string) {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  async createFile(repo: SelectedRepo, relativePath: string, content = "") {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
  }

  async createDirectory(repo: SelectedRepo, relativePath: string) {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await mkdir(absolutePath);
  }

  async duplicateFile(repo: SelectedRepo, sourceRelativePath: string, targetRelativePath: string) {
    const sourceAbsolutePath = resolveWithin(repo.absolutePath, sourceRelativePath);
    const targetAbsolutePath = resolveWithin(repo.absolutePath, targetRelativePath);

    const sourceStats = await stat(sourceAbsolutePath);

    if (!sourceStats.isFile()) {
      throw new Error("Only files can be duplicated.");
    }

    await mkdir(path.dirname(targetAbsolutePath), { recursive: true });
    await copyFile(sourceAbsolutePath, targetAbsolutePath, constants.COPYFILE_EXCL);
  }

  async movePath(repo: SelectedRepo, sourceRelativePath: string, targetRelativePath: string) {
    const sourceAbsolutePath = resolveWithin(repo.absolutePath, sourceRelativePath);
    const targetAbsolutePath = resolveWithin(repo.absolutePath, targetRelativePath);

    await mkdir(path.dirname(targetAbsolutePath), { recursive: true });
    await rename(sourceAbsolutePath, targetAbsolutePath);
  }

  async deletePath(repo: SelectedRepo, relativePath: string) {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    await rm(absolutePath, { recursive: true, force: false });
  }
}
