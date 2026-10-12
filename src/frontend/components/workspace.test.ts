import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyAgentSnapshot } from '../lib/live-connection.svelte.js';
import Workspace from './Workspace.svelte';
class Socket {
  static latest: Socket;
  onmessage: ((event: { data: string }) => void) | null = null;
  close() {}
  constructor() {
    Socket.latest = this;
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('loads runtime commands on mount and updates them when a snapshot selects another repository', async () => {
  vi.stubGlobal('WebSocket', Socket);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.sessionStorage.clear();
  let command = 'custom-a';
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          availableCommands: [{ name: command, description: command, source: 'extension' }],
        }),
      ),
  );
  render(Workspace, {
    initialRepo: { name: 'a', relativePath: 'a', absolutePath: '/repo/a' },
    theme: 'vscode-dark',
    onsetTheme: vi.fn(),
    onlogout: vi.fn(),
  });
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/agent/command-state', expect.anything()),
  );
  const textarea = screen.getByPlaceholderText(/Ask pi/);
  await fireEvent.input(textarea, { target: { value: '/custom', selectionStart: 7 } });
  await screen.findByRole('option', { name: /custom-a/ });
  command = 'custom-b';
  Socket.latest.onmessage?.({
    data: JSON.stringify({
      type: 'snapshot',
      payload: {
        ...emptyAgentSnapshot,
        repo: { name: 'b', relativePath: 'b', absolutePath: '/repo/b' },
      },
    }),
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await fireEvent.input(screen.getByPlaceholderText(/Ask pi/), {
    target: { value: '/custom', selectionStart: 7 },
  });
  await screen.findByRole('option', { name: /custom-b/ });
  expect(screen.queryByRole('option', { name: /custom-a/ })).toBeNull();
});
