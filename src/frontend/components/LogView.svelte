<script lang="ts">
  import { createEventDispatcher } from "svelte";

  import type { BackendLogEntry, BackendLogLevel } from "../../../src/shared/contracts.js";

  export let entries: BackendLogEntry[] = [];
  export let loading = false;
  export let loadingMore = false;
  export let clearing = false;
  export let hasMore = false;
  export let live = true;
  export let streamConnected = false;
  export let levelFilter: BackendLogLevel | "" = "";
  export let sourceFilter = "";
  export let searchFilter = "";
  export let knownSources: string[] = [];
  export let lastError = "";

  const dispatch = createEventDispatcher<{
    refresh: void;
    loadMore: void;
    clearAll: void;
    toggleLive: { value: boolean };
    setLevel: { value: BackendLogLevel | "" };
    setSource: { value: string };
    setSearch: { value: string };
    clearFilters: void;
  }>();

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });

  let searchDraft = searchFilter;

  $: if (searchFilter !== searchDraft) {
    searchDraft = searchFilter;
  }

  function formatTimestamp(value: string) {
    return dateTimeFormatter.format(new Date(value));
  }

  function formatDetails(details: unknown) {
    if (details === null || details === undefined || details === "") {
      return "";
    }

    if (typeof details === "string") {
      return details;
    }

    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  }

  function applySearch() {
    dispatch("setSearch", { value: searchDraft.trim() });
  }
</script>

<section class="view-shell log-view">
  <div class="top-bar log-header">
    <div>
      <p class="eyebrow">Runtime log</p>
      <h1>Backend activity stream</h1>
      <p class="lede">Full structured output from API, runtime lifecycle, watchers, and agent execution.</p>
    </div>
    <div class="log-header-actions">
      <button class="secondary-button compact" type="button" on:click={() => dispatch("refresh")} disabled={loading}>Refresh</button>
      <button class:selected={live} class="secondary-button compact" type="button" on:click={() => dispatch("toggleLive", { value: !live })}>
        {live ? "Pause live" : "Resume live"}
      </button>
      <button class="ghost-button compact danger-button" type="button" on:click={() => dispatch("clearAll")} disabled={clearing}>
        {clearing ? "Deleting log..." : "Delete complete log"}
      </button>
    </div>
  </div>

  <section class="card-panel log-filter-card">
    <div class="section-header">
      <div>
        <p class="eyebrow">Filters</p>
        <h2>Find incidents quickly</h2>
      </div>
      <button class="ghost-button compact" type="button" on:click={() => dispatch("clearFilters")}>Reset filters</button>
    </div>

    <div class="log-filter-grid">
      <label>
        <span class="field-label">Level</span>
        <select class="text-input" value={levelFilter} on:change={(event) => dispatch("setLevel", { value: (event.currentTarget as HTMLSelectElement).value as BackendLogLevel | "" })}>
          <option value="">All levels</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </label>

      <label>
        <span class="field-label">Source</span>
        <select class="text-input" value={sourceFilter} on:change={(event) => dispatch("setSource", { value: (event.currentTarget as HTMLSelectElement).value })}>
          <option value="">All sources</option>
          {#each knownSources as source}
            <option value={source}>{source}</option>
          {/each}
        </select>
      </label>

      <form class="log-search-form" on:submit|preventDefault={applySearch}>
        <label>
          <span class="field-label">Search</span>
          <input class="text-input" type="search" bind:value={searchDraft} placeholder="message, event, repo, request id" />
        </label>
        <button class="secondary-button compact" type="submit">Apply</button>
      </form>
    </div>

    <div class="log-meta-row">
      <span class:ok={streamConnected} class:warn={!streamConnected} class="status-pill">{streamConnected ? "Live stream connected" : "Live stream disconnected"}</span>
      <span class="status-pill">{entries.length} visible entries</span>
    </div>

    {#if lastError}
      <div class="notice error">{lastError}</div>
    {/if}
  </section>

  {#if loading}
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
        <button class="secondary-button" type="button" on:click={() => dispatch("loadMore")} disabled={loadingMore}>
          {loadingMore ? "Loading older entries..." : "Load older entries"}
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
