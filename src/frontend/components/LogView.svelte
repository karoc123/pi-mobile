<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap, SvelteURLSearchParams } from 'svelte/reactivity';

  import type {
    BackendLogEntry,
    BackendLogLevel,
    BackendLogQueryResponse,
  } from '../../shared/contracts.js';
  import { api, apiFetch, run, toErrorMessage } from '../lib/api.js';

  const maxVisibleLogEntries = 600;

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  let entries = $state<BackendLogEntry[]>([]);
  let loading = $state(false);
  let loadingMore = $state(false);
  let clearing = $state(false);
  let hasMore = $state(false);
  let live = $state(true);
  let streamConnected = $state(false);
  let levelFilter = $state<BackendLogLevel | ''>('');
  let sourceFilter = $state('');
  let searchFilter = $state('');
  let searchDraft = $state('');
  let lastError = $state('');

  const knownSources = $derived(
    [...new Set(entries.map((entry) => entry.source).filter((source) => source.length > 0))].sort(
      (left, right) => left.localeCompare(right),
    ),
  );

  function formatTimestamp(value: string) {
    return dateTimeFormatter.format(new Date(value));
  }

  function formatDetails(details: unknown) {
    if (details === null || details === undefined || details === '') {
      return '';
    }

    if (typeof details === 'string') {
      return details;
    }

    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  }

  function mergeLogEntries(current: BackendLogEntry[], incoming: BackendLogEntry[]) {
    const bySeq = new SvelteMap<number, BackendLogEntry>();

    for (const entry of current) {
      bySeq.set(entry.seq, entry);
    }

    for (const entry of incoming) {
      bySeq.set(entry.seq, entry);
    }

    return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
  }

  async function loadLogs(refresh = false) {
    if (refresh) {
      loading = true;
    } else {
      loadingMore = true;
    }

    try {
      const query = new SvelteURLSearchParams();
      query.set('limit', '200');

      if (!refresh && entries.length > 0) {
        query.set('beforeSeq', String(entries[0].seq));
      }

      if (levelFilter) {
        query.set('level', levelFilter);
      }

      if (sourceFilter) {
        query.set('source', sourceFilter);
      }

      if (searchFilter) {
        query.set('search', searchFilter);
      }

      const response = await apiFetch<BackendLogQueryResponse>(`/api/logs?${query.toString()}`);
      entries = refresh ? response.entries : mergeLogEntries(entries, response.entries);
      entries = entries.slice(-maxVisibleLogEntries);
      hasMore = response.hasMore;
      lastError = '';
    } catch (error) {
      lastError = toErrorMessage(error);
    } finally {
      if (refresh) {
        loading = false;
      } else {
        loadingMore = false;
      }
    }
  }

  function refreshLogs() {
    void loadLogs(true);
  }

  function toggleLive() {
    live = !live;
  }

  async function clearAllLogs() {
    if (clearing) {
      return;
    }

    if (!window.confirm('Delete in-memory and persisted backend logs?')) {
      return;
    }

    await run(
      async () => {
        await api.del('/api/logs');
        entries = [];
        hasMore = false;
        lastError = '';
        await loadLogs(true);
      },
      'Backend log deleted.',
      (busy) => {
        clearing = busy;
      },
    );
  }

  function onLevelChange(event: Event) {
    levelFilter = (event.currentTarget as HTMLSelectElement).value as BackendLogLevel | '';
    void loadLogs(true);
  }

  function onSourceChange(event: Event) {
    sourceFilter = (event.currentTarget as HTMLSelectElement).value;
    void loadLogs(true);
  }

  function applySearch(event?: SubmitEvent) {
    event?.preventDefault();
    searchFilter = searchDraft.trim();
    void loadLogs(true);
  }

  function clearFilters() {
    levelFilter = '';
    sourceFilter = '';
    searchFilter = '';
    searchDraft = '';
    void loadLogs(true);
  }

  async function loadOlderLogs() {
    if (loadingMore || !hasMore) {
      return;
    }

    await loadLogs(false);
  }

  onMount(() => {
    void loadLogs(true);
  });

  $effect(() => {
    if (!live || typeof EventSource === 'undefined') {
      streamConnected = false;
      return;
    }

    const query = new SvelteURLSearchParams();

    if (levelFilter) {
      query.set('level', levelFilter);
    }

    if (sourceFilter) {
      query.set('source', sourceFilter);
    }

    if (searchFilter) {
      query.set('search', searchFilter);
    }

    const streamUrl = query.size > 0 ? `/api/logs/stream?${query.toString()}` : '/api/logs/stream';
    const source = new EventSource(streamUrl, { withCredentials: true });

    source.addEventListener('ready', () => {
      streamConnected = true;
      lastError = '';
    });

    source.addEventListener('log', (event) => {
      try {
        const entry = JSON.parse((event as MessageEvent<string>).data) as BackendLogEntry;
        entries = mergeLogEntries(entries, [entry]).slice(-maxVisibleLogEntries);
      } catch {
        // Ignore malformed stream payloads but keep stream open.
      }
    });

    source.onerror = () => {
      streamConnected = false;
    };

    return () => {
      source.close();
      streamConnected = false;
    };
  });
</script>

<section class="view-shell log-view">
  <div class="top-bar log-header">
    <div>
      <p class="eyebrow">Runtime log</p>
      <h1>Backend activity stream</h1>
      <p class="lede">
        Full structured output from API, runtime lifecycle, watchers, and agent execution.
      </p>
    </div>
    <div class="log-header-actions">
      <button
        class="secondary-button compact"
        type="button"
        onclick={refreshLogs}
        disabled={loading}
      >
        Refresh
      </button>
      <button
        class:selected={live}
        class="secondary-button compact"
        type="button"
        onclick={toggleLive}
      >
        {live ? 'Pause live' : 'Resume live'}
      </button>
      <button
        class="ghost-button compact danger-button"
        type="button"
        onclick={clearAllLogs}
        disabled={clearing}
      >
        {clearing ? 'Deleting log...' : 'Delete complete log'}
      </button>
    </div>
  </div>

  <section class="card-panel log-filter-card">
    <div class="section-header">
      <div>
        <p class="eyebrow">Filters</p>
        <h2>Find incidents quickly</h2>
      </div>
      <button class="ghost-button compact" type="button" onclick={clearFilters}>
        Reset filters
      </button>
    </div>

    <div class="log-filter-grid">
      <label>
        <span class="field-label">Level</span>
        <select class="text-input" value={levelFilter} onchange={onLevelChange}>
          <option value="">All levels</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </label>

      <label>
        <span class="field-label">Source</span>
        <select class="text-input" value={sourceFilter} onchange={onSourceChange}>
          <option value="">All sources</option>
          {#each knownSources as source (source)}
            <option value={source}>{source}</option>
          {/each}
        </select>
      </label>

      <form class="log-search-form" onsubmit={applySearch}>
        <label>
          <span class="field-label">Search</span>
          <input
            class="text-input"
            type="search"
            bind:value={searchDraft}
            placeholder="message, event, repo, request id"
          />
        </label>
        <button class="secondary-button compact" type="submit">Apply</button>
      </form>
    </div>

    <div class="log-meta-row">
      <span class:ok={streamConnected} class:warn={!streamConnected} class="status-pill">
        {streamConnected ? 'Live stream connected' : 'Live stream disconnected'}
      </span>
      <span class="status-pill">{entries.length} visible entries</span>
    </div>

    {#if lastError}
      <div class="notice error">{lastError}</div>
    {/if}
  </section>

  {#if loading && entries.length === 0}
    <div class="empty-state-card compact">
      <h2>Loading backend log...</h2>
      <p>Fetching recent entries from the server log buffer.</p>
    </div>
  {:else if entries.length === 0}
    <div class="empty-state-card compact">
      <h2>No log entries match</h2>
      <p>Try widening the filters or keep live mode enabled while reproducing the issue.</p>
    </div>
  {:else}
    <div class="log-entry-list">
      {#if hasMore}
        <button
          class="secondary-button"
          type="button"
          onclick={loadOlderLogs}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading older entries...' : 'Load older entries'}
        </button>
      {/if}

      {#each entries as entry (entry.seq)}
        <article class={`card-panel log-entry log-level-${entry.level}`}>
          <header>
            <div class="log-entry-title">
              <p class="eyebrow">{entry.level}</p>
              <h2>{entry.message}</h2>
            </div>
            <span class="log-entry-time">{formatTimestamp(entry.timestamp)}</span>
          </header>

          <div class="log-entry-meta">
            <span>source: {entry.source}</span>
            {#if entry.event}
              <span>event: {entry.event}</span>
            {/if}
            {#if entry.repo}
              <span>repo: {entry.repo}</span>
            {/if}
            {#if entry.requestId}
              <span>request: {entry.requestId}</span>
            {/if}
          </div>

          {#if formatDetails(entry.details)}
            <pre>{formatDetails(entry.details)}</pre>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .log-view,
  .log-entry-list {
    display: grid;
    gap: 1rem;
  }

  .log-header {
    align-items: start;
  }

  .log-header-actions {
    display: grid;
    gap: 0.5rem;
  }

  .log-filter-card {
    display: grid;
    gap: 1rem;
  }

  .log-filter-grid {
    display: grid;
    gap: 0.75rem;
  }

  .log-search-form {
    display: grid;
    gap: 0.55rem;
  }

  .log-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .log-entry {
    border-radius: 0.4rem;
    display: grid;
    gap: 0.75rem;
    background: var(--surface);
    border-color: var(--line);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }

  .log-entry header {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .log-entry-title {
    min-width: 0;
  }

  .log-entry-title h2 {
    margin: 0.35rem 0 0;
    font-size: 1rem;
    overflow-wrap: anywhere;
  }

  .log-entry-time {
    color: var(--muted);
    font-size: 0.84rem;
    white-space: nowrap;
  }

  .log-entry-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }

  .log-entry-meta span {
    color: var(--muted);
    font-size: 0.84rem;
    overflow-wrap: anywhere;
  }

  .log-entry pre {
    margin: 0;
    border-radius: 0.22rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    padding: 0.75rem;
    overflow: auto;
    max-height: 16rem;
    font-size: 0.83rem;
  }

  .log-level-debug {
    border-left: 4px solid color-mix(in srgb, var(--muted) 80%, transparent);
  }

  .log-level-info {
    border-left: 4px solid color-mix(in srgb, var(--accent) 80%, transparent);
  }

  .log-level-warn {
    border-left: 4px solid color-mix(in srgb, var(--warning) 90%, transparent);
  }

  .log-level-error {
    border-left: 4px solid color-mix(in srgb, var(--danger) 90%, transparent);
  }

  @media (min-width: 48rem) {
    .log-header {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
    }

    .log-header-actions {
      grid-auto-flow: column;
    }

    .log-filter-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: end;
    }
  }
</style>
