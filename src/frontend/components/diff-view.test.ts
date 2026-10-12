import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitDiffResponse } from '../../shared/contracts.js';
import * as apiModule from '../lib/api.js';
import DiffView from './DiffView.svelte';

describe('DiffView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders clean state when there are no diffs', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      files: [],
      sync: { ahead: 0, behind: 0, hasUpstream: true },
    } as GitDiffResponse);

    render(DiffView, { active: true });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Working tree clean' })).toBeTruthy();
    });
  });

  it.each(['stage', 'unstage', 'revert'] as const)(
    'applies %s and releases busy after reloading the diff',
    async (action) => {
      const mockDiff: GitDiffResponse = {
        files: [
          {
            path: 'src/index.ts',
            oldPath: 'src/index.ts',
            newPath: 'src/index.ts',
            status: 'modified',
            addedLines: 1,
            removedLines: 1,
            hunks: [
              {
                id: 'hunk-1',
                header: '@@ -1,3 +1,3 @@',
                diff: '--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,3 @@\n-old\n+new\n',
                staged: action === 'unstage',
                addedLines: 1,
                removedLines: 1,
              },
            ],
          },
        ],
        sync: { ahead: 1, behind: 0, hasUpstream: true },
      };

      const fetch = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(mockDiff);
      let finish!: () => void;
      const post = vi.spyOn(apiModule.api, 'post').mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const changed = vi.fn();

      render(DiffView, { active: true, onworkspacechange: changed });

      const label = `${action[0].toUpperCase()}${action.slice(1)} hunk`;
      const button = (await screen.findByRole('button', { name: label })) as HTMLButtonElement;
      await fireEvent.click(button);
      expect(post).toHaveBeenCalledExactlyOnceWith('/api/git/hunk', {
        diff: mockDiff.files[0].hunks[0].diff,
        action,
      });
      expect(button.disabled).toBe(true);
      finish();
      await waitFor(() => expect(button.disabled).toBe(false));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(changed).toHaveBeenCalledTimes(action === 'revert' ? 1 : 0);
    },
  );

  it('opens actions menu with git operations', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      files: [],
      sync: { ahead: 0, behind: 0, hasUpstream: true },
    } as GitDiffResponse);

    render(DiffView, { active: true });

    const actionsBtn = screen.getByRole('button', { name: 'Open git actions' });
    await fireEvent.click(actionsBtn);

    expect(screen.getByRole('menuitem', { name: 'Switch branch…' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Create branch…' })).toBeTruthy();
  });
  it('shows an initial error instead of claiming the working tree is clean', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockRejectedValue(new Error('git unavailable'));
    render(DiffView, { active: true, workspaceChange: { version: 0 } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('git unavailable'));
    expect(screen.queryByText('Working tree clean')).toBeNull();
  });

  it('loads once on mount, debounces watcher bursts and keeps existing hunks on refresh failure', async () => {
    const fetch = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      files: [
        {
          path: 'keep.txt',
          oldPath: 'keep.txt',
          newPath: 'keep.txt',
          status: 'modified',
          addedLines: 1,
          removedLines: 0,
          hunks: [],
        },
      ],
      sync: { ahead: 0, behind: 0, hasUpstream: false },
    });
    const { rerender } = render(DiffView, { active: true, workspaceChange: { version: 0 } });
    await waitFor(() => expect(screen.getByText('keep.txt')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRejectedValue(new Error('refresh failed'));
    for (const version of [1, 2, 3]) await rerender({ active: true, workspaceChange: { version } });
    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('refresh failed'));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText('keep.txt')).toBeTruthy();
  });

  it('dismisses the actions menu with Escape or an outside tap', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      files: [],
      sync: { ahead: 0, behind: 0, hasUpstream: false },
    });
    render(DiffView);
    const trigger = screen.getByRole('button', { name: 'Open git actions' });
    await fireEvent.click(trigger);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await fireEvent.click(trigger);
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
