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

  const dispatch = createEventDispatcher<{
    browse: { path: string };
    openFile: { path: string };
    save: { content: string };
    change: { content: string };
  }>();

  function parentPath(pathValue: string) {
    if (pathValue === '.' || pathValue.length === 0) {
      return '.';
    }

    const parts = pathValue.split('/').filter(Boolean);
    parts.pop();
    return parts.length === 0 ? '.' : parts.join('/');
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
    <button class="primary-button" type="button" on:click={() => dispatch('save', { content })} disabled={!selectedFilePath || !dirty || saving}>
      {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
    </button>
  </div>

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