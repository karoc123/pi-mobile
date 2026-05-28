<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { CostReport } from '../../../src/shared/contracts.js';
  import { formatCompactTokenCount } from '../lib/agent-usage.js';

  export type CostRangePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

  export let report: CostReport;
  export let loading = false;
  export let selectedRepo = '';
  export let selectedModel = '';
  export let fromDate = '';
  export let toDate = '';
  export let selectedPreset: CostRangePreset = 'all';

  const dispatch = createEventDispatcher<{
    refresh: void;
    setRepo: { value: string };
    setModel: { value: string };
    setFrom: { value: string };
    setTo: { value: string };
    applyPreset: { value: Exclude<CostRangePreset, 'custom'> };
  }>();

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });

  function formatDateTime(value: string | null) {
    if (!value) {
      return 'Open session';
    }

    return dateTimeFormatter.format(new Date(value));
  }

  function formatCurrency(value: number) {
    return currencyFormatter.format(value);
  }

  function formatModels(modelsUsed: string[], modelId: string | null) {
    if (modelsUsed.length > 0) {
      return modelsUsed.join(' · ');
    }

    return modelId ?? 'Unknown model';
  }

  function formatTokenLine(inputTokens: number, outputTokens: number, cacheTokens: number) {
    const parts = [`↑${formatCompactTokenCount(inputTokens)}`, `↓${formatCompactTokenCount(outputTokens)}`];

    if (cacheTokens > 0) {
      parts.push(`cache ${formatCompactTokenCount(cacheTokens)}`);
    }

    return parts.join(' ');
  }
</script>

<section class="view-shell cost-view">
  <div class="top-bar cost-header">
    <div>
      <p class="eyebrow">Cost overview</p>
      <h1>Pi session costs</h1>
      <p class="lede">Persistent per-session costs across all tracked repositories.</p>
    </div>
    <button class="secondary-button compact" type="button" on:click={() => dispatch('refresh')} disabled={loading}>Refresh</button>
  </div>

  <section class="cost-summary-grid">
    <article class="card-panel cost-metric-card">
      <p class="eyebrow">Total cost</p>
      <strong>{formatCurrency(report.summary.totalCost)}</strong>
      <span>Across {report.summary.totalSessions} sessions</span>
    </article>
    <article class="card-panel cost-metric-card">
      <p class="eyebrow">Total tokens</p>
      <strong>{formatCompactTokenCount(report.summary.totalTokens)}</strong>
      <span>{formatTokenLine(report.summary.inputTokens, report.summary.outputTokens, report.summary.cacheReadTokens + report.summary.cacheWriteTokens)}</span>
    </article>
    <article class="card-panel cost-metric-card">
      <p class="eyebrow">Prompt tokens</p>
      <strong>{formatCompactTokenCount(report.summary.inputTokens)}</strong>
      <span>Assistant: {formatCompactTokenCount(report.summary.outputTokens)}</span>
    </article>
    <article class="card-panel cost-metric-card">
      <p class="eyebrow">Cache tokens</p>
      <strong>{formatCompactTokenCount(report.summary.cacheReadTokens + report.summary.cacheWriteTokens)}</strong>
      <span>Read {formatCompactTokenCount(report.summary.cacheReadTokens)} · Write {formatCompactTokenCount(report.summary.cacheWriteTokens)}</span>
    </article>
  </section>

  <section class="card-panel cost-filter-card">
    <div class="section-header">
      <div>
        <p class="eyebrow">Filters</p>
        <h2>Slice the history</h2>
      </div>
    </div>

    <div class="cost-filter-grid">
      <label>
        <span class="field-label">Repository</span>
        <select class="text-input" value={selectedRepo} on:change={(event) => dispatch('setRepo', { value: (event.currentTarget as HTMLSelectElement).value })}>
          <option value="">All repositories</option>
          {#each report.filters.repos as repo}
            <option value={repo.value}>{repo.label}</option>
          {/each}
        </select>
      </label>

      <label>
        <span class="field-label">Model</span>
        <select class="text-input" value={selectedModel} on:change={(event) => dispatch('setModel', { value: (event.currentTarget as HTMLSelectElement).value })}>
          <option value="">All models</option>
          {#each report.filters.models as model}
            <option value={model.value}>{model.label}</option>
          {/each}
        </select>
      </label>

      <label>
        <span class="field-label">From</span>
        <input class="text-input" type="date" value={fromDate} on:change={(event) => dispatch('setFrom', { value: (event.currentTarget as HTMLInputElement).value })} />
      </label>

      <label>
        <span class="field-label">To</span>
        <input class="text-input" type="date" value={toDate} on:change={(event) => dispatch('setTo', { value: (event.currentTarget as HTMLInputElement).value })} />
      </label>
    </div>

    <div class="cost-preset-row" role="group" aria-label="Cost range presets">
      {#each ['7d', '30d', '90d', 'all'] as preset}
        <button
          class:selected={selectedPreset === preset}
          class="cost-preset"
          type="button"
          on:click={() => dispatch('applyPreset', { value: preset as Exclude<CostRangePreset, 'custom'> })}
        >
          {preset === 'all' ? 'All' : preset.toUpperCase()}
        </button>
      {/each}
    </div>
  </section>

  {#if loading}
    <div class="empty-state-card compact">
      <h2>Loading cost data...</h2>
      <p>The aggregated session history is being refreshed.</p>
    </div>
  {:else if report.sessions.length === 0}
    <div class="empty-state-card compact">
      <h2>No tracked costs yet</h2>
      <p>Start an agent session and send a prompt to persist the first cost entry.</p>
    </div>
  {:else}
    <div class="cost-session-list">
      {#each report.sessions as session}
        <article class="card-panel cost-session-card">
          <header>
            <div>
              <p class="eyebrow">{session.repoName}</p>
              <h2>{formatModels(session.modelsUsed, session.modelId)}</h2>
            </div>
            <strong class="cost-session-total">{formatCurrency(session.totalCost)}</strong>
          </header>

          <div class="cost-session-meta">
            <span>{formatTokenLine(session.inputTokens, session.outputTokens, session.cacheReadTokens + session.cacheWriteTokens)}</span>
            <span>{formatCompactTokenCount(session.totalTokens)} total</span>
            <span>{session.usingSubscription ? 'Subscription' : 'Direct billing'}</span>
            <span>{session.autoCompactEnabled ? 'Auto compact on' : 'Auto compact off'}</span>
          </div>

          <div class="cost-session-timeline">
            <span>Started {formatDateTime(session.startedAt)}</span>
            <span>{session.endedAt ? `Ended ${formatDateTime(session.endedAt)}` : `Updated ${formatDateTime(session.updatedAt)}`}</span>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>