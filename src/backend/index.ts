import { createServer } from 'node:http';

import type { SelectedRepo, WebsocketEnvelope } from '../shared/contracts.js';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { AuthService } from './services/auth-service.js';
import { FileService } from './services/file-service.js';
import { GitService } from './services/git-service.js';
import { LogService } from './services/log-service.js';
import { ModelUsageStore } from './services/model-usage-store.js';
import { PiAgentService } from './services/pi-agent-service.js';
import { PiAuthService } from './services/pi-auth-service.js';
import { ResourceHealthService } from './services/resource-health-service.js';
import { WatcherService } from './services/watcher-service.js';
import { WorkspaceService } from './services/workspace-service.js';
import { WebsocketHub } from './services/websocket-hub.js';

const serverStartedAt = new Date();
const config = loadConfig();
const logService = new LogService({
  logDirPath: config.logsDirPath,
  minLevel: config.logLevel,
});
const bootstrapLog = logService.child({ source: 'bootstrap' });
const authService = new AuthService(config.appPassword);
const resourceHealthService = new ResourceHealthService(config);
const workspaceService = new WorkspaceService(config.workspaceRoot, config.defaultRepo);
const gitService = new GitService();
const piAuthService = new PiAuthService(config);

const websocketHub = new WebsocketHub(
  authService,
  config.sessionCookieName,
  () => piAgentService.getSnapshot(),
  logService.child({ source: 'ws' }),
);

const piAgentService = new PiAgentService(
  config,
  (event) => {
    websocketHub.broadcast(event);
  },
  new ModelUsageStore(config.modelUsagePath, logService.child({ source: 'model-usage' })),
  logService.child({ source: 'pi-agent' }),
);

const watcherService = new WatcherService(
  (payload) => {
    websocketHub.broadcast({
      type: 'workspace_changed',
      payload,
    } satisfies WebsocketEnvelope);
  },
  logService.child({ source: 'watcher' }),
  {
    ignoredAbsolutePaths: [config.logsDirPath, config.piSessionDir].filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    ),
  },
);

const activateRepo = async (repo: SelectedRepo) => {
  await watcherService.watch(repo.absolutePath);
  await piAgentService.selectRepo(repo);
  websocketHub.broadcast({
    type: 'repo_selected',
    payload: { repo },
  });
};

const app = createApp({
  config,
  authService,
  logService,
  workspaceService,
  activateRepo,
  fileService: new FileService(),
  gitService,
  resourceHealthService,
  piAgentService,
  piAuthService,
  serverStartedAt,
});

const server = createServer(app);

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }

  websocketHub.handleUpgrade(request, socket, head);
});

const defaultRepo = await workspaceService.initializeDefaultRepo();
if (defaultRepo) {
  await activateRepo(defaultRepo);
}

server.listen(config.port, config.host, () => {
  bootstrapLog.info('PiMobile server listening.', {
    event: 'server_listen',
    details: {
      host: config.host,
      port: config.port,
      workspaceRoot: config.workspaceRoot,
      logsDirPath: config.logsDirPath,
    },
  });
});

let shuttingDown = false;

async function shutdown(signal?: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  bootstrapLog.info('Server shutdown requested.', {
    event: 'server_shutdown_requested',
    details: { signal: signal ?? 'manual' },
  });

  try {
    await watcherService.dispose();
    await piAgentService.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    bootstrapLog.info('Server shutdown completed.', { event: 'server_shutdown_complete' });
  } catch (error) {
    bootstrapLog.error('Server shutdown failed.', {
      event: 'server_shutdown_failed',
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    await logService.flush();
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.once('uncaughtException', (error) => {
  bootstrapLog.error('Uncaught exception.', {
    event: 'uncaught_exception',
    details: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
  });
  void shutdown('uncaughtException');
});

process.once('unhandledRejection', (reason) => {
  bootstrapLog.error('Unhandled promise rejection.', {
    event: 'unhandled_rejection',
    details: {
      reason:
        reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason),
    },
  });
  void shutdown('unhandledRejection');
});

process.on('warning', (warning) => {
  bootstrapLog.warn('Process warning emitted.', {
    event: 'process_warning',
    details: {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    },
  });
});
