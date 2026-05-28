import { createServer } from 'node:http';

import type { WebsocketEnvelope } from '../shared/contracts.js';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { AuthService } from './services/auth-service.js';
import { FileService } from './services/file-service.js';
import { GitService } from './services/git-service.js';
import { PiAgentService } from './services/pi-agent-service.js';
import { RepositoryRuntimeService } from './services/repository-runtime-service.js';
import { WatcherService } from './services/watcher-service.js';
import { WorkspaceService } from './services/workspace-service.js';
import { WebsocketHub } from './services/websocket-hub.js';

const config = loadConfig();
const authService = new AuthService(config.appPassword);
const workspaceService = new WorkspaceService(config.workspaceRoot, config.defaultRepo);

let websocketHub: WebsocketHub;

const piAgentService = new PiAgentService(config, (event) => {
  websocketHub.broadcast(event);
});

const watcherService = new WatcherService((payload) => {
  websocketHub.broadcast({
    type: 'workspace_changed',
    payload
  } satisfies WebsocketEnvelope);
});

const repositoryRuntimeService = new RepositoryRuntimeService(
  workspaceService,
  watcherService,
  piAgentService,
  (repo) => {
    websocketHub.broadcast({
      type: 'repo_selected',
      payload: { repo }
    });
  }
);

websocketHub = new WebsocketHub(authService, config.sessionCookieName, () => piAgentService.getSnapshot());

const app = createApp({
  config,
  authService,
  workspaceService,
  repositoryRuntimeService,
  fileService: new FileService(),
  gitService: new GitService(),
  piAgentService
});

const server = createServer(app);

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }

  websocketHub.handleUpgrade(request, socket, head);
});

await repositoryRuntimeService.initialize();

server.listen(config.port, config.host, () => {
  console.log(`PiMobile server listening on http://${config.host}:${config.port}`);
});

async function shutdown() {
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
}

process.once('SIGINT', () => {
  void shutdown();
});

process.once('SIGTERM', () => {
  void shutdown();
});