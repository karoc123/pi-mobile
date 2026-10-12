import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '../../shared/contracts.js';
import ChatView from './ChatView.svelte';

describe('ChatView', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    window.sessionStorage.clear();
  });
  it('does NOT submit prompt on plain Enter key (allowing multiline input)', async () => {
    const onsubmit = vi.fn();
    render(ChatView, {
      messages: [],
      runtimePhase: 'idle',
      onsubmit,
    });

    const textarea = screen.getByPlaceholderText(/Ask pi to change the active repository/);
    await fireEvent.input(textarea, { target: { value: 'line 1\nline 2' } });

    // Press plain Enter (no ctrlKey, no metaKey)
    await fireEvent.keyDown(textarea, {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });

    expect(onsubmit).not.toHaveBeenCalled();
  });

  it('submits prompt on Ctrl+Enter', async () => {
    const onsubmit = vi.fn();
    render(ChatView, {
      messages: [],
      runtimePhase: 'idle',
      onsubmit,
    });

    const textarea = screen.getByPlaceholderText(/Ask pi to change the active repository/);
    await fireEvent.input(textarea, { target: { value: 'prompt text' } });

    await fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(onsubmit).toHaveBeenCalledWith('prompt text');
  });

  it('submits prompt on Cmd/Meta+Enter', async () => {
    const onsubmit = vi.fn();
    render(ChatView, {
      messages: [],
      runtimePhase: 'idle',
      onsubmit,
    });

    const textarea = screen.getByPlaceholderText(/Ask pi to change the active repository/);
    await fireEvent.input(textarea, { target: { value: 'mac prompt' } });

    await fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    expect(onsubmit).toHaveBeenCalledWith('mac prompt');
  });

  it('does NOT submit prompt when IME is composing (isComposing: true)', async () => {
    const onsubmit = vi.fn();
    render(ChatView, {
      messages: [],
      runtimePhase: 'idle',
      onsubmit,
    });

    const textarea = screen.getByPlaceholderText(/Ask pi to change the active repository/);
    await fireEvent.input(textarea, { target: { value: 'korean text' } });

    await fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true, isComposing: true });

    expect(onsubmit).not.toHaveBeenCalled();
  });

  it('renders bottom scroll sentinel for document-level autoscroll', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        text: 'hello',
        status: 'complete',
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-2',
        role: 'assistant',
        text: 'world',
        status: 'complete',
        timestamp: new Date().toISOString(),
      },
    ];

    const { container } = render(ChatView, {
      messages,
      runtimePhase: 'idle',
    });

    const sentinel = container.querySelector('.scroll-sentinel');
    expect(sentinel).toBeTruthy();
  });
  it('selects a valid suggestion after the filtered list shrinks', async () => {
    render(ChatView, {
      availableCommands: ['custom-a', 'custom-b', 'custom-c'].map((name) => ({
        name,
        description: name,
        source: 'extension' as const,
      })),
    });
    const textarea = screen.getByPlaceholderText(/Ask pi/) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: '/custom', selectionStart: 7 } });
    await fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    await fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    await fireEvent.input(textarea, { target: { value: '/custom-a', selectionStart: 9 } });
    await fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('/custom-a ');
  });
});
