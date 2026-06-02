import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type CostSessionRecord = {
  sessionKey: string;
  sessionId: string | null;
  sessionFile: string | null;
  repoName: string;
  repoRelativePath: string;
  repoAbsolutePath: string;
  modelId: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  contextTokens: number | null;
  contextWindow: number | null;
  contextPercent: number | null;
  usingSubscription: boolean;
  autoCompactEnabled: boolean;
};

export type CostReportFilters = {
  repo?: string;
  model?: string;
  from?: string;
  to?: string;
};

export type CostFilterOption = {
  value: string;
  label: string;
};

export type CostReportSession = CostSessionRecord & {
  modelsUsed: string[];
};

export type CostReport = {
  summary: {
    totalSessions: number;
    totalCost: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  sessions: CostReportSession[];
  filters: {
    repos: CostFilterOption[];
    models: CostFilterOption[];
  };
};

type SessionRow = {
  session_key: string;
  session_id: string | null;
  session_file: string | null;
  repo_name: string;
  repo_relative_path: string;
  repo_absolute_path: string;
  model_id: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  total_cost: number;
  context_tokens: number | null;
  context_window: number | null;
  context_percent: number | null;
  using_subscription: number;
  auto_compact_enabled: number;
};

type ModelUsageRow = {
  model_id: string;
  usage_count: number;
  last_used_at: string;
};

export type ModelUsageSummary = {
  usageCount: number;
  lastUsedAt: string;
};

export class CostService {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_cost_sessions (
        session_key TEXT PRIMARY KEY,
        session_id TEXT,
        session_file TEXT,
        repo_name TEXT NOT NULL,
        repo_relative_path TEXT NOT NULL,
        repo_absolute_path TEXT NOT NULL,
        model_id TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        total_cost REAL NOT NULL,
        context_tokens INTEGER,
        context_window INTEGER,
        context_percent REAL,
        using_subscription INTEGER NOT NULL,
        auto_compact_enabled INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_cost_session_models (
        session_key TEXT NOT NULL,
        model_id TEXT NOT NULL,
        PRIMARY KEY (session_key, model_id),
        FOREIGN KEY (session_key) REFERENCES agent_cost_sessions(session_key) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_cost_sessions_repo ON agent_cost_sessions(repo_relative_path);
      CREATE INDEX IF NOT EXISTS idx_agent_cost_sessions_updated_at ON agent_cost_sessions(updated_at);
      CREATE INDEX IF NOT EXISTS idx_agent_cost_sessions_model ON agent_cost_sessions(model_id);
      CREATE INDEX IF NOT EXISTS idx_agent_cost_session_models_model ON agent_cost_session_models(model_id);
    `);
  }

  recordSession(record: CostSessionRecord) {
    this.database
      .prepare(
        `
      INSERT INTO agent_cost_sessions (
        session_key,
        session_id,
        session_file,
        repo_name,
        repo_relative_path,
        repo_absolute_path,
        model_id,
        started_at,
        updated_at,
        ended_at,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        total_tokens,
        total_cost,
        context_tokens,
        context_window,
        context_percent,
        using_subscription,
        auto_compact_enabled
      ) VALUES (
        :sessionKey,
        :sessionId,
        :sessionFile,
        :repoName,
        :repoRelativePath,
        :repoAbsolutePath,
        :modelId,
        :startedAt,
        :updatedAt,
        :endedAt,
        :inputTokens,
        :outputTokens,
        :cacheReadTokens,
        :cacheWriteTokens,
        :totalTokens,
        :totalCost,
        :contextTokens,
        :contextWindow,
        :contextPercent,
        :usingSubscription,
        :autoCompactEnabled
      )
      ON CONFLICT(session_key) DO UPDATE SET
        session_id = excluded.session_id,
        session_file = excluded.session_file,
        repo_name = excluded.repo_name,
        repo_relative_path = excluded.repo_relative_path,
        repo_absolute_path = excluded.repo_absolute_path,
        model_id = excluded.model_id,
        started_at = agent_cost_sessions.started_at,
        updated_at = excluded.updated_at,
        ended_at = excluded.ended_at,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        total_tokens = excluded.total_tokens,
        total_cost = excluded.total_cost,
        context_tokens = excluded.context_tokens,
        context_window = excluded.context_window,
        context_percent = excluded.context_percent,
        using_subscription = excluded.using_subscription,
        auto_compact_enabled = excluded.auto_compact_enabled
    `,
      )
      .run({
        ...record,
        endedAt: record.endedAt,
        usingSubscription: record.usingSubscription ? 1 : 0,
        autoCompactEnabled: record.autoCompactEnabled ? 1 : 0,
      });

    if (record.modelId) {
      this.database
        .prepare(
          `
          INSERT INTO agent_cost_session_models (session_key, model_id)
          VALUES (:sessionKey, :modelId)
          ON CONFLICT(session_key, model_id) DO NOTHING
        `,
        )
        .run({ sessionKey: record.sessionKey, modelId: record.modelId });
    }
  }

  finalizeSession(sessionKey: string, endedAt: string) {
    this.database
      .prepare(
        `
        UPDATE agent_cost_sessions
        SET ended_at = :endedAt
        WHERE session_key = :sessionKey
      `,
      )
      .run({ sessionKey, endedAt });
  }

  getReport(filters: CostReportFilters): CostReport {
    const whereParts: string[] = [];
    const parameters: Record<string, string> = {};

    if (filters.repo) {
      whereParts.push("sessions.repo_relative_path = :repo");
      parameters.repo = filters.repo;
    }

    if (filters.model) {
      whereParts.push("EXISTS (SELECT 1 FROM agent_cost_session_models models WHERE models.session_key = sessions.session_key AND models.model_id = :model)");
      parameters.model = filters.model;
    }

    if (filters.from) {
      whereParts.push("sessions.updated_at >= :from");
      parameters.from = filters.from;
    }

    if (filters.to) {
      whereParts.push("sessions.updated_at <= :to");
      parameters.to = filters.to;
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const rows = this.database
      .prepare(
        `
        SELECT
          sessions.session_key,
          sessions.session_id,
          sessions.session_file,
          sessions.repo_name,
          sessions.repo_relative_path,
          sessions.repo_absolute_path,
          sessions.model_id,
          sessions.started_at,
          sessions.updated_at,
          sessions.ended_at,
          sessions.input_tokens,
          sessions.output_tokens,
          sessions.cache_read_tokens,
          sessions.cache_write_tokens,
          sessions.total_tokens,
          sessions.total_cost,
          sessions.context_tokens,
          sessions.context_window,
          sessions.context_percent,
          sessions.using_subscription,
          sessions.auto_compact_enabled
        FROM agent_cost_sessions sessions
        ${whereClause}
        ORDER BY sessions.updated_at DESC, sessions.started_at DESC
      `,
      )
      .all(parameters) as SessionRow[];

    const sessions = rows.map(
      (row) =>
        ({
          sessionKey: row.session_key,
          sessionId: row.session_id,
          sessionFile: row.session_file,
          repoName: row.repo_name,
          repoRelativePath: row.repo_relative_path,
          repoAbsolutePath: row.repo_absolute_path,
          modelId: row.model_id,
          startedAt: row.started_at,
          updatedAt: row.updated_at,
          endedAt: row.ended_at,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens,
          cacheWriteTokens: row.cache_write_tokens,
          totalTokens: row.total_tokens,
          totalCost: row.total_cost,
          contextTokens: row.context_tokens,
          contextWindow: row.context_window,
          contextPercent: row.context_percent,
          usingSubscription: row.using_subscription === 1,
          autoCompactEnabled: row.auto_compact_enabled === 1,
          modelsUsed: this.getModelsForSession(row.session_key),
        }) satisfies CostReportSession,
    );

    return {
      summary: {
        totalSessions: sessions.length,
        totalCost: roundCost(sessions.reduce((sum, session) => sum + session.totalCost, 0)),
        totalTokens: sessions.reduce((sum, session) => sum + session.totalTokens, 0),
        inputTokens: sessions.reduce((sum, session) => sum + session.inputTokens, 0),
        outputTokens: sessions.reduce((sum, session) => sum + session.outputTokens, 0),
        cacheReadTokens: sessions.reduce((sum, session) => sum + session.cacheReadTokens, 0),
        cacheWriteTokens: sessions.reduce((sum, session) => sum + session.cacheWriteTokens, 0),
      },
      sessions,
      filters: {
        repos: this.getRepoFilters(),
        models: this.getModelFilters(),
      },
    };
  }

  private getModelsForSession(sessionKey: string) {
    const rows = this.database
      .prepare(
        `
        SELECT model_id
        FROM agent_cost_session_models
        WHERE session_key = ?
        ORDER BY model_id ASC
      `,
      )
      .all(sessionKey) as Array<{ model_id: string }>;

    return rows.map((row) => row.model_id);
  }

  private getRepoFilters() {
    const rows = this.database
      .prepare(
        `
        SELECT DISTINCT repo_relative_path, repo_name
        FROM agent_cost_sessions
        ORDER BY repo_relative_path ASC
      `,
      )
      .all() as Array<{ repo_relative_path: string; repo_name: string }>;

    return rows.map((row) => ({
      value: row.repo_relative_path,
      label: row.repo_name,
    }));
  }

  private getModelFilters() {
    const rows = this.database
      .prepare(
        `
        SELECT DISTINCT model_id
        FROM agent_cost_session_models
        ORDER BY model_id ASC
      `,
      )
      .all() as Array<{ model_id: string }>;

    return rows.map((row) => ({
      value: row.model_id,
      label: row.model_id,
    }));
  }

  getModelUsageSummary(repoRelativePath?: string) {
    const rows = this.database
      .prepare(
        `
        SELECT
          models.model_id,
          COUNT(*) AS usage_count,
          MAX(sessions.updated_at) AS last_used_at
        FROM agent_cost_session_models models
        INNER JOIN agent_cost_sessions sessions
          ON sessions.session_key = models.session_key
        WHERE (:repoRelativePath IS NULL OR sessions.repo_relative_path = :repoRelativePath)
        GROUP BY models.model_id
      `,
      )
      .all({ repoRelativePath: repoRelativePath ?? null }) as ModelUsageRow[];

    return rows.reduce<Record<string, ModelUsageSummary>>((summary, row) => {
      summary[row.model_id] = {
        usageCount: row.usage_count,
        lastUsedAt: row.last_used_at,
      };

      return summary;
    }, {});
  }
}

function roundCost(value: number) {
  return Number(value.toFixed(6));
}
