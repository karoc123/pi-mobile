// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

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
});
