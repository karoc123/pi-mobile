import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import AppMenu from './AppMenu.svelte';

describe('AppMenu', () => {
  it('shows the Pi Login action in the session section', () => {
    render(AppMenu, {
      open: true,
      currentRepo: null,
      theme: 'vscode-dark',
    });

    expect(screen.getByRole('button', { name: 'Pi Login' })).toBeTruthy();
  });

  it('keeps logout and Pi Login grouped in the session section', () => {
    render(AppMenu, {
      open: true,
      currentRepo: null,
      theme: 'vscode-dark',
    });

    expect(screen.getByRole('button', { name: 'Pi Login' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy();
  });
  it('signs out locally even when the logout request fails offline', async () => {
    const onlogout = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
    render(AppMenu, { open: true, onlogout });
    await fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(onlogout).toHaveBeenCalledOnce());
    fetch.mockRestore();
  });
});
