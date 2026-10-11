<script lang="ts">
  import type { PiAuthProviderState, PiAuthStatusResponse } from '../../shared/contracts.js';
  import { api, apiFetch, run, toErrorMessage } from '../lib/api.js';
  import Sheet from './Sheet.svelte';

  interface Props {
    open?: boolean;
    initialProviders?: PiAuthProviderState[];
    onclose?: () => void;
  }

  const { open = false, initialProviders = [], onclose = () => {} }: Props = $props();

  let loading = $state(false);
  let submitting = $state(false);
  let providers = $state<PiAuthProviderState[]>([]);
  let provider = $state('');
  let token = $state('');
  let errorMessage = $state('');

  $effect(() => {
    if (initialProviders.length > 0 && providers.length === 0) {
      providers = initialProviders;
    }
  });

  async function loadStatus() {
    loading = true;
    errorMessage = '';

    try {
      const response = await apiFetch<PiAuthStatusResponse>('/api/pi/auth/status');
      providers = response.providers;
      if (!provider && providers.length > 0) {
        provider = providers[0]?.provider ?? '';
      }
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) {
      void loadStatus();
    }
  });

  $effect(() => {
    if (!provider && providers.length > 0) {
      provider = providers[0]?.provider ?? '';
    }
  });

  async function handleSubmit() {
    const selectedProvider = provider.trim();
    const nextToken = token.trim();

    if (!selectedProvider || !nextToken || submitting) {
      return;
    }

    errorMessage = '';
    await run(
      async () => {
        await api.post('/api/pi/auth/login-token', {
          provider: selectedProvider,
          token: nextToken,
        });
        token = '';
        await loadStatus();
      },
      `Pi token for ${selectedProvider} updated.`,
      (busy) => {
        submitting = busy;
      },
    );
  }

  async function handleLogout() {
    const selectedProvider = provider.trim();

    if (!selectedProvider || submitting) {
      return;
    }

    errorMessage = '';
    await run(
      async () => {
        await api.post('/api/pi/auth/logout', { provider: selectedProvider });
        await loadStatus();
      },
      `Pi provider ${selectedProvider} signed out.`,
      (busy) => {
        submitting = busy;
      },
    );
  }
</script>

<Sheet {open} {onclose} title="Provider token" eyebrow="Pi login">
  <p class="menu-copy">Token is stored in the persistent Pi volume and reused across restarts.</p>

  {#if loading && providers.length === 0}
    <p class="empty-state small">Loading providers…</p>
  {:else if providers.length === 0}
    <p class="empty-state small">No providers available.</p>
  {:else}
    <label class="field-label" for="pi-provider-select">Provider</label>
    <select id="pi-provider-select" class="text-input" bind:value={provider} disabled={submitting}>
      {#each providers as entry (entry.provider)}
        <option value={entry.provider}
          >{entry.label}{entry.configured ? ' · configured' : ''}</option
        >
      {/each}
    </select>

    <label class="field-label" for="pi-provider-token">API token</label>
    <input
      id="pi-provider-token"
      class="text-input"
      type="password"
      bind:value={token}
      placeholder="Paste token"
      autocapitalize="off"
      spellcheck="false"
      disabled={submitting}
    />

    <div class="menu-insight-actions">
      <button class="secondary-button" type="button" onclick={loadStatus} disabled={submitting}
        >Refresh</button
      >
      <button class="secondary-button" type="button" onclick={handleLogout} disabled={submitting}
        >Logout provider</button
      >
      <button
        class="primary-button"
        type="button"
        onclick={handleSubmit}
        disabled={submitting || token.trim().length === 0 || provider.trim().length === 0}
      >
        {submitting ? 'Saving…' : 'Save token'}
      </button>
    </div>
  {/if}

  {#if errorMessage}
    <p class="notice error">{errorMessage}</p>
  {/if}
</Sheet>

<style>
  .menu-copy {
    margin: 0 0 1rem;
    color: var(--muted);
    font-size: 0.88rem;
  }

  .menu-insight-actions {
    display: grid;
    gap: 0.55rem;
    margin-top: 1rem;
  }
</style>
