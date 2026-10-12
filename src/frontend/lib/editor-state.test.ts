import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileDocument } from '../../shared/contracts.js';
import * as apiModule from './api.js';
import { toast } from './toast.svelte.js';
import { EditorState } from './editor-state.svelte.js';

describe('EditorState', () => {
  let state: EditorState;

  beforeEach(() => {
    vi.restoreAllMocks();
    state = new EditorState();
  });

  it('discards stale responses when a newer openFile request was initiated', async () => {
    let resolveFirstFetch!: (doc: FileDocument) => void;
    let resolveSecondFetch!: (doc: FileDocument) => void;

    const firstPromise = new Promise<FileDocument>((resolve) => {
      resolveFirstFetch = resolve;
    });
    const secondPromise = new Promise<FileDocument>((resolve) => {
      resolveSecondFetch = resolve;
    });

    vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url: string) => {
      if (url.includes('first.txt')) return firstPromise;
      if (url.includes('second.txt')) return secondPromise;
      return {} as FileDocument;
    });

    // Start opening first file
    const openFirstPromise = state.openFile('first.txt');
    // Start opening second file before first finishes
    const openSecondPromise = state.openFile('second.txt');

    // Second file finishes first
    resolveSecondFetch({
      path: 'second.txt',
      content: 'second content',
      kind: 'text',
      mimeType: 'text/plain',
    });
    await openSecondPromise;

    expect(state.selectedFilePath).toBe('second.txt');
    expect(state.draftContent).toBe('second content');

    // First file finishes later (stale response)
    resolveFirstFetch({
      path: 'first.txt',
      content: 'first content',
      kind: 'text',
      mimeType: 'text/plain',
    });
    const firstResult = await openFirstPromise;

    expect(firstResult).toBe(false);
    // Crucial: first.txt must NOT overwrite second.txt
    expect(state.selectedFilePath).toBe('second.txt');
    expect(state.draftContent).toBe('second content');
  });

  it('does NOT overwrite draftContent or clear dirty flag if user started typing while openFile was in flight', async () => {
    let resolveFetch!: (doc: FileDocument) => void;
    const fetchPromise = new Promise<FileDocument>((resolve) => {
      resolveFetch = resolve;
    });

    vi.spyOn(apiModule, 'apiFetch').mockReturnValue(fetchPromise);

    // Initial state: doc already loaded once
    state.selectedDocument = {
      path: 'notes.txt',
      content: 'original server content',
      kind: 'text',
      mimeType: 'text/plain',
    };
    state.draftContent = 'original server content';
    state.dirty = false;

    // Trigger openFile (e.g. reload)
    const openPromise = state.openFile('notes.txt');

    // While in-flight, user types into editor
    state.updateDraft('user active edit');
    expect(state.dirty).toBe(true);
    expect(state.draftContent).toBe('user active edit');

    // Server response arrives with original server content
    resolveFetch({
      path: 'notes.txt',
      content: 'original server content',
      kind: 'text',
      mimeType: 'text/plain',
    });
    const result = await openPromise;

    expect(result).toBe(false);
    // User typing must NOT be wiped out!
    expect(state.draftContent).toBe('user active edit');
    expect(state.dirty).toBe(true);
  });
  it('keeps edits typed while a save is pending dirty after that save completes', () => {
    state.selectedDocument = { path: 'notes.txt', content: 'old', kind: 'text', mimeType: null };
    state.updateDraft('saved');
    state.updateDraft('typed later');
    state.markSaved('notes.txt', 'saved');
    expect(state.draftContent).toBe('typed later');
    expect(state.selectedDocument.content).toBe('saved');
    expect(state.dirty).toBe(true);
  });

  it('retains the directory and document and reports failed reads', async () => {
    state.entries = [{ name: 'notes', relativePath: 'notes', kind: 'file' }];
    vi.spyOn(apiModule, 'apiFetch').mockRejectedValue(new Error('Read denied'));
    await state.browse('missing');
    expect(state.entries).toHaveLength(1);
    expect(state.currentPath).toBe('.');
    expect(toast.message).toBe('Read denied');
    expect(await state.openFile('missing')).toBe(false);
    expect(toast.message).toBe('Read denied');
  });
});
