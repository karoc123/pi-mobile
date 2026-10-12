import type { FileDocument, FileEntry } from '../../shared/contracts.js';
import { toast } from './toast.svelte.js';
import { apiFetch, toErrorMessage } from './api.js';

export class EditorState {
  currentPath = $state('.');
  entries = $state<FileEntry[]>([]);
  loading = $state(false);
  loadedPath = $state<string | null>(null);
  selectedDocument = $state<FileDocument | null>(null);
  draftContent = $state('');
  dirty = $state(false);

  private openFileRequestId = 0;
  private browseRequestId = 0;

  selectedFilePath = $derived(this.selectedDocument?.path ?? '');
  fileKind = $derived(this.selectedDocument?.kind ?? 'text');

  async browse(path = '.'): Promise<void> {
    const id = ++this.browseRequestId;
    this.loading = true;
    try {
      const response = await apiFetch<{ currentPath: string; entries: FileEntry[] }>(
        `/api/files/browse?path=${encodeURIComponent(path)}`,
      );
      if (id !== this.browseRequestId) return;
      this.currentPath = response.currentPath;
      this.entries = response.entries;
      this.loadedPath = response.currentPath;
    } catch (error) {
      if (id === this.browseRequestId) toast.show(toErrorMessage(error), 'error');
    } finally {
      if (id === this.browseRequestId) this.loading = false;
    }
  }

  async openFile(path: string): Promise<boolean> {
    const requestId = ++this.openFileRequestId;
    try {
      const fileDoc = await apiFetch<FileDocument>(
        `/api/files/content?path=${encodeURIComponent(path)}`,
      );
      if (requestId !== this.openFileRequestId) {
        return false;
      }
      if (this.dirty && this.selectedDocument?.path === path) {
        return false;
      }
      if (
        this.selectedDocument?.path === path &&
        this.selectedDocument.content === fileDoc.content &&
        this.draftContent === (fileDoc.kind === 'text' ? fileDoc.content : '')
      ) {
        this.selectedDocument = fileDoc;
        return true;
      }
      this.selectedDocument = fileDoc;
      this.draftContent = fileDoc.kind === 'text' ? fileDoc.content : '';
      this.dirty = false;
      return true;
    } catch (error) {
      if (requestId === this.openFileRequestId) toast.show(toErrorMessage(error), 'error');
      return false;
    }
  }

  updateDraft(content: string): void {
    this.draftContent = content;
    this.dirty = this.selectedDocument ? content !== this.selectedDocument.content : false;
  }

  markSaved(path = this.selectedFilePath, content = this.draftContent): void {
    if (this.selectedDocument?.path !== path) return;
    this.openFileRequestId++;
    this.selectedDocument = { ...this.selectedDocument, content };
    this.dirty = this.draftContent !== content;
  }

  closeDocument(): void {
    this.openFileRequestId++;
    this.selectedDocument = null;
    this.draftContent = '';
    this.dirty = false;
  }

  reset(): void {
    this.browseRequestId++;
    this.openFileRequestId++;
    this.currentPath = '.';
    this.entries = [];
    this.loading = false;
    this.loadedPath = null;
    this.selectedDocument = null;
    this.draftContent = '';
    this.dirty = false;
  }
}

export const editorState = new EditorState();
