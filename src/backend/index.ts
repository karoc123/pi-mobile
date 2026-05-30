import { createServer } from "node:http";

import type { WebsocketEnvelope } from "../shared/contracts.js";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AuthService } from "./services/auth-service.js";
import { CostService } from "./services/cost-service.js";
import { FileService } from "./services/file-service.js";
import { GitService } from "./services/git-service.js";
import { LogService } from "./services/log-service.js";
import { PiAgentService } from "./services/pi-agent-service.js";
import { RepositoryRuntimeService } from "./services/repository-runtime-service.js";
import { WatcherService } from "./services/watcher-service.js";
import { WorkspaceService } from "./services/workspace-service.js";
import { WebsocketHub } from "./services/websocket-hub.js";

const serverStartedAt = new Date();
const config = loadConfig();
const logService = new LogService({
  logDirPath: config.logsDirPath,
  minLevel: config.logLevel,
});
const bootstrapLog = logService.child({ source: "bootstrap" });
const authService = new AuthService(config.appPassword);
const workspaceService = new WorkspaceService(config.workspaceRoot, config.defaultRepo);
const costService = new CostService(config.costsDbPath);
const gitIdentity = config.gitUserName && config.gitUserEmail ? { name: config.gitUserName, email: config.gitUserEmail } : undefined;
const gitService = new GitService(gitIdentity);

let websocketHub: WebsocketHub;

const piAgentService = new PiAgentService(
  config,
  (event) => {
    websocketHub.broadcast(event);
  },
  costService,
  logService.child({ source: "pi-agent" }),
);

const watcherService = new WatcherService(
  (payload) => {
    websocketHub.broadcast({
      type: "workspace_changed",
      payload,
    } satisfies WebsocketEnvelope);
  },
  logService.child({ source: "watcher" }),
);

const repositoryRuntimeService = new RepositoryRuntimeService(workspaceService, watcherService, piAgentService, (repo) => {
  websocketHub.broadcast({
    type: "repo_selected",
    payload: { repo },
  });
});

websocketHub = new WebsocketHub(authService, config.sessionCookieName, () => piAgentService.getSnapshot(), logService.child({ source: "ws" }));

const app = createApp({
  config,
  authService,
  logService,
  workspaceService,
  repositoryRuntimeService,
  fileService: new FileService(),
  gitService,
  costService,
  piAgentService,
  serverStartedAt,
});

const server = createServer(app);

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }

  websocketHub.handleUpgrade(request, socket, head);
});

await repositoryRuntimeService.initialize();

server.listen(config.port, config.host, () => {
  bootstrapLog.info("PiMobile server listening.", {
    event: "server_listen",
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
  bootstrapLog.info("Server shutdown requested.", {
    event: "server_shutdown_requested",
    details: { signal: signal ?? "manual" },
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

    bootstrapLog.info("Server shutdown completed.", { event: "server_shutdown_complete" });
  } catch (error) {
    bootstrapLog.error("Server shutdown failed.", {
      event: "server_shutdown_failed",
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    await logService.flush();
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("uncaughtException", (error) => {
  bootstrapLog.error("Uncaught exception.", {
    event: "uncaught_exception",
    details: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
  });
  void shutdown("uncaughtException");
});

process.once("unhandledRejection", (reason) => {
  bootstrapLog.error("Unhandled promise rejection.", {
    event: "unhandled_rejection",
    details: {
      reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason),
    },
  });
  void shutdown("unhandledRejection");
});

process.on("warning", (warning) => {
  bootstrapLog.warn("Process warning emitted.", {
    event: "process_warning",
    details: {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    },
  });
});
