import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";

import type {
  AgentCommandRequest,
  ApiErrorResponse,
  BackendHealthResponse,
  BackendLogLevel,
  BackendLogQuery,
  BackendLogQueryResponse,
  FileCreateDirectoryResult,
  FileCreateResult,
  FileDeleteResult,
  FileDownloadInfo,
  FileDuplicateResult,
  FileMoveResult,
  FileUploadResult,
  GitBranchesResponse,
  GitDiffResponse,
  GitSyncResult,
  PiAuthLoginTokenRequest,
  PiAuthLogoutRequest,
  PiAuthStatusResponse,
  SelectedRepo,
  WorkspaceCloneRequest,
  WorkspaceCloneResult,
} from "../shared/contracts.js";

import type { AppConfig } from "./config.js";
import { AuthService } from "./services/auth-service.js";
import { FileService } from "./services/file-service.js";
import { GitService } from "./services/git-service.js";
import { LogService } from "./services/log-service.js";
import { PiAgentService } from "./services/pi-agent-service.js";
import { PiAuthService, PiAuthServiceError } from "./services/pi-auth-service.js";
import { RepositoryRuntimeService } from "./services/repository-runtime-service.js";
import { ResourceHealthService } from "./services/resource-health-service.js";
import { WorkspaceService } from "./services/workspace-service.js";
import { HttpError, isHttpError } from "./utils/http-error.js";

type AppServices = {
  config: AppConfig;
  authService: AuthService;
  logService: LogService;
  workspaceService: WorkspaceService;
  repositoryRuntimeService: RepositoryRuntimeService;
  fileService: FileService;
  gitService: GitService;
  resourceHealthService: ResourceHealthService;
  piAgentService: PiAgentService;
  piAuthService: PiAuthService;
  serverStartedAt: Date;
};

export function createApp(services: AppServices) {
  const app = express();
  const httpLog = services.logService.child({ source: "http" });

  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    next();
  });

  app.use((request, response, next) => {
    const incomingRequestId = request.header("x-request-id")?.trim();
    const requestId = incomingRequestId && incomingRequestId.length > 0 ? incomingRequestId : randomUUID();
    setRequestId(response, requestId);
    response.setHeader("x-request-id", requestId);
    next();
  });

  app.use((request, response, next) => {
    const requestStartedAt = Date.now();
    const requestId = getRequestId(response);
    const suppressRequestLogs = request.method === "DELETE" && request.path === "/api/logs";

    if (!suppressRequestLogs) {
      httpLog.info("Request started.", {
        event: "request_start",
        requestId,
        details: {
          method: request.method,
          path: request.path,
        },
      });
    }

    response.on("finish", () => {
      if (suppressRequestLogs) {
        return;
      }

      const durationMs = Date.now() - requestStartedAt;
      const level: BackendLogLevel = response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info";
      services.logService[level]("Request completed.", {
        source: "http",
        event: "request_finish",
        requestId,
        details: {
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs,
        },
      });
    });

    next();
  });

  app.get("/api/health", async (_request, response) => {
    const resourceReport = await services.resourceHealthService.check();

    response.json({
      ok: true,
      status: resourceReport.allRequiredAccessible ? "healthy" : "degraded",
      serverTime: new Date().toISOString(),
      startedAt: services.serverStartedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      resources: resourceReport,
    } satisfies BackendHealthResponse);
  });

  app.get("/api/auth/session", (request, response) => {
    const authenticated = services.authService.isValid(request.cookies?.[services.config.sessionCookieName]);
    response.json({
      authenticated,
      repo: authenticated ? services.workspaceService.getCurrentRepo() : null,
    });
  });

  app.post("/api/auth/login", (request, response) => {
    const password = getBodyString(request, "password");
    const token = services.authService.login(password);

    if (!token) {
      sendApiError(response, new HttpError(401, "unauthorized", "Invalid password.", { retriable: false }));
      return;
    }

    response.cookie(services.config.sessionCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: services.config.sessionCookieSecure,
      path: "/",
    });
    response.json({
      authenticated: true,
      repo: services.workspaceService.getCurrentRepo(),
    });
  });

  app.use("/api", requireAuth(services));
  const currentRepo = () => services.workspaceService.requireCurrentRepo();

  app.post("/api/auth/logout", (request, response) => {
    services.authService.logout(request.cookies?.[services.config.sessionCookieName]);
    response.clearCookie(services.config.sessionCookieName, { path: "/" });
    response.json({ authenticated: false });
  });

  app.get("/api/pi/auth/status", async (_request, response) => {
    response.json((await services.piAuthService.getStatus()) satisfies PiAuthStatusResponse);
  });

  app.post("/api/pi/auth/login-token", async (request, response) => {
    const body = getBodyObject<PiAuthLoginTokenRequest>(request);
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!provider || !token) {
      throw new HttpError(400, "bad_request", "Provider and token are required.", { retriable: false });
    }

    try {
      response.json(await services.piAuthService.loginToken(provider, token));
    } catch (error) {
      if (error instanceof PiAuthServiceError) {
        const statusCode = error.code === "unknown_provider" ? 400 : 401;
        throw new HttpError(statusCode, "validation_error", error.message, { retriable: false });
      }

      throw error;
    }
  });

  app.post("/api/pi/auth/logout", async (request, response) => {
    const body = getBodyObject<PiAuthLogoutRequest>(request);
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";

    if (!provider) {
      throw new HttpError(400, "bad_request", "Provider is required.", { retriable: false });
    }

    try {
      response.json(await services.piAuthService.logout(provider));
    } catch (error) {
      if (error instanceof PiAuthServiceError && error.code === "unknown_provider") {
        throw new HttpError(400, "validation_error", error.message, { retriable: false });
      }

      throw error;
    }
  });

  app.get("/api/workspaces/browse", async (request, response) => {
    const currentPath = getQueryString(request, "path", ".");
    response.json({
      currentPath,
      entries: await services.workspaceService.browse(currentPath),
      currentRepo: services.workspaceService.getCurrentRepo(),
    });
  });

  app.post("/api/workspaces/select", async (request, response) => {
    const repo = await services.repositoryRuntimeService.selectRepo(getBodyString(request, "path"));
    response.json({ repo });
  });

  app.post("/api/workspaces/clone", async (request, response) => {
    const body = getBodyObject<WorkspaceCloneRequest>(request);
    const remoteUrl = typeof body.remoteUrl === "string" ? body.remoteUrl.trim() : "";
    const destinationPath = typeof body.destinationPath === "string" ? body.destinationPath.trim() : undefined;

    if (!remoteUrl) {
      throw new HttpError(400, "bad_request", "Remote URL is required.", { retriable: false });
    }

    try {
      const repo = await services.repositoryRuntimeService.cloneRepo(remoteUrl, destinationPath && destinationPath.length > 0 ? destinationPath : undefined);
      response.json({ ok: true, repo } satisfies WorkspaceCloneResult);
    } catch (error) {
      if (isCloneDestinationConflict(error)) {
        throw new HttpError(409, "conflict", "Destination path already exists.", { retriable: false });
      }

      throw error;
    }
  });

  app.use("/api/files", createFileRouter(services.fileService, currentRepo));

  app.get("/api/git/diff", async (_request, response) => {
    const repo = currentRepo();
    const [files, sync] = await Promise.all([services.gitService.getDiff(repo), services.gitService.getRemoteSyncStatus(repo)]);
    response.json({ files, sync } satisfies GitDiffResponse);
  });

  app.post("/api/git/commit", async (request, response) => {
    const repo = currentRepo();
    const commitSha = await services.gitService.commit(repo, getBodyString(request, "message"));
    response.json({ commitSha });
  });

  app.post("/api/git/pull", async (_request, response) => {
    const repo = currentRepo();
    response.json({
      summary: await services.gitService.pull(repo),
    } satisfies GitSyncResult);
  });

  app.post("/api/git/push", async (_request, response) => {
    const repo = currentRepo();
    response.json({
      summary: await services.gitService.push(repo),
    } satisfies GitSyncResult);
  });

  app.get("/api/git/branches", async (_request, response) => {
    const repo = currentRepo();
    const [branches, current] = await Promise.all([services.gitService.getBranches(repo), services.gitService.getCurrentBranch(repo)]);
    response.json({ branches, current } satisfies GitBranchesResponse);
  });

  app.post("/api/git/branch/switch", async (request, response) => {
    const repo = currentRepo();
    await services.gitService.switchBranch(repo, getBodyString(request, "name"));
    response.json({ ok: true });
  });

  app.post("/api/git/branch/create", async (request, response) => {
    const repo = currentRepo();
    await services.gitService.createBranch(repo, getBodyString(request, "name"));
    response.json({ ok: true });
  });

  app.post("/api/git/stage-hunk", async (request, response) => {
    const repo = currentRepo();
    await services.gitService.stageHunk(repo, getBodyString(request, "diff"));
    response.json({ ok: true });
  });

  app.post("/api/git/unstage-hunk", async (request, response) => {
    const repo = currentRepo();
    await services.gitService.unstageHunk(repo, getBodyString(request, "diff"));
    response.json({ ok: true });
  });

  app.post("/api/git/stage-all", async (_request, response) => {
    const repo = currentRepo();
    await services.gitService.stageAll(repo);
    response.json({ ok: true });
  });

  app.post("/api/git/unstage-all", async (_request, response) => {
    const repo = currentRepo();
    await services.gitService.unstageAll(repo);
    response.json({ ok: true });
  });

  app.post("/api/git/revert-hunk", async (request, response) => {
    const repo = currentRepo();
    await services.gitService.revertHunk(repo, getBodyString(request, "diff"));
    response.json({ ok: true });
  });

  app.get("/api/logs", (request, response) => {
    const query = parseLogQuery(request);
    response.json(services.logService.queryLogs(query) satisfies BackendLogQueryResponse);
  });

  app.delete("/api/logs", async (_request, response) => {
    await services.logService.clear();
    response.status(204).end();
  });

  app.get("/api/logs/stream", (request, response) => {
    const query = parseLogQuery(request);

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const writeEvent = (event: string, payload: unknown) => {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    writeEvent("ready", { ok: true });

    const unsubscribe = services.logService.subscribe((entry) => {
      writeEvent("log", entry);
    }, query);

    const heartbeat = setInterval(() => {
      writeEvent("ping", { time: Date.now() });
    }, 15000);

    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get("/api/agent/state", (request, response) => {
    if (request.query.minimal === "true") {
      response.json(services.piAgentService.getMinimalSnapshot());
      return;
    }

    response.json(services.piAgentService.getSnapshot());
  });

  app.get("/api/agent/command-state", async (_request, response) => {
    response.json(await services.piAgentService.getCommandState());
  });

  app.post("/api/agent/command", async (request, response) => {
    response.json(await services.piAgentService.executeCommand(getBodyObject<AgentCommandRequest>(request)));
  });

  app.post("/api/agent/prompt", async (request, response) => {
    await services.piAgentService.prompt(getBodyString(request, "prompt"));
    response.status(202).json({ accepted: true });
  });

  app.post("/api/agent/abort", async (_request, response) => {
    await services.piAgentService.abort();
    response.json({ ok: true });
  });

  app.post("/api/agent/new-session", async (_request, response) => {
    await services.piAgentService.startNewSession();
    response.json({ ok: true });
  });

  const publicDir = path.resolve(process.cwd(), "dist/public");
  const indexFile = path.join(publicDir, "index.html");

  if (services.config.nodeEnv === "production" && existsSync(indexFile)) {
    app.use(express.static(publicDir));
    app.get(/^(?!\/api).*/, (_request, response) => {
      response.sendFile(indexFile);
    });
  } else if (services.config.nodeEnv === "development") {
    app.get(/^(?!\/api|\/ws).*/, (request, response) => {
      const host = request.hostname;
      response.redirect(307, `http://${host}:5173${request.originalUrl}`);
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const { statusCode, payload } = toApiError(error, getRequestId(response));

    services.logService.error("Request failed.", {
      source: "http",
      event: "request_failed",
      requestId: payload.error.requestId,
      details: {
        code: payload.error.code,
        statusCode,
        message: payload.error.message,
        error: serializeError(error),
      },
    });

    response.status(statusCode).json(payload);
  });

  return app;
}

function createFileRouter(fileService: FileService, currentRepo: () => SelectedRepo) {
  const router = express.Router();

  router.get("/browse", async (request, response) => {
    const currentPath = getQueryString(request, "path", ".");
    response.json({ currentPath, entries: await fileService.browse(currentRepo(), currentPath) });
  });

  router.get("/content", async (request, response) => {
    response.json(await fileService.readFile(currentRepo(), getQueryString(request, "path")));
  });

  router.post("/write", async (request, response) => {
    await fileService.writeFile(currentRepo(), getEntryPath(getBodyString(request, "path")), getBodyString(request, "content"));
    response.json({ ok: true });
  });

  router.post("/create", async (request, response) => {
    const filePath = getEntryPath(getBodyString(request, "path"));
    const content = typeof request.body.content === "string" ? request.body.content : "";
    await fileService.createFile(currentRepo(), filePath, content);
    response.json({ ok: true, path: filePath } satisfies FileCreateResult);
  });

  router.post("/create-directory", async (request, response) => {
    const directoryPath = getEntryPath(getBodyString(request, "path"));
    await fileService.createDirectory(currentRepo(), directoryPath);
    response.json({ ok: true, path: directoryPath } satisfies FileCreateDirectoryResult);
  });

  router.post("/duplicate", async (request, response) => {
    const sourcePath = getEntryPath(getBodyString(request, "sourcePath"));
    const targetPath = getEntryPath(getBodyString(request, "targetPath"));
    await fileService.duplicateFile(currentRepo(), sourcePath, targetPath);
    response.json({ ok: true, path: targetPath } satisfies FileDuplicateResult);
  });

  router.post(["/move", "/rename"], async (request, response) => {
    const fromPath = getEntryPath(getBodyString(request, "fromPath"));
    const toPath = getEntryPath(getBodyString(request, "toPath"));
    await fileService.movePath(currentRepo(), fromPath, toPath);
    response.json({ ok: true, fromPath, toPath } satisfies FileMoveResult);
  });

  router.post("/delete", async (request, response) => {
    const filePath = getEntryPath(getBodyString(request, "path"));
    await fileService.deletePath(currentRepo(), filePath);
    response.json({ ok: true, path: filePath } satisfies FileDeleteResult);
  });

  router.post("/upload", async (request, response) => {
    const filePath = getEntryPath(getBodyString(request, "path"));
    const contentBase64 = getBodyString(request, "contentBase64");

    if (contentBase64.length === 0) {
      throw new HttpError(400, "bad_request", "Base64 content is required.", { retriable: false });
    }

    await fileService.uploadFile(currentRepo(), filePath, contentBase64);
    response.json({ ok: true, path: filePath } satisfies FileUploadResult);
  });

  router.get("/download", async (request, response) => {
    response.json((await fileService.getDownloadInfo(currentRepo(), getEntryPath(getQueryString(request, "path")))) satisfies FileDownloadInfo);
  });

  router.use((error: unknown, _request: Request, _response: Response, next: NextFunction) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;

    if (code === "EEXIST") {
      next(new HttpError(409, "conflict", "Target path already exists.", { retriable: false }));
    } else if (code === "ENOENT") {
      next(new HttpError(404, "not_found", "Path does not exist.", { retriable: false }));
    } else {
      next(error);
    }
  });

  return router;
}

function requireAuth(services: AppServices) {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = request.cookies?.[services.config.sessionCookieName];

    if (!services.authService.isValid(token)) {
      sendApiError(response, new HttpError(401, "unauthorized", "Unauthorized.", { retriable: false }));
      return;
    }

    next();
  };
}

function getQueryString(request: Request, key: string, fallback?: string) {
  const candidate = request.query[key];
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new HttpError(400, "bad_request", `Missing query parameter: ${key}`, { retriable: false });
}

function getOptionalQueryString(request: Request, key: string) {
  const candidate = request.query[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function getBodyString(request: Request, key: string) {
  const candidate = request.body?.[key];

  if (typeof candidate !== "string") {
    throw new HttpError(400, "bad_request", `Missing request body field: ${key}`, { retriable: false });
  }

  return candidate;
}

function getBodyObject<T>(request: Request) {
  if (!request.body || typeof request.body !== "object") {
    throw new HttpError(400, "bad_request", "Missing request body.", { retriable: false });
  }

  return request.body as T;
}

// path.posix.normalize also catches "foo/.." so no mutating file route can target the repository root.
function getEntryPath(value: string) {
  const trimmed = value.trim();

  if (trimmed.length === 0 || path.posix.normalize(trimmed) === ".") {
    throw new HttpError(400, "bad_request", "A path inside the repository is required.", { retriable: false });
  }

  return trimmed;
}

function isCloneDestinationConflict(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("destination path already exists") || message.includes("already exists");
}

function parseLogQuery(request: Request): BackendLogQuery {
  const query: BackendLogQuery = {};
  const limitRaw = getOptionalQueryString(request, "limit");
  const beforeSeqRaw = getOptionalQueryString(request, "beforeSeq");
  const levelRaw = getOptionalQueryString(request, "level");
  const sourceRaw = getOptionalQueryString(request, "source");
  const searchRaw = getOptionalQueryString(request, "search");

  if (limitRaw !== undefined) {
    const value = Number.parseInt(limitRaw, 10);

    if (!Number.isFinite(value) || value <= 0) {
      throw new HttpError(400, "bad_request", "Query parameter 'limit' must be a positive integer.", { retriable: false });
    }

    query.limit = value;
  }

  if (beforeSeqRaw !== undefined) {
    const value = Number.parseInt(beforeSeqRaw, 10);

    if (!Number.isFinite(value) || value <= 0) {
      throw new HttpError(400, "bad_request", "Query parameter 'beforeSeq' must be a positive integer.", { retriable: false });
    }

    query.beforeSeq = value;
  }

  if (levelRaw !== undefined) {
    if (!isBackendLogLevel(levelRaw)) {
      throw new HttpError(400, "bad_request", "Query parameter 'level' is invalid.", { retriable: false });
    }

    query.level = levelRaw;
  }

  if (sourceRaw !== undefined) {
    query.source = sourceRaw;
  }

  if (searchRaw !== undefined) {
    query.search = searchRaw;
  }

  return query;
}

function sendApiError(response: Response, error: HttpError) {
  const { statusCode, payload } = toApiError(error, getRequestId(response));
  response.status(statusCode).json(payload);
}

function toApiError(error: unknown, requestId: string): { statusCode: number; payload: ApiErrorResponse } {
  if (isHttpError(error)) {
    return {
      statusCode: error.statusCode,
      payload: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          requestId,
          retriable: error.retriable,
          details: error.details,
        },
      },
    };
  }

  if (error instanceof SyntaxError && "body" in error) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        error: {
          code: "validation_error",
          message: "Malformed JSON request body.",
          requestId,
          retriable: false,
        },
      },
    };
  }

  const message = error instanceof Error ? error.message : "Unexpected server error.";

  return {
    statusCode: 500,
    payload: {
      ok: false,
      error: {
        code: "internal_error",
        message,
        requestId,
        retriable: true,
      },
    },
  };
}

function getRequestId(response: Response) {
  const locals = response.locals as Record<string, unknown>;
  const requestId = locals.requestId;

  if (typeof requestId === "string" && requestId.length > 0) {
    return requestId;
  }

  const generated = randomUUID();
  locals.requestId = generated;
  return generated;
}

function setRequestId(response: Response, requestId: string) {
  const locals = response.locals as Record<string, unknown>;
  locals.requestId = requestId;
}

function isBackendLogLevel(value: string): value is BackendLogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { value: String(error) };
}
