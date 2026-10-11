import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspacePicker from './WorkspacePicker.svelte';

describe('WorkspacePicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('autonomously fetches workspace entries when open', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          currentPath: '.',
          entries: [
            {
              name: 'my-project',
              relativePath: 'my-project',
              isGitRepo: true,
            },
          ],
          currentRepo: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    render(WorkspacePicker, {
      open: true,
      currentRepo: null,
    });

    expect(screen.getByText('Clone repository URL / SSH target')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Use repo' })).toBeTruthy();
    });
  });
});
