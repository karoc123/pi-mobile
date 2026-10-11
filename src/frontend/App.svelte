<script lang="ts">
  import { onMount } from 'svelte';

  import type { SelectedRepo, SessionResponse } from '../shared/contracts.js';
  import type { ThemeName } from './components/AppMenu.svelte';
  import LoginScreen from './components/LoginScreen.svelte';
  import Workspace from './components/Workspace.svelte';
  import { apiFetch, setUnauthorizedHandler, toErrorMessage } from './lib/api.js';
  import { toast } from './lib/toast.svelte.js';

  const themeStorageKey = 'pimobile.theme';

  let authChecked = $state(false);
  let authenticated = $state(false);
  let currentRepo = $state<SelectedRepo | null>(null);
  let theme = $state<ThemeName>('vscode-dark');

  onMount(() => {
    initializeTheme();
    void checkSession();
  });

  setUnauthorizedHandler(() => {
    authenticated = false;
    currentRepo = null;
    toast.show('Session expired. Please sign in again.', 'error');
  });

  async function checkSession() {
    try {
      const session = await apiFetch<SessionResponse>('/api/auth/session');
      authChecked = true;
      authenticated = session.authenticated;
      currentRepo = session.repo;
    } catch (error) {
      authChecked = true;
      authenticated = false;
      currentRepo = null;
      toast.show(toErrorMessage(error), 'error');
    }
  }

  function initializeTheme() {
    const storedTheme = window.localStorage.getItem(themeStorageKey);

    if (storedTheme === 'vscode-dark' || storedTheme === 'vscode-light') {
      setTheme(storedTheme, false);
      return;
    }

    setTheme(
      window.matchMedia('(prefers-color-scheme: light)').matches ? 'vscode-light' : 'vscode-dark',
      false,
    );
  }

  function setTheme(nextTheme: ThemeName, persist = true) {
    theme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;

    if (persist) {
      window.localStorage.setItem(themeStorageKey, nextTheme);
    }
  }
</script>

{#if !authChecked}
  <main class="app-shell loading-shell">
    <div class="hero-card pulse">
      <p class="eyebrow">PiMobile</p>
      <h1>Preparing workspace...</h1>
    </div>
  </main>
{:else if !authenticated}
  <LoginScreen
    onLogin={(session) => {
      currentRepo = session.repo;
      authenticated = session.authenticated;
    }}
  />
{:else}
  <Workspace
    initialRepo={currentRepo}
    {theme}
    onsetTheme={setTheme}
    onlogout={() => {
      authenticated = false;
      currentRepo = null;
    }}
  />
{/if}
