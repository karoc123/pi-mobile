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

  it('renders diff file cards and hunks when active', async () => {
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
              staged: false,
              addedLines: 1,
              removedLines: 1,
            },
          ],
        },
      ],
      sync: { ahead: 1, behind: 0, hasUpstream: true },
    };

    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(mockDiff);

    render(DiffView, { active: true });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: 'src/index.ts' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Stage hunk' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Revert hunk' })).toBeTruthy();
    });
  });

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
});
