<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { SelectedRepo } from '../../../src/shared/contracts.js';

  export type ThemeName = 'vscode-dark' | 'vscode-light';

  export let open = false;
  export let currentRepo: SelectedRepo | null = null;
  export let theme: ThemeName = 'vscode-dark';

  const dispatch = createEventDispatcher<{
    close: void;
    chooseRepo: void;
    openCosts: void;
    logout: void;
    setTheme: { value: ThemeName };
  }>();
</script>

{#if open}
  <div class="overlay menu-overlay" role="presentation" on:click={() => dispatch('close')}>
    <div class="menu-panel card-panel" role="dialog" aria-modal="true" aria-label="App menu" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="sheet-header">
        <div>
          <p class="eyebrow">Workspace menu</p>
          <h2>{currentRepo ? currentRepo.name : 'PiMobile'}</h2>
        </div>
      </div>

      <section class="menu-section">
        <p class="eyebrow">Repository</p>
        <p class="menu-copy">{currentRepo ? currentRepo.relativePath : 'No repository selected yet. Pick one below your configured workspace root.'}</p>
        <button class="secondary-button" type="button" on:click={() => dispatch('chooseRepo')}>Choose repo</button>
      </section>

      <section class="menu-section">
        <p class="eyebrow">Theme</p>
        <div class="theme-toggle-group" role="group" aria-label="Theme switcher">
          <button class:selected={theme === 'vscode-dark'} class="theme-toggle" type="button" on:click={() => dispatch('setTheme', { value: 'vscode-dark' })}>
            VS Code Dark
          </button>
          <button class:selected={theme === 'vscode-light'} class="theme-toggle" type="button" on:click={() => dispatch('setTheme', { value: 'vscode-light' })}>
            VS Code Light
          </button>
        </div>
      </section>

      <section class="menu-section">
        <p class="eyebrow">Insights</p>
        <p class="menu-copy">Open the aggregated cost overview with filters for repository, model, and timeframe.</p>
        <button class="secondary-button" type="button" on:click={() => dispatch('openCosts')}>Open costs</button>
      </section>

      <section class="menu-section">
        <p class="eyebrow">Session</p>
        <button class="ghost-button danger-button" type="button" on:click={() => dispatch('logout')}>Logout</button>
      </section>
    </div>
  </div>
{/if}