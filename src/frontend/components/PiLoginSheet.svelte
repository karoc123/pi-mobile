<script lang="ts">
  import type {
    PiAuthProviderState,
    PiAuthStatusResponse,
    PiAuthLoginState,
  } from '../../shared/contracts.js';
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
  let login = $state<PiAuthLoginState | null>(null);
  let answer = $state('');
  let connectionMessage = $state('');
  const selected = $derived(providers.find((entry) => entry.provider === provider));
  const signingIn = $derived(login?.status === 'pending');
  const busy = $derived(submitting || signingIn);
  const streamId = $derived(open && login?.status === 'pending' ? login.id : null);

  async function restoreLogin() {
    try {
      const response = await api.get<{ login: PiAuthLoginState | null }>('/api/pi/auth/oauth');
      login = response.login;
      if (login?.status === 'pending') provider = login.provider;
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
  }

  $effect(() => {
    if (!streamId) return;
    const stream = new EventSource(`/api/pi/auth/oauth/stream?id=${encodeURIComponent(streamId)}`);
    let checkingConnection = false;
    let disposed = false;
    stream.onmessage = (event) => {
      checkingConnection = false;
      connectionMessage = '';
      const next: PiAuthLoginState = JSON.parse(event.data);
      if (next.prompt?.id !== login?.prompt?.id) answer = '';
      login = next;
      if (next.status !== 'pending') {
        stream.close();
        void loadStatus();
      }
    };
    stream.onerror = () => {
      connectionMessage = 'Connection interrupted. Reconnecting to sign-in…';
      if (checkingConnection) return;
      checkingConnection = true;
      void api
        .get<{ login: PiAuthLoginState | null }>('/api/pi/auth/oauth')
        .then((response) => {
          if (disposed) return;
          if (!response.login || response.login.id !== streamId) {
            stream.close();
            login = null;
            errorMessage = 'Sign-in is no longer available. Start again.';
          } else if (response.login.status !== 'pending') {
            login = response.login;
            void loadStatus();
          }
        })
        .catch(() => {});
    };
    return () => {
      disposed = true;
      stream.close();
    };
  });

  async function startLogin(method: 'device_code' | 'browser' = 'device_code') {
    errorMessage = '';
    submitting = true;
    try {
      login = await api.post<PiAuthLoginState>('/api/pi/auth/oauth', { provider, method });
      answer = '';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      submitting = false;
    }
  }

  async function respond() {
    if (!login?.prompt || !answer.trim()) return;
    submitting = true;
    errorMessage = '';
    try {
      await api.post('/api/pi/auth/oauth/respond', {
        id: login.id,
        promptId: login.prompt.id,
        answer,
      });
      answer = '';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      submitting = false;
    }
  }

  async function cancelLogin() {
    if (!login) return;
    submitting = true;
    try {
      login = await api.post<PiAuthLoginState>('/api/pi/auth/oauth/cancel', { id: login.id });
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      submitting = false;
    }
  }

  async function copyCode() {
    if (!login?.userCode) return;
    try {
      await navigator.clipboard.writeText(login.userCode);
      connectionMessage = 'Code copied.';
    } catch {
      connectionMessage = 'Select the code above and copy it with your browser.';
    }
  }

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
      void restoreLogin();
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
      {
        okText: `Pi token for ${selectedProvider} updated.`,
        busy: (busy) => (submitting = busy),
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
      {
        okText: `Pi provider ${selectedProvider} signed out.`,
        busy: (busy) => (submitting = busy),
      },
    );
  }
</script>

<Sheet {open} {onclose} title="Provider sign-in">
  <p class="menu-copy">
    Connect a subscription account or save an API token. Credentials stay in the persistent Pi
    volume.
  </p>

  {#if loading && providers.length === 0}
    <p class="empty-state small">Loading providers…</p>
  {:else if providers.length === 0}
    <p class="empty-state small">No providers available.</p>
  {:else}
    <label class="field-label" for="pi-provider-select">Provider</label>
    <select
      id="pi-provider-select"
      class="text-input"
      bind:value={provider}
      disabled={busy}
      onchange={() => {
        token = '';
        login = null;
        errorMessage = '';
      }}
    >
      {#each providers as entry (entry.provider)}
        <option value={entry.provider}
          >{entry.label}{entry.configured ? ' · configured' : ''}</option
        >
      {/each}
    </select>

    {#if selected?.configured}
      <p class="connection-state">
        Connected{selected.authMethod === 'oauth'
          ? selected.subscription
            ? ' · subscription'
            : ' · account'
          : ' · API credentials'}
      </p>
    {/if}

    {#if selected?.supportsOAuth && !signingIn}
      <div class="menu-insight-actions">
        <button
          class="primary-button"
          type="button"
          onclick={() => startLogin()}
          disabled={submitting}
        >
          {provider === 'openai-codex' ? 'Sign in with ChatGPT' : `Sign in with ${selected.label}`}
        </button>
        {#if provider === 'openai-codex'}
          <button
            class="secondary-button"
            type="button"
            onclick={() => startLogin('browser')}
            disabled={submitting}>Use browser sign-in instead</button
          >
          <p class="menu-copy">
            Device-code sign-in works on phones and remote servers. Enable it in your ChatGPT
            security settings if required.
          </p>
        {/if}
      </div>
    {/if}

    {#if login && login.provider === provider}
      <div class="login-progress" aria-live="polite">
        <p class:notice={login.status !== 'pending'} class:error={login.status === 'failed'}>
          {login.message}
        </p>
        {#if login.userCode}
          <label class="field-label" for="pi-device-code">One-time code</label>
          <input
            id="pi-device-code"
            class="text-input device-code"
            value={login.userCode}
            readonly
          />
          <button class="secondary-button" type="button" onclick={copyCode}>Copy code</button>
        {/if}
        {#if login.url}
          <a
            class="primary-button sign-in-link"
            href={login.url}
            target="_blank"
            rel="noopener noreferrer">Open sign-in page</a
          >
        {/if}
        {#if login.prompt}
          {#if provider === 'openai-codex' && login.prompt.type === 'manual_code'}
            <p class="menu-copy">
              After approval, your browser may show an unreachable localhost page. Copy its entire
              address and paste it below.
            </p>
          {/if}
          <label class="field-label" for="pi-login-answer">{login.prompt.message}</label>
          {#if login.prompt.type === 'select'}
            <select id="pi-login-answer" class="text-input" bind:value={answer}>
              <option value="" disabled>Choose an option</option>
              {#each login.prompt.options ?? [] as option (option.id)}
                <option value={option.id}>{option.label}</option>
              {/each}
            </select>
          {:else}
            <input
              id="pi-login-answer"
              class="text-input"
              type={login.prompt.type === 'secret' ? 'password' : 'text'}
              bind:value={answer}
              placeholder={login.prompt.type === 'manual_code'
                ? 'Paste the complete callback URL'
                : login.prompt.placeholder}
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
          {/if}
          <button
            class="primary-button"
            type="button"
            onclick={respond}
            disabled={submitting || !answer.trim()}>Continue sign-in</button
          >
        {/if}
        {#if signingIn}
          <p class="menu-copy">
            Waiting for confirmation. You can close this sheet and return to the running sign-in.
          </p>
          <button class="secondary-button" type="button" onclick={cancelLogin} disabled={submitting}
            >Cancel sign-in</button
          >
        {/if}
        {#if connectionMessage}<p role="status">{connectionMessage}</p>{/if}
      </div>
    {/if}

    {#if selected?.supportsApiKey !== false}
      <label class="field-label" for="pi-provider-token">API token</label>
      <input
        id="pi-provider-token"
        class="text-input"
        type="password"
        bind:value={token}
        placeholder="Paste token"
        autocapitalize="off"
        spellcheck="false"
        disabled={busy}
      />
    {/if}

    <div class="menu-insight-actions">
      <button class="secondary-button" type="button" onclick={loadStatus} disabled={busy}
        >Refresh</button
      >
      <button
        class="secondary-button"
        type="button"
        onclick={handleLogout}
        disabled={busy || !selected?.configured}>Logout provider</button
      >
      {#if selected?.supportsApiKey !== false}
        <button
          class="primary-button"
          type="button"
          onclick={handleSubmit}
          disabled={busy || token.trim().length === 0 || provider.trim().length === 0}
        >
          {submitting ? 'Saving…' : 'Save token'}
        </button>
      {/if}
    </div>
  {/if}

  {#if errorMessage}
    <p class="notice error">{errorMessage}</p>
  {/if}
</Sheet>

<style>
  .login-progress {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
    overflow-wrap: anywhere;
  }

  .device-code {
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .sign-in-link {
    display: block;
    text-align: center;
    text-decoration: none;
  }

  .connection-state {
    color: var(--text);
  }

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
