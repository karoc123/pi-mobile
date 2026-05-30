<script lang="ts">
  export let authStatus: "authenticated" | "expired" = "authenticated";
  export let socketStatus: "connecting" | "connected" | "reconnecting" | "offline" = "offline";
  export let reconnectAttempt = 0;
  export let backendStatus: "healthy" | "degraded" | "unreachable" | "unknown" = "unknown";
  export let backendLastSeen: string | null = null;
  export let backendUptimeSeconds: number | null = null;
  export let logStreamLive = false;

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });

  $: authLabel = authStatus === "authenticated" ? "Session active" : "Session expired";
  $: socketLabel = describeSocketStatus(socketStatus, reconnectAttempt);
  $: backendLabel = describeBackendStatus(backendStatus, backendLastSeen, backendUptimeSeconds);
  $: logLabel = logStreamLive ? "Log stream live" : "Log stream idle";

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
</script>

<section class="system-status card-panel" aria-label="System status">
  <p class="eyebrow">System status</p>
  <div class="system-status-grid">
    <span class:ok={authStatus === 'authenticated'} class:error={authStatus === 'expired'} class="status-chip">{authLabel}</span>
    <span class:ok={socketStatus === 'connected'} class:warn={socketStatus === 'connecting' || socketStatus === 'reconnecting'} class:error={socketStatus === 'offline'} class="status-chip">{socketLabel}</span>
    <span class:ok={backendStatus === 'healthy'} class:warn={backendStatus === 'degraded' || backendStatus === 'unknown'} class:error={backendStatus === 'unreachable'} class="status-chip">{backendLabel}</span>
    <span class:ok={logStreamLive} class="status-chip">{logLabel}</span>
  </div>
</section>
