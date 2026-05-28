<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let pending = false;
  export let error = '';

  const dispatch = createEventDispatcher<{ submit: { password: string } }>();

  let password = '';

  function submit() {
    dispatch('submit', { password });
  }
</script>

<section class="login-screen">
  <div class="login-card">
    <p class="eyebrow">PiMobile kickoff</p>
    <h1>Mobile Git cockpit for your local repos</h1>
    <p class="lede">Authenticate once, pick a repository below your configured workspace root, and drive chat, diffs, and edits from one touch-first surface.</p>

    <label class="field-label" for="password">App password</label>
    <input
      id="password"
      class="text-input"
      type="password"
      bind:value={password}
      placeholder="Enter APP_PASSWORD"
      autocomplete="current-password"
      on:keydown={(event) => event.key === 'Enter' && submit()}
      disabled={pending}
    />

    {#if error}
      <p class="inline-error">{error}</p>
    {/if}

    <button class="primary-button" type="button" on:click={submit} disabled={pending || password.trim().length === 0}>
      {pending ? 'Signing in...' : 'Unlock workspace'}
    </button>
  </div>
</section>