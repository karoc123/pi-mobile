import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import type { BackendLogEntry, BackendLogLevel, BackendLogQuery, BackendLogQueryResponse } from "../../shared/contracts.js";

type LogContext = {
  source?: string;
  repo?: string | null;
  requestId?: string | null;
};

export type LogMetadata = {
  source?: string;
  event?: string;
  details?: unknown;
  repo?: string | null;
  requestId?: string | null;
};

type LogListener = (entry: BackendLogEntry) => void;

export type LogChannel = {
  debug: (message: string, metadata?: LogMetadata) => void;
  info: (message: string, metadata?: LogMetadata) => void;
  warn: (message: string, metadata?: LogMetadata) => void;
  error: (message: string, metadata?: LogMetadata) => void;
};

type LogServiceOptions = {
  logDirPath: string;
  maxEntries?: number;
  maxFileBytes?: number;
  minLevel?: BackendLogLevel;
};

const defaultSource = "backend";

const levelPriority: Record<BackendLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class LogService {
  private readonly entries: BackendLogEntry[] = [];
  private readonly listeners = new Set<LogListener>();
  private readonly maxEntries: number;
  private readonly maxFileBytes: number;
  private readonly minLevel: BackendLogLevel;
  private readonly logFilePath: string;
  private sequence = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: LogServiceOptions) {
    this.maxEntries = options.maxEntries ?? 2500;
    this.maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024;
    this.minLevel = options.minLevel ?? "info";
    this.logFilePath = path.join(options.logDirPath, "backend.log");
    void mkdir(options.logDirPath, { recursive: true });
  }

  child(context: LogContext): LogChannel {
    return {
      debug: (message: string, metadata: LogMetadata = {}) => {
        this.log("debug", message, { ...context, ...metadata });
      },
      info: (message: string, metadata: LogMetadata = {}) => {
        this.log("info", message, { ...context, ...metadata });
      },
      warn: (message: string, metadata: LogMetadata = {}) => {
        this.log("warn", message, { ...context, ...metadata });
      },
      error: (message: string, metadata: LogMetadata = {}) => {
        this.log("error", message, { ...context, ...metadata });
      },
    };
  }

  debug(message: string, metadata: LogMetadata = {}) {
    this.log("debug", message, metadata);
  }

  info(message: string, metadata: LogMetadata = {}) {
    this.log("info", message, metadata);
  }

  warn(message: string, metadata: LogMetadata = {}) {
    this.log("warn", message, metadata);
  }

  error(message: string, metadata: LogMetadata = {}) {
    this.log("error", message, metadata);
  }

  queryLogs(query: BackendLogQuery): BackendLogQueryResponse {
    const limit = normalizeLimit(query.limit);
    const beforeSeq = typeof query.beforeSeq === "number" && Number.isFinite(query.beforeSeq) ? query.beforeSeq : undefined;
    const filtered = this.entries.filter((entry) => this.matchesQuery(entry, query));
    const scoped = beforeSeq === undefined ? filtered : filtered.filter((entry) => entry.seq < beforeSeq);
    const entries = scoped.slice(-limit);
    const hasMore = scoped.length > entries.length;

    return {
      entries,
      hasMore,
      nextBeforeSeq: entries.length > 0 ? entries[0].seq : null,
    };
  }

  subscribe(listener: LogListener, query: BackendLogQuery = {}) {
    const wrapped: LogListener = (entry) => {
      if (this.matchesQuery(entry, query)) {
        listener(entry);
      }
    };

    this.listeners.add(wrapped);

    return () => {
      this.listeners.delete(wrapped);
    };
  }

  async flush() {
    await this.writeQueue;
  }

  async clear() {
    this.entries.splice(0, this.entries.length);
    this.sequence = 0;

    const clearTask = this.writeQueue.then(async () => {
      const fileNames = await this.listPersistedLogFiles();

      await Promise.all(
        fileNames.map(async (fileName) => {
          await unlink(path.join(this.options.logDirPath, fileName));
        }),
      );
    });

    this.writeQueue = clearTask.catch((error) => {
      this.emitPersistenceError(error);
    });

    await clearTask;
  }

  private log(level: BackendLogLevel, message: string, metadata: LogMetadata) {
    if (levelPriority[level] < levelPriority[this.minLevel]) {
      return;
    }

    const entry: BackendLogEntry = {
      seq: ++this.sequence,
      timestamp: new Date().toISOString(),
      level,
      source: metadata.source ?? defaultSource,
      event: metadata.event ?? null,
      message,
      repo: metadata.repo ?? null,
      requestId: metadata.requestId ?? null,
      details: redactSecrets(metadata.details),
    };

    this.entries.push(entry);

    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    this.emitToConsole(entry);

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Ignore subscriber errors to keep logging stable.
      }
    }

    this.writeQueue = this.writeQueue
      .then(() => this.persistEntry(entry))
      .catch((error) => {
        this.emitPersistenceError(error);
      });
  }

  private emitToConsole(entry: BackendLogEntry) {
    const output = JSON.stringify(entry);

    if (entry.level === "error") {
      console.error(output);
      return;
    }

    if (entry.level === "warn") {
      console.warn(output);
      return;
    }

    console.log(output);
  }

  private emitPersistenceError(error: unknown) {
    const fallback: BackendLogEntry = {
      seq: ++this.sequence,
      timestamp: new Date().toISOString(),
      level: "error",
      source: "log-service",
      event: "persist_failed",
      message: "Failed to persist backend log entry.",
      repo: null,
      requestId: null,
      details: {
        reason: toErrorMessage(error),
      },
    };

    this.entries.push(fallback);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    console.error(JSON.stringify(fallback));
  }

  private matchesQuery(entry: BackendLogEntry, query: BackendLogQuery) {
    if (query.level && entry.level !== query.level) {
      return false;
    }

    if (query.source && entry.source !== query.source) {
      return false;
    }

    if (!query.search) {
      return true;
    }

    const needle = query.search.trim().toLowerCase();

    if (!needle) {
      return true;
    }

    const haystack = `${entry.message} ${entry.source} ${entry.event ?? ""} ${entry.repo ?? ""} ${serializeDetails(entry.details)}`.toLowerCase();
    return haystack.includes(needle);
  }

  private async persistEntry(entry: BackendLogEntry) {
    await mkdir(this.options.logDirPath, { recursive: true });

    try {
      const info = await stat(this.logFilePath);

      if (info.size >= this.maxFileBytes) {
        const rotatedPath = path.join(this.options.logDirPath, `backend-${Date.now()}.log`);
        await rename(this.logFilePath, rotatedPath);
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }

    await appendFile(this.logFilePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private async listPersistedLogFiles() {
    try {
      const entries = await readdir(this.options.logDirPath, { withFileTypes: true });

      return entries.filter((entry) => entry.isFile() && (entry.name === "backend.log" || /^backend-\d+\.log$/.test(entry.name))).map((entry) => entry.name);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }

      throw error;
    }
  }
}

function normalizeLimit(limit: number | undefined) {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return 200;
  }

  return Math.min(Math.floor(limit), 500);
}

function isMissingFile(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, candidate] of Object.entries(value)) {
    if (looksSensitive(key)) {
      redacted[key] = "[REDACTED]";
      continue;
    }

    redacted[key] = redactSecrets(candidate);
  }

  return redacted;
}

function looksSensitive(key: string) {
  return /(password|token|secret|authorization|cookie)/i.test(key);
}

function serializeDetails(details: unknown) {
  if (details === null || details === undefined) {
    return "";
  }

  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
