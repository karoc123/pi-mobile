import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import Sheet from './Sheet.svelte';
it('reports native close events so a sheet can be reopened', async () => {
  const onclose = vi.fn();
  render(Sheet, { open: true, title: 'Test sheet', onclose });
  await fireEvent(screen.getByRole('dialog', { name: 'Test sheet' }), new Event('close'));
  expect(onclose).toHaveBeenCalledTimes(1);
});
