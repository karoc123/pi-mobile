<script lang="ts">
  import { onMount, tick } from 'svelte';

  import type {
    AgentRuntimePhase,
    AgentSlashCommand,
    AgentUsage,
    ChatMessage,
    InteractivePrompt,
  } from '../../shared/contracts.js';
  import { formatCompactTokenCount, formatUsageCost } from '../lib/agent-usage.js';
  import { copyText } from '../lib/clipboard.js';
  import {
    applySlashCommandSuggestion,
    getSlashCommandSuggestions,
    toRuntimeSlashCommandSuggestions,
    type SlashCommandSuggestion,
  } from '../lib/command-suggestions.js';
  import { renderMarkdown } from '../lib/markdown.js';
  import InteractiveCard from './InteractiveCard.svelte';
  import ToolCalls from './ToolCalls.svelte';

  interface Props {
    messages?: ChatMessage[];
    runtimePhase?: AgentRuntimePhase;
    pendingMessageCount?: number;
    canAbort?: boolean;
    lastError?: string | null;
    usage?: AgentUsage;
    prefillPrompt?: string;
    prefillToken?: number;
    availableCommands?: AgentSlashCommand[];
    interactivePrompt?: InteractivePrompt | null;
    draftStorageScope?: string;
    onsubmit?: (prompt: string) => void;
    onabort?: () => void;
    onopencommands?: () => void;
    onopenmodelcommands?: () => void;
    onnewsession?: () => void;
    oninteractivedismiss?: () => void;
  }

  const {
    messages = [],
    runtimePhase = 'idle',
    pendingMessageCount = 0,
    canAbort = false,
    lastError = null,
    usage,
    prefillPrompt = '',
    prefillToken = 0,
    availableCommands = [],
    interactivePrompt = null,
    draftStorageScope = 'default',
    onsubmit,
    onabort,
    onopencommands,
    onopenmodelcommands,
    onnewsession,
    oninteractivedismiss,
  }: Props = $props();

  let prompt = $state('');
  let promptField = $state<HTMLTextAreaElement | null>(null);
  let logContainer = $state<HTMLDivElement | null>(null);
  let handledPrefillToken = $state(0);
  let copiedMessageId = $state<string | null>(null);
  let promptCursorIndex = $state(0);
  let selectedSlashSuggestionIndex = $state(0);
  let slashSuggestionsDismissed = $state(false);
  let isNearBottom = true;

  const statusTitle = $derived(
    lastError
      ? 'Agent needs attention'
      : runtimePhase === 'streaming'
        ? 'Pi is working'
        : runtimePhase === 'queued'
          ? `Pending queue: ${pendingMessageCount}`
          : runtimePhase === 'compacting'
            ? 'Pi is compacting context'
            : runtimePhase === 'retrying'
              ? 'Pi is retrying'
              : runtimePhase === 'bash-running'
                ? 'Pi is running bash'
                : messages.length > 0
                  ? 'Agent finished'
                  : 'Ready',
  );

  const statusTone = $derived(lastError ? 'error' : runtimePhase === 'idle' ? 'ready' : 'running');

  function modelLabelForSendButton(modelId?: string | null): string {
    if (!modelId) return 'no-model';
    const compact = modelId.split('/').filter(Boolean).pop() ?? modelId;
    return compact.length > 20 ? `${compact.slice(0, 20)}...` : compact;
  }

  const sendButtonModel = $derived(`(${modelLabelForSendButton(usage?.modelId)})`);

  const runtimeSlashSuggestions = $derived(toRuntimeSlashCommandSuggestions(availableCommands));

  const slashSuggestions = $derived(
    slashSuggestionsDismissed
      ? []
      : getSlashCommandSuggestions(prompt, promptCursorIndex, runtimeSlashSuggestions),
  );

  const contextChipLabel = $derived.by(() => {
    if (!usage) return '?/?';
    const used = usage.contextTokens === null ? '?' : formatCompactTokenCount(usage.contextTokens);
    const win = usage.contextWindow === null ? '?' : formatCompactTokenCount(usage.contextWindow);
    return `${used}/${win}`;
  });

  const contextChipTitle = $derived.by(() => {
    if (!usage) return 'Context usage';
    const used = usage.contextTokens === null ? '?' : formatCompactTokenCount(usage.contextTokens);
    const win = usage.contextWindow === null ? '?' : formatCompactTokenCount(usage.contextWindow);
    const mode = usage.autoCompactEnabled ? 'auto compact on' : 'auto compact off';
    return `Context usage ${used}/${win} (${mode})`;
  });

  const draftStorageKey = $derived(`pi-mobile:prompt-draft:${draftStorageScope}`);

  function saveDraft(value: string) {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (value.trim().length === 0) {
        window.sessionStorage.removeItem(draftStorageKey);
      } else {
        window.sessionStorage.setItem(draftStorageKey, value);
      }
    }
  }

  function handleScroll() {
    if (!logContainer) return;
    const distanceToBottom =
      logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight;
    isNearBottom = distanceToBottom < 48;
  }

  function scrollToBottom() {
    if (!logContainer) return;
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  $effect(() => {
    // When messages change, stick to bottom if user is near bottom
    const _len = messages.length;
    const _phase = runtimePhase;
    if (isNearBottom) {
      tick().then(scrollToBottom);
    }
  });

  let activeDraftScope = $state('');

  $effect(() => {
    // Load draft on scope change
    const key = draftStorageKey;
    if (key !== activeDraftScope) {
      activeDraftScope = key;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        prompt = window.sessionStorage.getItem(key) ?? '';
      }
    }
  });

  $effect(() => {
    // Prefill prompt if requested
    if (prefillToken && prefillToken !== handledPrefillToken && prefillPrompt) {
      handledPrefillToken = prefillToken;
      prompt = prefillPrompt;
      saveDraft(prompt);
      tick().then(() => {
        if (promptField) {
          promptField.focus();
          promptField.setSelectionRange(prompt.length, prompt.length);
        }
      });
    }
  });

  onMount(() => {
    scrollToBottom();

    const handleViewportResize = () => {
      if (typeof document !== 'undefined' && document.activeElement === promptField) {
        tick().then(scrollToBottom);
      }
    };

    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
      return () => {
        window.visualViewport?.removeEventListener('resize', handleViewportResize);
      };
    }
  });

  function handleSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    saveDraft('');
    prompt = '';
    slashSuggestionsDismissed = false;
    onsubmit?.(trimmed);
  }

  function handleSendPointerDown(event: PointerEvent) {
    event.preventDefault();
    handleSubmit();
  }

  function handleInput() {
    if (promptField) {
      promptCursorIndex = promptField.selectionStart ?? prompt.length;
    }
    slashSuggestionsDismissed = false;
    saveDraft(prompt);
  }

  function handleCursorActivity() {
    if (promptField) {
      promptCursorIndex = promptField.selectionStart ?? prompt.length;
    }
  }

  function selectSlashSuggestion(suggestion?: SlashCommandSuggestion) {
    if (!suggestion) return;
    const result = applySlashCommandSuggestion(prompt, promptCursorIndex, suggestion);
    prompt = result.prompt;
    saveDraft(prompt);
    slashSuggestionsDismissed = false;
    tick().then(() => {
      if (promptField) {
        promptField.focus();
        promptField.setSelectionRange(result.cursorIndex, result.cursorIndex);
      }
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (slashSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedSlashSuggestionIndex = (selectedSlashSuggestionIndex + 1) % slashSuggestions.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedSlashSuggestionIndex =
          (selectedSlashSuggestionIndex - 1 + slashSuggestions.length) % slashSuggestions.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (!event.shiftKey) {
          event.preventDefault();
          selectSlashSuggestion(slashSuggestions[selectedSlashSuggestionIndex]);
          return;
        }
      }
      if (event.key === 'Escape') {
        slashSuggestionsDismissed = true;
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  async function handleCopy(messageId: string, text: string) {
    const success = await copyText(text);
    if (success) {
      copiedMessageId = messageId;
      setTimeout(() => {
        if (copiedMessageId === messageId) {
          copiedMessageId = null;
        }
      }, 2000);
    }
  }

  function isSkippablePlaceholder(message: ChatMessage): boolean {
    return (
      message.role === 'assistant' &&
      message.text.trim().length === 0 &&
      (!message.tools || message.tools.length === 0)
    );
  }
</script>

<section class="view-shell chat-view">
  {#if lastError}
    <div class="notice error">{lastError}</div>
  {/if}

  <div class="chat-log" bind:this={logContainer} onscroll={handleScroll}>
    {#if messages.length === 0}
      <article class="empty-state-card">
        <h3>No transcript yet</h3>
        <p>
          Send the first prompt once a repository is selected. New prompts and agent output will
          appear here like a running CLI session.
        </p>
      </article>
    {/if}

    {#each messages as message (message.id)}
      {#if !isSkippablePlaceholder(message)}
        <article
          class="message-card {message.role}"
          class:assistant={message.role === 'assistant'}
          class:user={message.role === 'user'}
          class:system={message.role === 'system'}
        >
          <header>
            <div class="message-heading">
              <span class="message-prompt">{message.role === 'user' ? 'you>' : 'pi>'}</span>
              <strong>{message.role === 'user' ? 'User' : 'Pi'}</strong>
            </div>
            <div class="message-meta-actions">
              <span class="message-status">{message.status}</span>
              {#if message.text}
                <button
                  class="ghost-button compact message-action"
                  type="button"
                  onclick={() => handleCopy(message.id, message.text)}
                >
                  {copiedMessageId === message.id ? 'Copied' : 'Copy'}
                </button>
              {/if}
            </div>
          </header>

          {#if message.tools && message.tools.length > 0}
            <ToolCalls tools={message.tools} />
          {/if}

          {#if message.text}
            <div class="markdown-body">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderMarkdown(message.text)}
            </div>
          {/if}
        </article>
      {/if}
    {/each}

    {#if interactivePrompt}
      <InteractiveCard
        prompt={interactivePrompt}
        onSubmit={(formattedText) => onsubmit?.(formattedText)}
        onDismiss={() => oninteractivedismiss?.()}
      />
    {/if}
  </div>

  <div class="composer">
    <div class="composer-session-meta">
      <div class="composer-status-row">
        <span
          class="live-dot"
          class:ready={statusTone === 'ready'}
          class:error={statusTone === 'error'}
          class:running={statusTone === 'running'}
        ></span>
        <strong class="composer-status-title">{statusTitle}</strong>
        <div class="composer-status-spacer"></div>
        <div class="usage-rail">
          <span class="usage-chip">↑ {formatCompactTokenCount(usage?.inputTokens ?? 0)}</span>
          <span class="usage-chip">↓ {formatCompactTokenCount(usage?.outputTokens ?? 0)}</span>
          <span class="usage-chip usage-context" title={contextChipTitle}>{contextChipLabel}</span>
          <span class="usage-chip usage-cost">{formatUsageCost(usage?.totalCost ?? 0)}</span>
        </div>
        {#if canAbort}
          <button class="ghost-button compact" type="button" onclick={() => onabort?.()}>
            Stop
          </button>
        {/if}
      </div>
    </div>

    <label class="composer-terminal-input">
      <span class="composer-prefix">$</span>
      <textarea
        bind:this={promptField}
        bind:value={prompt}
        rows="3"
        placeholder="Ask pi to change the active repository..."
        oninput={handleInput}
        onclick={handleCursorActivity}
        onkeyup={handleCursorActivity}
        onkeydown={handleKeydown}></textarea>
    </label>

    {#if slashSuggestions.length > 0}
      <div class="composer-suggestion-list" role="listbox" aria-label="Slash command suggestions">
        {#each slashSuggestions as suggestion, index (`${suggestion.command}-${index}`)}
          <button
            class="composer-suggestion"
            class:selected={index === selectedSlashSuggestionIndex}
            type="button"
            role="option"
            aria-selected={index === selectedSlashSuggestionIndex}
            onclick={() => selectSlashSuggestion(suggestion)}
          >
            <strong>{suggestion.command}</strong>
            <span>{suggestion.description}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="composer-footer">
      <div class="composer-actions">
        <button
          class="secondary-button compact new-button"
          type="button"
          onclick={() => onnewsession?.()}
          disabled={runtimePhase !== 'idle'}
        >
          NEW
        </button>
        <div class="cmd-split" role="group" aria-label="Command palette actions">
          <button
            class="secondary-button compact cmd-button"
            type="button"
            onclick={() => onopencommands?.()}
            disabled={runtimePhase !== 'idle'}
          >
            CMD
          </button>
          <button
            class="secondary-button compact cmd-button-shortcut"
            type="button"
            onclick={() => onopenmodelcommands?.()}
            disabled={runtimePhase !== 'idle'}
            aria-label="Open model switcher"
            title="Quick open model switcher"
          >
            ▾
          </button>
        </div>
      </div>
      <button
        class="primary-button send-button"
        type="button"
        onpointerdown={handleSendPointerDown}
        onclick={handleSubmit}
        disabled={prompt.trim().length === 0}
      >
        Send <span class="send-button-model">{sendButtonModel}</span>
      </button>
    </div>
  </div>
</section>

<style>
  .chat-view {
    min-width: 0;
    font-family: 'IBM Plex Mono', 'Consolas', 'Liberation Mono', monospace;
  }

  .chat-view button,
  .chat-view textarea {
    font-family: 'IBM Plex Mono', 'Consolas', 'Liberation Mono', monospace;
  }

  .chat-log {
    position: relative;
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    padding: 0.9rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }

  .chat-log > * {
    min-width: 0;
  }

  .chat-log::before {
    content: 'transcript';
    position: absolute;
    top: 0;
    left: 0.9rem;
    transform: translateY(-50%);
    padding: 0.1rem 0.45rem;
    background: var(--surface);
    color: var(--muted);
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .message-card,
  .empty-state-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.22rem;
    color: var(--ink);
    padding: 0.9rem;
    min-width: 0;
    overflow-x: hidden;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.03),
      inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .message-card.user {
    background: var(--user-surface);
  }

  .message-card.assistant,
  .message-card.system,
  .empty-state-card {
    background: var(--surface-strong);
  }

  .message-card header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-bottom: 0.65rem;
    margin-bottom: 0.7rem;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 30%, transparent);
  }

  .message-heading {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }

  .message-prompt {
    color: var(--accent-strong);
    font-weight: 700;
    flex: 0 0 auto;
  }

  .message-card header strong,
  .message-status {
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .message-card header strong {
    overflow-wrap: anywhere;
  }

  .message-status,
  .empty-state-card p {
    color: var(--muted);
  }

  .message-meta-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .message-action {
    padding: 0.18rem 0.42rem;
    border-radius: 0.2rem;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .markdown-body {
    font-size: 0.96rem;
    line-height: 1.65;
    color: var(--ink);
    max-width: 100%;
    min-width: 0;
    overflow-x: hidden;
    overflow-wrap: anywhere;
  }

  .markdown-body > * {
    max-width: 100%;
  }

  .markdown-body > :first-child {
    margin-top: 0;
  }

  .markdown-body > :last-child {
    margin-bottom: 0;
  }

  .markdown-body :global(pre) {
    padding: 0.9rem;
    border-radius: 0.2rem;
    border: 1px solid color-mix(in srgb, var(--line) 38%, transparent);
    background: rgba(255, 255, 255, 0.06);
    color: var(--ink);
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .markdown-body :global(code) {
    display: inline-block;
    max-width: 100%;
    background: color-mix(in srgb, var(--line) 12%, transparent);
    color: inherit;
    padding: 0.08rem 0.28rem;
    border-radius: 0.18rem;
    white-space: pre;
    overflow-x: auto;
    overflow-y: hidden;
    vertical-align: bottom;
  }

  .markdown-body :global(pre code) {
    display: inline;
    max-width: none;
    background: transparent;
    padding: 0;
    white-space: inherit;
    overflow: visible;
  }

  .markdown-body :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    padding-left: 1.35rem;
  }

  .markdown-body :global(blockquote) {
    margin: 0;
    padding-left: 0.85rem;
    border-left: 2px solid color-mix(in srgb, var(--line) 32%, transparent);
    color: var(--muted);
  }

  .empty-state-card h3 {
    margin: 0 0 0.55rem;
    color: var(--ink);
  }

  .composer {
    display: grid;
    gap: 0.75rem;
    position: sticky;
    bottom: calc(4.8rem + env(safe-area-inset-bottom));
    z-index: 4;
    padding: 0.9rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }

  .composer-session-meta {
    display: grid;
    gap: 0.55rem;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: 0.22rem;
    background: var(--surface);
    color: var(--ink);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.03),
      inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .composer-status-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .composer-status-title {
    margin: 0;
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink);
  }

  .composer-status-spacer {
    flex: 1 1 auto;
  }

  .live-dot {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 0.15rem;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
  }

  .live-dot.running {
    animation: terminal-blink 1.15s steps(1, end) infinite;
  }

  .usage-rail {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .usage-chip {
    border: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
    border-radius: 0.2rem;
    background: var(--surface-strong);
    color: var(--muted);
    padding: 0.2rem 0.4rem;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .usage-chip.usage-context {
    color: var(--ink);
  }

  .usage-chip.usage-cost {
    font-weight: 800;
    color: var(--ink);
  }

  .composer-terminal-input {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.7rem;
    align-items: start;
    border: 1px solid var(--line);
    border-radius: 0.22rem;
    background: var(--surface);
    color: var(--ink);
    padding: 0.9rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.03),
      inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .composer-prefix {
    color: var(--accent-strong);
    font-weight: 700;
    padding-top: 0.05rem;
  }

  .composer textarea {
    min-height: 4.5rem;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    padding: 0;
    resize: vertical;
    line-height: 1.65;
  }

  .composer textarea:focus {
    outline: none;
  }

  .composer textarea::placeholder {
    color: var(--muted);
  }

  .composer-suggestion-list {
    display: grid;
    gap: 0.25rem;
    border: 1px solid var(--line);
    border-radius: 0.22rem;
    background: var(--surface-strong);
    padding: 0.4rem;
    max-height: 12rem;
    overflow-y: auto;
  }

  .composer-suggestion {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid transparent;
    border-radius: 0.2rem;
    background: transparent;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .composer-suggestion.selected,
  .composer-suggestion:hover {
    background: var(--surface-raised);
    border-color: var(--line);
  }

  .composer-suggestion strong {
    color: var(--accent-strong);
  }

  .composer-suggestion span {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .composer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .composer-actions {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .composer-actions .new-button {
    background: color-mix(in srgb, #2e88ff 22%, var(--surface));
    border-color: color-mix(in srgb, #2e88ff 60%, var(--line));
    color: var(--ink);
  }

  .composer-actions .new-button:hover {
    background: color-mix(in srgb, #2e88ff 34%, var(--surface));
  }

  .composer-actions .cmd-split {
    display: inline-flex;
    align-items: stretch;
  }

  .composer-actions .cmd-button,
  .composer-actions .cmd-button-shortcut {
    background: color-mix(in srgb, #7ac57a 22%, var(--surface));
    border-color: color-mix(in srgb, #7ac57a 58%, var(--line));
    color: var(--ink);
  }

  .composer-actions .cmd-button {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .composer-actions .cmd-button-shortcut {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left-width: 0;
    min-width: 2.2rem;
    padding-left: 0.45rem;
    padding-right: 0.45rem;
  }

  .composer-actions .cmd-button:hover,
  .composer-actions .cmd-button-shortcut:hover {
    background: color-mix(in srgb, #7ac57a 34%, var(--surface));
  }

  .composer-footer .send-button {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    margin-left: auto;
    white-space: nowrap;
    background: color-mix(in srgb, #fd6755 26%, var(--surface));
    border-color: color-mix(in srgb, #fd6755 60%, var(--line));
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .composer-footer .send-button .send-button-model {
    font-size: 0.58em;
    opacity: 0.75;
  }

  .composer-footer .send-button:hover {
    background: color-mix(in srgb, #fd6755 38%, var(--surface));
  }

  @keyframes terminal-blink {
    0%,
    50% {
      opacity: 1;
    }
    50.01%,
    100% {
      opacity: 0.35;
    }
  }

  @media (max-width: 859px) {
    .chat-view {
      --chat-composer-bottom-offset: 4.8rem;
      --chat-composer-horizontal-offset: 0.45rem;
      --chat-composer-reserve: clamp(6.5rem, 21vh, 8.8rem);
      padding-bottom: calc(var(--chat-composer-bottom-offset) + var(--chat-composer-reserve));
      min-height: 0;
    }

    .composer {
      position: fixed;
      left: var(--chat-composer-horizontal-offset);
      right: var(--chat-composer-horizontal-offset);
      bottom: var(--chat-composer-bottom-offset);
      z-index: 6;
      gap: 0.35rem;
      padding: 0.5rem;
    }

    .chat-log {
      padding: 0.55rem;
    }

    .composer-session-meta {
      gap: 0.3rem;
      padding: 0.4rem 0.5rem;
    }

    .composer-terminal-input {
      gap: 0.35rem;
      padding: 0.45rem;
    }

    .composer textarea {
      min-height: calc(1.45em * 3);
      line-height: 1.45;
      resize: none;
    }

    .composer-footer {
      gap: 0.4rem;
    }

    .composer-actions {
      gap: 0.3rem;
    }

    .composer .compact,
    .composer-footer .send-button {
      padding-top: 0.47rem;
      padding-bottom: 0.47rem;
    }
  }

  @media (max-width: 420px) {
    .composer-actions {
      gap: 0.5rem;
    }

    .composer-actions .cmd-button-shortcut {
      min-width: 2rem;
      padding-left: 0.35rem;
      padding-right: 0.35rem;
    }
  }

  @media (min-width: 860px) {
    .composer {
      bottom: 1rem;
    }
  }
</style>
