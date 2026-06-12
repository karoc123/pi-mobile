import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const workspaceRoot = path.join(process.cwd(), ".playwright", "workspace");

export default defineConfig({
  testDir: "./playwright/tests",
  timeout: 60_000,
  fullyParallel: false,
  globalSetup: "./playwright/global-setup.ts",
  use: {
    ...devices["iPhone 13"],
    browserName: "chromium",
    baseURL: "http://127.0.0.1:3200",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm start",
    cwd: process.cwd(),
    url: "http://127.0.0.1:3200/api/health",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "3200",
      APP_PASSWORD: "test-password",
      WORKSPACE_ROOT: workspaceRoot,
      COSTS_DB_PATH: path.join(workspaceRoot, ".pi-mobile", "costs.sqlite"),
      LOGS_DIR: path.join(workspaceRoot, ".pi-mobile", "logs"),
      PI_AGENT_DIR: path.join(workspaceRoot, ".pi-mobile", "agent"),
      PI_SESSION_DIR: path.join(workspaceRoot, ".pi-mobile", "sessions"),
      SSH_PRIVATE_KEY_TARGET: path.join(workspaceRoot, ".pi-mobile", "ssh", "id_ed25519"),
      SSH_KNOWN_HOSTS_PATH: path.join(workspaceRoot, ".pi-mobile", "ssh", "known_hosts"),
      PI_MOCK_MODE: "1",
    },
  },
});
