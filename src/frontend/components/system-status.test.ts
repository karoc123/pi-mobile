import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackendHealthResponse } from '../../shared/contracts.js';
import SystemStatus from './SystemStatus.svelte';

describe('SystemStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders socket status and fetches backend health when open', async () => {
    const mockHealth: BackendHealthResponse = {
      ok: true,
      status: 'healthy',
      serverTime: '2026-10-11T12:00:00.000Z',
      startedAt: '2026-10-11T11:00:00.000Z',
      uptimeSeconds: 3665,
      resources: {
        allRequiredAccessible: true,
        checks: [
          {
            key: 'workspace_root',
            label: 'Workspace directory',
            path: '/workspace',
            required: true,
            ok: true,
            detail: null,
          },
        ],
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockHealth), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(SystemStatus, {
      open: true,
      socketStatus: 'connected',
      reconnectAttempt: 0,
    });

    expect(screen.getByText('Socket connected')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(/Backend healthy/)).toBeTruthy();
      expect(screen.getByText('Resources accessible (1/1)')).toBeTruthy();
    });
  });

  it('renders failures when a required resource is inaccessible', async () => {
    const mockHealth: BackendHealthResponse = {
      ok: true,
      status: 'degraded',
      serverTime: '2026-10-11T12:00:00.000Z',
      startedAt: '2026-10-11T11:59:00.000Z',
      uptimeSeconds: 60,
      resources: {
        allRequiredAccessible: false,
        checks: [
          {
            key: 'logs_dir',
            label: 'Logs directory',
            path: '/data/logs',
            required: true,
            ok: false,
            detail: 'EACCES permission denied',
          },
        ],
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockHealth), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(SystemStatus, {
      open: true,
      socketStatus: 'offline',
      reconnectAttempt: 0,
    });

    expect(screen.getByText('Socket offline')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Backend degraded')).toBeTruthy();
      expect(screen.getByText('Resources blocked (1/1)')).toBeTruthy();
      expect(
        screen.getByText(/Logs directory: \/data\/logs \(EACCES permission denied\)/),
      ).toBeTruthy();
    });
  });
});
