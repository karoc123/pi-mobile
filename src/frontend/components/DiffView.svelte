<script lang="ts">
  import { untrack } from 'svelte';

  import 'diff2html/bundles/css/diff2html.min.css';

  import type {
    DiffFile,
    GitBranchesResponse,
    GitBranchInfo,
    GitCommitResult,
    GitDiffResponse,
    GitRemoteSyncStatus,
    GitSyncResult,
  } from '../../shared/contracts.js';
  import { api, apiFetch, run, toErrorMessage, type RunOptions } from '../lib/api.js';
  import { renderDiff } from '../lib/diff.js';
  import { toast } from '../lib/toast.svelte.js';
  import Sheet from './Sheet.svelte';

  interface Props {
    active?: boolean;
    workspaceChange?: { version: number };
    onworkspacechange?: (path?: string) => void;
  }

  const {
    active = false,
    workspaceChange = { version: 0 },
    onworkspacechange = () => {},
  }: Props = $props();

  let files = $state<DiffFile[]>([]);
  let syncStatus = $state<GitRemoteSyncStatus | null>(null);
  let loading = $state(false);
  let busy = $state<string | null>(null);

  let actionsOpen = $state(false);
  let diffError = $state('');
  let requestId = 0;
  let loaded = false;
  let actionsElement: HTMLDivElement | undefined = $state();
  let branchSheetMode = $state<'switch' | 'create' | null>(null);
  let branches = $state<GitBranchInfo[]>([]);
  let branchToCreate = $state('');

  const allHunks = $derived(files.flatMap((file) => file.hunks));
  const stagedHunkCount = $derived(allHunks.filter((hunk) => hunk.staged).length);
  const unstagedHunkCount = $derived(allHunks.length - stagedHunkCount);
  const syncHeadline = $derived(describeSyncHeadline(syncStatus));
  const pullLabel = $derived(
    busy === 'pull'
      ? 'Pulling…'
      : buildActionLabel('Pull', '↓', syncStatus?.behind ?? 0, Boolean(syncStatus?.hasUpstream)),
  );
  const pushLabel = $derived(
    busy === 'push'
      ? 'Pushing…'
      : buildActionLabel('Push', '↑', syncStatus?.ahead ?? 0, Boolean(syncStatus?.hasUpstream)),
  );

  export async function loadDiff() {
    const id = ++requestId;
    loading = true;
    try {
      const response = await apiFetch<GitDiffResponse>('/api/git/diff');
      if (id !== requestId) return;
      files = response.files;
      syncStatus = response.sync;
      diffError = '';
      loaded = true;
    } catch (error) {
      if (id === requestId) diffError = toErrorMessage(error);
    } finally {
      if (id === requestId) loading = false;
    }
  }

  $effect(() => {
    const version = workspaceChange.version;
    if (!active) return;
    const timer = setTimeout(() => void loadDiff(), untrack(() => loaded) && version > 0 ? 400 : 0);
    return () => {
      clearTimeout(timer);
      requestId++;
    };
  });

  function runAction<T>(key: string, action: () => Promise<T>, okText?: RunOptions<T>['okText']) {
    return run(action, { okText, busy: (isBusy) => (busy = isBusy ? key : null) });
  }

  async function applyHunkAction(
    diff: string,
    hunkId: string,
    action: 'stage' | 'unstage' | 'revert',
  ) {
    const successMsg =
      action === 'stage'
        ? 'Hunk staged.'
        : action === 'unstage'
          ? 'Hunk unstaged.'
          : 'Hunk reverted.';

    await runAction(
      `hunk:${action}:${hunkId}`,
      async () => {
        await api.post('/api/git/hunk', { diff, action });
        await loadDiff();
        if (action === 'revert') {
          onworkspacechange();
        }
      },
      successMsg,
    );
  }

  async function triggerStageAll() {
    actionsOpen = false;
    await runAction(
      'stage-all',
      async () => {
        await api.post('/api/git/stage-all');
        await loadDiff();
      },
      'All changes staged.',
    );
  }

  async function triggerUnstageAll() {
    actionsOpen = false;
    await runAction(
      'unstage-all',
      async () => {
        await api.post('/api/git/unstage-all');
        await loadDiff();
      },
      'All changes unstaged.',
    );
  }

  async function triggerPull() {
    actionsOpen = false;
    await runAction(
      'pull',
      async () => {
        const response = await api.post<GitSyncResult>('/api/git/pull');
        await loadDiff();
        return response;
      },
      (res) => res.summary || 'Pull completed.',
    );
  }

  async function triggerPush() {
    actionsOpen = false;
    await runAction(
      'push',
      async () => {
        const response = await api.post<GitSyncResult>('/api/git/push');
        await loadDiff();
        return response;
      },
      (res) => res.summary || 'Push completed.',
    );
  }

  async function triggerCommit() {
    actionsOpen = false;
    const input = window.prompt('Commit message', '');
    if (input === null) {
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) {
      toast.show('Commit message is required.', 'error');
      return;
    }

    await runAction(
      'commit',
      async () => {
        const res = await api.post<GitCommitResult>('/api/git/commit', { message: trimmed });
        await loadDiff();
        onworkspacechange();
        return res;
      },
      (res) => `Committed ${res.commitSha.slice(0, 7)}.`,
    );
  }

  async function loadBranches() {
    await runAction('branches', async () => {
      const res = await apiFetch<GitBranchesResponse>('/api/git/branches');
      branches = res.branches;
    });
  }

  function openBranchSwitch() {
    actionsOpen = false;
    branchSheetMode = 'switch';
    void loadBranches();
  }

  function openBranchCreate() {
    actionsOpen = false;
    branchSheetMode = 'create';
    branchToCreate = '';
  }

  function closeBranchSheet() {
    branchSheetMode = null;
    branchToCreate = '';
  }

  async function triggerSwitchBranch(name: string) {
    await runAction(
      'switch-branch',
      async () => {
        await api.post('/api/git/branch/switch', { name });
        closeBranchSheet();
        await loadDiff();
        onworkspacechange();
      },
      `Switched to ${name}.`,
    );
  }

  async function triggerCreateBranch(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = branchToCreate.trim();
    if (!trimmed) {
      return;
    }

    await runAction(
      'create-branch',
      async () => {
        await api.post('/api/git/branch/create', { name: trimmed });
        closeBranchSheet();
        await loadDiff();
        onworkspacechange();
      },
      `Created branch ${trimmed}.`,
    );
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

  function buildActionLabel(
    base: string,
    icon: '↑' | '↓',
    commitCount: number,
    hasUpstream: boolean,
  ) {
    if (!hasUpstream || commitCount <= 0) {
      return base;
    }

    return `${base} (${icon}${commitCount})`;
  }
</script>

<svelte:window
  onpointerdown={(event) => {
    if (!actionsElement?.contains(event.target as Node)) actionsOpen = false;
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape') actionsOpen = false;
  }}
/>

<section class="view-shell diff-view">
  <div class="section-header">
    <div>
      <p class="eyebrow">Git diff</p>
      <h2>Review (Sync: {syncHeadline})</h2>
    </div>
    <div class="header-actions">
      <span class="status-pill"
        >{files.length} file{files.length === 1 ? '' : 's'} · staged {stagedHunkCount}</span
      >
      <div class="diff-actions" bind:this={actionsElement}>
        <button
          class="primary-button"
          type="button"
          aria-expanded={actionsOpen}
          aria-label="Open git actions"
          disabled={Boolean(busy)}
          onclick={() => (actionsOpen = !actionsOpen)}
        >
          Actions
        </button>

        {#if actionsOpen}
          <div class="diff-actions-menu" role="menu" aria-label="Git actions">
            <button
              class="secondary-button"
              type="button"
              role="menuitem"
              disabled={Boolean(busy) || unstagedHunkCount === 0}
              onclick={triggerStageAll}
            >
              {busy === 'stage-all' ? 'Staging all…' : `Stage all (${unstagedHunkCount})`}
            </button>
            <button
              class="secondary-button"
              type="button"
              role="menuitem"
              disabled={Boolean(busy) || stagedHunkCount === 0}
              onclick={triggerUnstageAll}
            >
              {busy === 'unstage-all' ? 'Unstaging all…' : `Unstage all (${stagedHunkCount})`}
            </button>
            <button
              class="secondary-button"
              type="button"
              role="menuitem"
              disabled={Boolean(busy)}
              onclick={triggerPull}
            >
              {pullLabel}
            </button>
            <button
              class="secondary-button"
              type="button"
              role="menuitem"
              disabled={Boolean(busy)}
              onclick={triggerPush}
            >
              {pushLabel}
            </button>
            <button
              class="secondary-button"
              type="button"
              role="menuitem"
              disabled={Boolean(busy)}
              onclick={openBranchSwitch}
            >
              Switch branch…
            </button>
            <button
              class="secondary-button"
              type="button"
              role="menuitem"
              disabled={Boolean(busy)}
              onclick={openBranchCreate}
            >
              Create branch…
            </button>
            <button
              class="primary-button"
              type="button"
              role="menuitem"
              disabled={Boolean(busy) || stagedHunkCount === 0}
              onclick={triggerCommit}
            >
              {busy === 'commit' ? 'Committing…' : 'Commit staged'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <Sheet
    open={branchSheetMode === 'switch'}
    title="Switch branch"
    eyebrow="Git branch"
    onclose={closeBranchSheet}
  >
    {#if busy === 'branches'}
      <p class="empty-state small">Loading branches...</p>
    {:else if branches.length === 0}
      <p class="empty-state small">No branches found.</p>
    {:else}
      <div class="branch-list">
        {#each branches as branch (branch.name)}
          <button
            class="branch-item"
            class:current={branch.current}
            type="button"
            disabled={branch.current || busy === 'switch-branch'}
            onclick={() => triggerSwitchBranch(branch.name)}
          >
            <strong>{branch.name}</strong>
            {#if branch.current}
              <span class="branch-current-badge">current</span>
            {:else if busy === 'switch-branch'}
              <span>Switching...</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </Sheet>

  <Sheet
    open={branchSheetMode === 'create'}
    title="Create branch"
    eyebrow="Git branch"
    onclose={closeBranchSheet}
  >
    <form class="branch-create-form" onsubmit={triggerCreateBranch}>
      <label class="field-label" for="new-branch-name">Branch name</label>
      <input
        id="new-branch-name"
        class="text-input"
        bind:value={branchToCreate}
        placeholder="feature/my-new-feature"
        autocomplete="off"
      />
      <p class="empty-state small">Creates a new branch from the current HEAD.</p>

      <div class="branch-create-footer">
        <button class="ghost-button" type="button" onclick={closeBranchSheet}>Back</button>
        <button
          class="primary-button"
          type="submit"
          disabled={!branchToCreate.trim() || busy === 'create-branch'}
        >
          {busy === 'create-branch' ? 'Creating...' : 'Create branch'}
        </button>
      </div>
    </form>
  </Sheet>

  {#if diffError}
    <div class="notice error" role="alert">
      {diffError}
      <button class="ghost-button" type="button" onclick={() => void loadDiff()}>Retry</button>
    </div>
  {/if}
  {#if loading && files.length > 0}<p role="status">Refreshing diff…</p>{/if}
  {#if loading && files.length === 0}
    <div class="empty-state-card">
      <p>Loading diff...</p>
    </div>
  {:else if files.length === 0 && !diffError}
    <div class="empty-state-card">
      <h3>Working tree clean</h3>
      <p>As soon as pi or the editor changes files, the modified hunks will appear here.</p>
    </div>
  {:else}
    <div class="diff-stack">
      {#each files as file (file.path)}
        <article class="diff-card">
          <header class="diff-card-header">
            <div>
              <h3>{file.path}</h3>
              <p>{file.status} · +{file.addedLines} / -{file.removedLines}</p>
            </div>
          </header>

          <div class="hunk-stack">
            {#each file.hunks as hunk (hunk.id)}
              <section class="hunk-card">
                <div class="hunk-toolbar">
                  <div class="hunk-toolbar-main">
                    <code>{hunk.header}</code>
                    <span
                      class:staged={hunk.staged}
                      class:unstaged={!hunk.staged}
                      class="hunk-stage-badge"
                    >
                      {hunk.staged ? 'staged' : 'unstaged'}
                    </span>
                  </div>
                  <div class="hunk-toolbar-actions">
                    {#if hunk.staged}
                      <button
                        class="secondary-button"
                        type="button"
                        disabled={Boolean(busy)}
                        onclick={() => applyHunkAction(hunk.diff, hunk.id, 'unstage')}
                      >
                        {busy === `hunk:unstage:${hunk.id}` ? 'Unstaging...' : 'Unstage hunk'}
                      </button>
                    {:else}
                      <button
                        class="secondary-button"
                        type="button"
                        disabled={Boolean(busy)}
                        onclick={() => applyHunkAction(hunk.diff, hunk.id, 'stage')}
                      >
                        {busy === `hunk:stage:${hunk.id}` ? 'Staging...' : 'Stage hunk'}
                      </button>
                    {/if}
                    <button
                      class="secondary-button"
                      type="button"
                      disabled={Boolean(busy)}
                      onclick={() => applyHunkAction(hunk.diff, hunk.id, 'revert')}
                    >
                      {busy === `hunk:revert:${hunk.id}` ? 'Reverting...' : 'Revert hunk'}
                    </button>
                  </div>
                </div>
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                <div class="diff-html">{@html renderDiff(hunk.diff)}</div>
              </section>
            {/each}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .diff-view {
    color: var(--ink);
  }

  .diff-view .eyebrow {
    color: var(--muted);
  }

  .diff-view .section-header {
    align-items: end;
  }

  .diff-actions {
    position: relative;
  }

  .diff-actions-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.45rem);
    z-index: 4;
    min-width: 11.5rem;
    display: grid;
    gap: 0.4rem;
    padding: 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.35rem;
    background: var(--surface);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.03),
      inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .diff-actions-menu .primary-button,
  .diff-actions-menu .secondary-button {
    width: 100%;
    text-align: left;
  }

  .diff-view .status-pill,
  .diff-view .primary-button,
  .diff-view .secondary-button {
    background: var(--surface);
    border-color: var(--line);
    color: var(--ink);
  }

  .diff-view .primary-button:hover,
  .diff-view .secondary-button:hover {
    background: var(--surface-strong);
  }

  .diff-stack {
    display: grid;
    gap: 1.25rem;
  }

  .diff-card,
  .empty-state-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-color: var(--line);
    color: var(--ink);
    border-radius: 0.4rem;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }

  .diff-card {
    display: grid;
    gap: 0.9rem;
    padding: 1rem;
  }

  .diff-card-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.75rem;
  }

  .empty-state-card p,
  .diff-card-header p {
    color: var(--muted);
    margin: 0;
  }

  .diff-card h3,
  .hunk-toolbar code {
    margin: 0;
  }

  .hunk-stack {
    display: grid;
    gap: 0.85rem;
  }

  .hunk-card {
    background: var(--surface-strong);
    border: 1px solid var(--line);
    border-color: var(--line);
    color: var(--ink);
    border-radius: 0.22rem;
    padding: 0.85rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.03),
      inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .hunk-toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.55rem;
    padding-bottom: 0.7rem;
    margin-bottom: 0.8rem;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 30%, transparent);
  }

  .hunk-toolbar-main {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .hunk-toolbar-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .hunk-toolbar code {
    color: var(--accent-strong);
    background: color-mix(in srgb, var(--line) 10%, transparent);
    padding: 0.2rem 0.45rem;
    border-radius: 0.2rem;
  }

  .hunk-stage-badge {
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--muted);
    padding: 0.16rem 0.5rem;
    font-size: 0.67rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .hunk-stage-badge.staged {
    border-color: var(--diff-added-border);
    background: color-mix(in srgb, var(--diff-added-bg) 70%, var(--surface));
    color: var(--diff-added-text);
  }

  .hunk-stage-badge.unstaged {
    border-color: color-mix(in srgb, var(--warning) 80%, var(--line));
    background: color-mix(in srgb, var(--diff-change-bg) 68%, var(--surface));
    color: var(--ink);
  }

  .diff-html {
    --d2h-bg-color: var(--surface-strong);
    --d2h-border-color: var(--line);
    --d2h-dim-color: var(--diff-dim);
    --d2h-line-border-color: color-mix(in srgb, var(--line) 50%, transparent);
    --d2h-file-header-bg-color: var(--surface-raised);
    --d2h-file-header-border-color: var(--line);
    --d2h-empty-placeholder-bg-color: var(--diff-gutter);
    --d2h-empty-placeholder-border-color: var(--line);
    --d2h-ins-bg-color: var(--diff-added-bg);
    --d2h-ins-border-color: var(--diff-added-border);
    --d2h-ins-highlight-bg-color: var(--diff-added-highlight);
    --d2h-ins-label-color: var(--diff-added-text);
    --d2h-del-bg-color: var(--diff-removed-bg);
    --d2h-del-border-color: var(--diff-removed-border);
    --d2h-del-highlight-bg-color: var(--diff-removed-highlight);
    --d2h-del-label-color: var(--diff-removed-text);
    --d2h-change-del-color: var(--diff-change-bg);
    --d2h-change-ins-color: var(--diff-added-highlight);
    --d2h-info-bg-color: var(--diff-info-bg);
    --d2h-info-border-color: var(--diff-info-border);
    --d2h-change-label-color: var(--accent-strong);
    --d2h-moved-label-color: var(--accent-strong);
    font-family: 'IBM Plex Mono', 'Consolas', 'Liberation Mono', monospace;
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .diff-html :global(.d2h-wrapper),
  .diff-html :global(.d2h-file-wrapper),
  .diff-html :global(.d2h-file-diff) {
    border-radius: 0.22rem;
    overflow: hidden;
  }

  .diff-html :global(.d2h-file-wrapper) {
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .diff-html :global(.d2h-code-line),
  .diff-html :global(.d2h-code-side-line),
  .diff-html :global(.d2h-code-line-ctn),
  .diff-html :global(.d2h-code-side-line-ctn),
  .diff-html :global(.d2h-code-line-prefix),
  .diff-html :global(.d2h-code-linenumber),
  .diff-html :global(.d2h-code-side-linenumber) {
    font-family: inherit;
  }

  .diff-html :global(.d2h-code-linenumber),
  .diff-html :global(.d2h-code-side-linenumber) {
    background: var(--diff-gutter);
    color: var(--diff-dim);
  }

  .diff-html :global(.d2h-ins),
  .diff-html :global(.d2h-ins .d2h-code-line-ctn),
  .diff-html :global(.d2h-ins .d2h-code-side-line-ctn),
  .diff-html :global(.d2h-added),
  .diff-html :global(.d2h-lines-added) {
    color: var(--diff-added-text);
  }

  .diff-html :global(.d2h-del),
  .diff-html :global(.d2h-del .d2h-code-line-ctn),
  .diff-html :global(.d2h-del .d2h-code-side-line-ctn),
  .diff-html :global(.d2h-deleted),
  .diff-html :global(.d2h-lines-deleted) {
    color: var(--diff-removed-text);
  }

  .diff-html :global(.d2h-info),
  .diff-html :global(.d2h-emptyplaceholder),
  .diff-html :global(.d2h-code-side-emptyplaceholder) {
    color: var(--diff-dim);
  }

  .diff-html :global(.d2h-wrapper) {
    margin: 0;
  }

  .diff-html :global(.d2h-file-header),
  .diff-html :global(.d2h-file-list-wrapper) {
    display: none;
  }

  .diff-html :global(.d2h-diff-table) {
    font-size: 0.85rem;
    table-layout: fixed;
    width: 100%;
  }

  .diff-html :global(.d2h-code-wrapper),
  .diff-html :global(.d2h-file-diff),
  .diff-html :global(.d2h-file-side-diff) {
    max-width: 100%;
    overflow-x: hidden;
  }

  .diff-html :global(.d2h-code-linenumber),
  .diff-html :global(.d2h-code-side-linenumber) {
    display: table-cell;
    position: static;
    width: clamp(5.25rem, 10vw, 7.5rem);
    min-width: clamp(5.25rem, 10vw, 7.5rem);
    max-width: clamp(5.25rem, 10vw, 7.5rem);
    padding: 0 0.45rem;
    box-sizing: border-box;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    vertical-align: top;
    white-space: nowrap;
    direction: ltr;
  }

  .diff-html :global(.d2h-code-linenumber .line-num1),
  .diff-html :global(.d2h-code-linenumber .line-num2),
  .diff-html :global(.d2h-code-side-linenumber .line-num1),
  .diff-html :global(.d2h-code-side-linenumber .line-num2) {
    float: none;
    display: inline-block;
    width: auto;
    max-width: 100%;
    padding: 0;
  }

  .diff-html :global(.d2h-code-linenumber .line-num1),
  .diff-html :global(.d2h-code-side-linenumber .line-num1) {
    margin-right: 0.35rem;
  }

  .diff-html :global(.d2h-code-line),
  .diff-html :global(.d2h-code-side-line) {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    width: 100%;
    min-width: 0;
    padding: 0 0.45rem;
    box-sizing: border-box;
    white-space: normal !important;
  }

  .diff-html :global(.d2h-code-line-prefix) {
    flex: 0 0 auto;
    white-space: pre;
  }

  .diff-html :global(.d2h-code-line-ctn),
  .diff-html :global(.d2h-code-side-line-ctn) {
    display: block;
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    white-space: pre-wrap !important;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .diff-html :global(.d2h-code-line del),
  .diff-html :global(.d2h-code-line ins),
  .diff-html :global(.d2h-code-side-line del),
  .diff-html :global(.d2h-code-side-line ins) {
    display: inline;
    white-space: inherit;
  }

  .branch-list {
    display: grid;
    gap: 0.4rem;
    max-height: 40vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0.2rem 0;
  }

  .branch-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 0.35rem;
    background: var(--surface);
    color: var(--ink);
    text-align: left;
    font-size: 0.88rem;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .branch-item:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .branch-item:not(:disabled):active {
    background: var(--surface-strong);
  }

  .branch-item.current {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  }

  .branch-current-badge {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.45rem;
    border-radius: 0.2rem;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .branch-create-form {
    display: grid;
    gap: 0.75rem;
  }

  .branch-create-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }

  @media (max-width: 1180px) {
    .diff-card,
    .hunk-card {
      padding: 0.85rem;
    }
  }

  @media (max-width: 540px) {
    .diff-html :global(.d2h-code-linenumber),
    .diff-html :global(.d2h-code-side-linenumber) {
      width: clamp(4.5rem, 15vw, 6rem);
      min-width: clamp(4.5rem, 15vw, 6rem);
      max-width: clamp(4.5rem, 15vw, 6rem);
    }
    .diff-html :global(.line-num1),
    .diff-html :global(.line-num2) {
      font-size: 0.78rem;
    }
  }
</style>
