import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoginScreen from './LoginScreen.svelte';

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders login prompt and submits password', async () => {
    const onLogin = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: true,
          repo: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    render(LoginScreen, {
      onLogin,
    });

    expect(
      screen.getByRole('heading', { name: 'Mobile Git cockpit for your local repos' }),
    ).toBeTruthy();

    const passwordInput = screen.getByLabelText('App password') as HTMLInputElement;
    const submitButton = screen.getByRole('button', {
      name: 'Unlock workspace',
    }) as HTMLButtonElement;

    expect(submitButton.disabled).toBe(true);
    await fireEvent.input(passwordInput, { target: { value: 'secret' } });
    expect(submitButton.disabled).toBe(false);

    await fireEvent.click(submitButton);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
