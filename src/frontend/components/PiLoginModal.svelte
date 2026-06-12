<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { PiAuthProviderState } from '../../../src/shared/contracts.js';

  export let open = false;
  export let loading = false;
  export let submitting = false;
  export let providers: PiAuthProviderState[] = [];
  export let errorMessage = '';

  let provider = '';
  let token = '';

  $: if (open && !provider && providers.length > 0) {
    provider = providers[0]?.provider ?? '';
  }

  const dispatch = createEventDispatcher<{
    close: void;
    refresh: void;
    submit: { provider: string; token: string };
    logout: { provider: string };
  }>();

  function handleSubmit() {
    const selectedProvider = provider.trim();
    const nextToken = token.trim();

    if (!selectedProvider || !nextToken) {
      return;
    }

    dispatch('submit', {
      provider: selectedProvider,
      token: nextToken,
    });
  }

  function handleLogout() {
    const selectedProvider = provider.trim();

    if (!selectedProvider) {
      return;
    }

    dispatch('logout', { provider: selectedProvider });
  }
</script>

{#if open}
  <div class="overlay" role="presentation" on:click={() => dispatch('close')}>
    <section class="sheet-card" role="dialog" aria-modal="true" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="sheet-header">
        <div>
          <p class="eyebrow">Pi login</p>
          <h2>Provider token</h2>
        </div>
        <button class="ghost-button" type="button" on:click={() => dispatch('close')}>Close</button>
      </div>

      <p class="menu-copy">Token is stored in the persistent Pi volume and reused across restarts.</p>

      {#if loading}
        <p class="empty-state small">Loading providers…</p>
      {:else if providers.length === 0}
        <p class="empty-state small">No providers available.</p>
      {:else}
        <label class="field-label" for="pi-provider-select">Provider</label>
        <select id="pi-provider-select" class="text-input" bind:value={provider} disabled={submitting}>
          {#each providers as entry}
            <option value={entry.provider}>{entry.label}{entry.configured ? ' · configured' : ''}</option>
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
          <button class="secondary-button" type="button" on:click={() => dispatch('refresh')} disabled={submitting}>Refresh</button>
          <button class="secondary-button" type="button" on:click={handleLogout} disabled={submitting}>Logout provider</button>
          <button class="primary-button" type="button" on:click={handleSubmit} disabled={submitting || token.trim().length === 0 || provider.trim().length === 0}>
            {submitting ? 'Saving…' : 'Save token'}
          </button>
        </div>
      {/if}

      {#if errorMessage}
        <p class="notice error">{errorMessage}</p>
      {/if}
    </section>
  </div>
{/if}
