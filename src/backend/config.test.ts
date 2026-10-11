// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('treats blank optional environment values as unset', () => {
    const config = loadConfig({
      APP_PASSWORD: 'secret-pass',
      WORKSPACE_ROOT: '/workspace',
      DEFAULT_REPO: '',
      PI_PROVIDER: '',
      PI_MODEL: '',
      PI_THINKING_LEVEL: '',
    });

    expect(config.defaultRepo).toBeUndefined();
    expect(config.piProvider).toBeUndefined();
    expect(config.piModel).toBeUndefined();
    expect(config.piThinkingLevel).toBeUndefined();
    expect(config.sessionCookieSecure).toBe(false);
  });

  it('rejects missing passwords and invalid values', () => {
    const base = { APP_PASSWORD: 'secret-pass', WORKSPACE_ROOT: '/workspace' };

    expect(() => loadConfig({ WORKSPACE_ROOT: '/workspace' })).toThrow('APP_PASSWORD is required');
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, PORT: '0' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, NODE_ENV: 'staging' })).toThrow('NODE_ENV');
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'verbose' })).toThrow('LOG_LEVEL');
    expect(() => loadConfig({ ...base, PI_THINKING_LEVEL: 'max' })).toThrow('PI_THINKING_LEVEL');
    expect(() => loadConfig({ ...base, PI_PROVIDER: 'anthropic' })).toThrow(
      'PI_PROVIDER and PI_MODEL',
    );
    expect(loadConfig({ ...base, PORT: '3200' }).port).toBe(3200);
  });

  it('defaults secure cookies only in production and allows overriding them', () => {
    const productionConfig = loadConfig({
      APP_PASSWORD: 'secret-pass',
      WORKSPACE_ROOT: '/workspace',
      NODE_ENV: 'production',
    });
    const overriddenConfig = loadConfig({
      APP_PASSWORD: 'secret-pass',
      WORKSPACE_ROOT: '/workspace',
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'false',
    });

    expect(productionConfig.sessionCookieSecure).toBe(true);
    expect(overriddenConfig.sessionCookieSecure).toBe(false);
  });

  it('resolves persistence paths from env or workspace defaults', () => {
    const defaultConfig = loadConfig({
      APP_PASSWORD: 'secret-pass',
      WORKSPACE_ROOT: '/workspace',
    });

    expect(defaultConfig.modelUsagePath).toBe('/workspace/.pi-mobile/model-usage.json');
    expect(defaultConfig.logsDirPath).toBe('/workspace/.pi-mobile/logs');
    expect(defaultConfig.piAgentDir).toBeUndefined();
    expect(defaultConfig.piSessionDir).toBeUndefined();

    const explicitConfig = loadConfig({
      APP_PASSWORD: 'secret-pass',
      WORKSPACE_ROOT: '/workspace',
      MODEL_USAGE_PATH: '/data/db/model-usage.json',
      LOGS_DIR: '/data/db/logs',
      PI_AGENT_DIR: '/data/pi/agent',
      PI_SESSION_DIR: '/data/pi/sessions',
    });

    expect(explicitConfig.modelUsagePath).toBe('/data/db/model-usage.json');
    expect(explicitConfig.logsDirPath).toBe('/data/db/logs');
    expect(explicitConfig.piAgentDir).toBe('/data/pi/agent');
    expect(explicitConfig.piSessionDir).toBe('/data/pi/sessions');
  });
});
