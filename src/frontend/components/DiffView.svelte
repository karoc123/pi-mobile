<script lang="ts">
  import 'diff2html/bundles/css/diff2html.min.css';

  import { createEventDispatcher } from 'svelte';

  import type { DiffFile, GitRemoteSyncStatus } from '../../../src/shared/contracts.js';
  import { renderDiff } from '../lib/diff.js';

  export let files: DiffFile[] = [];
  export let loading = false;
  export let syncStatus: GitRemoteSyncStatus | null = null;
  export let revertingHunkId: string | null = null;
  export let stagingHunkId: string | null = null;
  export let unstagingHunkId: string | null = null;
  export let stagingAll = false;
  export let unstagingAll = false;
  export let committing = false;
  export let pulling = false;
  export let pushing = false;

  const dispatch = createEventDispatcher<{
    revert: { diff: string; hunkId: string };
    stageHunk: { diff: string; hunkId: string };
    unstageHunk: { diff: string; hunkId: string };
    stageAll: void;
    unstageAll: void;
    pull: void;
    push: void;
    commit: void;
  }>();

  let actionsOpen = false;

  $: allHunks = files.flatMap((file) => file.hunks);
  $: stagedHunkCount = allHunks.filter((hunk) => hunk.staged).length;
  $: unstagedHunkCount = allHunks.length - stagedHunkCount;
  $: actionsBusy = loading || pulling || pushing || committing || stagingAll || unstagingAll;
  $: syncHeadline = describeSyncHeadline(syncStatus);
  $: pullLabel = pulling ? 'Pulling…' : buildActionLabel('Pull', '↓', syncStatus?.behind ?? 0, Boolean(syncStatus?.hasUpstream));
  $: pushLabel = pushing ? 'Pushing…' : buildActionLabel('Push', '↑', syncStatus?.ahead ?? 0, Boolean(syncStatus?.hasUpstream));

  function triggerPull() {
    actionsOpen = false;
    dispatch('pull');
  }

  function triggerPush() {
    actionsOpen = false;
    dispatch('push');
  }

  function triggerCommit() {
    actionsOpen = false;
    dispatch('commit');
  }

  function triggerStageAll() {
    actionsOpen = false;
    dispatch('stageAll');
  }

  function triggerUnstageAll() {
    actionsOpen = false;
    dispatch('unstageAll');
  }

  function handleWindowClick(event: MouseEvent) {
    if (!actionsOpen) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element) || target.closest('.diff-actions')) {
      return;
    }

    actionsOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      actionsOpen = false;
    }
  }

  function describeSyncHeadline(status: GitRemoteSyncStatus | null) {
    if (!status) {
      return 'checking…';
    }

    if (!status.hasUpstream) {
      return 'no upstream';
    }

    if (status.ahead === 0 && status.behind === 0) {
      return 'up to date';
    }

    return `↑ ${status.ahead} ↓ ${status.behind}`;
  }

  function buildActionLabel(base: string, icon: '↑' | '↓', commitCount: number, hasUpstream: boolean) {
    if (!hasUpstream || commitCount <= 0) {
      return base;
    }

    return `${base} (${icon}${commitCount})`;
  }
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleWindowKeydown} />

<section class="view-shell diff-view">
  <div class="section-header">
    <div>
      <p class="eyebrow">Git diff</p>
      <h2>Review (Sync: {syncHeadline})</h2>
    </div>
    <div class="header-actions">
      <span class="status-pill">{files.length} file{files.length === 1 ? '' : 's'} · staged {stagedHunkCount}</span>
      <div class="diff-actions">
        <button
          class="primary-button"
          type="button"
          aria-expanded={actionsOpen}
          aria-label="Open git actions"
          disabled={actionsBusy}
          on:click={() => (actionsOpen = !actionsOpen)}
        >
          Actions
        </button>

        {#if actionsOpen}
          <div class="diff-actions-menu" role="menu" aria-label="Git actions">
            <button class="secondary-button" type="button" role="menuitem" disabled={actionsBusy || unstagedHunkCount === 0} on:click={triggerStageAll}>
              {stagingAll ? 'Staging all…' : `Stage all (${unstagedHunkCount})`}
            </button>
            <button class="secondary-button" type="button" role="menuitem" disabled={actionsBusy || stagedHunkCount === 0} on:click={triggerUnstageAll}>
              {unstagingAll ? 'Unstaging all…' : `Unstage all (${stagedHunkCount})`}
            </button>
            <button class="secondary-button" type="button" role="menuitem" disabled={actionsBusy} on:click={triggerPull}>
              {pullLabel}
            </button>
            <button class="secondary-button" type="button" role="menuitem" disabled={actionsBusy} on:click={triggerPush}>
              {pushLabel}
            </button>
            <button class="primary-button" type="button" role="menuitem" disabled={actionsBusy || stagedHunkCount === 0} on:click={triggerCommit}>
              {committing ? 'Committing…' : 'Commit staged'}
            </button>
          </div>
        {/if}
      </div>
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
                  <div class="hunk-toolbar-main">
                    <code>{hunk.header}</code>
                    <span class:staged={hunk.staged} class:unstaged={!hunk.staged} class="hunk-stage-badge">
                      {hunk.staged ? 'staged' : 'unstaged'}
                    </span>
                  </div>
                  <div class="hunk-toolbar-actions">
                    {#if hunk.staged}
                      <button
                        class="secondary-button"
                        type="button"
                        disabled={unstagingHunkId === hunk.id || actionsBusy}
                        on:click={() => dispatch('unstageHunk', { diff: hunk.diff, hunkId: hunk.id })}
                      >
                        {unstagingHunkId === hunk.id ? 'Unstaging...' : 'Unstage hunk'}
                      </button>
                    {:else}
                      <button
                        class="secondary-button"
                        type="button"
                        disabled={stagingHunkId === hunk.id || actionsBusy}
                        on:click={() => dispatch('stageHunk', { diff: hunk.diff, hunkId: hunk.id })}
                      >
                        {stagingHunkId === hunk.id ? 'Staging...' : 'Stage hunk'}
                      </button>
                    {/if}
                    <button class="secondary-button" type="button" disabled={revertingHunkId === hunk.id} on:click={() => dispatch('revert', { diff: hunk.diff, hunkId: hunk.id })}>
                      {revertingHunkId === hunk.id ? 'Reverting...' : 'Revert hunk'}
                    </button>
                  </div>
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