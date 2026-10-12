// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { AuthService } from './services/auth-service.js';
import { FileService, MAX_FILE_BYTES } from './services/file-service.js';
import { LogService } from './services/log-service.js';
import { WorkspaceService } from './services/workspace-service.js';
import { PiAuthServiceError } from './services/pi-auth-service.js';
import { runCommand } from './utils/process.js';

describe('Authenticated file transport', () => {
  let root: string;
  let app: ReturnType<typeof createApp>;
  let logs: LogService;
  let cookie: string[];
  let files: FileService;
  const loginToken = vi.fn();
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), '.pi-raw-'));
    await runCommand('git', ['init', root]);
    const config = {
      nodeEnv: 'test' as const,
      host: '127.0.0.1',
      port: 3000,
      appPassword: 'password',
      workspaceRoot: root,
      modelUsagePath: path.join(root, 'usage.json'),
      logsDirPath: path.join(root, 'logs'),
      logLevel: 'error' as const,
      sessionCookieName: 'session',
      sessionCookieSecure: false,
    };
    logs = new LogService({ logDirPath: config.logsDirPath, minLevel: 'error' });
    const workspaceService = new WorkspaceService(root);
    await workspaceService.initializeDefaultRepo();
    files = new FileService();
    app = createApp({
      config,
      authService: new AuthService('password'),
      logService: logs,
      workspaceService,
      fileService: files,
      piAuthService: { loginToken },
      serverStartedAt: new Date(),
    } as never);
    const response = await request(app).post('/api/auth/login').send({ password: 'password' });
    cookie = [response.get('Set-Cookie')!].flat();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await logs.flush();
    await rm(root, { recursive: true, force: true });
  });
  it('protects raw reads and writes and serves dotfiles even inside a hidden workspace', async () => {
    await mkdir(path.join(root, '.github'));
    await writeFile(path.join(root, '.env'), 'test=value');
    await writeFile(path.join(root, '.github', 'x.png'), Buffer.from([1, 2, 3]));
    expect((await request(app).get('/api/files/raw?path=.env')).status).toBe(401);
    expect((await request(app).put('/api/files/raw?path=x').send('x')).status).toBe(401);
    const env = await request(app).get('/api/files/raw?path=.env&download=1').set('Cookie', cookie);
    expect(env.status).toBe(200);
    const image = await request(app).get('/api/files/raw?path=.github/x.png').set('Cookie', cookie);
    expect(image.status).toBe(200);
    expect(image.headers['content-disposition']).toBeUndefined();
  });
  it.each(['evil.html', 'evil.svg'])(
    'sandboxes active content and forces download for %s',
    async (name) => {
      await writeFile(path.join(root, name), '<script>alert(1)</script>');
      const response = await request(app).get(`/api/files/raw?path=${name}`).set('Cookie', cookie);
      expect(response.status).toBe(200);
      expect(response.headers['content-security-policy']).toBe('sandbox');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-disposition']).toContain('attachment');
    },
  );
  it('returns a structured 413 for Content-Length over the upload limit', async () => {
    const response = await request(app)
      .put('/api/files/raw?path=large')
      .set('Cookie', cookie)
      .set('Content-Length', String(MAX_FILE_BYTES + 1))
      .send('x');
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('payload_too_large');
    expect(response.headers.connection).toBe('close');
    expect((await readdir(root)).some((name) => name.startsWith('.tmp.'))).toBe(false);
  });
  it('returns a structured 413 for a chunked upload without destroying its response', async () => {
    const original = files.writeStream.bind(files);
    vi.spyOn(files, 'writeStream').mockImplementation((repo, name, source) =>
      original(repo, name, source, 3),
    );
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as { port: number };
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/api/files/raw?path=chunked',
            method: 'PUT',
            headers: { cookie: cookie.join(';'), 'transfer-encoding': 'chunked' },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode!, body }));
          },
        );
        req.on('error', reject);
        req.end('too large');
      });
      expect(response.status).toBe(413);
      expect(JSON.parse(response.body).error.code).toBe('payload_too_large');
      expect((await readdir(root)).some((name) => name.startsWith('.tmp.'))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('keeps provider token validation separate from application authentication', async () => {
    loginToken.mockRejectedValue(
      new PiAuthServiceError('invalid_token', 'Invalid provider token.'),
    );
    const response = await request(app)
      .post('/api/pi/auth/login-token')
      .set('Cookie', cookie)
      .send({ provider: 'test', token: 'bad' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Invalid provider token.');
    expect(
      (await request(app).get('/api/auth/session').set('Cookie', cookie)).body.authenticated,
    ).toBe(true);
  });
});
