// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { runCommand } from '../utils/process.js';
import { GitService } from './git-service.js';

describe('GitService', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('reverts a single hunk without discarding unrelated changes', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-git-'));

    await runCommand('git', ['init'], { cwd: tempDir });
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
    await runCommand('git', ['config', 'user.name', 'PiMobile Test'], { cwd: tempDir });

    const filePath = path.join(tempDir, 'notes.txt');
    const original = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu'].join('\n') + '\n';
    const modified = ['alpha', 'beta-changed', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda-changed', 'mu'].join('\n') + '\n';

    await writeFile(filePath, original, 'utf8');
    await runCommand('git', ['add', 'notes.txt'], { cwd: tempDir });
    await runCommand('git', ['commit', '-m', 'initial'], { cwd: tempDir });
    await writeFile(filePath, modified, 'utf8');

    const service = new GitService();
    const repo = { name: 'repo', relativePath: '.', absolutePath: tempDir };
    const diffFiles = await service.getDiff(repo);

    expect(diffFiles).toHaveLength(1);
    expect(diffFiles[0].hunks).toHaveLength(2);

    await service.revertHunk(repo, diffFiles[0].hunks[0].diff);

    const updatedContent = await readFile(filePath, 'utf8');

    expect(updatedContent).toContain('beta\n');
    expect(updatedContent).not.toContain('beta-changed');
    expect(updatedContent).toContain('lambda-changed');
  });
});