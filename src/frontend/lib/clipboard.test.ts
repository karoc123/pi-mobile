import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from './clipboard.js';

describe('copyText', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
    document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard.writeText when available in secure context', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    const success = await copyText('hello world');
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('hello world');
  });

  it('falls back to execCommand when clipboard API is unavailable or insecure', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: false,
      configurable: true,
    });
    const execCommandFn = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandFn;

    const success = await copyText('fallback test');
    expect(success).toBe(true);
    expect(execCommandFn).toHaveBeenCalledWith('copy');
  });
});
