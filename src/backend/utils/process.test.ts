// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runCommand } from './process.js';

describe('runCommand', () => {
  it('handles a child closing stdin before a large input is consumed', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'process.exit(1)'], {
        input: 'x'.repeat(4 * 1024 * 1024),
      }),
    ).rejects.toThrow('code 1');
  });
  it('decodes split UTF-8 output after collecting the byte stream', async () => {
    const result = await runCommand(process.execPath, [
      '-e',
      'process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.end(Buffer.from([0x82,0xac])), 30)',
    ]);
    expect(result.stdout).toBe('€');
  });
  it('terminates a command exceeding its timeout', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 40 }),
    ).rejects.toThrow('timed out');
  });
});
