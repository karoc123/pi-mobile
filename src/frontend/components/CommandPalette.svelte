<script lang="ts">
  import type {
    AgentCommandRequest,
    AgentCommandResponse,
    AgentCommandState,
    AgentModelOption,
    AgentThinkingLevel,
    AgentThinkingLevelOption,
  } from '../../shared/contracts.js';
  import { apiFetch, toErrorMessage } from '../lib/api.js';
  import { SLASH_COMMAND_ALIASES, SLASH_COMMANDS } from '../lib/command-suggestions.js';
  import { toast } from '../lib/toast.svelte.js';
  import ChoiceGroup from './ChoiceGroup.svelte';
  import Sheet from './Sheet.svelte';

  interface Props {
    open?: boolean;
    initialCommand?: string | null;
    onclose: () => void;
    onprefill?: (value: string) => void;
    onaction?: () => void;
    onstatechange?: (state: AgentCommandState) => void;
  }

  const {
    open = false,
    initialCommand = null,
    onclose,
    onprefill,
    onaction,
    onstatechange,
  }: Props = $props();

  let loading = $state(false);
  let busy = $state(false);
  let commandState = $state<AgentCommandState | null>(null);
  let selectedCommand = $state(SLASH_COMMANDS[0]?.command ?? '/model');
  let sessionNameDraft = $state('');
  let bashCommandDraft = $state('git status --short');
  let bashExcludeFromContext = $state(false);

  function resolveCommand(commandText: string | null | undefined): string {
    if (!commandText) return SLASH_COMMANDS[0]?.command ?? '/model';
    const trimmed = commandText.trim();
    const aliasResolved = SLASH_COMMAND_ALIASES[trimmed] ?? trimmed;
    if (SLASH_COMMANDS.some((entry) => entry.command === aliasResolved)) {
      return aliasResolved;
    }
    return SLASH_COMMANDS[0]?.command ?? '/model';
  }

  $effect(() => {
    if (open) {
      if (initialCommand) {
        selectedCommand = resolveCommand(initialCommand);
      }
      void loadState();
    }
  });

  $effect(() => {
    if (commandState?.session?.sessionName && sessionNameDraft.length === 0) {
      sessionNameDraft = commandState.session.sessionName;
    }
  });

  const availableModels = $derived(
    commandState?.models.filter((model: AgentModelOption) => model.available || model.isCurrent) ??
      [],
  );

  const thinkingOptions = $derived(
    commandState?.thinkingLevels.map((level: AgentThinkingLevelOption) => ({
      value: level.value,
      label: level.value,
    })) ?? [],
  );

  const currentThinkingLevel = $derived(
    commandState?.thinkingLevels.find((level: AgentThinkingLevelOption) => level.isCurrent)
      ?.value ?? '',
  );

  async function loadState() {
    loading = true;

    try {
      commandState = await apiFetch<AgentCommandState>('/api/agent/command-state');
      if (commandState) {
        onstatechange?.(commandState);
      }
    } catch (error) {
      toast.show(toErrorMessage(error), 'error');
    } finally {
      loading = false;
    }
  }

  async function executeCommand(request: AgentCommandRequest) {
    busy = true;

    try {
      const response = await apiFetch<AgentCommandResponse>('/api/agent/command', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      if (response.message) {
        toast.show(response.message, 'success');
      }

      if (response.prompt) {
        onprefill?.(response.prompt);
      }

      const closePaletteCommands: AgentCommandRequest['command'][] = [
        'new-session',
        'resume-session',
        'navigate-tree',
        'fork-session',
        'export-session',
      ];

      if (closePaletteCommands.includes(request.command)) {
        onclose();
      } else {
        await loadState();
      }

      onaction?.();
    } catch (error) {
      toast.show(toErrorMessage(error), 'error');
    } finally {
      busy = false;
    }
  }

  function formatTimestamp(value: string) {
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatModelUsage(model: AgentModelOption) {
    return model.usageCount ? `Used ${model.usageCount}x` : '';
  }
</script>

<Sheet
  {open}
  {onclose}
  title="CMD"
  eyebrow="Command palette"
  ariaLabel="Command palette"
  wide={true}
>
  <div class="command-body">
    <div class="command-layout">
      <div class="command-list">
        {#each SLASH_COMMANDS as suggestion (suggestion.command)}
          <button
            class:selected={selectedCommand === suggestion.command}
            class="command-tab"
            type="button"
            onclick={() => (selectedCommand = suggestion.command)}
          >
            <strong>{suggestion.command}</strong>
            <span>{suggestion.description}</span>
          </button>
        {/each}
      </div>

      <div class="command-panel">
        {#if loading && !commandState}
          <p class="empty-state small">Loading available commands...</p>
        {:else if !commandState}
          <p class="empty-state small">No command state available yet.</p>
        {:else}
          {#if selectedCommand === '/model'}
            <div class="command-stack">
              <p class="subdued">Pick the active Pi model for this session.</p>
              {#if availableModels.length === 0}
                <p class="empty-state small">No models are available for switching right now.</p>
              {:else}
                {#each availableModels as model (model.provider + '/' + model.modelId)}
                  <button
                    class:selected={model.isCurrent}
                    class="command-option"
                    type="button"
                    disabled={busy || model.isCurrent}
                    onclick={() =>
                      executeCommand({
                        command: 'set-model',
                        provider: model.provider,
                        modelId: model.modelId,
                      })}
                  >
                    <div class="command-option-main">
                      <strong>{model.provider}/{model.modelId}</strong>
                      <span>{model.name}</span>
                      {#if formatModelUsage(model)}
                        <span>{formatModelUsage(model)}</span>
                      {/if}
                    </div>
                    <span class="command-meta"
                      >{model.isCurrent
                        ? 'Current'
                        : model.usingSubscription
                          ? 'OAuth'
                          : 'Ready'}</span
                    >
                  </button>
                {/each}
              {/if}
            </div>
          {:else if selectedCommand === '/session'}
            <div class="command-stack">
              <p class="subdued">Current Pi session metadata, rename, export, and restart.</p>
              {#if commandState.session}
                <div class="command-summary-grid">
                  <article class="command-stat">
                    <span>Users</span>
                    <strong>{commandState.session.userMessages}</strong>
                  </article>
                  <article class="command-stat">
                    <span>Assistant</span>
                    <strong>{commandState.session.assistantMessages}</strong>
                  </article>
                  <article class="command-stat">
                    <span>Tool calls</span>
                    <strong>{commandState.session.toolCalls}</strong>
                  </article>
                  <article class="command-stat">
                    <span>Total</span>
                    <strong>{commandState.session.totalMessages}</strong>
                  </article>
                </div>
                <article class="command-summary-card">
                  <strong>Session ID</strong>
                  <span>{commandState.session.sessionId ?? 'No session yet'}</span>
                </article>
                <article class="command-summary-card">
                  <strong>Session file</strong>
                  <span>{commandState.session.sessionFile ?? 'No persisted session file yet'}</span>
                </article>
                <article class="command-summary-card">
                  <strong>Session name</strong>
                  <span>{commandState.session.sessionName ?? 'No custom session name set'}</span>
                </article>
                <article class="command-summary-card">
                  <strong>Runtime status</strong>
                  <span>
                    {commandState.isCompacting
                      ? 'Compacting'
                      : commandState.isRetrying
                        ? 'Retrying'
                        : commandState.isBashRunning
                          ? 'Running bash'
                          : 'Idle'}
                    {#if commandState.pendingMessageCount > 0}
                      · queue {commandState.pendingMessageCount}
                    {/if}
                  </span>
                </article>
              {:else}
                <p class="empty-state small">No active session metadata is available yet.</p>
              {/if}

              <section class="menu-section">
                <p class="eyebrow">Session name</p>
                <label class="field-label" for="session-name-input">Session name</label>
                <input
                  id="session-name-input"
                  class="text-input"
                  type="text"
                  bind:value={sessionNameDraft}
                  placeholder="Feature planning"
                />
                <button
                  class="primary-button"
                  type="button"
                  disabled={busy || sessionNameDraft.trim().length === 0}
                  onclick={() =>
                    executeCommand({
                      command: 'set-session-name',
                      name: sessionNameDraft.trim(),
                    })}
                >
                  Save session name
                </button>
              </section>

              <section class="menu-section">
                <p class="eyebrow">Export session</p>
                <div class="action-row" role="group" aria-label="Export session">
                  <button
                    class="secondary-button"
                    type="button"
                    disabled={busy}
                    onclick={() =>
                      executeCommand({
                        command: 'export-session',
                        format: 'html',
                      })}
                  >
                    Export HTML
                  </button>
                  <button
                    class="secondary-button"
                    type="button"
                    disabled={busy}
                    onclick={() =>
                      executeCommand({
                        command: 'export-session',
                        format: 'jsonl',
                      })}
                  >
                    Export JSONL
                  </button>
                </div>
              </section>

              <section class="menu-section">
                <p class="eyebrow">New session</p>
                <button
                  class="primary-button"
                  type="button"
                  disabled={busy}
                  onclick={() => executeCommand({ command: 'new-session' })}
                >
                  Start new session
                </button>
              </section>
            </div>
          {:else if selectedCommand === '/resume'}
            <div class="command-stack">
              <p class="subdued">Resume one of the saved sessions for this repository.</p>
              {#if commandState.resumeSessions.length === 0}
                <p class="empty-state small">
                  No saved sessions were found for this repository yet.
                </p>
              {:else}
                {#each commandState.resumeSessions as sessionEntry (sessionEntry.id)}
                  <button
                    class:selected={sessionEntry.isCurrent}
                    class="command-option"
                    type="button"
                    disabled={busy || sessionEntry.isCurrent}
                    onclick={() =>
                      executeCommand({
                        command: 'resume-session',
                        sessionPath: sessionEntry.path,
                      })}
                  >
                    <div class="command-option-main">
                      <strong>{sessionEntry.name ?? sessionEntry.preview}</strong>
                      <span>{sessionEntry.path}</span>
                    </div>
                    <span class="command-meta"
                      >{sessionEntry.isCurrent
                        ? 'Current'
                        : formatTimestamp(sessionEntry.modifiedAt)}</span
                    >
                  </button>
                {/each}
              {/if}
            </div>
          {:else if selectedCommand === '/tree'}
            <div class="command-stack">
              <p class="subdued">Jump to an earlier point in the current session tree.</p>
              {#if commandState.treeEntries.length === 0}
                <p class="empty-state small">No tree entries are available yet.</p>
              {:else}
                {#each commandState.treeEntries as entry (entry.entryId)}
                  <button
                    class:selected={entry.isCurrent}
                    class="command-option command-tree-option"
                    type="button"
                    style={`padding-left: ${0.9 + entry.depth * 0.7}rem;`}
                    disabled={busy || entry.isCurrent}
                    onclick={() =>
                      executeCommand({
                        command: 'navigate-tree',
                        entryId: entry.entryId,
                      })}
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
              {#if commandState.forkEntries.length === 0}
                <p class="empty-state small">There are no earlier prompts to fork from yet.</p>
              {:else}
                {#each commandState.forkEntries as entry (entry.entryId)}
                  <button
                    class="command-option"
                    type="button"
                    disabled={busy}
                    onclick={() =>
                      executeCommand({
                        command: 'fork-session',
                        entryId: entry.entryId,
                      })}
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
          {:else if selectedCommand === '/bash'}
            <div class="command-stack">
              <p class="subdued">Run a direct bash command inside the active repository.</p>
              <label class="field-label" for="command-bash-input">Command</label>
              <input
                id="command-bash-input"
                class="text-input"
                type="text"
                bind:value={bashCommandDraft}
                placeholder="git status --short"
              />
              <label class="subdued">
                <input type="checkbox" bind:checked={bashExcludeFromContext} />
                Exclude command output from next prompt context
              </label>
              <div class="action-row" role="group" aria-label="Bash actions">
                <button
                  class="primary-button"
                  type="button"
                  disabled={busy || bashCommandDraft.trim().length === 0}
                  onclick={() =>
                    executeCommand({
                      command: 'run-bash',
                      commandText: bashCommandDraft.trim(),
                      excludeFromContext: bashExcludeFromContext,
                    })}
                >
                  Run bash
                </button>
                <button
                  class="secondary-button"
                  type="button"
                  disabled={busy || !commandState.isBashRunning}
                  onclick={() => executeCommand({ command: 'abort-bash' })}
                >
                  Abort bash
                </button>
              </div>
            </div>
          {:else if selectedCommand === '/settings'}
            <div class="command-stack">
              <p class="subdued">
                Adjust thinking level, compaction, steering, follow-up, and retry settings.
              </p>

              <section class="menu-section">
                <p class="eyebrow">Thinking</p>
                {#if thinkingOptions.length === 0}
                  <p class="empty-state small">This model does not expose thinking controls.</p>
                {:else}
                  <ChoiceGroup
                    options={thinkingOptions}
                    value={currentThinkingLevel}
                    onchange={(level) =>
                      executeCommand({
                        command: 'set-thinking',
                        level: level as AgentThinkingLevel,
                      })}
                    disabled={busy}
                    label="Thinking level"
                  />
                {/if}
              </section>

              <section class="menu-section">
                <p class="eyebrow">Compaction</p>
                <div class="action-row" role="group" aria-label="Compaction actions">
                  <button
                    class="primary-button"
                    type="button"
                    disabled={busy || commandState.isCompacting}
                    onclick={() => executeCommand({ command: 'compact' })}
                  >
                    {commandState.isCompacting ? 'Compacting...' : 'Compact now'}
                  </button>
                  <button
                    class="secondary-button"
                    type="button"
                    disabled={busy}
                    onclick={() => {
                      if (!commandState) return;
                      executeCommand({
                        command: 'set-auto-compact',
                        enabled: !commandState.autoCompactEnabled,
                      });
                    }}
                  >
                    {commandState.autoCompactEnabled
                      ? 'Disable auto compaction'
                      : 'Enable auto compaction'}
                  </button>
                </div>
              </section>

              <section class="menu-section">
                <p class="eyebrow">Steering mode</p>
                <ChoiceGroup
                  options={[
                    { value: 'all', label: 'all' },
                    { value: 'one-at-a-time', label: 'one-at-a-time' },
                  ]}
                  value={commandState.steeringMode}
                  onchange={(mode) => executeCommand({ command: 'set-steering-mode', mode })}
                  disabled={busy}
                  label="Steering mode"
                />
              </section>

              <section class="menu-section">
                <p class="eyebrow">Follow-up mode</p>
                <ChoiceGroup
                  options={[
                    { value: 'all', label: 'all' },
                    { value: 'one-at-a-time', label: 'one-at-a-time' },
                  ]}
                  value={commandState.followUpMode}
                  onchange={(mode) => executeCommand({ command: 'set-follow-up-mode', mode })}
                  disabled={busy}
                  label="Follow-up mode"
                />
              </section>

              <section class="menu-section">
                <p class="eyebrow">Automatic retry</p>
                <article class="command-summary-card">
                  <strong>Retry status</strong>
                  <span>{commandState.isRetrying ? 'Retry in progress' : 'No retry active'}</span>
                </article>
                <div class="action-row" role="group" aria-label="Retry actions">
                  <button
                    class="secondary-button"
                    type="button"
                    disabled={busy}
                    onclick={() => {
                      if (!commandState) return;
                      executeCommand({
                        command: 'set-auto-retry',
                        enabled: !commandState.autoRetryEnabled,
                      });
                    }}
                  >
                    {commandState.autoRetryEnabled ? 'Disable auto retry' : 'Enable auto retry'}
                  </button>
                  <button
                    class="ghost-button"
                    type="button"
                    disabled={busy || !commandState.isRetrying}
                    onclick={() => executeCommand({ command: 'abort-retry' })}
                  >
                    Abort retry
                  </button>
                </div>
              </section>
            </div>
          {:else if selectedCommand === '/commands'}
            <div class="command-stack">
              <p class="subdued">
                Runtime slash commands discovered from extensions, prompts, and skills.
              </p>
              {#if commandState.availableCommands.length === 0}
                <p class="empty-state small">
                  No runtime slash commands discovered for this repository yet.
                </p>
              {:else}
                {#each commandState.availableCommands as cmd (cmd.name)}
                  <button
                    class="command-option"
                    type="button"
                    disabled={busy}
                    onclick={() => {
                      onprefill?.(`/${cmd.name} `);
                      onclose();
                    }}
                  >
                    <div class="command-option-main">
                      <strong>/{cmd.name}</strong>
                      <span>{cmd.description ?? 'No description available'} · {cmd.source}</span>
                    </div>
                    <span class="command-meta">Insert</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</Sheet>

<style>
  .command-body {
    display: grid;
    min-height: 0;
  }

  .command-layout {
    display: grid;
    grid-template-columns: minmax(8.6rem, 38%) minmax(0, 1fr);
    gap: 0.8rem;
    min-height: 0;
  }

  .command-list,
  .command-panel,
  .command-stack {
    display: grid;
    gap: 0.75rem;
  }

  .command-list,
  .command-panel {
    min-height: 0;
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .command-tab,
  .command-option,
  .command-summary-card,
  .command-stat {
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--surface-strong);
  }

  .command-tab,
  .command-option {
    width: 100%;
    text-align: left;
    padding: 0.85rem 0.9rem;
    color: var(--ink);
  }

  .command-tab {
    display: grid;
    gap: 0.2rem;
  }

  .command-tab span,
  .command-option span,
  .command-summary-card span {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .command-tab.selected,
  .command-option.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, var(--surface-strong));
  }

  .command-option {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .command-option-main {
    min-width: 0;
    display: grid;
    gap: 0.2rem;
  }

  .command-option-main strong,
  .command-summary-card span {
    overflow-wrap: anywhere;
  }

  .command-meta {
    color: var(--muted);
    font-size: 0.78rem;
    flex: 0 0 auto;
  }

  .command-summary-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .command-summary-card,
  .command-stat {
    padding: 0.85rem 0.9rem;
    display: grid;
    gap: 0.25rem;
  }

  .command-stat strong {
    font-size: 1.15rem;
  }

  .menu-section {
    display: grid;
    gap: 0.5rem;
  }

  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  @media (max-width: 420px) {
    .command-layout {
      grid-template-columns: minmax(6.5rem, 30%) minmax(0, 1fr);
      gap: 0.6rem;
    }

    .command-tab,
    .command-option,
    .command-summary-card,
    .command-stat {
      padding: 0.7rem 0.75rem;
    }

    .command-tab {
      gap: 0.15rem;
    }

    .command-tab strong,
    .command-option-main strong {
      font-size: 0.92rem;
    }

    .command-tab span,
    .command-option span,
    .command-summary-card span,
    .command-meta {
      font-size: 0.77rem;
    }

    .command-option {
      gap: 0.55rem;
    }

    .command-option-main {
      gap: 0.15rem;
    }

    .command-summary-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (min-width: 900px) {
    .command-layout {
      grid-template-columns: 15rem minmax(0, 1fr);
      align-items: stretch;
    }
  }
</style>
