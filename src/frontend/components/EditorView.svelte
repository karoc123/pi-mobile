<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { FileEntry } from '../../../src/shared/contracts.js';
  import CodeEditor from './CodeEditor.svelte';

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
        <CodeEditor value={content} filePath={selectedFilePath} on:change={(event) => dispatch('change', { content: event.detail.value })} />
      {:else}
        <div class="empty-state-card compact">
          <h3>No file selected</h3>
          <p>Pick a file from the browser to edit it directly inside the mobile UI.</p>
        </div>
      {/if}
    </div>
  </div>
</section>