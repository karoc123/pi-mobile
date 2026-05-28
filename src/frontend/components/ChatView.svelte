<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';

  import type { AgentUsage, ChatMessage, ToolActivity } from '../../../src/shared/contracts.js';
  import { formatModelLabel, formatUsageSummary } from '../lib/agent-usage.js';
  import { renderMarkdown } from '../lib/markdown.js';

  export let messages: ChatMessage[] = [];
  export let tools: ToolActivity[] = [];
  export let isStreaming = false;
  export let lastError: string | null = null;
  export let usage: AgentUsage;
  export let prefillPrompt = '';
  export let prefillToken = 0;

  const dispatch = createEventDispatcher<{
    submit: { prompt: string };
    abort: void;
    openCommands: void;
  }>();

  let prompt = '';
  let logEndAnchor: HTMLDivElement | null = null;
  let promptField: HTMLTextAreaElement | null = null;
  let handledPrefillToken = 0;

  $: statusTitle = lastError
    ? 'Agent needs attention'
    : isStreaming
      ? 'Pi is working'
      : messages.length > 0
        ? 'Agent finished'
        : 'Ready for your first prompt';
  $: statusDetail = lastError
    ? lastError
    : isStreaming
      ? 'Streaming response and tool activity live.'
      : messages.length > 0
        ? 'Response complete. Ready for the next prompt.'
        : 'Type a prompt and use CMD for Pi actions.';
  $: statusTone = lastError ? 'error' : isStreaming ? 'running' : 'ready';

  $: if (prefillToken !== handledPrefillToken) {
    handledPrefillToken = prefillToken;
    void applyPrefill(prefillPrompt);
  }

  $: if (logEndAnchor && messages) {
    requestAnimationFrame(() => {
      logEndAnchor?.scrollIntoView({ block: 'end' });
    });
  }

  function submit() {
    if (prompt.trim().length === 0) {
      return;
    }

    dispatch('submit', { prompt: prompt.trim() });
    prompt = '';
  }

  async function applyPrefill(nextPrompt: string) {
    prompt = nextPrompt;
    await tick();
    promptField?.focus();
    promptField?.setSelectionRange(nextPrompt.length, nextPrompt.length);
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  function describeMessageStatus(message: ChatMessage) {
    if (message.role === 'assistant') {
      return message.status === 'streaming' ? 'working...' : 'ready';
    }

    return new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="view-shell chat-view">
  <section class="chat-status-card card-panel">
    <div class="chat-status-main">
      <span class:ready={statusTone === 'ready'} class:error={statusTone === 'error'} class:running={statusTone === 'running'} class="live-dot"></span>
      <div>
        <p class="eyebrow">Live agent</p>
        <h2>{statusTitle}</h2>
        <p class="subdued">{statusDetail}</p>
      </div>
    </div>
    <div class="chat-status-actions">
      <div class="usage-summary" title={formatUsageSummary(usage)}>{formatUsageSummary(usage)}</div>
      <div class="model-summary" title={formatModelLabel(usage.modelId)}>{formatModelLabel(usage.modelId)}</div>
      <button class="ghost-button" type="button" on:click={() => dispatch('abort')} disabled={!isStreaming}>
        Stop run
      </button>
    </div>
  </section>

  {#if lastError}
    <div class="notice error">{lastError}</div>
  {/if}

  {#if tools.length > 0}
    <section class="activity-panel card-panel">
      <div class="activity-header">
        <strong>Recent tool activity</strong>
        <span class="subdued">{tools.length}</span>
      </div>
      <div class="tool-strip">
        {#each tools as tool}
          <article class:error={tool.status === 'error'} class:running={tool.status === 'running'} class:success={tool.status === 'complete'} class="tool-chip">
            <div class="tool-chip-header">
              <strong>{tool.toolName}</strong>
              <span>{tool.status}</span>
            </div>
            {#if tool.detail}
              <p>{tool.detail}</p>
            {/if}
          </article>
        {/each}
      </div>
    </section>
  {/if}

  <div class="chat-log">
    {#if messages.length === 0}
      <article class="empty-state-card">
        <h3>No conversation yet</h3>
        <p>Send the first prompt once a repository is selected. The status card above will switch between working and ready as Pi completes each run.</p>
      </article>
    {/if}

    {#each messages as message}
      <article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'} class="message-card">
        <header>
          <strong>{message.role}</strong>
          <span>{describeMessageStatus(message)}</span>
        </header>
        <div class="markdown-body">{@html renderMarkdown(message.text || '_No text returned._')}</div>
      </article>
    {/each}
    <div class="chat-log-end" aria-hidden="true" bind:this={logEndAnchor}></div>
  </div>

  <div class="composer">
    <textarea
      bind:this={promptField}
      bind:value={prompt}
      rows="4"
      placeholder="Ask pi to change the active repository..."
      on:keydown={handleComposerKeydown}
    ></textarea>
    <div class="composer-footer">
      <div class="composer-actions">
        <button class="secondary-button compact" type="button" on:click={() => dispatch('openCommands')} disabled={isStreaming}>
          CMD
        </button>
        <span class="subdued">Use CMD for model, session, compact, tree, and fork actions.</span>
      </div>
      <button class="primary-button" type="button" on:click={submit} disabled={prompt.trim().length === 0}>
        {isStreaming ? 'Send follow-up' : 'Send prompt'}
      </button>
    </div>
  </div>
</section>