<script lang="ts">
  import { untrack } from 'svelte';
  import type {
    SelectedRepo,
    WorkspaceCloneResult,
    WorkspaceEntry,
  } from '../../shared/contracts.js';
  import { api, apiFetch, run, toErrorMessage } from '../lib/api.js';
  import Sheet from './Sheet.svelte';

  interface Props {
    open?: boolean;
    currentRepo?: SelectedRepo | null;
    onclose?: () => void;
    onselect?: (repo: SelectedRepo) => void;
  }

  const {
    open = false,
    currentRepo = null,
    onclose = () => {},
    onselect = () => {},
  }: Props = $props();

  let currentPath = $state('.');
  let loading = $state(false);
  let cloning = $state(false);
  let remoteUrl = $state('');
  let destinationPath = $state('');
  let entries = $state<WorkspaceEntry[]>([]);
  let errorMessage = $state('');

  async function loadWorkspaces(path: string) {
    loading = true;
    errorMessage = '';

    try {
      const response = await apiFetch<{
        currentPath: string;
        entries: WorkspaceEntry[];
        currentRepo: SelectedRepo | null;
      }>(`/api/workspaces/browse?path=${encodeURIComponent(path)}`);

      currentPath = response.currentPath;
      entries = response.entries;
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) {
      untrack(() => void loadWorkspaces(currentPath));
    }
  });

  function parentPath(pathValue: string) {
    if (pathValue === '.' || pathValue.length === 0) {
      return '.';
    }

    const parts = pathValue.split('/').filter(Boolean);
    parts.pop();
    return parts.length === 0 ? '.' : parts.join('/');
  }

  function browseUp() {
    void loadWorkspaces(parentPath(currentPath));
  }

  function browsePath(path: string) {
    void loadWorkspaces(path);
  }

  async function handleSelect(path: string) {
    await run(
      async () => {
        const response = await api.post<{ repo: SelectedRepo }>('/api/workspaces/select', { path });
        onselect(response.repo);
        onclose();
      },
      { okText: 'Repository activated.' },
    );
  }

  async function submitClone(event?: SubmitEvent) {
    event?.preventDefault();
    const trimmedRemoteUrl = remoteUrl.trim();

    if (!trimmedRemoteUrl || cloning) {
      return;
    }

    const trimmedDestinationPath = destinationPath.trim();

    await run(
      async () => {
        const response = await api.post<WorkspaceCloneResult>('/api/workspaces/clone', {
          remoteUrl: trimmedRemoteUrl,
          destinationPath: trimmedDestinationPath.length > 0 ? trimmedDestinationPath : undefined,
        });

        remoteUrl = '';
        destinationPath = '';
        onselect(response.repo);
        onclose();
        return response;
      },
      {
        okText: (res) => `Repository cloned and activated (${res.repo.name}).`,
        busy: (busy) => (cloning = busy),
      },
    );
  }
</script>

<Sheet
  {open}
  {onclose}
  title={currentPath === '.' ? 'Workspace root' : currentPath}
  eyebrow="Repository picker"
>
  <form class="workspace-clone-form" onsubmit={submitClone}>
    <label class="field-label" for="clone-remote-url">Clone repository URL / SSH target</label>
    <input
      id="clone-remote-url"
      class="text-input"
      type="text"
      bind:value={remoteUrl}
      placeholder="git@github.com:owner/repo.git"
      autocapitalize="off"
      spellcheck="false"
      disabled={cloning}
    />

    <label class="field-label" for="clone-destination">Target folder (optional)</label>
    <input
      id="clone-destination"
      class="text-input"
      type="text"
      bind:value={destinationPath}
      placeholder={currentPath === '.' ? 'repo-name' : `${currentPath}/repo-name`}
      autocapitalize="off"
      spellcheck="false"
      disabled={cloning}
    />

    <button
      class="primary-button compact"
      type="submit"
      disabled={cloning || remoteUrl.trim().length === 0}
    >
      {cloning ? 'Cloning…' : 'Clone And Activate'}
    </button>
  </form>

  {#if currentPath !== '.'}
    <button class="path-button" type="button" onclick={browseUp}> Up one level </button>
  {/if}

  <div class="picker-list">
    {#if loading && entries.length === 0}
      <p class="empty-state small">Loading folders...</p>
    {:else if entries.length === 0}
      <p class="empty-state small">No directories found at this level.</p>
    {:else}
      {#each entries as entry (entry.relativePath)}
        <article class="picker-entry">
          <button class="entry-main" type="button" onclick={() => browsePath(entry.relativePath)}>
            <strong>{entry.name}</strong>
            <span>{entry.isGitRepo ? 'Git repository available' : 'Browse deeper'}</span>
          </button>
          {#if entry.isGitRepo}
            <button
              class="primary-button compact"
              type="button"
              onclick={() => handleSelect(entry.relativePath)}
            >
              {currentRepo?.relativePath === entry.relativePath ? 'Active' : 'Use repo'}
            </button>
          {/if}
        </article>
      {/each}
    {/if}
  </div>

  {#if errorMessage}
    <p class="notice error">{errorMessage}</p>
  {/if}
</Sheet>

<style>
  .workspace-clone-form {
    display: grid;
    gap: 0.55rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }

  .path-button {
    width: 100%;
    margin-bottom: 0.75rem;
    padding: 0.6rem 0.8rem;
    text-align: left;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    border-radius: 0.35rem;
    cursor: pointer;
  }

  .picker-list {
    display: grid;
    gap: 0.55rem;
    max-height: 45vh;
    overflow-y: auto;
  }

  .picker-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: var(--surface);
  }

  .entry-main {
    display: grid;
    gap: 0.2rem;
    background: transparent;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: var(--ink);
    flex: 1;
    min-width: 0;
  }

  .entry-main strong {
    font-size: 0.95rem;
    overflow-wrap: anywhere;
  }

  .entry-main span {
    font-size: 0.82rem;
    color: var(--muted);
  }
</style>
