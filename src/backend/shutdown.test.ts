// @vitest-environment node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

it('terminates active WebSocket and SSE clients and flushes logs on SIGTERM', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-shutdown-'));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  await mkdir(path.join(root, 'agent'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/backend/index.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_PASSWORD: 'shutdown-test',
      HOST: '127.0.0.1',
      PORT: String(port),
      WORKSPACE_ROOT: root,
      DEFAULT_REPO: '',
      MODEL_USAGE_PATH: path.join(root, 'usage.json'),
      LOGS_DIR: path.join(root, 'logs'),
      PI_AGENT_DIR: path.join(root, 'agent'),
      PI_SESSION_DIR: path.join(root, 'sessions'),
      PI_TEST_PROVIDER: '1',
      PI_PROVIDER: '',
      PI_MODEL: '',
      SESSION_COOKIE_SECURE: 'false',
      SESSION_COOKIE_NAME: 'session',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => {
    diagnostics += chunk;
  });
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk;
  });
  const exited = once(child, 'exit');
  let socket: WebSocket | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const base = `http://127.0.0.1:${port}`;
    await vi.waitFor(async () => expect((await fetch(`${base}/api/health`)).ok).toBe(true), {
      timeout: 5000,
      interval: 50,
    });
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'shutdown-test' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
    await once(socket, 'open');
    const closed = once(socket, 'close');
    const response = await fetch(`${base}/api/logs/stream`, { headers: { cookie } });
    reader = response.body!.getReader();
    await reader.read();
    child.kill('SIGTERM');
    const result = await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Shutdown hung: ${diagnostics}`)), 3000);
        timer.unref();
      }),
    ]);
    expect(result[0]).toBe(0);
    await closed;
    let finalChunk = await reader.read();
    while (!finalChunk.done) finalChunk = await reader.read();
    const log = await readFile(path.join(root, 'logs', 'backend.log'), 'utf8');
    expect(log).toContain('server_shutdown_complete');
  } finally {
    socket?.terminate();
    await reader?.cancel();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);
