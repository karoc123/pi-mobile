<script module lang="ts">
  export type ThemeName = 'vscode-dark' | 'vscode-light';
</script>

<script lang="ts">
  import type { SelectedRepo } from '../../shared/contracts.js';
  import { api, run } from '../lib/api.js';
  import Sheet from './Sheet.svelte';

  interface Props {
    open?: boolean;
    currentRepo?: SelectedRepo | null;
    theme?: ThemeName;
    onclose?: () => void;
    onchooseRepo?: () => void;
    onopenLogs?: () => void;
    onopenPiLogin?: () => void;
    onsetTheme?: (value: ThemeName) => void;
    onlogout?: () => void;
  }

  const {
    open = false,
    currentRepo = null,
    theme = 'vscode-dark',
    onclose = () => {},
    onchooseRepo = () => {},
    onopenLogs = () => {},
    onopenPiLogin = () => {},
    onsetTheme = () => {},
    onlogout = () => {},
  }: Props = $props();

  async function handleLogout() {
    try {
      await run(() => api.post('/api/auth/logout'));
    } finally {
      onlogout();
    }
  }
</script>

<Sheet {open} {onclose} ariaLabel="App menu">
  <div class="sheet-header">
    <div>
      <p class="eyebrow">Workspace menu</p>
      <h2>{currentRepo ? currentRepo.name : 'PiMobile'}</h2>
    </div>
    <button class="ghost-button" type="button" onclick={onclose}>Close</button>
  </div>

  <section class="menu-section">
    <p class="eyebrow">Repository</p>
    <p class="menu-copy">
      {currentRepo
        ? currentRepo.relativePath
        : 'No repository selected yet. Pick one below your configured workspace root.'}
    </p>
    <button class="secondary-button" type="button" onclick={onchooseRepo}> Choose repo </button>
  </section>

  <section class="menu-section">
    <p class="eyebrow">Theme</p>
    <div class="theme-toggle-group" role="group" aria-label="Theme switcher">
      <button
        class:selected={theme === 'vscode-dark'}
        class="theme-toggle"
        type="button"
        onclick={() => onsetTheme('vscode-dark')}
      >
        VS Code Dark
      </button>
      <button
        class:selected={theme === 'vscode-light'}
        class="theme-toggle"
        type="button"
        onclick={() => onsetTheme('vscode-light')}
      >
        VS Code Light
      </button>
    </div>
  </section>

  <section class="menu-section">
    <p class="eyebrow">Insights</p>
    <p class="menu-copy">Inspect the live backend log stream to debug runtime activity.</p>
    <div class="menu-insight-actions">
      <button class="secondary-button" type="button" onclick={onopenLogs}> Open log </button>
    </div>
  </section>

  <section class="menu-section">
    <p class="eyebrow">Session</p>
    <div class="menu-insight-actions">
      <button class="secondary-button" type="button" onclick={onopenPiLogin}> Pi Login </button>
      <button class="ghost-button danger-button" type="button" onclick={handleLogout}>
        Logout
      </button>
    </div>
  </section>
</Sheet>

<style>
  .sheet-header {
    margin-bottom: 0.75rem;
  }

  .sheet-header h2 {
    margin: 0.2rem 0 0;
  }

  .menu-section {
    display: grid;
    gap: 0.55rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--line);
  }

  .menu-section:first-of-type {
    border-top: none;
  }

  .menu-copy {
    margin: 0;
    color: var(--muted);
    font-size: 0.88rem;
  }

  .theme-toggle-group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .theme-toggle {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    padding: 0.55rem 0.75rem;
    border-radius: 0.35rem;
    cursor: pointer;
    font-size: 0.88rem;
  }

  .theme-toggle.selected {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .menu-insight-actions {
    display: grid;
    gap: 0.55rem;
  }
</style>
