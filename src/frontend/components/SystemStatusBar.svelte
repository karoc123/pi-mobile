<script lang="ts">
  import type { BackendResourceCheck } from "../../../src/shared/contracts.js";

  export let authStatus: "authenticated" | "expired" = "authenticated";
  export let socketStatus: "connecting" | "connected" | "reconnecting" | "offline" = "offline";
  export let reconnectAttempt = 0;
  export let backendStatus: "healthy" | "degraded" | "unreachable" | "unknown" = "unknown";
  export let backendLastSeen: string | null = null;
  export let backendUptimeSeconds: number | null = null;
  export let logStreamLive = false;
  export let resourcesAccessible = false;
  export let resourceChecks: BackendResourceCheck[] = [];

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });

  $: authLabel = authStatus === "authenticated" ? "Session active" : "Session expired";
  $: socketLabel = describeSocketStatus(socketStatus, reconnectAttempt);
  $: backendLabel = describeBackendStatus(backendStatus, backendLastSeen, backendUptimeSeconds);
  $: logLabel = logStreamLive ? "Log stream live" : "Log stream idle";
  $: resourceLabel = describeResourceStatus(resourceChecks, resourcesAccessible);
  $: resourcePending = resourceChecks.filter((check) => check.required).length === 0;
  $: resourceFailures = resourceChecks.filter((check) => check.required && !check.ok);

  function describeSocketStatus(state: "connecting" | "connected" | "reconnecting" | "offline", attempt: number) {
    if (state === "connected") {
      return "Socket connected";
    }

    if (state === "connecting") {
      return "Socket connecting";
    }

    if (state === "reconnecting") {
      return attempt > 0 ? `Socket reconnecting (${attempt})` : "Socket reconnecting";
    }

    return "Socket offline";
  }

  function describeBackendStatus(
    state: "healthy" | "degraded" | "unreachable" | "unknown",
    lastSeen: string | null,
    uptimeSeconds: number | null,
  ) {
    if (state === "healthy") {
      if (!lastSeen) {
        return "Backend healthy";
      }

      const uptime = uptimeSeconds !== null ? ` · up ${formatUptime(uptimeSeconds)}` : "";
      return `Backend healthy · seen ${dateTimeFormatter.format(new Date(lastSeen))}${uptime}`;
    }

    if (state === "degraded") {
      return "Backend degraded";
    }

    if (state === "unreachable") {
      return "Backend unreachable";
    }

    return "Backend status pending";
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
      return "Resource checks pending";
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
    <span class:ok={authStatus === 'authenticated'} class:error={authStatus === 'expired'} class="status-chip">{authLabel}</span>
    <span class:ok={socketStatus === 'connected'} class:warn={socketStatus === 'connecting' || socketStatus === 'reconnecting'} class:error={socketStatus === 'offline'} class="status-chip">{socketLabel}</span>
    <span class:ok={backendStatus === 'healthy'} class:warn={backendStatus === 'degraded' || backendStatus === 'unknown'} class:error={backendStatus === 'unreachable'} class="status-chip">{backendLabel}</span>
    <span class:ok={logStreamLive} class="status-chip">{logLabel}</span>
    <span class:ok={resourcesAccessible && !resourcePending} class:warn={resourcePending} class:error={!resourcePending && !resourcesAccessible} class="status-chip">{resourceLabel}</span>
  </div>

  {#if resourceFailures.length > 0}
    <div class="system-status-failures">
      {#each resourceFailures as failure (failure.key)}
        <p>
          {failure.label}: {failure.path}{failure.detail ? ` (${failure.detail})` : ""}
        </p>
      {/each}
    </div>
  {/if}
</section>
