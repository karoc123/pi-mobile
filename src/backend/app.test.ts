// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { AuthService } from './services/auth-service.js';
import { FileService } from './services/file-service.js';
import { LogService } from './services/log-service.js';
import { WorkspaceService } from './services/workspace-service.js';
import { runCommand } from './utils/process.js';

describe('createApp', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-app-'));
    await runCommand('git', ['init'], { cwd: tempDir });
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
    await runCommand('git', ['config', 'user.name', 'PiMobile Test'], { cwd: tempDir });
    await writeFile(path.join(tempDir, 'README.md'), '# temp repo\n', 'utf8');
    await runCommand('git', ['add', 'README.md'], { cwd: tempDir });
    await runCommand('git', ['commit', '-m', 'initial'], { cwd: tempDir });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('protects workspace routes until a valid login cookie is present', async () => {
    const config = {
      nodeEnv: 'test' as const,
      host: '127.0.0.1',
      port: 3000,
      appPassword: 'secret-pass',
      workspaceRoot: tempDir,
      modelUsagePath: path.join(tempDir, '.pi-mobile', 'model-usage.json'),
      logsDirPath: path.join(tempDir, '.pi-mobile', 'logs'),
      logLevel: 'debug' as const,
      sessionCookieName: 'pi_mobile_session',
      sessionCookieSecure: false,
    };
    const authService = new AuthService(config.appPassword);
    const logService = new LogService({
      logDirPath: config.logsDirPath,
      minLevel: config.logLevel,
    });
    const workspaceService = new WorkspaceService(tempDir);
    await workspaceService.initializeDefaultRepo();
    const getCommandState = vi.fn(async () => ({
      session: null,
      models: [],
      thinkingLevels: [],
      steeringMode: 'all',
      followUpMode: 'one-at-a-time',
      autoCompactEnabled: false,
      autoRetryEnabled: false,
      isRetrying: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      availableCommands: [],
      resumeSessions: [],
      treeEntries: [],
      forkEntries: [],
    }));
    const executeCommand = vi.fn(async () => ({
      message: 'Started a new session.',
      prompt: null,
    }));
    const getResourceHealth = vi.fn(async () => ({
      allRequiredAccessible: true,
      checks: [
        {
          key: 'workspace_root',
          label: 'Workspace root',
          path: tempDir,
          required: true,
          ok: true,
          detail: null,
        },
      ],
    }));
    const gitPull = vi.fn(async () => 'Already up to date.');
    const gitPush = vi.fn(async () => 'Everything up-to-date');
    const gitApplyHunk = vi.fn(async () => undefined);
    const gitStageAll = vi.fn(async () => undefined);
    const gitUnstageAll = vi.fn(async () => undefined);
    const cloneRepo = vi
      .spyOn(workspaceService, 'cloneRepo')
      .mockImplementation(async () => workspaceService.requireCurrentRepo());
    const getPiAuthStatus = vi.fn(() => ({
      providers: [{ provider: 'anthropic', label: 'Anthropic', configured: false }],
    }));
    const loginPiToken = vi.fn(async () => ({
      ok: true,
      provider: 'anthropic',
      configured: true,
    }));
    const logoutPiProvider = vi.fn(() => ({
      ok: true,
      provider: 'anthropic',
      configured: false,
    }));
    const createFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('File exists'), { code: 'EEXIST' }));

    const app = createApp({
      config,
      authService,
      logService,
      workspaceService,
      activateRepo: vi.fn(),
      fileService: {
        browse: vi.fn(async () => []),
        readFile: vi.fn(async () => ({ path: 'README.md', content: '# temp repo\n' })),
        writeFile: vi.fn(async () => undefined),
        createFile,
      } as never,
      gitService: {
        getDiff: vi.fn(async () => []),
        getRemoteSyncStatus: vi.fn(async () => ({ ahead: 0, behind: 0, hasUpstream: true })),
        pull: gitPull,
        push: gitPush,
        applyHunk: gitApplyHunk,
        stageHunk: vi.fn(),
        unstageHunk: vi.fn(),
        stageAll: gitStageAll,
        unstageAll: gitUnstageAll,
        revertHunk: vi.fn(),
      } as never,
      resourceHealthService: {
        check: getResourceHealth,
      } as never,
      piAgentService: {
        getSnapshot: vi.fn(() => ({
          repo: workspaceService.getCurrentRepo(),
          isStreaming: false,
          runtimePhase: 'idle',
          pendingMessageCount: 0,
          isCompacting: false,
          isRetrying: false,
          isBashRunning: false,
          messages: [],
          tools: [],
          lastError: null,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            totalCost: 0,
            contextTokens: null,
            contextWindow: null,
            contextPercent: null,
            modelId: null,
            usingSubscription: false,
            autoCompactEnabled: false,
          },
          interactivePrompt: null,
        })),
        getCommandState,
        executeCommand,
        prompt: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      } as never,
      piAuthService: {
        getStatus: getPiAuthStatus,
        loginToken: loginPiToken,
        logout: logoutPiProvider,
      } as never,
      serverStartedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const unauthorized = await request(app).get('/api/workspaces/browse');
    const unauthorizedPiAuth = await request(app).get('/api/pi/auth/status');

    expect(unauthorized.status).toBe(401);
    expect(unauthorizedPiAuth.status).toBe(401);
    expect(unauthorized.body.error.code).toBe('unauthorized');
    expect(typeof unauthorized.headers['x-request-id']).toBe('string');

    const login = await request(app).post('/api/auth/login').send({ password: 'secret-pass' });

    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']).toBeDefined();
    expect(login.headers['set-cookie'][0]).not.toContain('Secure');

    const cookie = login.headers['set-cookie'];
    const authorized = await request(app).get('/api/workspaces/browse').set('Cookie', cookie);
    const commandStateResponse = await request(app)
      .get('/api/agent/command-state')
      .set('Cookie', cookie);
    const commandExecuteResponse = await request(app)
      .post('/api/agent/command')
      .set('Cookie', cookie)
      .send({ command: 'new-session' });
    const logsResponse = await request(app).get('/api/logs?limit=50').set('Cookie', cookie);
    const healthResponse = await request(app).get('/api/health').set('Cookie', cookie);
    const pullResponse = await request(app).post('/api/git/pull').set('Cookie', cookie);
    const pushResponse = await request(app).post('/api/git/push').set('Cookie', cookie);
    const cloneResponse = await request(app)
      .post('/api/workspaces/clone')
      .set('Cookie', cookie)
      .send({ remoteUrl: 'https://github.com/example/repo.git', destinationPath: 'repo-clone' });
    const piAuthStatusResponse = await request(app)
      .get('/api/pi/auth/status')
      .set('Cookie', cookie);
    const piAuthLoginResponse = await request(app)
      .post('/api/pi/auth/login-token')
      .set('Cookie', cookie)
      .send({ provider: 'anthropic', token: 'test-token' });
    const piAuthLogoutResponse = await request(app)
      .post('/api/pi/auth/logout')
      .set('Cookie', cookie)
      .send({ provider: 'anthropic' });
    const stageAllResponse = await request(app).post('/api/git/stage-all').set('Cookie', cookie);
    const unstageAllResponse = await request(app)
      .post('/api/git/unstage-all')
      .set('Cookie', cookie);
    const stageHunkResponse = await request(app)
      .post('/api/git/hunk')
      .set('Cookie', cookie)
      .send({ diff: 'diff --git a/a.txt b/a.txt\n', action: 'stage' });
    const unstageHunkResponse = await request(app)
      .post('/api/git/hunk')
      .set('Cookie', cookie)
      .send({ diff: 'diff --git a/a.txt b/a.txt\n', action: 'unstage' });
    const revertHunkResponse = await request(app)
      .post('/api/git/hunk')
      .set('Cookie', cookie)
      .send({ diff: 'diff --git a/a.txt b/a.txt\n', action: 'revert' });
    const invalidHunkResponse = await request(app)
      .post('/api/git/hunk')
      .set('Cookie', cookie)
      .send({ diff: 'diff --git a/a.txt b/a.txt\n', action: 'invalid' });
    const createFileResponse = await request(app)
      .post('/api/files/create')
      .set('Cookie', cookie)
      .send({ path: 'notes/new-file.md', content: '# hello\n' });
    const createFileConflictResponse = await request(app)
      .post('/api/files/create')
      .set('Cookie', cookie)
      .send({ path: 'notes/new-file.md', content: '# hello again\n' });
    const createFileMissingPathResponse = await request(app)
      .post('/api/files/create')
      .set('Cookie', cookie)
      .send({ path: '   ' });
    const clearLogsResponse = await request(app).delete('/api/logs').set('Cookie', cookie);

    expect(authorized.status).toBe(200);
    expect(authorized.body.entries).toEqual([]);
    expect(authorized.body.currentRepo.name).toBe(path.basename(tempDir));
    expect(authorized.headers['cache-control']).toContain('no-store');
    expect(commandStateResponse.status).toBe(200);
    expect(commandStateResponse.body).toEqual({
      session: null,
      models: [],
      thinkingLevels: [],
      steeringMode: 'all',
      followUpMode: 'one-at-a-time',
      autoCompactEnabled: false,
      autoRetryEnabled: false,
      isRetrying: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      availableCommands: [],
      resumeSessions: [],
      treeEntries: [],
      forkEntries: [],
    });
    expect(getCommandState).toHaveBeenCalledTimes(1);
    expect(commandExecuteResponse.status).toBe(200);
    expect(commandExecuteResponse.body).toEqual({
      message: 'Started a new session.',
      prompt: null,
    });
    expect(executeCommand).toHaveBeenCalledWith({ command: 'new-session' });
    expect(logsResponse.status).toBe(200);
    expect(Array.isArray(logsResponse.body.entries)).toBe(true);
    expect(logsResponse.body.entries.length).toBeGreaterThan(0);
    expect(logsResponse.body.entries[0]).toHaveProperty('requestId');
    expect(typeof logsResponse.headers['x-request-id']).toBe('string');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe('healthy');
    expect(healthResponse.body.resources.allRequiredAccessible).toBe(true);
    expect(getResourceHealth).toHaveBeenCalledTimes(1);
    expect(pullResponse.status).toBe(200);
    expect(pullResponse.body.summary).toBe('Already up to date.');
    expect(gitPull).toHaveBeenCalledTimes(1);
    expect(pushResponse.status).toBe(200);
    expect(pushResponse.body.summary).toBe('Everything up-to-date');
    expect(gitPush).toHaveBeenCalledTimes(1);
    expect(cloneResponse.status).toBe(200);
    expect(cloneResponse.body.ok).toBe(true);
    expect(cloneRepo).toHaveBeenCalledWith('https://github.com/example/repo.git', 'repo-clone');
    expect(piAuthStatusResponse.status).toBe(200);
    expect(piAuthStatusResponse.body.providers).toEqual([
      { provider: 'anthropic', label: 'Anthropic', configured: false },
    ]);
    expect(getPiAuthStatus).toHaveBeenCalledTimes(1);
    expect(piAuthLoginResponse.status).toBe(200);
    expect(loginPiToken).toHaveBeenCalledWith('anthropic', 'test-token');
    expect(piAuthLogoutResponse.status).toBe(200);
    expect(logoutPiProvider).toHaveBeenCalledWith('anthropic');
    expect(stageAllResponse.status).toBe(200);
    expect(gitStageAll).toHaveBeenCalledTimes(1);
    expect(unstageAllResponse.status).toBe(200);
    expect(gitUnstageAll).toHaveBeenCalledTimes(1);
    expect(stageHunkResponse.status).toBe(200);
    expect(unstageHunkResponse.status).toBe(200);
    expect(revertHunkResponse.status).toBe(200);
    expect(invalidHunkResponse.status).toBe(400);
    expect(gitApplyHunk).toHaveBeenNthCalledWith(
      1,
      workspaceService.requireCurrentRepo(),
      'diff --git a/a.txt b/a.txt\n',
      'stage',
    );
    expect(gitApplyHunk).toHaveBeenNthCalledWith(
      2,
      workspaceService.requireCurrentRepo(),
      'diff --git a/a.txt b/a.txt\n',
      'unstage',
    );
    expect(gitApplyHunk).toHaveBeenNthCalledWith(
      3,
      workspaceService.requireCurrentRepo(),
      'diff --git a/a.txt b/a.txt\n',
      'revert',
    );
    expect(createFileResponse.status).toBe(200);
    expect(createFileResponse.body).toEqual({ ok: true, path: 'notes/new-file.md' });
    expect(createFile).toHaveBeenNthCalledWith(
      1,
      workspaceService.requireCurrentRepo(),
      'notes/new-file.md',
      '# hello\n',
    );
    expect(createFileConflictResponse.status).toBe(409);
    expect(createFileConflictResponse.body.error.code).toBe('conflict');
    expect(createFile).toHaveBeenNthCalledWith(
      2,
      workspaceService.requireCurrentRepo(),
      'notes/new-file.md',
      '# hello again\n',
    );
    expect(createFileMissingPathResponse.status).toBe(400);
    expect(createFileMissingPathResponse.body.error.code).toBe('bad_request');
    expect(createFile).toHaveBeenCalledTimes(2);
    expect(clearLogsResponse.status).toBe(204);

    await logService.flush();
  });

  it('maps file system errors and rejects repository-root paths on file routes', async () => {
    const config = {
      nodeEnv: 'test' as const,
      host: '127.0.0.1',
      port: 3000,
      appPassword: 'secret-pass',
      workspaceRoot: tempDir,
      modelUsagePath: path.join(tempDir, '.pi-mobile', 'model-usage.json'),
      logsDirPath: path.join(tempDir, '.pi-mobile', 'logs'),
      logLevel: 'debug' as const,
      sessionCookieName: 'pi_mobile_session',
      sessionCookieSecure: false,
    };
    const logService = new LogService({
      logDirPath: config.logsDirPath,
      minLevel: config.logLevel,
    });
    const workspaceService = new WorkspaceService(tempDir);
    await workspaceService.initializeDefaultRepo();
    const app = createApp({
      config,
      authService: new AuthService(config.appPassword),
      logService,
      workspaceService,
      fileService: new FileService(),
      serverStartedAt: new Date(),
    } as never);

    const unauthorized = await request(app).post('/api/files/delete').send({ path: 'README.md' });
    const cookie = (await request(app).post('/api/auth/login').send({ password: 'secret-pass' }))
      .headers['set-cookie'];
    const deleteRoot = await request(app)
      .post('/api/files/delete')
      .set('Cookie', cookie)
      .send({ path: 'notes/..' });
    const moveMissing = await request(app)
      .post('/api/files/rename')
      .set('Cookie', cookie)
      .send({ fromPath: 'missing.md', toPath: 'other.md' });
    const duplicateExisting = await request(app)
      .post('/api/files/duplicate')
      .set('Cookie', cookie)
      .send({ sourcePath: 'README.md', targetPath: 'README.md' });
    const readMissing = await request(app)
      .get('/api/files/content?path=missing.md')
      .set('Cookie', cookie);

    expect(unauthorized.status).toBe(401);
    expect(deleteRoot.status).toBe(400);
    expect(moveMissing.status).toBe(404);
    expect(duplicateExisting.status).toBe(409);
    expect(readMissing.status).toBe(404);
    expect(await readFile(path.join(tempDir, 'README.md'), 'utf8')).toBe('# temp repo\n');

    await logService.flush();
  });
});
