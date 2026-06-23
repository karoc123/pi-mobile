<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  import type { FileEntry } from '../../../src/shared/contracts.js';

  type ActionMode = 'menu' | 'create-file' | 'create-directory' | 'duplicate-file' | 'rename-file' | 'move-file' | 'delete-file' | 'upload-file' | 'download-file';

  let codeEditorComponent: any = null;
  let codeEditorPromise: Promise<void> | null = null;
  let codeEditorError = '';

  export let entries: FileEntry[] = [];
  export let currentPath = '.';
  export let selectedFilePath = '';
  export let content = '';
  export let fileKind: 'text' | 'image' = 'text';
  export let imageDataUrl = '';
  export let dirty = false;
  export let loading = false;
  export let saving = false;
  export let creating = false;

  const dispatch = createEventDispatcher<{
    browse: { path: string };
    openFile: { path: string };
    save: { content: string };
    change: { content: string };
    createFile: { path: string; content: string };
    createDirectory: { path: string };
    duplicateFile: { fromPath: string; toPath: string };
    renameFile: { fromPath: string; toPath: string };
    moveFile: { fromPath: string; toPath: string };
    deleteFile: { path: string };
    uploadFile: { path: string; contentBase64: string };
    downloadFile: { path: string };
  }>();

  const COLLAPSIBLE_MAX_WIDTH = 859;

  let actionsOpen = false;
  let actionMode: ActionMode = 'menu';
  let browserCollapsed = false;
  let canCollapseBrowser = false;
  let lastAutoCollapsedFilePath = '';

  let newFileName = '';
  let newFileContent = '';
  let newDirectoryName = '';
  let targetPath = '';
  let fileInputElement: HTMLInputElement | null = null;
  let uploadingFileName = '';
  let uploading = false;

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

    if (selectedFilePath && (mode === 'duplicate-file' || mode === 'rename-file' || mode === 'move-file')) {
      if (mode === 'duplicate-file') {
        targetPath = withCopySuffix(selectedFilePath);
      } else {
        targetPath = selectedFilePath;
      }
    }

    if (mode === 'upload-file') {
      uploadingFileName = selectedFilePath ? fileName(selectedFilePath) : 'uploaded-file';
    }
  }

  function selectAction(mode: ActionMode) {
    actionMode = mode;
    ensureActionDefaults(mode);
  }

  function canSubmitAction() {
    if (actionMode === 'create-file') {
      const fileNameValue = newFileName.trim();
      const nextPath = joinPath(currentPath, fileNameValue).trim();
      return fileNameValue.length > 0 && nextPath.length > 0 && nextPath !== '.';
    }

    if (actionMode === 'create-directory') {
      const directoryName = newDirectoryName.trim();
      const nextPath = joinPath(currentPath, directoryName).trim();
      return directoryName.length > 0 && nextPath.length > 0 && nextPath !== '.';
    }

    if (actionMode === 'duplicate-file' || actionMode === 'rename-file' || actionMode === 'move-file') {
      return selectedFilePath.length > 0 && targetPath.trim().length > 0 && targetPath.trim() !== '.';
    }

    if (actionMode === 'delete-file') {
      return selectedFilePath.length > 0;
    }

    if (actionMode === 'upload-file') {
      return uploadingFileName.trim().length > 0 && uploadingFileName.trim() !== '.';
    }

    if (actionMode === 'download-file') {
      return selectedFilePath.length > 0;
    }

    return false;
  }

  function submitAction() {
    if (creating || !canSubmitAction()) {
      return;
    }

    if (actionMode === 'create-file') {
      dispatch('createFile', {
        path: joinPath(currentPath, newFileName.trim()),
        content: newFileContent,
      });
      closeActions();
      return;
    }

    if (actionMode === 'create-directory') {
      dispatch('createDirectory', {
        path: joinPath(currentPath, newDirectoryName.trim()),
      });
      closeActions();
      return;
    }

    if (actionMode === 'duplicate-file' && selectedFilePath) {
      dispatch('duplicateFile', {
        fromPath: selectedFilePath,
        toPath: targetPath.trim(),
      });
      closeActions();
      return;
    }

    if (actionMode === 'rename-file' && selectedFilePath) {
      dispatch('renameFile', {
        fromPath: selectedFilePath,
        toPath: targetPath.trim(),
      });
      closeActions();
      return;
    }

    if (actionMode === 'move-file' && selectedFilePath) {
      dispatch('moveFile', {
        fromPath: selectedFilePath,
        toPath: targetPath.trim(),
      });
      closeActions();
      return;
    }

    if (actionMode === 'delete-file' && selectedFilePath) {
      if (!window.confirm(`Delete ${selectedFilePath}?`)) {
        return;
      }

      dispatch('deleteFile', { path: selectedFilePath });
      closeActions();
    }

    if (actionMode === 'upload-file') {
      const fileInput = fileInputElement;

      if (fileInput) {
        fileInput.click();
      }
    }

    if (actionMode === 'download-file' && selectedFilePath) {
      dispatch('downloadFile', { path: selectedFilePath });
      closeActions();
    }
  }

  function handleFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const targetUploadPath = joinPath(currentPath, uploadingFileName.trim() || file.name);
    uploading = true;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== 'string') {
        uploading = false;
        return;
      }

      const base64Index = result.indexOf(';base64,');

      if (base64Index === -1) {
        uploading = false;
        return;
      }

      const contentBase64 = result.slice(base64Index + 8);
      dispatch('uploadFile', { path: targetUploadPath, contentBase64 });

      // Reset file input so the same file can be picked again
      input.value = '';
      uploading = false;
      closeActions();
    };

    reader.onerror = () => {
      uploading = false;
    };

    reader.readAsDataURL(file);
  }

  $: if (selectedFilePath && fileKind === 'text') {
    void ensureCodeEditorLoaded();
  }

  $: if (selectedFilePath && selectedFilePath !== lastAutoCollapsedFilePath) {
    browserCollapsed = canCollapseBrowser;
    lastAutoCollapsedFilePath = selectedFilePath;
  }

  function syncCollapseCapability() {
    if (typeof window === 'undefined') {
      return;
    }

    canCollapseBrowser = window.innerWidth <= COLLAPSIBLE_MAX_WIDTH;

    if (!canCollapseBrowser && browserCollapsed) {
      browserCollapsed = false;
    }
  }

  onMount(() => {
    syncCollapseCapability();
    window.addEventListener('resize', syncCollapseCapability, { passive: true });

    return () => {
      window.removeEventListener('resize', syncCollapseCapability);
    };
  });

  async function ensureCodeEditorLoaded() {
    if (codeEditorComponent || codeEditorPromise) {
      return codeEditorPromise;
    }

    codeEditorError = '';
    codeEditorPromise = import('./CodeEditor.svelte')
      .then((module) => {
        codeEditorComponent = module.default;
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
      <h2>{selectedFilePath || 'Select a file'}</h2>
    </div>
  </div>

  {#if actionsOpen}
    <div class="overlay" role="presentation" on:click={closeActions}>
      <div class="sheet-card editor-action-sheet" role="dialog" aria-modal="true" aria-label="Editor actions" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
        <div class="editor-actions-panel-header">
          <div>
            <p class="eyebrow">Editor actions</p>
            <h3>
              {#if actionMode === 'menu'}
                Choose action
              {:else if actionMode === 'create-file'}
                Create file
              {:else if actionMode === 'create-directory'}
                Create folder
              {:else if actionMode === 'duplicate-file'}
                Duplicate file
              {:else if actionMode === 'rename-file'}
                Rename file
              {:else if actionMode === 'move-file'}
                Move file
              {:else}
                Delete file
              {/if}
            </h3>
          </div>
          <button class="ghost-button" type="button" on:click={closeActions}>Close</button>
        </div>

        {#if actionMode === 'menu'}
          <div class="editor-action-menu">
            <button class="secondary-button" type="button" on:click={() => selectAction('create-file')}>New file</button>
            <button class="secondary-button" type="button" on:click={() => selectAction('create-directory')}>New folder</button>
            <button class="secondary-button" type="button" on:click={() => selectAction('upload-file')}>Upload file</button>

            {#if selectedFilePath}
              <button class="secondary-button" type="button" on:click={() => selectAction('download-file')}>Download file</button>
              <button class="secondary-button" type="button" on:click={() => selectAction('duplicate-file')}>Duplicate file</button>
              <button class="secondary-button" type="button" on:click={() => selectAction('rename-file')}>Rename file</button>
              <button class="secondary-button" type="button" on:click={() => selectAction('move-file')}>Move file</button>
              <button class="danger-button" type="button" on:click={() => selectAction('delete-file')}>Delete file</button>
            {:else}
              <p class="empty-state small">Open a file to unlock download, duplicate, rename, move and delete actions.</p>
            {/if}
          </div>
        {:else}
          <form class="editor-actions-form" on:submit|preventDefault={submitAction}>
            {#if actionMode === 'create-file'}
              <label class="field-label" for="new-file-name">File path</label>
              <input id="new-file-name" class="text-input" bind:value={newFileName} placeholder="notes/new-file.md" autocomplete="off" />

              <label class="field-label" for="new-file-content">Initial content</label>
              <textarea id="new-file-content" class="text-input editor-actions-textarea" bind:value={newFileContent} placeholder="Optional starter content"></textarea>

              <p class="empty-state small">Creates the file inside {currentPath === '.' ? 'the repo root' : currentPath}.</p>
            {:else if actionMode === 'create-directory'}
              <label class="field-label" for="new-folder-name">Folder path</label>
              <input id="new-folder-name" class="text-input" bind:value={newDirectoryName} placeholder="notes/new-folder" autocomplete="off" />

              <p class="empty-state small">Creates the folder inside {currentPath === '.' ? 'the repo root' : currentPath}.</p>
            {:else if actionMode === 'duplicate-file' || actionMode === 'rename-file' || actionMode === 'move-file'}
              <p class="empty-state small">Current file: <strong>{selectedFilePath}</strong></p>

              <label class="field-label" for="target-path">Target path</label>
              <input id="target-path" class="text-input" bind:value={targetPath} placeholder="src/new-name.ts" autocomplete="off" />
            {:else if actionMode === 'upload-file'}
              <label class="field-label" for="upload-file-name">Upload as</label>
              <input id="upload-file-name" class="text-input" bind:value={uploadingFileName} placeholder="target/file.ext" autocomplete="off" />
              <p class="empty-state small">Select a file from your device to upload into {currentPath === '.' ? 'the repo root' : currentPath}.</p>
            {:else if actionMode === 'download-file'}
              <p class="empty-state small">
                Download <strong>{selectedFilePath}</strong> to your device.
              </p>
            {:else}
              <p class="empty-state small">
                The file <strong>{selectedFilePath}</strong> will be permanently deleted from the repository working tree.
              </p>
            {/if}

            <div class="editor-actions-footer">
              <button class="ghost-button" type="button" on:click={() => (actionMode = 'menu')}>Back</button>
              <button class="primary-button" type="submit" disabled={!canSubmitAction() || creating || uploading}>
                {creating || uploading ? 'Working...' : actionMode === 'create-file' ? 'Create file' : actionMode === 'create-directory' ? 'Create folder' : actionMode === 'duplicate-file' ? 'Duplicate file' : actionMode === 'rename-file' ? 'Rename file' : actionMode === 'move-file' ? 'Move file' : actionMode === 'upload-file' ? 'Select file...' : actionMode === 'download-file' ? 'Download file' : 'Delete file'}
              </button>
            </div>
          </form>
        {/if}
      </div>
    </div>
  {/if}

  <div class="editor-layout" class:browser-collapsed={browserCollapsed && canCollapseBrowser}>
    <aside class="file-browser card-panel" class:collapsed={browserCollapsed && canCollapseBrowser}>
      <div class="browser-toolbar">
        <strong>{currentPath === '.' ? 'Repo root' : currentPath}</strong>
        <div class="browser-toolbar-actions">
          {#if canCollapseBrowser}
            <button
              class="ghost-button browser-collapse-toggle"
              type="button"
              on:click={() => (browserCollapsed = !browserCollapsed)}
              aria-expanded={!browserCollapsed}
            >
              {browserCollapsed ? 'Expand' : 'Collapse'}
            </button>
          {/if}
          {#if currentPath !== '.'}
            <button class="ghost-button" type="button" on:click={() => dispatch('browse', { path: parentPath(currentPath) })}>↑</button>
          {/if}
        </div>
      </div>

      {#if browserCollapsed && canCollapseBrowser}
        <p class="empty-state small">Repo root is collapsed. Tap expand to browse files.</p>
      {:else if loading}
        <p class="empty-state small">Loading files...</p>
      {:else if entries.length === 0}
        <p class="empty-state small">No files in this directory.</p>
      {:else}
        <div class="browser-list">
          {#each entries as entry}
            <button
              class:selected={entry.kind === 'file' && entry.relativePath === selectedFilePath}
              class="browser-entry"
              type="button"
              on:click={() => entry.kind === 'directory' ? dispatch('browse', { path: entry.relativePath }) : dispatch('openFile', { path: entry.relativePath })}
            >
              <strong>{entry.name}</strong>
              <span>{entry.kind === 'directory' ? 'Open folder' : entry.relativePath}</span>
            </button>
          {/each}
        </div>
      {/if}
    </aside>

    <div class="editor-panel card-panel">
      {#if selectedFilePath}
        {#if fileKind === 'image'}
          {#if imageDataUrl}
            <div class="editor-image-preview">
              <img src={imageDataUrl} alt={selectedFilePath} loading="lazy" />
            </div>
          {:else}
            <div class="empty-state-card compact">
              <h3>Image preview unavailable</h3>
              <p>The opened image could not be rendered.</p>
            </div>
          {/if}
        {:else}
          {#if codeEditorComponent}
            <svelte:component this={codeEditorComponent} value={content} filePath={selectedFilePath} on:change={(event) => dispatch('change', { content: event.detail.value })} />
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
        <button class="secondary-button" type="button" on:click={openActions} aria-expanded={actionsOpen}>
          Actions
        </button>
        <button class="primary-button" type="button" on:click={() => dispatch('save', { content })} disabled={!selectedFilePath || !dirty || saving}>
          {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  </div>
</section>

<input
  type="file"
  bind:this={fileInputElement}
  on:change={handleFileSelected}
  style="display: none"
  aria-hidden="true"
/>
