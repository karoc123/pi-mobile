import { describe, expect, it } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { setupTestProvider } from './test-provider.js';

describe('setupTestProvider', () => {
  it('does nothing when PI_TEST_PROVIDER is not 1', async () => {
    const original = process.env.PI_TEST_PROVIDER;
    delete process.env.PI_TEST_PROVIDER;
    try {
      const runtime = await ModelRuntime.create();
      await setupTestProvider(runtime);
      expect(runtime.getModel('faux', 'faux-1')).toBeUndefined();
    } finally {
      process.env.PI_TEST_PROVIDER = original;
    }
  });

  it('registers faux provider and sets API key when PI_TEST_PROVIDER is 1', async () => {
    const original = process.env.PI_TEST_PROVIDER;
    process.env.PI_TEST_PROVIDER = '1';
    try {
      const runtime = await ModelRuntime.create();
      await setupTestProvider(runtime);
      const model = runtime.getModel('faux', 'faux-1');
      expect(model).toBeDefined();
      expect(model?.id).toBe('faux-1');
      expect(model?.provider).toBe('faux');
      const auth = runtime.getProviderAuthStatus('faux');
      expect(auth.configured).toBe(true);
    } finally {
      process.env.PI_TEST_PROVIDER = original;
    }
  });
});
