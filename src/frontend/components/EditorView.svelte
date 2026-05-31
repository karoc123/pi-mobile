<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { FileEntry } from '../../../src/shared/contracts.js';

  let codeEditorComponent: any = null;
  let codeEditorPromise: Promise<void> | null = null;
  let codeEditorError = '';

  export let entries: FileEntry[] = [];
  export let currentPath = '.';
  export let selectedFilePath = '';
  export let content = '';
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
  }>();

  let actionsOpen = false;
  let newFileName = '';
  let newFileContent = '';

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

  function openActions() {
    actionsOpen = !actionsOpen;

    if (actionsOpen && !newFileName) {
      newFileName = 'new-file.txt';
    }
  }

  function canSubmitNewFile() {
    const fileName = newFileName.trim();
    const targetPath = joinPath(currentPath, fileName).trim();
    return fileName.length > 0 && targetPath.length > 0 && targetPath !== '.';
  }

  function submitNewFile() {
    if (creating || !canSubmitNewFile()) {
      return;
    }

    dispatch('createFile', {
      path: joinPath(currentPath, newFileName.trim()),
      content: newFileContent,
    });
    actionsOpen = false;
    newFileName = '';
    newFileContent = '';
  }

  $: if (selectedFilePath) {
    void ensureCodeEditorLoaded();
  }

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
    <div class="header-actions editor-header-actions">
      <button class="secondary-button" type="button" on:click={openActions} aria-expanded={actionsOpen}>
        Actions
      </button>
      <button class="primary-button" type="button" on:click={() => dispatch('save', { content })} disabled={!selectedFilePath || !dirty || saving}>
        {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
      </button>
    </div>
  </div>

  {#if actionsOpen}
    <div class="card-panel editor-actions-panel">
      <div class="editor-actions-panel-header">
        <div>
          <p class="eyebrow">Hidden actions</p>
          <h3>Create file</h3>
        </div>
        <button class="ghost-button" type="button" on:click={() => (actionsOpen = false)}>Close</button>
      </div>

      <form class="editor-actions-form" on:submit|preventDefault={submitNewFile}>
        <label class="field-label" for="new-file-name">File path</label>
        <input id="new-file-name" class="text-input" bind:value={newFileName} placeholder="notes/new-file.md" autocomplete="off" />

        <label class="field-label" for="new-file-content">Initial content</label>
        <textarea id="new-file-content" class="text-input editor-actions-textarea" bind:value={newFileContent} placeholder="Optional starter content"></textarea>

        <p class="empty-state small">Creates the file inside {currentPath === '.' ? 'the repo root' : currentPath}.</p>

        <div class="editor-actions-footer">
          <button class="ghost-button" type="button" on:click={() => (actionsOpen = false)}>Cancel</button>
          <button class="primary-button" type="submit" disabled={!canSubmitNewFile() || creating}>
            {creating ? 'Creating...' : 'Create file'}
          </button>
        </div>
      </form>
    </div>
  {/if}

  <div class="editor-layout">
    <aside class="file-browser card-panel">
      <div class="browser-toolbar">
        <strong>{currentPath === '.' ? 'Repo root' : currentPath}</strong>
        {#if currentPath !== '.'}
          <button class="ghost-button" type="button" on:click={() => dispatch('browse', { path: parentPath(currentPath) })}>Up</button>
        {/if}
      </div>

      {#if loading}
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
      {:else}
        <div class="empty-state-card compact">
          <h3>No file selected</h3>
          <p>Pick a file from the browser to edit it directly inside the mobile UI.</p>
        </div>
      {/if}
    </div>
  </div>
</section>
