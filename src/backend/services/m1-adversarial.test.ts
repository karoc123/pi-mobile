// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { WebsocketEnvelope } from '../../shared/contracts.js';
import { noopLogger } from './log-service.js';
import { ModelUsageStore } from './model-usage-store.js';
import { PiAgentService } from './pi-agent-service.js';
import { PiAgentSessionAdapter } from './pi-agent-session-adapter.js';

describe('Agent lifecycle regressions', () => {
  let root: string;
  let service: PiAgentService;
  const events: WebsocketEnvelope[] = [];
  const repo = (name: string) => ({
    name,
    relativePath: name,
    absolutePath: path.join(root, name),
  });
  const internals = () =>
    service as unknown as {
      sessionAdapter: PiAgentSessionAdapter;
      handleSessionEvent: (event: AgentSessionEvent) => void;
    };
  const settle = () => vi.waitFor(() => expect(service.getSnapshot().isStreaming).toBe(false));
  beforeEach(async () => {
    vi.stubEnv('PI_TEST_PROVIDER', '1');
    root = await mkdtemp(path.join(os.tmpdir(), 'pi-agent-regression-'));
    await Promise.all(['a', 'b'].map((name) => mkdir(path.join(root, name))));
    events.length = 0;
    service = new PiAgentService(
      {
        nodeEnv: 'test',
        host: '127.0.0.1',
        port: 3000,
        appPassword: 'password',
        workspaceRoot: root,
        modelUsagePath: path.join(root, 'usage.json'),
        logsDirPath: path.join(root, 'logs'),
        logLevel: 'error',
        sessionCookieName: 'session',
        sessionCookieSecure: false,
        piAgentDir: path.join(root, 'agent'),
        piSessionDir: path.join(root, 'sessions'),
        piProvider: 'nonexistent',
        piModel: 'from-user-env',
      },
      (event) => events.push(event),
      new ModelUsageStore(path.join(root, 'usage.json')),
      noopLogger,
    );
    await service.selectRepo(repo('a'));
  });
  afterEach(async () => {
    await service?.dispose();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  it('forces the test model even with configured defaults and settles after abort and a subsequent prompt', async () => {
    expect(service.getSnapshot().usage.modelId).toBe('faux-1');
    await service.prompt('trigger:tool_read');
    await service.abort();
    await settle();
    await service.prompt('single word done');
    await settle();
    expect(events.filter((e) => e.type === 'agent_status').at(-1)).toMatchObject({
      payload: { isStreaming: false, runtimePhase: 'idle' },
    });
    expect(service.getSnapshot().messages.at(-1)?.text).toBe('DONE');
  });
  it('does not hydrate away an active assistant while bash executes, then includes deferred bash at settle', async () => {
    const session = internals().sessionAdapter.getSession()!;
    vi.spyOn(session, 'isStreaming', 'get').mockReturnValue(true);
    internals().handleSessionEvent({
      type: 'message_start',
      message: { role: 'assistant' },
    } as AgentSessionEvent);
    const messageId = service.getSnapshot().messages.at(-1)!.id;
    const snapshotsBefore = events.filter((e) => e.type === 'snapshot').length;
    vi.spyOn(session, 'executeBash').mockImplementation(async () => {
      session.recordBashResult('echo deferred', {
        output: 'deferred\n',
        exitCode: 0,
        cancelled: false,
        truncated: false,
      });
      return { output: 'deferred\n', exitCode: 0, cancelled: false, truncated: false };
    });
    await service.executeCommand({
      command: 'run-bash',
      commandText: 'echo deferred',
      excludeFromContext: false,
    });
    expect(service.getSnapshot().messages.at(-1)?.id).toBe(messageId);
    expect(events.filter((e) => e.type === 'snapshot')).toHaveLength(snapshotsBefore);
    vi.restoreAllMocks();
    await service.prompt('single word settled');
    await settle();
    expect(service.getSnapshot().messages.some((m) => m.text.includes('echo deferred'))).toBe(true);
  });
  it('clears an ask_user question when starting or resuming a session', async () => {
    await service.prompt('trigger:ask_user');
    await settle();
    expect(service.getSnapshot().interactivePrompt).not.toBeNull();
    const sessionPath = internals().sessionAdapter.getSession()!.sessionFile!;
    internals().handleSessionEvent({
      type: 'auto_retry_end',
      success: false,
      attempt: 1,
      finalError: 'Old session error',
    });
    await service.executeCommand({ command: 'new-session' });
    expect(service.getSnapshot().interactivePrompt).toBeNull();
    expect(service.getSnapshot().lastError).toBeNull();
    await service.executeCommand({ command: 'resume-session', sessionPath });
    expect(service.getSnapshot().interactivePrompt).toBeNull();
  });
  it('serializes concurrent repository selection and session creation', async () => {
    await Promise.all([service.selectRepo(repo('b')), service.selectRepo(repo('a'))]);
    expect(service.getSnapshot().repo).toEqual(repo('a'));
    const adapter = internals().sessionAdapter;
    await adapter.reset();
    const [first, second] = await Promise.all([
      adapter.ensureSession(repo('a')),
      adapter.ensureSession(repo('a')),
    ]);
    expect(first).toBe(second);
    expect(adapter.getSession()?.sessionManager.getCwd()).toBe(repo('a').absolutePath);
  });
  it('pushes compaction snapshots and surfaces provider and retry errors', () => {
    internals().handleSessionEvent({
      type: 'compaction_end',
      result: {},
      aborted: false,
      reason: 'threshold',
      willRetry: false,
    } as AgentSessionEvent);
    expect(events.at(-2)?.type).toBe('snapshot');
    internals().handleSessionEvent({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'Provider unavailable' },
    } as AgentSessionEvent);
    expect(service.getSnapshot().lastError).toBe('Provider unavailable');
    internals().handleSessionEvent({
      type: 'auto_retry_end',
      success: false,
      attempt: 2,
      finalError: 'Retries exhausted',
    });
    expect(
      events.some((e) => e.type === 'agent_error' && e.payload.message === 'Retries exhausted'),
    ).toBe(true);
  });
});
