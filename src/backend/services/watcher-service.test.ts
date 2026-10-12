// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WatcherService } from './watcher-service.js';

describe('WatcherService', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-watcher-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('handles null repoPath and dispose cleanly', async () => {
    const onChange = vi.fn();
    const service = new WatcherService(onChange);

    await service.watch(null);
    await service.dispose();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('detects new files and ignores internal folders like .git and node_modules', async () => {
    const changes: Array<{ path: string; kind: string }> = [];
    const service = new WatcherService((payload) => {
      changes.push(payload);
    });

    await service.watch(tempDir);

    // Create ignored folders
    await mkdir(path.join(tempDir, '.git'), { recursive: true });
    await mkdir(path.join(tempDir, 'node_modules'), { recursive: true });
    await writeFile(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(path.join(tempDir, 'node_modules', 'package.json'), '{}');

    // Create valid file
    await writeFile(path.join(tempDir, 'hello.txt'), 'hello world');

    // Wait a brief moment for FSWatcher
    await vi.waitFor(
      () => {
        expect(changes.some((c) => c.path === 'hello.txt')).toBe(true);
      },
      { timeout: 3000, interval: 50 },
    );

    // Verify ignored files were not emitted
    expect(changes.some((c) => c.path.startsWith('.git'))).toBe(false);
    expect(changes.some((c) => c.path.startsWith('node_modules'))).toBe(false);

    await service.dispose();
  });
});
