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
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run build && npm start',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:3200/api/health',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '3200',
      APP_PASSWORD: 'test-password',
      WORKSPACE_ROOT: workspaceRoot,
      PI_MOCK_MODE: '1'
    }
  }
});