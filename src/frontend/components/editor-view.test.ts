import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileDocument } from '../../shared/contracts.js';
import * as apiModule from '../lib/api.js';
import { editorState } from '../lib/editor-state.svelte.js';
import { toast } from '../lib/toast.svelte.js';
import EditorView from './EditorView.svelte';

describe('EditorView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    editorState.reset();
    toast.clear();
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

  it.each([
    ['New file', 'Create file', 'create', { path: 'src/nested/new', content: 'seed' }],
    ['New folder', 'Create folder', 'create-directory', { path: 'src/nested/new' }],
    [
      'Duplicate file',
      'Duplicate file',
      'duplicate',
      { sourcePath: 'src/original', targetPath: 'src/nested/new' },
    ],
    [
      'Rename file',
      'Rename file',
      'rename',
      { fromPath: 'src/original', toPath: 'src/nested/new' },
    ],
    ['Move file', 'Move file', 'move', { fromPath: 'src/original', toPath: 'src/nested/new' }],
    ['Delete file', 'Delete file', 'delete', { path: 'src/original' }],
  ] as const)(
    'executes %s with its payload, busy state and follow-up',
    async (menu, submit, endpoint, body) => {
      editorState.currentPath = editorState.loadedPath = 'src';
      editorState.selectedDocument = {
        path: 'src/original',
        content: '',
        kind: 'binary',
        mimeType: null,
      };
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const fetch = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url) => {
        const path = new URL(url, 'http://localhost').searchParams.get('path')!;
        return url.includes('/browse')
          ? { currentPath: path, entries: [] }
          : { path, content: '', kind: 'binary', mimeType: null };
      });
      let finish!: () => void;
      const post = vi.spyOn(apiModule.api, 'post').mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const changed = vi.fn();
      render(EditorView, { active: true, onworkspacechange: changed });
      await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
      await fireEvent.click(screen.getByRole('button', { name: menu }));
      const input =
        screen.queryByLabelText('File path') ??
        screen.queryByLabelText('Folder path') ??
        screen.queryByLabelText('Target path');
      if (input)
        await fireEvent.input(input, {
          target: { value: endpoint.startsWith('create') ? 'nested/new' : 'src/nested/new' },
        });
      if (endpoint === 'create')
        await fireEvent.input(screen.getByLabelText('Initial content'), {
          target: { value: 'seed' },
        });
      await fireEvent.click(screen.getByRole('button', { name: submit }));
      expect(post).toHaveBeenCalledExactlyOnceWith(`/api/files/${endpoint}`, body);
      expect(
        (screen.getByRole('button', { name: 'Working...' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(changed).not.toHaveBeenCalled();
      finish();
      const nextPath = endpoint === 'delete' ? 'src/original' : 'src/nested/new';
      await waitFor(() => expect(changed).toHaveBeenCalledExactlyOnceWith(nextPath));
      expect(editorState.currentPath).toBe(
        endpoint === 'delete' || endpoint === 'create-directory' ? 'src' : 'src/nested',
      );
      expect(editorState.selectedFilePath).toBe(
        endpoint === 'delete' ? '' : endpoint === 'create-directory' ? 'src/original' : nextPath,
      );
      expect(fetch).toHaveBeenCalledTimes(
        endpoint === 'delete' || endpoint === 'create-directory' ? 1 : 2,
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(toast.tone).toBe('success');
    },
  );

  it('keeps the document when deletion is cancelled or fails and releases busy for retry', async () => {
    editorState.selectedDocument = {
      path: 'keep.bin',
      content: '',
      kind: 'binary',
      mimeType: null,
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const post = vi.spyOn(apiModule.api, 'post').mockRejectedValue(new Error('Delete denied'));
    const changed = vi.fn();
    render(EditorView, { onworkspacechange: changed });
    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(post).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editorState.selectedFilePath).toBe('keep.bin');
    expect(changed).not.toHaveBeenCalled();
    expect(toast.message).toBe('Delete denied');
    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(
      (screen.getByRole('button', { name: 'Delete file' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('does NOT trigger duplicate openFile fetches on file selection', async () => {
    const fetchSpy = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url: string) => {
      if (url.includes('/browse')) {
        return {
          currentPath: '.',
          entries: [{ name: 'test.txt', relativePath: 'test.txt', kind: 'file' }],
        };
      }
      if (url.includes('/content')) {
        return {
          path: 'test.txt',
          content: 'hello test',
          kind: 'text',
          mimeType: 'text/plain',
        } satisfies FileDocument;
      }
      return {};
    });

    render(EditorView, {
      active: true,
      workspaceChange: { path: '', version: 0 },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test\.txt/ })).toBeTruthy();
    });

    fetchSpy.mockClear();

    const fileBtn = screen.getByRole('button', { name: /test\.txt/ });
    await fireEvent.click(fileBtn);

    await waitFor(() => {
      expect(editorState.selectedFilePath).toBe('test.txt');
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const contentCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/api/files/content'),
    );
    expect(contentCalls).toHaveLength(1);
  });
  it('reports an initial browse failure once without an automatic request loop', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Directory unavailable'));
    render(EditorView, { active: true });
    await waitFor(() => expect(editorState.loading).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(editorState.loadedPath).toBeNull();
  });
});
