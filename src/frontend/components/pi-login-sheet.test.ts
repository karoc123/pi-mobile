import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PiLoginSheet from './PiLoginSheet.svelte';

describe('PiLoginSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enables token submission only after token input', async () => {
    render(PiLoginSheet, {
      open: true,
      initialProviders: [
        { provider: 'anthropic', label: 'Anthropic', configured: false },
        { provider: 'openai', label: 'OpenAI', configured: false },
      ],
    });

    const saveButton = screen.getByRole('button', { name: 'Save token' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await fireEvent.input(screen.getByLabelText('API token'), {
      target: { value: 'secret-token' },
    });

    expect(saveButton.disabled).toBe(false);
  });

  it('shows configured provider state and logout action', () => {
    render(PiLoginSheet, {
      open: true,
      initialProviders: [{ provider: 'anthropic', label: 'Anthropic', configured: true }],
    });

    expect(screen.getByRole('option', { name: 'Anthropic · configured' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Logout provider' })).toBeTruthy();
  });
});
