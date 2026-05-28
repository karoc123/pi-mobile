import path from "node:path";

import { z } from "zod";

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_PASSWORD: z.string().min(1, "APP_PASSWORD is required"),
  WORKSPACE_ROOT: z.string().default(process.cwd()),
  DEFAULT_REPO: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().default("pi_mobile_session"),
  PI_AGENT_DIR: z.string().optional(),
  PI_SESSION_DIR: z.string().optional(),
  PI_PROVIDER: z.string().optional(),
  PI_MODEL: z.string().optional(),
  PI_THINKING_LEVEL: z.enum(thinkingLevels).optional(),
  PI_MOCK_MODE: z.string().optional(),
});

export type AppConfig = {
  nodeEnv: "development" | "production" | "test";
  host: string;
  port: number;
  appPassword: string;
  workspaceRoot: string;
  defaultRepo?: string;
  sessionCookieName: string;
  piAgentDir?: string;
  piSessionDir?: string;
  piProvider?: string;
  piModel?: string;
  piThinkingLevel?: (typeof thinkingLevels)[number];
  piMockMode: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(env);

  if ((parsed.PI_PROVIDER && !parsed.PI_MODEL) || (!parsed.PI_PROVIDER && parsed.PI_MODEL)) {
    throw new Error("PI_PROVIDER and PI_MODEL must be configured together.");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    appPassword: parsed.APP_PASSWORD,
    workspaceRoot: path.resolve(parsed.WORKSPACE_ROOT),
    defaultRepo: parsed.DEFAULT_REPO,
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    piAgentDir: parsed.PI_AGENT_DIR ? path.resolve(parsed.PI_AGENT_DIR) : undefined,
    piSessionDir: parsed.PI_SESSION_DIR ? path.resolve(parsed.PI_SESSION_DIR) : undefined,
    piProvider: parsed.PI_PROVIDER,
    piModel: parsed.PI_MODEL,
    piThinkingLevel: parsed.PI_THINKING_LEVEL,
    piMockMode: asBoolean(parsed.PI_MOCK_MODE),
  };
}

function asBoolean(value: string | undefined) {
  return value === "1" || value === "true" || value === "yes";
}
