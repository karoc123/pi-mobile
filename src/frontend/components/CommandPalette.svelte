<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { AgentCommandRequest, AgentCommandState, AgentModelOption } from '../../../src/shared/contracts.js';
  import type { ThemeName } from './AppMenu.svelte';
  import { SLASH_COMMANDS } from '../lib/command-suggestions.js';

  export let open = false;
  export let loading = false;
  export let busy = false;
  export let state: AgentCommandState | null = null;
  export let theme: ThemeName = 'vscode-dark';

  const dispatch = createEventDispatcher<{
    close: void;
    copy: void;
    execute: { request: AgentCommandRequest };
    setTheme: { value: ThemeName };
  }>();

  let selectedCommand = SLASH_COMMANDS[0]?.command ?? '/model';
  let availableModels: AgentModelOption[] = [];

  $: if (open && !SLASH_COMMANDS.some((entry) => entry.command === selectedCommand)) {
    selectedCommand = SLASH_COMMANDS[0]?.command ?? '/model';
  }

  $: availableModels = state?.models.filter((model) => model.available || model.isCurrent) ?? [];

  function formatTimestamp(value: string) {
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

{#if open}
  <div class="overlay" role="presentation" on:click={() => dispatch('close')}>
    <div class="sheet-card command-sheet" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="sheet-header">
        <div>
          <p class="eyebrow">Command palette</p>
          <h2>CMD</h2>
        </div>
        <button class="ghost-button" type="button" on:click={() => dispatch('close')}>Close</button>
      </div>

      <div class="command-body">
        <div class="command-layout">
          <div class="command-list">
            {#each SLASH_COMMANDS as suggestion}
              <button class:selected={selectedCommand === suggestion.command} class="command-tab" type="button" on:click={() => (selectedCommand = suggestion.command)}>
                <strong>{suggestion.command}</strong>
                <span>{suggestion.description}</span>
              </button>
            {/each}
          </div>

          <div class="command-panel">
            {#if loading && !state}
              <p class="empty-state small">Loading available commands...</p>
            {:else if !state}
              <p class="empty-state small">No command state available yet.</p>
            {:else if selectedCommand === '/model'}
              <div class="command-stack">
                <p class="subdued">Pick the active Pi model for this session.</p>
                {#if availableModels.length === 0}
                  <p class="empty-state small">No models are available for switching right now.</p>
                {:else}
                  {#each availableModels as model}
                    <button
                      class:selected={model.isCurrent}
                      class="command-option"
                      type="button"
                      disabled={busy || model.isCurrent}
                      on:click={() => dispatch('execute', {
                        request: {
                          command: 'set-model',
                          provider: model.provider,
                          modelId: model.modelId,
                        },
                      })}
                    >
                      <div class="command-option-main">
                        <strong>{model.provider}/{model.modelId}</strong>
                        <span>{model.name}</span>
                      </div>
                      <span class="command-meta">{model.isCurrent ? 'Current' : model.usingSubscription ? 'OAuth' : 'Ready'}</span>
                    </button>
                  {/each}
                {/if}
              </div>
            {:else if selectedCommand === '/session'}
              <div class="command-stack">
                <p class="subdued">Current Pi session metadata and message counts.</p>
                {#if state.session}
                  <div class="command-summary-grid">
                    <article class="command-stat">
                      <span>Users</span>
                      <strong>{state.session.userMessages}</strong>
                    </article>
                    <article class="command-stat">
                      <span>Assistant</span>
                      <strong>{state.session.assistantMessages}</strong>
                    </article>
                    <article class="command-stat">
                      <span>Tool calls</span>
                      <strong>{state.session.toolCalls}</strong>
                    </article>
                    <article class="command-stat">
                      <span>Total</span>
                      <strong>{state.session.totalMessages}</strong>
                    </article>
                  </div>
                  <article class="command-summary-card">
                    <strong>Session ID</strong>
                    <span>{state.session.sessionId ?? 'No session yet'}</span>
                  </article>
                  <article class="command-summary-card">
                    <strong>Session file</strong>
                    <span>{state.session.sessionFile ?? 'No persisted session file yet'}</span>
                  </article>
                {:else}
                  <p class="empty-state small">No active session metadata is available yet.</p>
                {/if}
              </div>
            {:else if selectedCommand === '/settings'}
              <div class="command-stack">
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
                  <p class="eyebrow">Thinking</p>
                  {#if state.thinkingLevels.length === 0}
                    <p class="empty-state small">This model does not expose thinking controls.</p>
                  {:else}
                    <div class="theme-toggle-group command-toggle-grid" role="group" aria-label="Thinking level">
                      {#each state.thinkingLevels as level}
                        <button
                          class:selected={level.isCurrent}
                          class="theme-toggle"
                          type="button"
                          disabled={busy || level.isCurrent}
                          on:click={() => dispatch('execute', { request: { command: 'set-thinking', level: level.value } })}
                        >
                          {level.value}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </section>

                <section class="menu-section">
                  <p class="eyebrow">Compaction</p>
                  <button class="secondary-button" type="button" disabled={busy} on:click={() => dispatch('execute', { request: { command: 'set-auto-compact', enabled: !state.autoCompactEnabled } })}>
                    {state.autoCompactEnabled ? 'Disable auto compaction' : 'Enable auto compaction'}
                  </button>
                </section>
              </div>
            {:else if selectedCommand === '/compact'}
              <div class="command-stack">
                <p class="subdued">Run a manual context compaction for the current session.</p>
                <button class="primary-button" type="button" disabled={busy} on:click={() => dispatch('execute', { request: { command: 'compact' } })}>
                  Compact now
                </button>
              </div>
            {:else if selectedCommand === '/resume'}
              <div class="command-stack">
                <p class="subdued">Resume one of the saved sessions for this repository.</p>
                {#if state.resumeSessions.length === 0}
                  <p class="empty-state small">No saved sessions were found for this repository yet.</p>
                {:else}
                  {#each state.resumeSessions as sessionEntry}
                    <button
                      class:selected={sessionEntry.isCurrent}
                      class="command-option"
                      type="button"
                      disabled={busy || sessionEntry.isCurrent}
                      on:click={() => dispatch('execute', { request: { command: 'resume-session', sessionPath: sessionEntry.path } })}
                    >
                      <div class="command-option-main">
                        <strong>{sessionEntry.name ?? sessionEntry.preview}</strong>
                        <span>{sessionEntry.path}</span>
                      </div>
                      <span class="command-meta">{sessionEntry.isCurrent ? 'Current' : formatTimestamp(sessionEntry.modifiedAt)}</span>
                    </button>
                  {/each}
                {/if}
              </div>
            {:else if selectedCommand === '/new'}
              <div class="command-stack">
                <p class="subdued">Start a fresh session in the current repository.</p>
                <button class="primary-button" type="button" disabled={busy} on:click={() => dispatch('execute', { request: { command: 'new-session' } })}>
                  Start new session
                </button>
              </div>
            {:else if selectedCommand === '/copy'}
              <div class="command-stack">
                <p class="subdued">Copy the latest assistant reply to the clipboard.</p>
                <button class="primary-button" type="button" disabled={busy} on:click={() => dispatch('copy')}>
                  Copy last reply
                </button>
              </div>
            {:else if selectedCommand === '/tree'}
              <div class="command-stack">
                <p class="subdued">Jump to an earlier point in the current session tree.</p>
                {#if state.treeEntries.length === 0}
                  <p class="empty-state small">No tree entries are available yet.</p>
                {:else}
                  {#each state.treeEntries as entry}
                    <button
                      class:selected={entry.isCurrent}
                      class="command-option command-tree-option"
                      type="button"
                      style={`padding-left: ${0.9 + entry.depth * 0.7}rem;`}
                      disabled={busy || entry.isCurrent}
                      on:click={() => dispatch('execute', { request: { command: 'navigate-tree', entryId: entry.entryId } })}
                    >
                      <div class="command-option-main">
                        <strong>{entry.preview}</strong>
                        <span>{entry.role}</span>
                      </div>
                      <span class="command-meta">{entry.isCurrent ? 'Current' : 'Jump'}</span>
                    </button>
                  {/each}
                {/if}
              </div>
            {:else if selectedCommand === '/fork'}
              <div class="command-stack">
                <p class="subdued">Fork from one of the earlier user prompts into a new session.</p>
                {#if state.forkEntries.length === 0}
                  <p class="empty-state small">There are no earlier prompts to fork from yet.</p>
                {:else}
                  {#each state.forkEntries as entry}
                    <button
                      class="command-option"
                      type="button"
                      disabled={busy}
                      on:click={() => dispatch('execute', { request: { command: 'fork-session', entryId: entry.entryId } })}
                    >
                      <div class="command-option-main">
                        <strong>{entry.preview}</strong>
                        <span>Fork into a new session</span>
                      </div>
                      <span class="command-meta">Fork</span>
                    </button>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}