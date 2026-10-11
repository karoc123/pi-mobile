import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackendLogQueryResponse } from '../../shared/contracts.js';
import LogView from './LogView.svelte';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  close() {}

  emit(type: string, data: unknown) {
    const list = this.listeners[type] ?? [];
    for (const listener of list) {
      listener(data);
    }
  }
}

describe('LogView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  it('renders log header and filters, and autonomously fetches recent log entries', async () => {
    const mockQueryResponse: BackendLogQueryResponse = {
      entries: [
        {
          seq: 1,
          timestamp: '2026-10-11T12:00:00.000Z',
          level: 'info',
          source: 'server',
          event: null,
          message: 'Server started successfully',
          repo: null,
          requestId: null,
          details: null,
        },
      ],
      hasMore: false,
      nextBeforeSeq: null,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockQueryResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(LogView);

    expect(screen.getByRole('heading', { level: 1, name: 'Backend activity stream' })).toBeTruthy();
    expect(screen.getByPlaceholderText('message, event, repo, request id')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Server started successfully')).toBeTruthy();
      expect(screen.getByText('1 visible entries')).toBeTruthy();
    });

    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
  });

  it('allows resetting filters', async () => {
    const mockQueryResponse: BackendLogQueryResponse = {
      entries: [],
      hasMore: false,
      nextBeforeSeq: null,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockQueryResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(LogView);

    const searchInput = screen.getByPlaceholderText(
      'message, event, repo, request id',
    ) as HTMLInputElement;
    await fireEvent.input(searchInput, { target: { value: 'error query' } });
    expect(searchInput.value).toBe('error query');

    const resetButton = screen.getByRole('button', { name: 'Reset filters' });
    await fireEvent.click(resetButton);

    expect(searchInput.value).toBe('');
  });

  it('receives live stream events and updates visible entries', async () => {
    const mockQueryResponse: BackendLogQueryResponse = {
      entries: [],
      hasMore: false,
      nextBeforeSeq: null,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockQueryResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(LogView);

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
    });

    const es = MockEventSource.instances[0];
    es.emit('ready', { ok: true });
    es.emit('log', {
      data: JSON.stringify({
        seq: 42,
        timestamp: '2026-10-11T12:05:00.000Z',
        level: 'warn',
        source: 'watcher',
        event: null,
        message: 'File change debounce warning',
        repo: null,
        requestId: null,
        details: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('File change debounce warning')).toBeTruthy();
      expect(screen.getByText('Live stream connected')).toBeTruthy();
    });
  });
});
