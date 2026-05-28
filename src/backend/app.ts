import path from 'node:path';

import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';

import type { AppConfig } from './config.js';
import { AuthService } from './services/auth-service.js';
import { FileService } from './services/file-service.js';
import { GitService } from './services/git-service.js';
import { PiAgentService } from './services/pi-agent-service.js';
import { RepositoryRuntimeService } from './services/repository-runtime-service.js';
import { WorkspaceService } from './services/workspace-service.js';

type AppServices = {
  config: AppConfig;
  authService: AuthService;
  workspaceService: WorkspaceService;
  repositoryRuntimeService: RepositoryRuntimeService;
  fileService: FileService;
  gitService: GitService;
  piAgentService: PiAgentService;
};

export function createApp(services: AppServices) {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/api/auth/session', (request, response) => {
    const authenticated = services.authService.isValid(request.cookies?.[services.config.sessionCookieName]);
    response.json({
      authenticated,
      repo: authenticated ? services.workspaceService.getCurrentRepo() : null
    });
  });

  app.post('/api/auth/login', (request, response) => {
    const password = getBodyString(request, 'password');
    const token = services.authService.login(password);

    if (!token) {
      response.status(401).json({ message: 'Invalid password.' });
      return;
    }

    response.cookie(services.config.sessionCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: services.config.nodeEnv === 'production',
      path: '/'
    });
    response.json({
      authenticated: true,
      repo: services.workspaceService.getCurrentRepo()
    });
  });

  app.post('/api/auth/logout', requireAuth(services), (request, response) => {
    services.authService.logout(request.cookies?.[services.config.sessionCookieName]);
    response.clearCookie(services.config.sessionCookieName, { path: '/' });
    response.json({ authenticated: false });
  });

  app.get('/api/workspaces/browse', requireAuth(services), async (request, response) => {
    const currentPath = getQueryString(request, 'path', '.');
    response.json({
      currentPath,
      entries: await services.workspaceService.browse(currentPath),
      currentRepo: services.workspaceService.getCurrentRepo()
    });
  });

  app.post('/api/workspaces/select', requireAuth(services), async (request, response) => {
    const repo = await services.repositoryRuntimeService.selectRepo(getBodyString(request, 'path'));
    response.json({ repo });
  });

  app.get('/api/files/browse', requireAuth(services), async (request, response) => {
    const repo = services.workspaceService.requireCurrentRepo();
    const currentPath = getQueryString(request, 'path', '.');
    response.json({
      currentPath,
      entries: await services.fileService.browse(repo, currentPath)
    });
  });

  app.get('/api/files/content', requireAuth(services), async (request, response) => {
    const repo = services.workspaceService.requireCurrentRepo();
    response.json(await services.fileService.readFile(repo, getQueryString(request, 'path')));
  });

  app.post('/api/files/write', requireAuth(services), async (request, response) => {
    const repo = services.workspaceService.requireCurrentRepo();
    await services.fileService.writeFile(repo, getBodyString(request, 'path'), getBodyString(request, 'content'));
    response.json({ ok: true });
  });

  app.get('/api/git/diff', requireAuth(services), async (_request, response) => {
    const repo = services.workspaceService.requireCurrentRepo();
    response.json({ files: await services.gitService.getDiff(repo) });
  });

  app.post('/api/git/revert-hunk', requireAuth(services), async (request, response) => {
    const repo = services.workspaceService.requireCurrentRepo();
    await services.gitService.revertHunk(repo, getBodyString(request, 'diff'));
    response.json({ ok: true });
  });

  app.get('/api/agent/state', requireAuth(services), (_request, response) => {
    response.json(services.piAgentService.getSnapshot());
  });

  app.post('/api/agent/prompt', requireAuth(services), async (request, response) => {
    await services.piAgentService.prompt(getBodyString(request, 'prompt'));
    response.status(202).json({ accepted: true });
  });

  app.post('/api/agent/abort', requireAuth(services), async (_request, response) => {
    await services.piAgentService.abort();
    response.json({ ok: true });
  });

  if (services.config.nodeEnv === 'production') {
    const publicDir = path.resolve(process.cwd(), 'dist/public');
    app.use(express.static(publicDir));
    app.get(/^(?!\/api).*/, (_request, response) => {
      response.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    response.status(400).json({ message });
  });

  return app;
}

function requireAuth(services: AppServices) {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = request.cookies?.[services.config.sessionCookieName];

    if (!services.authService.isValid(token)) {
      response.status(401).json({ message: 'Unauthorized.' });
      return;
    }

    next();
  };
}

function getQueryString(request: Request, key: string, fallback?: string) {
  const candidate = request.query[key];
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Missing query parameter: ${key}`);
}

function getBodyString(request: Request, key: string) {
  const candidate = request.body?.[key];

  if (typeof candidate !== 'string') {
    throw new Error(`Missing request body field: ${key}`);
  }

  return candidate;
}