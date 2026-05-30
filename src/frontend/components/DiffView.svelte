<script lang="ts">
  import 'diff2html/bundles/css/diff2html.min.css';

  import { createEventDispatcher } from 'svelte';

  import type { DiffFile } from '../../../src/shared/contracts.js';
  import { renderDiff } from '../lib/diff.js';

  export let files: DiffFile[] = [];
  export let loading = false;
  export let revertingHunkId: string | null = null;
  export let committing = false;
  export let pulling = false;
  export let pushing = false;

  const dispatch = createEventDispatcher<{
    revert: { diff: string; hunkId: string };
    pull: void;
    push: void;
    commit: void;
  }>();
</script>

<section class="view-shell diff-view">
  <div class="section-header">
    <div>
      <p class="eyebrow">Git diff</p>
      <h2>Review every hunk</h2>
    </div>
    <div class="header-actions">
      <span class="status-pill">{files.length} file{files.length === 1 ? '' : 's'}</span>
      <button class="secondary-button" type="button" disabled={loading || pulling || pushing || committing} on:click={() => dispatch('pull')}>
        {pulling ? 'Pulling…' : 'Pull'}
      </button>
      <button class="secondary-button" type="button" disabled={loading || pulling || pushing || committing} on:click={() => dispatch('push')}>
        {pushing ? 'Pushing…' : 'Push'}
      </button>
      <button class="primary-button" type="button" disabled={loading || files.length === 0 || committing || pulling || pushing} on:click={() => dispatch('commit')}>
        {committing ? 'Committing…' : 'Commit changes'}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="empty-state-card">
      <p>Loading diff...</p>
    </div>
  {:else if files.length === 0}
    <div class="empty-state-card">
      <h3>Working tree clean</h3>
      <p>As soon as pi or the editor changes files, the modified hunks will appear here.</p>
    </div>
  {:else}
    <div class="diff-stack">
      {#each files as file}
        <article class="diff-card">
          <header class="diff-card-header">
            <div>
              <h3>{file.path}</h3>
              <p>{file.status} · +{file.addedLines} / -{file.removedLines}</p>
            </div>
          </header>

          <div class="hunk-stack">
            {#each file.hunks as hunk}
              <section class="hunk-card">
                <div class="hunk-toolbar">
                  <code>{hunk.header}</code>
                  <button class="secondary-button" type="button" disabled={revertingHunkId === hunk.id} on:click={() => dispatch('revert', { diff: hunk.diff, hunkId: hunk.id })}>
                    {revertingHunkId === hunk.id ? 'Reverting...' : 'Revert hunk'}
                  </button>
                </div>
                <div class="diff-html">{@html renderDiff(hunk.diff)}</div>
              </section>
            {/each}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>