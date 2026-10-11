<script lang="ts">
  import type { SessionResponse } from '../../shared/contracts.js';
  import { apiFetch, toErrorMessage } from '../lib/api.js';

  interface Props {
    initialError?: string;
    onLogin: (session: SessionResponse) => Promise<void> | void;
  }

  const { initialError = '', onLogin }: Props = $props();

  let password = $state('');
  let pending = $state(false);
  let errorMessage = $state('');

  $effect(() => {
    if (initialError) {
      errorMessage = initialError;
    }
  });

  async function submit() {
    const trimmed = password.trim();
    if (!trimmed || pending) {
      return;
    }

    pending = true;
    errorMessage = '';

    try {
      const session = await apiFetch<SessionResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: trimmed }),
      });
      await onLogin(session);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      pending = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      void submit();
    }
  }
</script>

<section class="login-screen">
  <div class="login-card">
    <p class="eyebrow">PiMobile kickoff</p>
    <h1>Mobile Git cockpit for your local repos</h1>
    <p class="lede">
      Authenticate once, pick a repository below your configured workspace root, and drive chat,
      diffs, and edits from one touch-first surface.
    </p>

    <label class="field-label" for="password">App password</label>
    <input
      id="password"
      class="text-input"
      type="password"
      bind:value={password}
      placeholder="Enter APP_PASSWORD"
      autocomplete="current-password"
      onkeydown={handleKeydown}
      disabled={pending}
    />

    {#if errorMessage}
      <p class="inline-error">{errorMessage}</p>
    {/if}

    <button
      class="primary-button"
      type="button"
      onclick={submit}
      disabled={pending || password.trim().length === 0}
    >
      {pending ? 'Signing in...' : 'Unlock workspace'}
    </button>
  </div>
</section>

<style>
  .login-screen {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 1.25rem;
  }

  .login-card {
    border: 1px solid var(--line);
    background: var(--surface);
    width: min(100%, 34rem);
    padding: 1.5rem;
    border-radius: 0.75rem;
    display: grid;
    gap: 0.75rem;
  }

  .login-card h1 {
    margin: 0.5rem 0 0.75rem;
    line-height: 0.96;
  }

  .inline-error {
    color: var(--danger);
    font-size: 0.88rem;
    margin: 0;
  }
</style>
