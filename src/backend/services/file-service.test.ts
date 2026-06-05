// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { FileService } from './file-service.js';

const fileService = new FileService();

describe('FileService', () => {
  it('creates new files without overwriting existing content', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-file-service-'));

    try {
      const repo = {
        name: path.basename(tempDir),
        relativePath: tempDir,
        absolutePath: tempDir,
      };

      await fileService.createFile(repo, 'notes/new-file.md', '# hello world\n');

      const createdContent = await readFile(path.join(tempDir, 'notes/new-file.md'), 'utf8');
      expect(createdContent).toBe('# hello world\n');

      await expect(fileService.createFile(repo, 'notes/new-file.md', 'replacement\n')).rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('creates directories and mutates files safely', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-file-service-'));

    try {
      const repo = {
        name: path.basename(tempDir),
        relativePath: tempDir,
        absolutePath: tempDir,
      };

      await fileService.createDirectory(repo, 'notes/archive');
      await fileService.createFile(repo, 'notes/archive/todo.md', 'one\n');
      await fileService.duplicateFile(repo, 'notes/archive/todo.md', 'notes/archive/todo-copy.md');
      await fileService.movePath(repo, 'notes/archive/todo-copy.md', 'notes/todo-copy.md');

      const copiedContent = await readFile(path.join(tempDir, 'notes/todo-copy.md'), 'utf8');
      expect(copiedContent).toBe('one\n');

      await fileService.deletePath(repo, 'notes/todo-copy.md');
      await expect(access(path.join(tempDir, 'notes/todo-copy.md'))).rejects.toBeDefined();

      await writeFile(path.join(tempDir, 'notes/archive/todo-copy.md'), 'exists\n', 'utf8');
      await expect(fileService.duplicateFile(repo, 'notes/archive/todo.md', 'notes/archive/todo-copy.md')).rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns image preview payloads for image files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-file-service-'));

    try {
      const repo = {
        name: path.basename(tempDir),
        relativePath: tempDir,
        absolutePath: tempDir,
      };

      const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sE5e3kAAAAASUVORK5CYII=';
      await mkdir(path.join(tempDir, 'assets'), { recursive: true });
      await writeFile(path.join(tempDir, 'assets', 'pixel.png'), Buffer.from(tinyPngBase64, 'base64'));

      const document = await fileService.readFile(repo, 'assets/pixel.png');

      expect(document.path).toBe('assets/pixel.png');
      expect(document.kind).toBe('image');
      expect(document.mimeType).toBe('image/png');
      expect(document.content).toBe('');
      expect(document.imageDataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
