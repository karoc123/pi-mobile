<script lang="ts">
  import type { Component } from 'svelte';

  import type {
    FileCreateDirectoryResult,
    FileCreateResult,
    FileDeleteResult,
    FileDuplicateResult,
    FileMoveResult,
  } from '../../shared/contracts.js';
  import { api, apiFetch, run } from '../lib/api.js';
  import { editorState } from '../lib/editor-state.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import Sheet from './Sheet.svelte';

  interface Props {
    active?: boolean;
    workspaceChange?: unknown;
    onworkspacechange?: (path?: string) => void;
  }

  const { active = false, workspaceChange = null, onworkspacechange = () => {} }: Props = $props();

  type ActionMode =
    | 'menu'
    | 'create-file'
    | 'create-directory'
    | 'duplicate-file'
    | 'rename-file'
    | 'move-file'
    | 'delete-file'
    | 'upload-file'
    | 'download-file';

  interface ActionConfig {
    mode: ActionMode;
    title: string;
    submitLabel: string;
    isDanger?: boolean;
    requiresFile?: boolean;
  }

  const ACTION_CONFIGS: Record<Exclude<ActionMode, 'menu'>, ActionConfig> = {
    'create-file': {
      mode: 'create-file',
      title: 'Create file',
      submitLabel: 'Create file',
    },
    'create-directory': {
      mode: 'create-directory',
      title: 'Create folder',
      submitLabel: 'Create folder',
    },
    'upload-file': {
      mode: 'upload-file',
      title: 'Upload file',
      submitLabel: 'Select file...',
    },
    'download-file': {
      mode: 'download-file',
      title: 'Download file',
      submitLabel: 'Download file',
      requiresFile: true,
    },
    'duplicate-file': {
      mode: 'duplicate-file',
      title: 'Duplicate file',
      submitLabel: 'Duplicate file',
      requiresFile: true,
    },
    'rename-file': {
      mode: 'rename-file',
      title: 'Rename file',
      submitLabel: 'Rename file',
      requiresFile: true,
    },
    'move-file': {
      mode: 'move-file',
      title: 'Move file',
      submitLabel: 'Move file',
      requiresFile: true,
    },
    'delete-file': {
      mode: 'delete-file',
      title: 'Delete file',
      submitLabel: 'Delete file',
      isDanger: true,
      requiresFile: true,
    },
  };

  const COLLAPSIBLE_MAX_WIDTH = 859;

  let actionsOpen = $state(false);
  let actionMode = $state<ActionMode>('menu');
  let browserCollapsed = $state(false);
  let canCollapseBrowser = $state(false);
  let lastAutoCollapsedFilePath = $state('');

  let newFileName = $state('');
  let newFileContent = $state('');
  let newDirectoryName = $state('');
  let targetPath = $state('');
  let fileInputElement = $state<HTMLInputElement | null>(null);
  let uploadingFileName = $state('');
  let busy = $state<string | null>(null);

  let CodeEditorComponent = $state<Component<{
    value?: string;
    filePath?: string;
    readOnly?: boolean;
    onchange?: (value: string) => void;
  }> | null>(null);
  let codeEditorPromise = $state<Promise<void> | null>(null);
  let codeEditorError = $state('');

  const currentActionConfig = $derived(actionMode !== 'menu' ? ACTION_CONFIGS[actionMode] : null);

  function parentPath(pathValue: string) {
    if (pathValue === '.' || pathValue.length === 0) {
      return '.';
    }

    const parts = pathValue.split('/').filter(Boolean);
    parts.pop();
    return parts.length === 0 ? '.' : parts.join('/');
  }

  function joinPath(basePath: string, childPath: string) {
    const normalizedChild = childPath.replace(/^\/+/, '');

    if (basePath === '.' || basePath.length === 0) {
      return normalizedChild;
    }

    return `${basePath.replace(/\/+$/, '')}/${normalizedChild}`;
  }

  function fileName(relativePath: string) {
    const parts = relativePath.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : relativePath;
  }

  function withCopySuffix(relativePath: string) {
    const baseName = fileName(relativePath);
    const dotIndex = baseName.lastIndexOf('.');
    const parent = parentPath(relativePath);

    if (dotIndex <= 0) {
      return joinPath(parent, `${baseName}-copy`);
    }

    const stem = baseName.slice(0, dotIndex);
    const ext = baseName.slice(dotIndex);
    return joinPath(parent, `${stem}-copy${ext}`);
  }

  function openActions() {
    actionsOpen = !actionsOpen;

    if (actionsOpen) {
      actionMode = 'menu';
      ensureActionDefaults('create-file');
    }
  }

  function closeActions() {
    actionsOpen = false;
    actionMode = 'menu';
  }

  function ensureActionDefaults(mode: ActionMode) {
    if (mode === 'create-file' && !newFileName) {
      newFileName = 'new-file.txt';
      newFileContent = '';
    }

    if (mode === 'create-directory' && !newDirectoryName) {
      newDirectoryName = 'new-folder';
    }

    if (
      editorState.selectedFilePath &&
      (mode === 'duplicate-file' || mode === 'rename-file' || mode === 'move-file')
    ) {
      if (mode === 'duplicate-file') {
        targetPath = withCopySuffix(editorState.selectedFilePath);
      } else {
        targetPath = editorState.selectedFilePath;
      }
    }

    if (mode === 'upload-file') {
      uploadingFileName = editorState.selectedFilePath
        ? fileName(editorState.selectedFilePath)
        : 'uploaded-file';
    }
  }

  function selectAction(mode: ActionMode) {
    actionMode = mode;
    ensureActionDefaults(mode);
  }

  function canSubmitAction() {
    if (actionMode === 'create-file') {
      const fileNameValue = newFileName.trim();
      const nextPath = joinPath(editorState.currentPath, fileNameValue).trim();
      return fileNameValue.length > 0 && nextPath.length > 0 && nextPath !== '.';
    }

    if (actionMode === 'create-directory') {
      const directoryName = newDirectoryName.trim();
      const nextPath = joinPath(editorState.currentPath, directoryName).trim();
      return directoryName.length > 0 && nextPath.length > 0 && nextPath !== '.';
    }

    if (
      actionMode === 'duplicate-file' ||
      actionMode === 'rename-file' ||
      actionMode === 'move-file'
    ) {
      return (
        editorState.selectedFilePath.length > 0 &&
        targetPath.trim().length > 0 &&
        targetPath.trim() !== '.'
      );
    }

    if (actionMode === 'delete-file') {
      return editorState.selectedFilePath.length > 0;
    }

    if (actionMode === 'upload-file') {
      return uploadingFileName.trim().length > 0 && uploadingFileName.trim() !== '.';
    }

    if (actionMode === 'download-file') {
      return editorState.selectedFilePath.length > 0;
    }

    return false;
  }

  async function submitAction(event?: Event) {
    event?.preventDefault();
    if (busy !== null || !canSubmitAction()) {
      return;
    }

    if (actionMode === 'create-file') {
      const fullPath = joinPath(editorState.currentPath, newFileName.trim());
      busy = 'action';
      await run(
        async () => {
          await api.post<FileCreateResult>('/api/files/create', {
            path: fullPath,
            content: newFileContent,
          });
          await editorState.browse(parentPath(fullPath));
          await editorState.openFile(fullPath);
          onworkspacechange(fullPath);
        },
        'File created.',
        (isBusy) => {
          busy = isBusy ? 'action' : null;
        },
      );
      closeActions();
      return;
    }

    if (actionMode === 'create-directory') {
      const fullPath = joinPath(editorState.currentPath, newDirectoryName.trim());
      busy = 'action';
      await run(
        async () => {
          await api.post<FileCreateDirectoryResult>('/api/files/create-directory', {
            path: fullPath,
          });
          await editorState.browse(editorState.currentPath);
          onworkspacechange(fullPath);
        },
        'Folder created.',
        (isBusy) => {
          busy = isBusy ? 'action' : null;
        },
      );
      closeActions();
      return;
    }

    if (actionMode === 'duplicate-file' && editorState.selectedFilePath) {
      const fromPath = editorState.selectedFilePath;
      const toPath = targetPath.trim();
      busy = 'action';
      await run(
        async () => {
          await api.post<FileDuplicateResult>('/api/files/duplicate', {
            sourcePath: fromPath,
            targetPath: toPath,
          });
          await editorState.browse(parentPath(toPath));
          await editorState.openFile(toPath);
          onworkspacechange(toPath);
        },
        'File duplicated.',
        (isBusy) => {
          busy = isBusy ? 'action' : null;
        },
      );
      closeActions();
      return;
    }

    if (actionMode === 'rename-file' && editorState.selectedFilePath) {
      const fromPath = editorState.selectedFilePath;
      const toPath = targetPath.trim();
      busy = 'action';
      await run(
        async () => {
          await api.post<FileMoveResult>('/api/files/rename', {
            fromPath,
            toPath,
          });
          await editorState.browse(parentPath(toPath));
          await editorState.openFile(toPath);
          onworkspacechange(toPath);
        },
        'File renamed.',
        (isBusy) => {
          busy = isBusy ? 'action' : null;
        },
      );
      closeActions();
      return;
    }

    if (actionMode === 'move-file' && editorState.selectedFilePath) {
      const fromPath = editorState.selectedFilePath;
      const toPath = targetPath.trim();
      busy = 'action';
      await run(
        async () => {
          await api.post<FileMoveResult>('/api/files/move', {
            fromPath,
            toPath,
          });
          await editorState.browse(parentPath(toPath));
          await editorState.openFile(toPath);
          onworkspacechange(toPath);
        },
        'File moved.',
        (isBusy) => {
          busy = isBusy ? 'action' : null;
        },
      );
      closeActions();
      return;
    }

    if (actionMode === 'delete-file' && editorState.selectedFilePath) {
      const filePath = editorState.selectedFilePath;
      if (!window.confirm(`Delete ${filePath}?`)) {
        return;
      }

      busy = 'action';
      await run(
        async () => {
          await api.post<FileDeleteResult>('/api/files/delete', {
            path: filePath,
          });
          editorState.closeDocument();
          await editorState.browse(parentPath(filePath));
          onworkspacechange(filePath);
        },
        'File deleted.',
        (isBusy) => {
          busy = isBusy ? 'action' : null;
        },
      );
      closeActions();
      return;
    }

    if (actionMode === 'upload-file') {
      fileInputElement?.click();
      return;
    }

    if (actionMode === 'download-file' && editorState.selectedFilePath) {
      downloadFile(editorState.selectedFilePath);
      closeActions();
    }
  }

  function downloadFile(filePath: string) {
    const link = document.createElement('a');
    link.href = `/api/files/raw?path=${encodeURIComponent(filePath)}&download=1`;
    link.download = fileName(filePath);
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.show('File downloaded.', 'success');
  }

  async function handleFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const targetUploadPath = joinPath(
      editorState.currentPath,
      uploadingFileName.trim() || file.name,
    );
    busy = 'upload';

    await run(
      async () => {
        await apiFetch(`/api/files/raw?path=${encodeURIComponent(targetUploadPath)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        await editorState.browse(parentPath(targetUploadPath));
        await editorState.openFile(targetUploadPath);
        onworkspacechange(targetUploadPath);
      },
      'File uploaded.',
      (isBusy) => {
        busy = isBusy ? 'upload' : null;
      },
    );

    input.value = '';
    closeActions();
  }

  async function saveFile() {
    if (!editorState.selectedFilePath || !editorState.dirty || busy !== null) {
      return;
    }

    busy = 'save';
    await run(
      async () => {
        await api.post('/api/files/write', {
          path: editorState.selectedFilePath,
          content: editorState.draftContent,
        });
        editorState.markSaved();
        onworkspacechange(editorState.selectedFilePath);
      },
      'File saved.',
      (isBusy) => {
        busy = isBusy ? 'save' : null;
      },
    );
  }

  $effect(() => {
    if (active && editorState.loadedPath === null && !editorState.loading) {
      void editorState.browse(editorState.currentPath);
    }
  });

  $effect(() => {
    if (workspaceChange && editorState.selectedFilePath && !editorState.dirty) {
      const changePath =
        typeof workspaceChange === 'object' && workspaceChange !== null && 'path' in workspaceChange
          ? (workspaceChange as { path: string }).path
          : '';
      if (!changePath || changePath === editorState.selectedFilePath) {
        void editorState.openFile(editorState.selectedFilePath);
      }
    }
  });

  $effect(() => {
    if (editorState.selectedFilePath && editorState.fileKind === 'text') {
      void ensureCodeEditorLoaded();
    }
  });

  $effect(() => {
    if (
      editorState.selectedFilePath &&
      editorState.selectedFilePath !== lastAutoCollapsedFilePath
    ) {
      browserCollapsed = canCollapseBrowser;
      lastAutoCollapsedFilePath = editorState.selectedFilePath;
    }
  });

  function syncCollapseCapability() {
    if (typeof window === 'undefined') {
      return;
    }

    canCollapseBrowser = window.innerWidth <= COLLAPSIBLE_MAX_WIDTH;

    if (!canCollapseBrowser && browserCollapsed) {
      browserCollapsed = false;
    }
  }

  $effect(() => {
    syncCollapseCapability();
    window.addEventListener('resize', syncCollapseCapability, { passive: true });

    return () => {
      window.removeEventListener('resize', syncCollapseCapability);
    };
  });

  async function ensureCodeEditorLoaded() {
    if (CodeEditorComponent || codeEditorPromise) {
      return codeEditorPromise;
    }

    codeEditorError = '';
    codeEditorPromise = import('./CodeEditor.svelte')
      .then((module) => {
        CodeEditorComponent = module.default;
      })
      .catch((error) => {
        codeEditorError = error instanceof Error ? error.message : 'Unexpected editor load error.';
      })
      .finally(() => {
        codeEditorPromise = null;
      });

    return codeEditorPromise;
  }
</script>

<section class="view-shell editor-view">
  <div class="section-header">
    <div>
      <p class="eyebrow">Touch editor</p>
      <h2>{editorState.selectedFilePath || 'Select a file'}</h2>
    </div>
  </div>

  <Sheet
    open={actionsOpen}
    onclose={closeActions}
    eyebrow="Editor actions"
    title={currentActionConfig?.title ?? 'Choose action'}
    ariaLabel="Editor actions"
  >
    {#if actionMode === 'menu'}
      <div class="editor-action-menu">
        <button class="secondary-button" type="button" onclick={() => selectAction('create-file')}>
          New file
        </button>
        <button
          class="secondary-button"
          type="button"
          onclick={() => selectAction('create-directory')}
        >
          New folder
        </button>
        <button class="secondary-button" type="button" onclick={() => selectAction('upload-file')}>
          Upload file
        </button>

        {#if editorState.selectedFilePath}
          <button
            class="secondary-button"
            type="button"
            onclick={() => selectAction('download-file')}
          >
            Download file
          </button>
          <button
            class="secondary-button"
            type="button"
            onclick={() => selectAction('duplicate-file')}
          >
            Duplicate file
          </button>
          <button
            class="secondary-button"
            type="button"
            onclick={() => selectAction('rename-file')}
          >
            Rename file
          </button>
          <button class="secondary-button" type="button" onclick={() => selectAction('move-file')}>
            Move file
          </button>
          <button class="danger-button" type="button" onclick={() => selectAction('delete-file')}>
            Delete file
          </button>
        {:else}
          <p class="empty-state small">
            Open a file to unlock download, duplicate, rename, move and delete actions.
          </p>
        {/if}
      </div>
    {:else}
      <form class="editor-actions-form" onsubmit={submitAction}>
        {#if actionMode === 'create-file'}
          <label class="field-label" for="new-file-name">File path</label>
          <input
            id="new-file-name"
            class="text-input"
            bind:value={newFileName}
            placeholder="notes/new-file.md"
            autocomplete="off"
          />

          <label class="field-label" for="new-file-content">Initial content</label>
          <textarea
            id="new-file-content"
            class="text-input editor-actions-textarea"
            bind:value={newFileContent}
            placeholder="Optional starter content"></textarea>

          <p class="empty-state small">
            Creates the file inside {editorState.currentPath === '.'
              ? 'the repo root'
              : editorState.currentPath}.
          </p>
        {:else if actionMode === 'create-directory'}
          <label class="field-label" for="new-folder-name">Folder path</label>
          <input
            id="new-folder-name"
            class="text-input"
            bind:value={newDirectoryName}
            placeholder="notes/new-folder"
            autocomplete="off"
          />

          <p class="empty-state small">
            Creates the folder inside {editorState.currentPath === '.'
              ? 'the repo root'
              : editorState.currentPath}.
          </p>
        {:else if actionMode === 'duplicate-file' || actionMode === 'rename-file' || actionMode === 'move-file'}
          <p class="empty-state small">
            Current file: <strong>{editorState.selectedFilePath}</strong>
          </p>

          <label class="field-label" for="target-path">Target path</label>
          <input
            id="target-path"
            class="text-input"
            bind:value={targetPath}
            placeholder="src/new-name.ts"
            autocomplete="off"
          />
        {:else if actionMode === 'upload-file'}
          <label class="field-label" for="upload-file-name">Upload as</label>
          <input
            id="upload-file-name"
            class="text-input"
            bind:value={uploadingFileName}
            placeholder="target/file.ext"
            autocomplete="off"
          />
          <p class="empty-state small">
            Select a file from your device to upload into {editorState.currentPath === '.'
              ? 'the repo root'
              : editorState.currentPath}.
          </p>
        {:else if actionMode === 'download-file'}
          <p class="empty-state small">
            Download <strong>{editorState.selectedFilePath}</strong> to your device.
          </p>
        {:else}
          <p class="empty-state small">
            The file <strong>{editorState.selectedFilePath}</strong> will be permanently deleted from
            the repository working tree.
          </p>
        {/if}

        <div class="editor-actions-footer">
          <button class="ghost-button" type="button" onclick={() => (actionMode = 'menu')}>
            Back
          </button>
          <button
            class={currentActionConfig?.isDanger ? 'danger-button' : 'primary-button'}
            type="submit"
            disabled={!canSubmitAction() || busy !== null}
          >
            {busy ? 'Working...' : currentActionConfig?.submitLabel}
          </button>
        </div>
      </form>
    {/if}
  </Sheet>

  <div class="editor-layout" class:browser-collapsed={browserCollapsed && canCollapseBrowser}>
    <aside class="file-browser card-panel" class:collapsed={browserCollapsed && canCollapseBrowser}>
      <div class="browser-toolbar">
        <strong>{editorState.currentPath === '.' ? 'Repo root' : editorState.currentPath}</strong>
        <div class="browser-toolbar-actions">
          {#if canCollapseBrowser}
            <button
              class="ghost-button browser-collapse-toggle"
              type="button"
              onclick={() => (browserCollapsed = !browserCollapsed)}
              aria-expanded={!browserCollapsed}
            >
              {browserCollapsed ? 'Expand' : 'Collapse'}
            </button>
          {/if}
          {#if editorState.currentPath !== '.'}
            <button
              class="ghost-button"
              type="button"
              onclick={() => editorState.browse(parentPath(editorState.currentPath))}
            >
              ↑
            </button>
          {/if}
        </div>
      </div>

      {#if browserCollapsed && canCollapseBrowser}
        <p class="empty-state small">Repo root is collapsed. Tap expand to browse files.</p>
      {:else if editorState.loading}
        <p class="empty-state small">Loading files...</p>
      {:else if editorState.entries.length === 0}
        <p class="empty-state small">No files in this directory.</p>
      {:else}
        <div class="browser-list">
          {#each editorState.entries as entry (entry.relativePath)}
            <button
              class:selected={entry.kind === 'file' &&
                entry.relativePath === editorState.selectedFilePath}
              class="browser-entry"
              type="button"
              onclick={() => {
                if (entry.kind === 'directory') {
                  void editorState.browse(entry.relativePath);
                } else {
                  void editorState.openFile(entry.relativePath);
                }
              }}
            >
              <strong>{entry.name}</strong>
              <span>{entry.kind === 'directory' ? 'Open folder' : entry.relativePath}</span>
            </button>
          {/each}
        </div>
      {/if}
    </aside>

    <div class="editor-panel card-panel">
      {#if editorState.selectedFilePath}
        {#if editorState.fileKind === 'image'}
          <div class="editor-image-preview">
            <img
              src={`/api/files/raw?path=${encodeURIComponent(editorState.selectedFilePath)}`}
              alt={editorState.selectedFilePath}
              loading="lazy"
            />
          </div>
        {:else if editorState.fileKind === 'binary'}
          <div class="empty-state-card compact">
            <h3>Binary file</h3>
            <p>This file is binary and cannot be edited in the browser.</p>
            <button
              class="secondary-button"
              type="button"
              onclick={() => downloadFile(editorState.selectedFilePath)}
            >
              Download file
            </button>
          </div>
        {:else}
          {#if CodeEditorComponent}
            <CodeEditorComponent
              value={editorState.draftContent}
              filePath={editorState.selectedFilePath}
              onchange={(content: string) => editorState.updateDraft(content)}
            />
          {:else if codeEditorPromise}
            <div class="empty-state-card compact">
              <h3>Loading editor engine...</h3>
              <p>CodeMirror is loading only when a file is opened.</p>
            </div>
          {:else}
            <div class="empty-state-card compact">
              <h3>Could not load editor engine</h3>
              <p>{codeEditorError || 'Unexpected editor load error.'}</p>
            </div>
          {/if}
        {/if}
      {:else}
        <div class="empty-state-card compact">
          <h3>No file selected</h3>
          <p>Pick a file from the browser to edit it directly inside the mobile UI.</p>
        </div>
      {/if}

      <div class="editor-panel-footer">
        <button
          class="secondary-button"
          type="button"
          onclick={openActions}
          aria-expanded={actionsOpen}
        >
          Actions
        </button>
        <button
          class="primary-button"
          type="button"
          onclick={saveFile}
          disabled={!editorState.selectedFilePath || !editorState.dirty || busy !== null}
        >
          {busy === 'save' ? 'Saving...' : editorState.dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  </div>

  <input
    type="file"
    bind:this={fileInputElement}
    onchange={handleFileSelected}
    style="display: none"
    aria-hidden="true"
  />
</section>

<style>
  .editor-layout {
    display: grid;
    gap: 1rem;
  }

  .file-browser,
  .editor-panel {
    min-height: 18rem;
  }

  .file-browser.collapsed {
    min-height: 0;
  }

  .browser-toolbar {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: center;
  }

  .browser-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .browser-list {
    display: grid;
    gap: 0.75rem;
  }

  .browser-entry {
    width: 100%;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    background: var(--surface-strong);
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    padding: 0.75rem 0.95rem;
    transition:
      transform 120ms ease,
      background 120ms ease;
  }

  .browser-entry span {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .browser-entry.selected {
    background: color-mix(in srgb, var(--accent) 16%, var(--surface-strong));
    border-color: var(--accent);
  }

  .editor-panel {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 0.85rem;
  }

  .editor-panel-footer {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    padding-top: 0.65rem;
    border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--surface) 90%, transparent);
  }

  .editor-panel-footer .primary-button {
    margin-left: auto;
  }

  .editor-action-menu {
    display: grid;
    gap: 0.6rem;
  }

  .editor-actions-form {
    display: grid;
    gap: 0.75rem;
  }

  .editor-actions-textarea {
    min-height: 7rem;
    resize: vertical;
  }

  .editor-actions-footer {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: center;
    margin-top: 0.5rem;
  }

  .editor-image-preview {
    min-height: 56vh;
    border-radius: 0.5rem;
    border: 1px solid var(--line);
    background: var(--surface-strong);
    padding: 0.65rem;
    display: grid;
    place-items: center;
    overflow: auto;
  }

  .editor-image-preview img {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: min(78vh, 56rem);
    object-fit: contain;
  }

  @media (max-width: 859px) {
    .editor-panel-footer {
      flex-wrap: wrap;
    }

    .editor-panel-footer .secondary-button,
    .editor-panel-footer .primary-button {
      flex: 1 1 9rem;
    }
  }

  @media (min-width: 860px) {
    .editor-layout {
      grid-template-columns: 20rem minmax(0, 1fr);
    }

    .editor-layout.browser-collapsed {
      grid-template-columns: 20rem minmax(0, 1fr);
    }

    .editor-layout.browser-collapsed .file-browser {
      display: grid;
      align-content: start;
    }

    .browser-collapse-toggle {
      display: none;
    }
  }
</style>
