import path from 'node:path';

import type { BackendLogLevel } from '../shared/contracts.js';

const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const nodeEnvs = ['development', 'production', 'test'] as const;
const logLevels = ['debug', 'info', 'warn', 'error'] as const;

export type AppConfig = {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  appPassword: string;
  workspaceRoot: string;
  modelUsagePath: string;
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
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const read = (name: string) => {
    const value = env[name];
    return value === undefined || value.trim() === '' ? undefined : value;
  };

  const nodeEnv = readEnum('NODE_ENV', read('NODE_ENV'), nodeEnvs) ?? 'development';
  const workspaceRoot = read('WORKSPACE_ROOT') ?? process.cwd();
  const appPassword = read('APP_PASSWORD');
  const port = Number(read('PORT') ?? 3000);
  const piProvider = read('PI_PROVIDER');
  const piModel = read('PI_MODEL');
  const resolveOr = <T extends string | undefined>(name: string, fallback: T): string | T => {
    const value = read(name);
    return value ? path.resolve(value) : fallback;
  };

  if (!appPassword) {
    throw new Error('APP_PASSWORD is required');
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer.');
  }

  if (Boolean(piProvider) !== Boolean(piModel)) {
    throw new Error('PI_PROVIDER and PI_MODEL must be configured together.');
  }

  const sessionCookieSecure = read('SESSION_COOKIE_SECURE');

  return {
    workspaceRoot: path.resolve(workspaceRoot),
    nodeEnv,
    host: read('HOST') ?? '0.0.0.0',
    port,
    appPassword,
    modelUsagePath: resolveOr(
      'MODEL_USAGE_PATH',
      path.resolve(workspaceRoot, '.pi-mobile', 'model-usage.json'),
    ),
    logsDirPath: resolveOr('LOGS_DIR', path.resolve(workspaceRoot, '.pi-mobile', 'logs')),
    logLevel: readEnum('LOG_LEVEL', read('LOG_LEVEL'), logLevels) ?? 'info',
    defaultRepo: read('DEFAULT_REPO'),
    sessionCookieName: read('SESSION_COOKIE_NAME') ?? 'pi_mobile_session',
    sessionCookieSecure: sessionCookieSecure
      ? asBoolean(sessionCookieSecure)
      : nodeEnv === 'production',
    piAgentDir: resolveOr('PI_AGENT_DIR', undefined),
    piSessionDir: resolveOr('PI_SESSION_DIR', undefined),
    piProvider,
    piModel,
    piThinkingLevel: readEnum('PI_THINKING_LEVEL', read('PI_THINKING_LEVEL'), thinkingLevels),
  };
}

function readEnum<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
  }

  return value as T;
}

function asBoolean(value: string | undefined) {
  return value === '1' || value === 'true' || value === 'yes';
}
