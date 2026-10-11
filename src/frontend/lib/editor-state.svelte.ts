import type { FileDocument, FileEntry } from '../../shared/contracts.js';
import { apiFetch } from './api.js';

export class EditorState {
  currentPath = $state('.');
  entries = $state<FileEntry[]>([]);
  loading = $state(false);
  loadedPath = $state<string | null>(null);
  selectedDocument = $state<FileDocument | null>(null);
  draftContent = $state('');
  dirty = $state(false);

  selectedFilePath = $derived(this.selectedDocument?.path ?? '');
  fileKind = $derived(this.selectedDocument?.kind ?? 'text');

  async browse(path = '.'): Promise<void> {
    this.loading = true;
    try {
      const response = await apiFetch<{ currentPath: string; entries: FileEntry[] }>(
        `/api/files/browse?path=${encodeURIComponent(path)}`,
      );
      this.currentPath = response.currentPath;
      this.entries = response.entries;
      this.loadedPath = response.currentPath;
    } catch {
      this.entries = [];
      this.loadedPath = path;
    } finally {
      this.loading = false;
    }
  }

  async openFile(path: string): Promise<boolean> {
    try {
      const fileDoc = await apiFetch<FileDocument>(
        `/api/files/content?path=${encodeURIComponent(path)}`,
      );
      this.selectedDocument = fileDoc;
      this.draftContent = fileDoc.kind === 'text' ? fileDoc.content : '';
      this.dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  updateDraft(content: string): void {
    this.draftContent = content;
    this.dirty = this.selectedDocument ? content !== this.selectedDocument.content : false;
  }

  markSaved(): void {
    if (this.selectedDocument) {
      this.selectedDocument = { ...this.selectedDocument, content: this.draftContent };
    }
    this.dirty = false;
  }

  closeDocument(): void {
    this.selectedDocument = null;
    this.draftContent = '';
    this.dirty = false;
  }

  reset(): void {
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
