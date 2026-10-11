import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast, ToastStore } from './toast.svelte.js';

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets message and tone and clears after duration', () => {
    toast.show('Saved successfully', 'success', 2000);
    expect(toast.message).toBe('Saved successfully');
    expect(toast.tone).toBe('success');

    vi.advanceTimersByTime(1999);
    expect(toast.message).toBe('Saved successfully');

    vi.advanceTimersByTime(1);
    expect(toast.message).toBe('');
  });

  it('can be manually cleared before timer fires', () => {
    const customToast = new ToastStore();
    customToast.show('Important alert', 'error');
    expect(customToast.message).toBe('Important alert');
    expect(customToast.tone).toBe('error');

    customToast.clear();
    expect(customToast.message).toBe('');
  });
});
