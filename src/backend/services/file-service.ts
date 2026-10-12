import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { FileDocument, FileEntry, SelectedRepo } from '../../shared/contracts.js';
import { HttpError } from '../utils/http-error.js';
import { relativeFrom, resolveWithin } from '../utils/path-utils.js';

const ignoredEntries = new Set(['.git', 'node_modules', 'dist', 'coverage']);

const imageMimeTypeByExtension: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export class FileService {
  async browse(repo: SelectedRepo, relativePath = '.') {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    const entryStats = await stat(absolutePath);

    if (!entryStats.isDirectory()) {
      throw new Error('Selected path is not a directory.');
    }

    const entries = await readdir(absolutePath, { withFileTypes: true });

    return entries
      .filter((entry) => !ignoredEntries.has(entry.name))
      .map((entry): FileEntry => ({
        name: entry.name,
        relativePath: relativeFrom(repo.absolutePath, path.join(absolutePath, entry.name)),
        kind: entry.isDirectory() ? 'directory' : 'file',
      }))
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === 'directory' ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
  }

  async readFile(repo: SelectedRepo, relativePath: string): Promise<FileDocument> {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    const imageMimeType = resolveImageMimeType(relativePath);

    if (imageMimeType) {
      return {
        path: relativePath,
        content: '',
        kind: 'image',
        mimeType: imageMimeType,
      };
    }

    const fileHandle = await open(absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await fileHandle.read(buffer, 0, 8192, 0);
      const isBinary = buffer.subarray(0, bytesRead).includes(0);

      if (isBinary) {
        return {
          path: relativePath,
          content: '',
          kind: 'binary',
          mimeType: 'application/octet-stream',
        };
      }
    } finally {
      await fileHandle.close();
    }

    return {
      path: relativePath,
      content: await readFile(absolutePath, 'utf8'),
      kind: 'text',
      mimeType: null,
    };
  }

  async writeFile(repo: SelectedRepo, relativePath: string, content: string) {
    await this.writeStream(repo, relativePath, Readable.from([content]));
  }

  async writeStream(
    repo: SelectedRepo,
    relativePath: string,
    source: Readable,
    maxBytes = MAX_FILE_BYTES,
  ) {
    const requestedPath = resolveWithin(repo.absolutePath, relativePath);
    await mkdir(path.dirname(requestedPath), { recursive: true });
    const root = await realpath(repo.absolutePath);
    const parent = await realpath(path.dirname(requestedPath));
    resolveWithin(root, path.relative(root, parent));
    let targetPath = path.join(parent, path.basename(requestedPath));
    let mode: number | undefined;
    try {
      targetPath = await realpath(targetPath);
      resolveWithin(root, path.relative(root, targetPath));
      const target = await stat(targetPath);
      if (!target.isFile()) throw new HttpError(400, 'bad_request', 'Target is not a file.');
      mode = target.mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (source.destroyed) throw new HttpError(400, 'bad_request', 'Upload aborted.');
    const tempPath = path.join(path.dirname(targetPath), `.tmp.${randomUUID()}`);
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > maxBytes
            ? new HttpError(413, 'payload_too_large', 'File size exceeds 50MB limit.')
            : null,
          chunk,
        );
      },
    });
    const onError = (error: Error) => limit.destroy(error);
    const onClose = () => {
      if (!source.readableEnded)
        limit.destroy(new HttpError(400, 'bad_request', 'Upload aborted.'));
    };
    source.on('error', onError);
    source.on('close', onClose);
    try {
      const writing = pipeline(limit, createWriteStream(tempPath, { flags: 'wx', mode }));
      source.pipe(limit);
      await writing;
      if (mode !== undefined) await chmod(tempPath, mode);
      await rename(tempPath, targetPath);
    } finally {
      source.unpipe(limit);
      source.off('error', onError);
      source.off('close', onClose);
      await rm(tempPath, { force: true });
    }
  }

  async createFile(repo: SelectedRepo, relativePath: string, content = '') {
    const absolutePath = resolveWithin(repo.absolutePath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, { encoding: 'utf8', flag: 'wx' });
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
      throw new Error('Only files can be duplicated.');
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

function resolveImageMimeType(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  return imageMimeTypeByExtension[extension] ?? null;
}
