<script lang="ts">
  import 'diff2html/bundles/css/diff2html.min.css';

  import { createEventDispatcher } from 'svelte';

  import type { DiffFile, GitBranchInfo, GitRemoteSyncStatus } from '../../../src/shared/contracts.js';
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
  export let branches: GitBranchInfo[] = [];
  export let branchesLoading = false;
  export let switchingBranch = false;
  export let creatingBranch = false;

  const dispatch = createEventDispatcher<{
    revert: { diff: string; hunkId: string };
    stageHunk: { diff: string; hunkId: string };
    unstageHunk: { diff: string; hunkId: string };
    stageAll: void;
    unstageAll: void;
    pull: void;
    push: void;
    commit: void;
    branchSwitch: { name: string };
    branchCreate: { name: string };
    loadBranches: void;
  }>();

  let actionsOpen = false;
  let branchActionMode: 'menu' | 'switch' | 'create' = 'menu';
  let branchToCreate = '';

  $: allHunks = files.flatMap((file) => file.hunks);
  $: stagedHunkCount = allHunks.filter((hunk) => hunk.staged).length;
  $: unstagedHunkCount = allHunks.length - stagedHunkCount;
  $: actionsBusy = loading || pulling || pushing || committing || stagingAll || unstagingAll || switchingBranch || creatingBranch;
  $: syncHeadline = describeSyncHeadline(syncStatus);
  $: pullLabel = pulling ? 'Pulling…' : buildActionLabel('Pull', '↓', syncStatus?.behind ?? 0, Boolean(syncStatus?.hasUpstream));
  $: pushLabel = pushing ? 'Pushing…' : buildActionLabel('Push', '↑', syncStatus?.ahead ?? 0, Boolean(syncStatus?.hasUpstream));

  function triggerPull() {
    closeOverlays();
    dispatch('pull');
  }

  function triggerPush() {
    closeOverlays();
    dispatch('push');
  }

  function triggerCommit() {
    closeOverlays();
    dispatch('commit');
  }

  function triggerStageAll() {
    closeOverlays();
    dispatch('stageAll');
  }

  function triggerUnstageAll() {
    closeOverlays();
    dispatch('unstageAll');
  }

  function openBranchSwitch() {
    actionsOpen = false;
    branchActionMode = 'switch';
    dispatch('loadBranches');
  }

  function openBranchCreate() {
    actionsOpen = false;
    branchActionMode = 'create';
    branchToCreate = '';
  }

  function triggerSwitchBranch(name: string) {
    closeOverlays();
    dispatch('branchSwitch', { name });
  }

  function triggerCreateBranch() {
    const trimmed = branchToCreate.trim();

    if (!trimmed) {
      return;
    }

    closeOverlays();
    dispatch('branchCreate', { name: trimmed });
  }

  function closeOverlays() {
    actionsOpen = false;
    branchActionMode = 'menu';
    branchToCreate = '';
  }

  function handleWindowClick(event: MouseEvent) {
    if (!actionsOpen && branchActionMode === 'menu') {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    // Close dropdown menu when clicking outside
    if (branchActionMode === 'menu' && !target.closest('.diff-actions') && !target.closest('.diff-actions-menu')) {
      actionsOpen = false;
      return;
    }

    // Close overlay when clicking outside the sheet
    if (branchActionMode !== 'menu' && !target.closest('.branch-sheet')) {
      closeOverlays();
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeOverlays();
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
            <button class="secondary-button" type="button" role="menuitem" disabled={actionsBusy} on:click={openBranchSwitch}>
              Switch branch…
            </button>
            <button class="secondary-button" type="button" role="menuitem" disabled={actionsBusy} on:click={openBranchCreate}>
              Create branch…
            </button>
            <button class="primary-button" type="button" role="menuitem" disabled={actionsBusy || stagedHunkCount === 0} on:click={triggerCommit}>
              {committing ? 'Committing…' : 'Commit staged'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if branchActionMode !== 'menu'}
    <div class="overlay" role="presentation" on:click={closeOverlays}>
      {#if branchActionMode === 'switch'}
        <div class="sheet-card branch-sheet" role="dialog" aria-modal="true" aria-label="Switch branch" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
          <div class="branch-sheet-header">
            <div>
              <p class="eyebrow">Git branch</p>
              <h3>Switch branch</h3>
            </div>
            <button class="ghost-button" type="button" on:click={closeOverlays}>Close</button>
          </div>

          {#if branchesLoading}
            <p class="empty-state small">Loading branches...</p>
          {:else if branches.length === 0}
            <p class="empty-state small">No branches found.</p>
          {:else}
            <div class="branch-list">
              {#each branches as branch}
                <button
                  class="branch-item"
                  class:current={branch.current}
                  type="button"
                  disabled={branch.current || switchingBranch}
                  on:click={() => triggerSwitchBranch(branch.name)}
                >
                  <strong>{branch.name}</strong>
                  {#if branch.current}
                    <span class="branch-current-badge">current</span>
                  {:else if switchingBranch}
                    <span>Switching...</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else if branchActionMode === 'create'}
        <div class="sheet-card branch-sheet" role="dialog" aria-modal="true" aria-label="Create branch" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
          <div class="branch-sheet-header">
            <div>
              <p class="eyebrow">Git branch</p>
              <h3>Create branch</h3>
            </div>
            <button class="ghost-button" type="button" on:click={closeOverlays}>Close</button>
          </div>

          <form class="branch-create-form" on:submit|preventDefault={triggerCreateBranch}>
            <label class="field-label" for="new-branch-name">Branch name</label>
            <input
              id="new-branch-name"
              class="text-input"
              bind:value={branchToCreate}
              placeholder="feature/my-new-feature"
              autocomplete="off"
              autofocus
            />
            <p class="empty-state small">Creates a new branch from the current HEAD.</p>

            <div class="branch-create-footer">
              <button class="ghost-button" type="button" on:click={() => (branchActionMode = 'menu')}>Back</button>
              <button class="primary-button" type="submit" disabled={!branchToCreate.trim() || creatingBranch}>
                {creatingBranch ? 'Creating...' : 'Create branch'}
              </button>
            </div>
          </form>
        </div>
      {/if}
    </div>
  {/if}

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