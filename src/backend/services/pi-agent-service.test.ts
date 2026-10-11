// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { LogService } from './log-service.js';
import { ModelUsageStore } from './model-usage-store.js';
import { PiAgentService, parseInteractivePromptArgs } from './pi-agent-service.js';

describe('PiAgentService', () => {
  let tempDir = '';

  afterEach(async () => {
    delete process.env.PI_TEST_PROVIDER;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('wires prompt and command-state using test provider and snapshot push', async () => {
    process.env.PI_TEST_PROVIDER = '1';
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mobile-agent-wiring-'));
    await mkdir(path.join(tempDir, 'repo-b'), { recursive: true });

    const logService = new LogService({
      logDirPath: path.join(tempDir, '.pi-mobile', 'logs'),
      minLevel: 'debug',
    });

    const events: string[] = [];
    const service = new PiAgentService(
      {
        nodeEnv: 'test',
        host: '127.0.0.1',
        port: 3000,
        appPassword: 'secret-pass',
        workspaceRoot: tempDir,
        modelUsagePath: path.join(tempDir, '.pi-mobile', 'model-usage.json'),
        logsDirPath: path.join(tempDir, '.pi-mobile', 'logs'),
        logLevel: 'debug',
        sessionCookieName: 'pi_mobile_session',
        sessionCookieSecure: false,
      },
      (event) => {
        events.push(event.type);
      },
      new ModelUsageStore(path.join(tempDir, '.pi-mobile', 'model-usage.json')),
      logService.child({ source: 'agent' }),
    );

    await service.selectRepo({
      name: 'repo-b',
      relativePath: 'repo-b',
      absolutePath: path.join(tempDir, 'repo-b'),
    });

    await service.prompt('single word done');

    const stateAfterPrompt = await service.getCommandState();
    const snapshotAfterPrompt = service.getSnapshot();

    expect(stateAfterPrompt.session?.totalMessages).toBe(3);
    expect(snapshotAfterPrompt.messages.at(-1)?.text).toBe('DONE');
    expect(snapshotAfterPrompt.messages.at(-1)?.status).toBe('complete');
    expect(events.filter((type) => type === 'chat_message_added').length).toBe(2);
    expect(events.includes('chat_message_updated')).toBe(true);
    expect(events.includes('snapshot')).toBe(true);

    await service.executeCommand({ command: 'new-session' });

    const stateAfterReset = await service.getCommandState();
    expect(stateAfterReset.session?.totalMessages).toBe(0);
  });
});

describe('parseInteractivePromptArgs', () => {
  it('returns null for non-object input', () => {
    expect(parseInteractivePromptArgs(null)).toBeNull();
    expect(parseInteractivePromptArgs(undefined)).toBeNull();
    expect(parseInteractivePromptArgs('string')).toBeNull();
    expect(parseInteractivePromptArgs(42)).toBeNull();
    expect(parseInteractivePromptArgs([])).toBeNull();
  });

  it('returns null when title is missing or empty', () => {
    expect(
      parseInteractivePromptArgs({ questions: [{ id: 'q', label: 'L', options: ['A'] }] }),
    ).toBeNull();
    expect(
      parseInteractivePromptArgs({
        title: '',
        questions: [{ id: 'q', label: 'L', options: ['A'] }],
      }),
    ).toBeNull();
    expect(
      parseInteractivePromptArgs({
        title: '   ',
        questions: [{ id: 'q', label: 'L', options: ['A'] }],
      }),
    ).toBeNull();
  });

  it('returns null when questions is missing, empty, or not an array', () => {
    expect(parseInteractivePromptArgs({ title: 'T' })).toBeNull();
    expect(parseInteractivePromptArgs({ title: 'T', questions: [] })).toBeNull();
    expect(parseInteractivePromptArgs({ title: 'T', questions: 'not-array' })).toBeNull();
  });

  it('returns null when a question is missing required fields', () => {
    expect(parseInteractivePromptArgs({ title: 'T', questions: [{}] })).toBeNull();
    expect(
      parseInteractivePromptArgs({
        title: 'T',
        questions: [{ id: '', label: 'L', options: ['A'] }],
      }),
    ).toBeNull();
    expect(
      parseInteractivePromptArgs({
        title: 'T',
        questions: [{ id: 'q', label: '', options: ['A'] }],
      }),
    ).toBeNull();
    expect(
      parseInteractivePromptArgs({ title: 'T', questions: [{ id: 'q', label: 'L' }] }),
    ).toBeNull();
    expect(
      parseInteractivePromptArgs({ title: 'T', questions: [{ id: 'q', label: 'L', options: [] }] }),
    ).toBeNull();
    expect(
      parseInteractivePromptArgs({
        title: 'T',
        questions: [{ id: 'q', label: 'L', options: ['A', 1] }],
      }),
    ).toBeNull();
  });

  it('parses a minimal valid prompt', () => {
    const result = parseInteractivePromptArgs({
      title: 'Setup',
      questions: [{ id: 'q1', label: 'Framework?', options: ['React', 'Svelte'] }],
    });

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Setup');
    expect(result!.questions).toHaveLength(1);
    expect(result!.questions[0].id).toBe('q1');
    expect(result!.questions[0].label).toBe('Framework?');
    expect(result!.questions[0].options).toEqual(['React', 'Svelte']);
    expect(result!.questions[0].allowFreeText).toBe(false);
    expect(result!.questions[0].multiple).toBe(false);
    expect(result!.questions[0].placeholder).toBeUndefined();
    expect(result!.promptId).toBeTruthy();
  });

  it('parses allowFreeText, multiple, and placeholder options', () => {
    const result = parseInteractivePromptArgs({
      title: 'Setup',
      questions: [
        {
          id: 'q1',
          label: 'Framework?',
          options: ['React'],
          allowFreeText: true,
          multiple: true,
          placeholder: 'Custom...',
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.questions[0].allowFreeText).toBe(true);
    expect(result!.questions[0].multiple).toBe(true);
    expect(result!.questions[0].placeholder).toBe('Custom...');
  });

  it('trims whitespace from strings', () => {
    const result = parseInteractivePromptArgs({
      title: '  Setup  ',
      questions: [{ id: '  q1  ', label: '  Q?  ', options: ['  A  '] }],
    });

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Setup');
    expect(result!.questions[0].id).toBe('q1');
    expect(result!.questions[0].label).toBe('Q?');
    expect(result!.questions[0].options[0]).toBe('  A  ');
  });

  it('filters out empty placeholder strings', () => {
    const result = parseInteractivePromptArgs({
      title: 'T',
      questions: [{ id: 'q', label: 'L', options: ['A'], placeholder: '' }],
    });

    expect(result).not.toBeNull();
    expect(result!.questions[0].placeholder).toBeUndefined();
  });

  it('parses multiple questions', () => {
    const result = parseInteractivePromptArgs({
      title: 'Setup',
      questions: [
        { id: 'q1', label: 'Q1', options: ['A'] },
        { id: 'q2', label: 'Q2', options: ['B'], multiple: true },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0].multiple).toBe(false);
    expect(result!.questions[1].multiple).toBe(true);
  });
});
