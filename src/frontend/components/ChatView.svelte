<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';

  import type { AgentRuntimePhase, AgentUsage, ChatMessage, ToolActivity } from '../../../src/shared/contracts.js';
  import { formatCompactTokenCount, formatUsageCost } from '../lib/agent-usage.js';
  import { renderMarkdown } from '../lib/markdown.js';

  type ToolTraceBatch = {
    id: string;
    tools: ToolActivity[];
  };

  type ParsedToolCall = {
    id: string;
    toolName: string;
    detail: string;
  };

  type DisplayEntry =
    | {
        kind: 'chat';
        message: ChatMessage;
      }
    | {
        kind: 'tool-group';
        id: string;
        toolCalls: ParsedToolCall[];
        statusLabel: string;
      };

  export let messages: ChatMessage[] = [];
  export let toolBatches: ToolTraceBatch[] = [];
  export let runtimePhase: AgentRuntimePhase = 'idle';
  export let pendingMessageCount = 0;
  export let canAbort = false;
  export let showKeepRunning = false;
  export let lastError: string | null = null;
  export let usage: AgentUsage;
  export let prefillPrompt = '';
  export let prefillToken = 0;

  const dispatch = createEventDispatcher<{
    submit: { prompt: string };
    abort: void;
    keepRunning: void;
    openCommands: void;
    newSession: void;
  }>();

  let prompt = '';
  let logEndAnchor: HTMLDivElement | null = null;
  let promptField: HTMLTextAreaElement | null = null;
  let handledPrefillToken = 0;
  let toolTraceExpanded = false;
  let expandedTraceToolMap: Record<string, boolean> = {};
  let expandedMessageToolMap: Record<string, boolean> = {};
  let shouldAutoScroll = true;
  let previousMessageSignature = '';
  let displayEntries: DisplayEntry[] = [];

  $: statusTitle = lastError
    ? 'Agent needs attention'
    : showKeepRunning
      ? 'Awaiting keep running'
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
                : 'Ready';
  $: statusTone = lastError ? 'error' : runtimePhase === 'idle' ? 'ready' : 'running';
  $: totalToolCount = toolBatches.reduce((sum, batch) => sum + batch.tools.length, 0);
  $: displayEntries = buildDisplayEntries(messages);
  $: messageSignature = messages.map((message) => `${message.id}:${message.status}:${message.text.length}`).join('|');

  $: if (prefillToken !== handledPrefillToken) {
    handledPrefillToken = prefillToken;
    void applyPrefill(prefillPrompt);
  }

  $: if (messageSignature !== previousMessageSignature) {
    previousMessageSignature = messageSignature;

    if (shouldAutoScroll) {
      requestAnimationFrame(() => {
        logEndAnchor?.scrollIntoView({ block: 'end' });
      });
    }
  }

  onMount(() => {
    const handleWindowScroll = () => {
      shouldAutoScroll = isNearViewportBottom();
    };

    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    handleWindowScroll();

    return () => {
      window.removeEventListener('scroll', handleWindowScroll);
    };
  });

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

  function isNearViewportBottom() {
    return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
  }

  function describeMessageStatus(message: ChatMessage) {
    if (message.role === 'assistant') {
      return message.status === 'streaming' ? 'working...' : 'ready';
    }

    return new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function describeMessageRole(message: ChatMessage) {
    if (message.role === 'assistant') {
      return 'pi';
    }

    if (message.role === 'system') {
      return 'system';
    }

    return 'you';
  }

  function describeMessagePrompt(message: ChatMessage) {
    if (message.role === 'assistant') {
      return 'pi>';
    }

    if (message.role === 'system') {
      return '!!';
    }

    return '$';
  }

  function normalizeToolName(toolName: string) {
    return toolName.trim().toLowerCase().replace(/\s+/g, '-');
  }

  function resolveToolIcon(toolName: string) {
    const normalized = normalizeToolName(toolName);

    if (normalized.includes('read')) {
      return 'read';
    }

    if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('patch')) {
      return 'write';
    }

    if (normalized.includes('search') || normalized.includes('grep') || normalized.includes('find')) {
      return 'search';
    }

    if (normalized.includes('bash') || normalized.includes('run') || normalized.includes('test') || normalized.includes('build')) {
      return 'terminal';
    }

    return 'generic';
  }

  function iconPath(icon: string) {
    if (icon === 'read') {
      return 'M4 5a2 2 0 0 1 2-2h11a3 3 0 0 1 3 3v13a1 1 0 0 1-1.447.894A5 5 0 0 0 16 19H6a2 2 0 0 1-2-2V5zm2 0v12h10a7.1 7.1 0 0 1 2 .29V6a1 1 0 0 0-1-1H6z';
    }

    if (icon === 'write') {
      return 'M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 0 0 0-1.41l-2.5-2.5a1 1 0 0 0-1.41 0l-1.84 1.84l3.75 3.75l1.99-1.68z';
    }

    if (icon === 'search') {
      return 'M15.5 14h-.79l-.28-.27a6 6 0 1 0-.71.71l.27.28v.79L20 21.5L21.5 20l-6-6zM10 15a5 5 0 1 1 0-10a5 5 0 0 1 0 10z';
    }

    if (icon === 'terminal') {
      return 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm3.2 2.7L8.5 10L6.2 12.3l1.1 1.1l3.4-3.4l-3.4-3.4L6.2 7.7zM11 13h6v-1.5h-6V13z';
    }

    return 'M11.3 1.05a1 1 0 0 1 1.4 0l1.11 1.12a2.5 2.5 0 0 0 2.13.67l1.57-.3a1 1 0 0 1 1.17.78l.3 1.57a2.5 2.5 0 0 0 1.36 1.8l1.42.7a1 1 0 0 1 .46 1.34l-.7 1.42a2.5 2.5 0 0 0 0 2.24l.7 1.42a1 1 0 0 1-.46 1.34l-1.42.7a2.5 2.5 0 0 0-1.36 1.8l-.3 1.57a1 1 0 0 1-1.17.78l-1.57-.3a2.5 2.5 0 0 0-2.13.67l-1.11 1.12a1 1 0 0 1-1.4 0L10.2 21.8a2.5 2.5 0 0 0-2.13-.67l-1.57.3a1 1 0 0 1-1.17-.78l-.3-1.57a2.5 2.5 0 0 0-1.36-1.8l-1.42-.7a1 1 0 0 1-.46-1.34l.7-1.42a2.5 2.5 0 0 0 0-2.24l-.7-1.42a1 1 0 0 1 .46-1.34l1.42-.7a2.5 2.5 0 0 0 1.36-1.8l.3-1.57a1 1 0 0 1 1.17-.78l1.57.3a2.5 2.5 0 0 0 2.13-.67l1.1-1.12zM12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z';
  }

  function formatContextChip(usageValue: AgentUsage) {
    const usedLabel = usageValue.contextTokens === null ? '?' : formatCompactTokenCount(usageValue.contextTokens);
    const windowLabel = usageValue.contextWindow === null ? '?' : formatCompactTokenCount(usageValue.contextWindow);

    return `${usedLabel}/${windowLabel}`;
  }

  function formatContextChipTitle(usageValue: AgentUsage) {
    const usedLabel = usageValue.contextTokens === null ? '?' : formatCompactTokenCount(usageValue.contextTokens);
    const windowLabel = usageValue.contextWindow === null ? '?' : formatCompactTokenCount(usageValue.contextWindow);
    const modeLabel = usageValue.autoCompactEnabled ? 'auto compact on' : 'auto compact off';

    return `Context usage ${usedLabel}/${windowLabel} (${modeLabel})`;
  }

  function parseToolCalls(message: ChatMessage) {
    const lines = message.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return [] as ParsedToolCall[];
    }

    const parsed: ParsedToolCall[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      if (isIgnorableToolWrapperLine(lines[index])) {
        continue;
      }

      const match = lines[index].match(/^[-*]?\s*\[tool:([^\]]+)\]\s*(.*)$/i);

      if (!match) {
        return [];
      }

      parsed.push({
        id: `${message.id}-${index}`,
        toolName: match[1],
        detail: match[2] ?? '',
      });
    }

    return parsed;
  }

  function isIgnorableToolWrapperLine(line: string) {
    return line === '```' || /^```[a-z0-9_-]*$/i.test(line);
  }

  function buildDisplayEntries(messageList: ChatMessage[]) {
    const entries: DisplayEntry[] = [];
    let activeToolGroup: Extract<DisplayEntry, { kind: 'tool-group' }> | null = null;

    for (const message of messageList) {
      if (isSkippableAssistantPlaceholder(message)) {
        continue;
      }

      const parsedToolCalls = message.role === 'assistant' ? parseToolCalls(message) : [];

      if (parsedToolCalls.length > 0) {
        if (!activeToolGroup) {
          activeToolGroup = {
            kind: 'tool-group',
            id: `tool-group-${message.id}`,
            toolCalls: parsedToolCalls,
            statusLabel: describeMessageStatus(message),
          };
          entries.push(activeToolGroup);
        } else {
          activeToolGroup.toolCalls = [...activeToolGroup.toolCalls, ...parsedToolCalls];
          activeToolGroup.statusLabel = describeMessageStatus(message);
        }

        continue;
      }

      activeToolGroup = null;
      entries.push({ kind: 'chat', message });
    }

    return entries;
  }

  function isSkippableAssistantPlaceholder(message: ChatMessage) {
    return message.role === 'assistant' && message.text.trim().length === 0;
  }

  function compactInline(value: string, maxLength: number) {
    const oneLine = value.replace(/\s+/g, ' ').trim();

    if (oneLine.length <= maxLength) {
      return oneLine;
    }

    return `${oneLine.slice(0, maxLength)}...`;
  }

  function summarizeToolLine(tool: ToolActivity) {
    const compactDetail = compactInline(tool.detail, 160);
    const normalizedName = normalizeToolName(tool.toolName);
    return compactDetail.length > 0 ? `[tool:${normalizedName}] ${compactDetail}` : `[tool:${normalizedName}]`;
  }

  function formatToolCallLine(toolCall: ParsedToolCall) {
    const normalizedName = normalizeToolName(toolCall.toolName);
    return toolCall.detail.length > 0 ? `[tool:${normalizedName}] ${toolCall.detail}` : `[tool:${normalizedName}]`;
  }

  function describeToolState(status: ToolActivity['status']) {
    if (status === 'running') {
      return 'running';
    }

    if (status === 'error') {
      return 'error';
    }

    return 'done';
  }

  function toggleTraceToolDetail(toolId: string) {
    expandedTraceToolMap = {
      ...expandedTraceToolMap,
      [toolId]: !expandedTraceToolMap[toolId],
    };
  }

  function isTraceToolExpanded(toolId: string) {
    return !!expandedTraceToolMap[toolId];
  }

  function messageToolKey(groupId: string, toolCallId: string) {
    return `${groupId}::${toolCallId}`;
  }

  function toggleMessageToolDetail(groupId: string, toolCallId: string) {
    const key = messageToolKey(groupId, toolCallId);

    expandedMessageToolMap = {
      ...expandedMessageToolMap,
      [key]: !expandedMessageToolMap[key],
    };
  }

  function isMessageToolExpanded(groupId: string, toolCallId: string) {
    return !!expandedMessageToolMap[messageToolKey(groupId, toolCallId)];
  }

  function modelLabelForSendButton(modelId: string | null) {
    if (!modelId) {
      return 'no-model';
    }

    const compact = modelId.split('/').filter(Boolean).pop() ?? modelId;
    return compact.length > 20 ? `${compact.slice(0, 20)}...` : compact;
  }

  function sendButtonModelLabel() {
    return `(${modelLabelForSendButton(usage.modelId)})`;
  }
</script>

<section class="view-shell chat-view">
  {#if lastError}
    <div class="notice error">{lastError}</div>
  {/if}

  <section class="activity-panel card-panel">
      <button
        class="tool-trace-toggle ghost-button compact"
        type="button"
        on:click={() => (toolTraceExpanded = !toolTraceExpanded)}
        aria-expanded={toolTraceExpanded}
      >
        <strong>Tool trace</strong>
        <span class="subdued">{totalToolCount}</span>
      </button>

      {#if totalToolCount === 0}
        <p class="tool-trace-empty subdued">No tool activity yet.</p>
      {:else if toolTraceExpanded}
        <div class="tool-batch-stack">
          {#each toolBatches as batch, index (batch.id)}
            <article class="tool-batch">
              <header class="tool-batch-header">
                <strong>Batch {toolBatches.length - index}</strong>
                <span class="subdued">{batch.tools.length}</span>
              </header>

              <div class="tool-inline-list">
                {#each batch.tools as tool (tool.id)}
                  <button
                    class:error={tool.status === 'error'}
                    class:running={tool.status === 'running'}
                    class:success={tool.status === 'complete'}
                    class="tool-inline-item"
                    type="button"
                    aria-expanded={isTraceToolExpanded(tool.id)}
                    on:click={() => toggleTraceToolDetail(tool.id)}
                  >
                    <span class="tool-inline-main">
                      <span class="tool-inline-icon icon-{resolveToolIcon(tool.toolName)}" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="14" height="14" focusable="false" aria-hidden="true">
                          <path fill="currentColor" d={iconPath(resolveToolIcon(tool.toolName))}></path>
                        </svg>
                      </span>
                      <span class="tool-inline-text">{summarizeToolLine(tool)}</span>
                    </span>
                    <span class="tool-inline-status">{describeToolState(tool.status)}</span>
                  </button>

                  {#if isTraceToolExpanded(tool.id)}
                    <pre class="tool-inline-detail">{tool.detail || 'No detail returned.'}</pre>
                  {/if}
                {/each}
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  <div class="chat-log">
    {#if messages.length === 0}
      <article class="empty-state-card">
        <h3>No transcript yet</h3>
        <p>Send the first prompt once a repository is selected. New prompts and agent output will appear here like a running CLI session.</p>
      </article>
    {/if}

    {#each displayEntries as entry (entry.kind === 'chat' ? `chat-${entry.message.id}` : entry.id)}
      {#if entry.kind === 'chat'}
        <article class:assistant={entry.message.role === 'assistant'} class:system={entry.message.role === 'system'} class:user={entry.message.role === 'user'} class="message-card">
          <header>
            <div class="message-heading">
              <span class="message-prompt">{describeMessagePrompt(entry.message)}</span>
              <strong>{describeMessageRole(entry.message)}</strong>
            </div>
            <span class="message-status">{describeMessageStatus(entry.message)}</span>
          </header>
          <div class="markdown-body">{@html renderMarkdown(entry.message.text || '_No text returned._')}</div>
        </article>
      {:else}
        <article class="message-card assistant tool-summary-card">
          <header>
            <div class="message-heading">
              <span class="message-prompt">pi&gt;</span>
              <strong>tools</strong>
            </div>
            <span class="message-status">{entry.statusLabel}</span>
          </header>

          <div class="tool-summary-icons">
            {#each entry.toolCalls as toolCall (toolCall.id)}
              <button
                class="tool-summary-icon icon-{resolveToolIcon(toolCall.toolName)}"
                type="button"
                title={formatToolCallLine(toolCall)}
                aria-expanded={isMessageToolExpanded(entry.id, toolCall.id)}
                on:click={() => toggleMessageToolDetail(entry.id, toolCall.id)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" focusable="false" aria-hidden="true">
                  <path fill="currentColor" d={iconPath(resolveToolIcon(toolCall.toolName))}></path>
                </svg>
              </button>
            {/each}
          </div>

          {#each entry.toolCalls as toolCall (toolCall.id)}
            {#if isMessageToolExpanded(entry.id, toolCall.id)}
              <pre class="tool-summary-detail">{formatToolCallLine(toolCall)}</pre>
            {/if}
          {/each}
        </article>
      {/if}
    {/each}
    <div class="chat-log-end" aria-hidden="true" bind:this={logEndAnchor}></div>
  </div>

  <div class="composer">
    <div class="composer-session-meta">
      <div class="composer-status-row">
        <span class:ready={statusTone === 'ready'} class:error={statusTone === 'error'} class:running={statusTone === 'running'} class="live-dot"></span>
        <strong class="composer-status-title">{statusTitle}</strong>
        <div class="composer-status-spacer"></div>
        <div class="usage-rail">
          <span class="usage-chip">↑ {formatCompactTokenCount(usage.inputTokens)}</span>
          <span class="usage-chip">↓ {formatCompactTokenCount(usage.outputTokens)}</span>
          <span class="usage-chip usage-context" title={formatContextChipTitle(usage)}>{formatContextChip(usage)}</span>
          <span class="usage-chip usage-cost">{formatUsageCost(usage.totalCost)}</span>
        </div>
        {#if canAbort}
          <button class="ghost-button compact" type="button" on:click={() => dispatch('abort')}>
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
        rows="4"
        placeholder="Ask pi to change the active repository..."
        on:keydown={handleComposerKeydown}
      ></textarea>
    </label>

    <div class="composer-footer">
      <div class="composer-actions">
        <button class="secondary-button compact new-button" type="button" on:click={() => dispatch('newSession')} disabled={runtimePhase !== 'idle'}>
          NEW
        </button>
        <button class="secondary-button compact cmd-button" type="button" on:click={() => dispatch('openCommands')} disabled={runtimePhase !== 'idle'}>
          CMD
        </button>
        {#if showKeepRunning && runtimePhase !== 'idle'}
          <button class="secondary-button compact keep-running-button" type="button" on:click={() => dispatch('keepRunning')}>
            Keep running
          </button>
        {/if}
      </div>
      <button class="primary-button send-button" type="button" on:click={submit} disabled={prompt.trim().length === 0 || (showKeepRunning && runtimePhase !== 'idle')}>
        <span>SEND</span>
        <span class="send-button-model">{sendButtonModelLabel()}</span>
      </button>
    </div>
  </div>
</section>