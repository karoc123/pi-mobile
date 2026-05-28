<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { SelectedRepo, WorkspaceEntry } from '../../../src/shared/contracts.js';

  export let open = false;
  export let loading = false;
  export let currentPath = '.';
  export let currentRepo: SelectedRepo | null = null;
  export let entries: WorkspaceEntry[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    browse: { path: string };
    select: { path: string };
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

{#if open}
  <div class="overlay" role="presentation" on:click={() => dispatch('close')}>
    <section class="sheet-card" role="dialog" aria-modal="true" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="sheet-header">
        <div>
          <p class="eyebrow">Repository picker</p>
          <h2>{currentPath === '.' ? 'Workspace root' : currentPath}</h2>
        </div>
        <button class="ghost-button" type="button" on:click={() => dispatch('close')}>Close</button>
      </div>

      {#if currentPath !== '.'}
        <button class="path-button" type="button" on:click={() => dispatch('browse', { path: parentPath(currentPath) })}>
          Up one level
        </button>
      {/if}

      <div class="picker-list">
        {#if loading}
          <p class="empty-state small">Loading folders...</p>
        {:else if entries.length === 0}
          <p class="empty-state small">No directories found at this level.</p>
        {:else}
          {#each entries as entry}
            <article class="picker-entry">
              <button class="entry-main" type="button" on:click={() => dispatch('browse', { path: entry.relativePath })}>
                <strong>{entry.name}</strong>
                <span>{entry.isGitRepo ? 'Git repository available' : 'Browse deeper'}</span>
              </button>
              {#if entry.isGitRepo}
                <button class="primary-button compact" type="button" on:click={() => dispatch('select', { path: entry.relativePath })}>
                  {currentRepo?.relativePath === entry.relativePath ? 'Active' : 'Use repo'}
                </button>
              {/if}
            </article>
          {/each}
        {/if}
      </div>
    </section>
  </div>
{/if}