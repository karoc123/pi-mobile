// @vitest-environment node
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
  chmod,
  stat,
  symlink,
  readlink,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileService } from './file-service.js';

describe('FileService atomic writes', () => {
  let root: string;
  const files = new FileService();
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pi-file-stream-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const repo = () => ({ name: 'repo', relativePath: '.', absolutePath: root });
  it('preserves executable mode and an internal symlink for both save transports', async () => {
    await writeFile(path.join(root, 'script'), 'old');
    await chmod(path.join(root, 'script'), 0o755);
    await symlink('script', path.join(root, 'link'));
    await files.writeStream(repo(), 'link', Readable.from(['new']));
    await files.writeFile(repo(), 'link', 'saved');
    expect(await readlink(path.join(root, 'link'))).toBe('script');
    expect(await readFile(path.join(root, 'script'), 'utf8')).toBe('saved');
    expect((await stat(path.join(root, 'script'))).mode & 0o777).toBe(0o755);
  });
  it('keeps original content and removes temp files on size limit and source failure', async () => {
    await writeFile(path.join(root, 'file'), 'original');
    await expect(
      files.writeStream(repo(), 'file', Readable.from(['oversized']), 3),
    ).rejects.toMatchObject({ statusCode: 413 });
    const broken = Readable.from(
      (async function* () {
        yield 'partial';
        throw new Error('aborted');
      })(),
    );
    await expect(files.writeStream(repo(), 'file', broken)).rejects.toThrow('aborted');
    expect(await readFile(path.join(root, 'file'), 'utf8')).toBe('original');
    expect(await readdir(root)).toEqual(['file']);
  });
  it('rejects directory targets and traversal without leaving temporary files', async () => {
    await mkdir(path.join(root, 'dir'));
    await expect(files.writeStream(repo(), 'dir', Readable.from(['x']))).rejects.toThrow(
      'not a file',
    );
    await expect(files.writeStream(repo(), '../escape', Readable.from(['x']))).rejects.toThrow(
      'escapes',
    );
    expect(await readdir(root)).toEqual(['dir']);
  });
  it('removes the temporary file if the destination becomes a directory before rename', async () => {
    const source = Readable.from(
      (async function* () {
        yield 'partial';
        await mkdir(path.join(root, 'target'));
        yield 'rest';
      })(),
    );
    await expect(files.writeStream(repo(), 'target', source)).rejects.toBeDefined();
    expect(await readdir(root)).toEqual(['target']);
  });
  it('rejects a client abort during initial filesystem checks without hanging or leaking files', async () => {
    await writeFile(path.join(root, 'file'), 'original');
    const source = new PassThrough();
    const writing = files.writeStream(repo(), 'file', source);
    source.destroy();
    await expect(writing).rejects.toMatchObject({ statusCode: 400 });
    expect(await readdir(root)).toEqual(['file']);
    expect(await readFile(path.join(root, 'file'), 'utf8')).toBe('original');
  });
});
