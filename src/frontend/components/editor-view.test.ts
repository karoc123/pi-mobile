import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileDocument } from '../../shared/contracts.js';
import * as apiModule from '../lib/api.js';
import { editorState } from '../lib/editor-state.svelte.js';
import EditorView from './EditorView.svelte';

describe('EditorView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    editorState.reset();
  });

  it('renders file browser and loads entries when active', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      currentPath: '.',
      entries: [
        { name: 'README.md', relativePath: 'README.md', kind: 'file' },
        { name: 'src', relativePath: 'src', kind: 'directory' },
      ],
    });

    render(EditorView, { active: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /README\.md/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /src/ })).toBeTruthy();
    });
  });

  it('renders image preview using raw file endpoint for images', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url: string) => {
      if (url.includes('/browse')) {
        return {
          currentPath: '.',
          entries: [{ name: 'pixel.png', relativePath: 'pixel.png', kind: 'file' }],
        };
      }
      if (url.includes('/content')) {
        return {
          path: 'pixel.png',
          content: '',
          kind: 'image',
          mimeType: 'image/png',
        } satisfies FileDocument;
      }
      return {};
    });

    render(EditorView, { active: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pixel\.png/ })).toBeTruthy();
    });

    const fileBtn = screen.getByRole('button', { name: /pixel\.png/ });
    await fireEvent.click(fileBtn);

    await waitFor(() => {
      const img = screen.getByRole('img', { name: 'pixel.png' });
      expect(img.getAttribute('src')).toContain('/api/files/raw?path=pixel.png');
    });
  });

  it('opens action sheet when Actions button is clicked', async () => {
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      currentPath: '.',
      entries: [],
    });

    render(EditorView, { active: true });

    const actionsBtn = screen.getByRole('button', { name: 'Actions' });
    await fireEvent.click(actionsBtn);

    expect(screen.getByRole('dialog', { name: 'Editor actions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New folder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload file' })).toBeTruthy();
  });
});
