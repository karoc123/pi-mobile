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
