import path from "node:path";

import { z } from "zod";

import type { BackendLogLevel } from "../shared/contracts.js";

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const optionalEnvString = z.preprocess(emptyStringToUndefined, z.string().optional());
const optionalThinkingLevel = z.preprocess(emptyStringToUndefined, z.enum(thinkingLevels).optional());

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_PASSWORD: z.string().min(1, "APP_PASSWORD is required"),
  WORKSPACE_ROOT: z.string().default(process.cwd()),
  COSTS_DB_PATH: optionalEnvString,
  LOGS_DIR: optionalEnvString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DEFAULT_REPO: optionalEnvString,
  SESSION_COOKIE_NAME: z.string().default("pi_mobile_session"),
  SESSION_COOKIE_SECURE: optionalEnvString,
  PI_AGENT_DIR: optionalEnvString,
  PI_SESSION_DIR: optionalEnvString,
  PI_PROVIDER: optionalEnvString,
  PI_MODEL: optionalEnvString,
  PI_THINKING_LEVEL: optionalThinkingLevel,
  PI_MOCK_MODE: optionalEnvString,
  GIT_USER_NAME: optionalEnvString,
  GIT_USER_EMAIL: optionalEnvString,
  SSH_PRIVATE_KEY_TARGET: optionalEnvString,
  SSH_KNOWN_HOSTS_PATH: optionalEnvString,
});

export type AppConfig = {
  nodeEnv: "development" | "production" | "test";
  host: string;
  port: number;
  appPassword: string;
  workspaceRoot: string;
  costsDbPath: string;
  logsDirPath: string;
  logLevel: BackendLogLevel;
  defaultRepo?: string;
  sessionCookieName: string;
  sessionCookieSecure: boolean;
  piAgentDir?: string;
  piSessionDir?: string;
  piProvider?: string;
  piModel?: string;
  piThinkingLevel?: (typeof thinkingLevels)[number];
  piMockMode: boolean;
  gitUserName?: string;
  gitUserEmail?: string;
  sshPrivateKeyTarget?: string;
  sshKnownHostsPath?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  hydrateProcessEnvFromDotEnvIfNeeded(env);
  const parsed = configSchema.parse(env);

  if ((parsed.PI_PROVIDER && !parsed.PI_MODEL) || (!parsed.PI_PROVIDER && parsed.PI_MODEL)) {
    throw new Error("PI_PROVIDER and PI_MODEL must be configured together.");
  }

  if ((parsed.GIT_USER_NAME && !parsed.GIT_USER_EMAIL) || (!parsed.GIT_USER_NAME && parsed.GIT_USER_EMAIL)) {
    throw new Error("GIT_USER_NAME and GIT_USER_EMAIL must be configured together.");
  }

  return {
    workspaceRoot: path.resolve(parsed.WORKSPACE_ROOT),
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    appPassword: parsed.APP_PASSWORD,
    costsDbPath: parsed.COSTS_DB_PATH ? path.resolve(parsed.COSTS_DB_PATH) : resolveDefaultCostsDbPath(parsed.WORKSPACE_ROOT, parsed.NODE_ENV),
    logsDirPath: parsed.LOGS_DIR ? path.resolve(parsed.LOGS_DIR) : resolveDefaultLogsDirPath(parsed.WORKSPACE_ROOT, parsed.NODE_ENV),
    logLevel: parsed.LOG_LEVEL,
    defaultRepo: parsed.DEFAULT_REPO,
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    sessionCookieSecure: parsed.SESSION_COOKIE_SECURE ? asBoolean(parsed.SESSION_COOKIE_SECURE) : parsed.NODE_ENV === "production",
    piAgentDir: parsed.PI_AGENT_DIR ? path.resolve(parsed.PI_AGENT_DIR) : resolveDefaultPiAgentDir(parsed.NODE_ENV),
    piSessionDir: parsed.PI_SESSION_DIR ? path.resolve(parsed.PI_SESSION_DIR) : resolveDefaultPiSessionDir(parsed.NODE_ENV),
    piProvider: parsed.PI_PROVIDER,
    piModel: parsed.PI_MODEL,
    piThinkingLevel: parsed.PI_THINKING_LEVEL,
    piMockMode: asBoolean(parsed.PI_MOCK_MODE),
    gitUserName: parsed.GIT_USER_NAME,
    gitUserEmail: parsed.GIT_USER_EMAIL,
    sshPrivateKeyTarget: parsed.SSH_PRIVATE_KEY_TARGET ? path.resolve(parsed.SSH_PRIVATE_KEY_TARGET) : resolveDefaultSshPrivateKeyTarget(parsed.NODE_ENV),
    sshKnownHostsPath: parsed.SSH_KNOWN_HOSTS_PATH ? path.resolve(parsed.SSH_KNOWN_HOSTS_PATH) : resolveDefaultSshKnownHostsPath(parsed.NODE_ENV),
  };
}

function hydrateProcessEnvFromDotEnvIfNeeded(env: NodeJS.ProcessEnv) {
  if (env !== process.env) {
    return;
  }

  if (typeof process.loadEnvFile !== "function") {
    return;
  }

  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function asBoolean(value: string | undefined) {
  return value === "1" || value === "true" || value === "yes";
}

function emptyStringToUndefined(value: unknown) {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}

function resolveDefaultCostsDbPath(workspaceRoot: string, nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production") {
    return path.resolve("/data/db/costs.sqlite");
  }

  return path.resolve(workspaceRoot, ".pi-mobile", "costs.sqlite");
}

function resolveDefaultLogsDirPath(workspaceRoot: string, nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production") {
    return path.resolve("/data/db/logs");
  }

  return path.resolve(workspaceRoot, ".pi-mobile", "logs");
}

function resolveDefaultPiAgentDir(nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production") {
    return path.resolve("/data/pi/agent");
  }

  return undefined;
}

function resolveDefaultPiSessionDir(nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production") {
    return path.resolve("/data/pi/sessions");
  }

  return undefined;
}

function resolveDefaultSshPrivateKeyTarget(nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production") {
    return path.resolve("/home/node/.ssh/id_ed25519");
  }

  return undefined;
}

function resolveDefaultSshKnownHostsPath(nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production") {
    return path.resolve("/data/db/known_hosts");
  }

  return undefined;
}
