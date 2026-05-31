<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { SelectedRepo } from '../../../src/shared/contracts.js';

  export type ThemeName = 'vscode-dark' | 'vscode-light';

  export let open = false;
  export let currentRepo: SelectedRepo | null = null;
  export let theme: ThemeName = 'vscode-dark';
  export let followUpCostGuardEnabled = true;
  export let followUpCostGuardEnabledHasOverride = false;
  export let followUpCostSoftLimitUsd = 0.5;
  export let followUpCostSoftLimitUsdDefault = 0.5;
  export let followUpCostSoftLimitHasOverride = false;

  const dispatch = createEventDispatcher<{
    close: void;
    chooseRepo: void;
    openCosts: void;
    openLogs: void;
    logout: void;
    setTheme: { value: ThemeName };
    setFollowUpCostGuardEnabled: { value: boolean };
    resetFollowUpCostGuardEnabled: void;
    setFollowUpCostSoftLimitUsd: { value: string };
    resetFollowUpCostSoftLimitUsd: void;
  }>();

  function formatUsd(value: number) {
    return `$${value.toFixed(2)}`;
  }
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
        <p class="eyebrow">Follow-up cost guard</p>
        <p class="menu-copy">Global guardrail for follow-up steps while a turn is still running.</p>

        <label class="menu-setting-inline">
          <span>Guard enabled</span>
          <input
            type="checkbox"
            checked={followUpCostGuardEnabled}
            on:change={(event) => dispatch('setFollowUpCostGuardEnabled', { value: (event.currentTarget as HTMLInputElement).checked })}
          />
        </label>

        <label class="menu-setting-row">
          <span class="field-label">Soft limit (USD)</span>
          <input
            class="text-input"
            type="number"
            min="0"
            step="0.01"
            value={followUpCostSoftLimitUsd.toFixed(2)}
            on:change={(event) => dispatch('setFollowUpCostSoftLimitUsd', { value: (event.currentTarget as HTMLInputElement).value })}
          />
        </label>

        <p class="menu-copy">
          Env default: {formatUsd(followUpCostSoftLimitUsdDefault)}
          {#if followUpCostSoftLimitHasOverride}
            · menu override active
          {/if}
          {#if followUpCostGuardEnabledHasOverride}
            · guard override active
          {/if}
        </p>

        <div class="menu-insight-actions">
          <button class="secondary-button" type="button" on:click={() => dispatch('resetFollowUpCostSoftLimitUsd')}>Use env limit</button>
          <button class="secondary-button" type="button" on:click={() => dispatch('resetFollowUpCostGuardEnabled')}>Use env toggle</button>
        </div>
      </section>

      <section class="menu-section">
        <p class="eyebrow">Insights</p>
        <p class="menu-copy">Open cost analytics or inspect the live backend log stream to debug runtime activity.</p>
        <div class="menu-insight-actions">
          <button class="secondary-button" type="button" on:click={() => dispatch('openCosts')}>Open costs</button>
          <button class="secondary-button" type="button" on:click={() => dispatch('openLogs')}>Open log</button>
        </div>
      </section>

      <section class="menu-section">
        <p class="eyebrow">Session</p>
        <button class="ghost-button danger-button" type="button" on:click={() => dispatch('logout')}>Logout</button>
      </section>
    </div>
  </div>
{/if}