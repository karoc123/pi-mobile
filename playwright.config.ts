import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const workspaceRoot = path.join(process.cwd(), '.playwright', 'workspace');

export default defineConfig({
  testDir: './playwright/tests',
  timeout: 60_000,
  fullyParallel: false,
  globalSetup: './playwright/global-setup.ts',
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:3200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node dist/backend/index.js',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:3200/api/health',
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'false',
      SESSION_COOKIE_NAME: 'pi_mobile_session',
      PI_THINKING_LEVEL: 'off',
      DEFAULT_REPO: '',
      MODEL_USAGE_PATH: path.join(workspaceRoot, '.pi-mobile', 'model-usage.json'),
      LOG_LEVEL: 'info',
      HOST: '127.0.0.1',
      PORT: '3200',
      APP_PASSWORD: 'test-password',
      WORKSPACE_ROOT: workspaceRoot,
      LOGS_DIR: path.join(workspaceRoot, '.pi-mobile', 'logs'),
      PI_AGENT_DIR: path.join(workspaceRoot, '.pi-mobile', 'agent'),
      PI_SESSION_DIR: path.join(workspaceRoot, '.pi-mobile', 'sessions'),
      PI_TEST_PROVIDER: '1',
      PI_PROVIDER: 'faux',
      PI_MODEL: 'faux-1',
    },
  },
});
