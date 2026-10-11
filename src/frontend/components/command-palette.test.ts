import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentCommandState } from '../../shared/contracts.js';
import * as apiModule from '../lib/api.js';
import CommandPalette from './CommandPalette.svelte';

const mockState: AgentCommandState = {
  models: [
    {
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      isCurrent: true,
      available: true,
      usingSubscription: false,
    },
    {
      provider: 'openai',
      modelId: 'gpt-4o',
      name: 'GPT-4o',
      isCurrent: false,
      available: true,
      usingSubscription: true,
      usageCount: 5,
    },
  ],
  thinkingLevels: [
    { value: 'off', isCurrent: true },
    { value: 'low', isCurrent: false },
    { value: 'high', isCurrent: false },
  ],
  autoCompactEnabled: true,
  steeringMode: 'all',
  followUpMode: 'one-at-a-time',
  autoRetryEnabled: true,
  isRetrying: false,
  isCompacting: false,
  isBashRunning: false,
  pendingMessageCount: 0,
  availableCommands: [
    {
      name: 'review',
      description: 'Review staged changes',
      source: 'extension',
    },
  ],
  resumeSessions: [
    {
      id: 'session-1',
      path: '/data/sessions/session-1.jsonl',
      preview: 'Initial planning session',
      name: 'Initial planning session',
      messageCount: 10,
      modifiedAt: new Date().toISOString(),
      isCurrent: true,
    },
  ],
  treeEntries: [
    {
      entryId: 'tree-1',
      preview: 'User: hello',
      role: 'user',
      depth: 0,
      isCurrent: true,
    },
  ],
  forkEntries: [
    {
      entryId: 'fork-1',
      preview: 'Prompt 1',
    },
  ],
  session: {
    sessionId: 'sess-abc-123',
    sessionFile: 'session.jsonl',
    sessionName: 'My Refactor Session',
    userMessages: 4,
    assistantMessages: 4,
    toolCalls: 12,
    toolResults: 12,
    totalMessages: 20,
  },
};

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads command state autonomously and renders model picker', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(mockState);

    render(CommandPalette, {
      open: true,
      onclose: () => {},
    });

    await waitFor(() => {
      expect(screen.getByText('anthropic/claude-3-5-sonnet')).toBeTruthy();
      expect(screen.getByText('openai/gpt-4o')).toBeTruthy();
      expect(screen.getByText('Used 5x')).toBeTruthy();
    });
  });

  it('executes model switch command when model is clicked', async () => {
    const apiSpy = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url, init) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/agent/command') &&
        init?.method === 'POST'
      ) {
        return { ok: true, message: 'Switched model' };
      }
      return mockState;
    });

    render(CommandPalette, {
      open: true,
      onclose: () => {},
    });

    await waitFor(() => {
      expect(screen.getByText('openai/gpt-4o')).toBeTruthy();
    });

    const gptButton = screen.getByText('openai/gpt-4o').closest('button')!;
    await fireEvent.click(gptButton);

    expect(apiSpy).toHaveBeenCalledWith(
      '/api/agent/command',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          command: 'set-model',
          provider: 'openai',
          modelId: 'gpt-4o',
        }),
      }),
    );
  });

  it('renders session metrics, name input, and new session button in /session', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(mockState);

    render(CommandPalette, {
      open: true,
      initialCommand: '/session',
      onclose: () => {},
    });

    await waitFor(() => {
      expect(screen.getByText('My Refactor Session')).toBeTruthy();
      expect(screen.getByText('sess-abc-123')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save session name' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Start new session' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Export HTML' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Export JSONL' })).toBeTruthy();
    });
  });

  it('resolves legacy alias /name to /session tab', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(mockState);

    render(CommandPalette, {
      open: true,
      initialCommand: '/name',
      onclose: () => {},
    });

    await waitFor(() => {
      const nameInput = screen.getByLabelText('Session name') as HTMLInputElement;
      expect(nameInput).toBeTruthy();
      expect(nameInput.value).toBe('My Refactor Session');
    });
  });

  it('renders runtime settings with ChoiceGroup controls in /settings', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(mockState);

    render(CommandPalette, {
      open: true,
      initialCommand: '/settings',
      onclose: () => {},
    });

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Thinking level' })).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Steering mode' })).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Follow-up mode' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Compact now' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Disable auto compaction' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Disable auto retry' })).toBeTruthy();
    });
  });

  it('triggers onprefill and onclose when clicking a slash command in /commands', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(mockState);
    const onprefill = vi.fn();
    const onclose = vi.fn();

    render(CommandPalette, {
      open: true,
      initialCommand: '/commands',
      onprefill,
      onclose,
    });

    await waitFor(() => {
      expect(screen.getByText('/review')).toBeTruthy();
    });

    const commandButton = screen.getByText('/review').closest('button')!;
    await fireEvent.click(commandButton);

    expect(onprefill).toHaveBeenCalledWith('/review ');
    expect(onclose).toHaveBeenCalled();
  });
});
