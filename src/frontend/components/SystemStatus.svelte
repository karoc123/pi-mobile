<script lang="ts">
  import type { BackendResourceCheck, BackendHealthResponse } from '../../shared/contracts.js';
  import { apiFetch } from '../lib/api.js';

  const {
    open = true,
    socketStatus = 'offline',
    reconnectAttempt = 0,
  }: {
    open?: boolean;
    socketStatus?: 'connecting' | 'connected' | 'reconnecting' | 'offline';
    reconnectAttempt?: number;
  } = $props();

  const backendHealthPollIntervalMs = 10_000;

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  let backendStatus = $state<'healthy' | 'degraded' | 'unreachable' | 'unknown'>('unknown');
  let backendLastSeen = $state<string | null>(null);
  let backendUptimeSeconds = $state<number | null>(null);
  let resourceChecks = $state<BackendResourceCheck[]>([]);
  let resourcesAccessible = $state(false);

  const socketLabel = $derived(describeSocketStatus(socketStatus, reconnectAttempt));
  const backendLabel = $derived(
    describeBackendStatus(backendStatus, backendLastSeen, backendUptimeSeconds),
  );
  const resourceLabel = $derived(describeResourceStatus(resourceChecks, resourcesAccessible));
  const resourcePending = $derived(resourceChecks.filter((check) => check.required).length === 0);
  const resourceFailures = $derived(resourceChecks.filter((check) => check.required && !check.ok));

  async function checkBackendHealth() {
    try {
      const health = await apiFetch<BackendHealthResponse>('/api/health');
      backendStatus = health.status;
      backendLastSeen = health.serverTime;
      backendUptimeSeconds = health.uptimeSeconds;
      resourceChecks = health.resources.checks;
      resourcesAccessible = health.resources.allRequiredAccessible;
    } catch {
      backendStatus = 'unreachable';
      resourceChecks = [];
      resourcesAccessible = false;
    }
  }

  $effect(() => {
    if (!open) {
      return;
    }

    void checkBackendHealth();
    const timer = window.setInterval(() => {
      void checkBackendHealth();
    }, backendHealthPollIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  });

  function describeSocketStatus(
    state: 'connecting' | 'connected' | 'reconnecting' | 'offline',
    attempt: number,
  ) {
    if (state === 'connected') {
      return 'Socket connected';
    }

    if (state === 'connecting') {
      return 'Socket connecting';
    }

    if (state === 'reconnecting') {
      return attempt > 0 ? `Socket reconnecting (${attempt})` : 'Socket reconnecting';
    }

    return 'Socket offline';
  }

  function describeBackendStatus(
    state: 'healthy' | 'degraded' | 'unreachable' | 'unknown',
    lastSeen: string | null,
    uptimeSeconds: number | null,
  ) {
    if (state === 'healthy') {
      if (!lastSeen) {
        return 'Backend healthy';
      }

      const uptime = uptimeSeconds !== null ? ` · up ${formatUptime(uptimeSeconds)}` : '';
      return `Backend healthy · seen ${dateTimeFormatter.format(new Date(lastSeen))}${uptime}`;
    }

    if (state === 'degraded') {
      return 'Backend degraded';
    }

    if (state === 'unreachable') {
      return 'Backend unreachable';
    }

    return 'Backend status pending';
  }

  function formatUptime(totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
  }

  function describeResourceStatus(checks: BackendResourceCheck[], allAccessible: boolean) {
    const requiredChecks = checks.filter((check) => check.required);

    if (requiredChecks.length === 0) {
      return 'Resource checks pending';
    }

    if (allAccessible) {
      return `Resources accessible (${requiredChecks.length}/${requiredChecks.length})`;
    }

    const failedCount = requiredChecks.filter((check) => !check.ok).length;
    return `Resources blocked (${failedCount}/${requiredChecks.length})`;
  }
</script>

<section class="system-status card-panel" aria-label="System status">
  <p class="eyebrow">System status</p>
  <div class="system-status-grid">
    <span
      class:ok={socketStatus === 'connected'}
      class:warn={socketStatus === 'connecting' || socketStatus === 'reconnecting'}
      class:error={socketStatus === 'offline'}
      class="status-chip">{socketLabel}</span
    >
    <span
      class:ok={backendStatus === 'healthy'}
      class:warn={backendStatus === 'degraded' || backendStatus === 'unknown'}
      class:error={backendStatus === 'unreachable'}
      class="status-chip">{backendLabel}</span
    >
    <span
      class:ok={resourcesAccessible && !resourcePending}
      class:warn={resourcePending}
      class:error={!resourcePending && !resourcesAccessible}
      class="status-chip">{resourceLabel}</span
    >
  </div>

  {#if resourceFailures.length > 0}
    <div class="system-status-failures">
      {#each resourceFailures as failure (failure.key)}
        <p>
          {failure.label}: {failure.path}{failure.detail ? ` (${failure.detail})` : ''}
        </p>
      {/each}
    </div>
  {/if}
</section>

<style>
  .system-status {
    display: grid;
    gap: 0.75rem;
    border-radius: 0.4rem;
    background: var(--surface);
    border-color: var(--line);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }

  .system-status .eyebrow {
    color: var(--muted);
  }

  .system-status-grid {
    display: grid;
    gap: 0.55rem;
  }

  .system-status-failures {
    display: grid;
    gap: 0.35rem;
  }

  .system-status-failures p {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .status-chip {
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    padding: 0.45rem 0.75rem;
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }

  .status-chip.ok {
    border-color: color-mix(in srgb, var(--success) 55%, var(--line));
  }

  .status-chip.warn {
    border-color: color-mix(in srgb, var(--warning) 55%, var(--line));
  }

  .status-chip.error {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--line));
  }

  @media (min-width: 48rem) {
    .system-status-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
