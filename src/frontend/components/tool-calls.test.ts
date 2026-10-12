import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import ToolCalls from './ToolCalls.svelte';
it('only adds tool details to the DOM when expanded', async () => {
  const { container } = render(ToolCalls, {
    tools: [{ id: 'call', name: 'read', status: 'aborted', detail: 'large result' }],
  });
  expect(screen.getByText('aborted')).toBeTruthy();
  expect(container.querySelector('pre')).toBeNull();
  const details = container.querySelector('details')!;
  details.open = true;
  await fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(screen.getByText('large result')).toBeTruthy());
  details.open = false;
  await fireEvent(details, new Event('toggle'));
  expect(container.querySelector('pre')).toBeNull();
});
