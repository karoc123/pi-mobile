import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export default async function globalSetup() {
  const workspaceRoot = path.join(process.cwd(), '.playwright', 'workspace');
  const repoRoot = path.join(workspaceRoot, 'playwright-smoke-repo');

  await rm(workspaceRoot, { recursive: true, force: true });
  await mkdir(repoRoot, { recursive: true });

  await execFileAsync('git', ['init'], { cwd: repoRoot });
  await execFileAsync('git', ['config', 'user.email', 'playwright@example.com'], { cwd: repoRoot });
  await execFileAsync('git', ['config', 'user.name', 'PiMobile Playwright'], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, 'notes.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
  await writeFile(path.join(repoRoot, 'README.md'), `# Playwright Smoke Repo\n\nGenerated on ${new Date().toISOString()} from ${os.hostname()}.\n`, 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: repoRoot });
  await execFileAsync('git', ['commit', '-m', 'initial smoke repo'], { cwd: repoRoot });
}