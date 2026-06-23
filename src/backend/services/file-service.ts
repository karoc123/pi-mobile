import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FileDocument, FileDownloadInfo, FileEntry, SelectedRepo } from "../../shared/contracts.js";

import { relativeFrom, resolveWithin } from "../utils/path-utils.js";

const ignoredEntries = new Set([".git", "node_modules", "dist", "coverage"]);

const binaryExtensions = new Set([
  ".apk",
  ".aab",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".xz",
  ".zst",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".wmv",
  ".flv",
  ".webm",
  ".exe",
  ".dmg",
  ".deb",
  ".rpm",
  ".msi",
  ".jar",
  ".class",
  ".war",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  ".o",
  ".so",
  ".dll",
  ".lib",
  ".dylib",
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".pyc",
  ".pyo",
  ".iso",
  ".img",
  ".wasm",
  ".keystore",
  ".jks",
  ".p12",
  ".pfx",
  ".pem",
  ".crt",
  ".cer",
  ".der",
  ".pub",
  ".asc",
  ".gpg",
  ".sig",
  ".DS_Store",
  ".min",
  ".br",
]);

const imageMimeTypeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

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
    const imageMimeType = resolveImageMimeType(relativePath);

    if (imageMimeType) {
      const contentBuffer = await readFile(absolutePath);

      return {
        path: relativePath,
        content: "",
        kind: "image",
        mimeType: imageMimeType,
        imageDataUrl: `data:${imageMimeType};base64,${contentBuffer.toString("base64")}`,
        binaryContentBase64: null,
      };
    }

    const binaryMimeType = resolveBinaryMimeType(relativePath);

    if (binaryMimeType) {
      const contentBuffer = await readFile(absolutePath);

      return {
        path: relativePath,
        content: "",
        kind: "binary",
        mimeType: binaryMimeType,
        imageDataUrl: null,
        binaryContentBase64: contentBuffer.toString("base64"),
      };
    }

    return {
      path: relativePath,
      content: await readFile(absolutePath, "utf8"),
      kind: "text",
      mimeType: null,
      imageDataUrl: null,
      binaryContentBase64: null,
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

  async uploadFile(repo: SelectedRepo, relativePath: string, contentBase64: string) {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const buffer = Buffer.from(contentBase64, "base64");
    await writeFile(absolutePath, buffer);
  }

  async getDownloadInfo(repo: SelectedRepo, relativePath: string): Promise<FileDownloadInfo> {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    const mimeType =
      resolveImageMimeType(relativePath) ??
      resolveBinaryMimeType(relativePath) ??
      "application/octet-stream";
    const contentBuffer = await readFile(absolutePath);

    return {
      path: relativePath,
      name: path.basename(relativePath),
      mimeType,
      contentBase64: contentBuffer.toString("base64"),
    };
  }
}

function resolveImageMimeType(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  return imageMimeTypeByExtension[extension] ?? null;
}

function resolveBinaryMimeType(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();

  if (imageMimeTypeByExtension[extension]) {
    return null;
  }

  if (binaryExtensions.has(extension)) {
    const binaryMimeTypes: Record<string, string> = {
      ".apk": "application/vnd.android.package-archive",
      ".aab": "application/x-android-app-bundle",
      ".zip": "application/zip",
      ".tar": "application/x-tar",
      ".gz": "application/gzip",
      ".bz2": "application/x-bzip2",
      ".7z": "application/x-7z-compressed",
      ".rar": "application/vnd.rar",
      ".xz": "application/x-xz",
      ".zst": "application/zstd",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".jar": "application/java-archive",
      ".ttf": "font/ttf",
      ".eot": "application/vnd.ms-fontobject",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".wasm": "application/wasm",
    };

    return binaryMimeTypes[extension] ?? "application/octet-stream";
  }

  return null;
}
