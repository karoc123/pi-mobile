<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';

  import type { AgentRuntimePhase, AgentSlashCommand, AgentUsage, ChatMessage, ToolActivity } from '../../../src/shared/contracts.js';
  import { formatCompactTokenCount, formatUsageCost } from '../lib/agent-usage.js';
  import { applySlashCommandSuggestion, getSlashCommandSuggestions, toRuntimeSlashCommandSuggestions, type SlashCommandSuggestion } from '../lib/command-suggestions.js';
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
  export let availableCommands: AgentSlashCommand[] = [];
  export let draftStorageScope = 'default';

  const dispatch = createEventDispatcher<{
    submit: { prompt: string };
    abort: void;
    keepRunning: void;
    openCommands: void;
    openModelCommands: void;
    newSession: void;
  }>();

  let prompt = '';
  let logEndAnchor: HTMLDivElement | null = null;
  let promptField: HTMLTextAreaElement | null = null;
  let composerPanel: HTMLDivElement | null = null;
  let handledPrefillToken = 0;
  let toolTraceExpanded = false;
  let expandedTraceToolMap: Record<string, boolean> = {};
  let expandedMessageToolMap: Record<string, boolean> = {};
  let shouldAutoScroll = true;
  let previousFinalAssistantMessageId: string | null = null;
  let displayEntries: DisplayEntry[] = [];
  let hiddenEntryMap: Record<string, boolean> = {};
  let copiedEntryId: string | null = null;
  let copiedEntryResetTimer: number | null = null;
  let activePromptDraftStorageKey = '';
  let hydratedPromptDraftStorageKey = '';
  let promptCursorIndex = 0;
  let runtimeSlashCommandSuggestions: SlashCommandSuggestion[] = [];
  let slashCommandSuggestions: SlashCommandSuggestion[] = [];
  let selectedSlashSuggestionIndex = 0;
  let slashSuggestionsDismissed = false;

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
  $: latestFinalAssistantMessageId = getLatestFinalAssistantMessageId(messages);
  $: normalizedDraftStorageScope = draftStorageScope.trim().length > 0 ? draftStorageScope.trim() : 'default';
  $: nextPromptDraftStorageKey = buildPromptDraftStorageKey(normalizedDraftStorageScope);
  $: runtimeSlashCommandSuggestions = toRuntimeSlashCommandSuggestions(availableCommands);
  $: slashCommandSuggestions = slashSuggestionsDismissed ? [] : getSlashCommandSuggestions(prompt, promptCursorIndex, runtimeSlashCommandSuggestions);
  $: if (slashCommandSuggestions.length === 0) {
    selectedSlashSuggestionIndex = 0;
  } else if (selectedSlashSuggestionIndex >= slashCommandSuggestions.length) {
    selectedSlashSuggestionIndex = slashCommandSuggestions.length - 1;
  }

  $: if (nextPromptDraftStorageKey !== activePromptDraftStorageKey) {
    activePromptDraftStorageKey = nextPromptDraftStorageKey;
    hydratePromptDraft(activePromptDraftStorageKey);
  }

  $: if (hydratedPromptDraftStorageKey === activePromptDraftStorageKey && activePromptDraftStorageKey.length > 0) {
    persistPromptDraft(activePromptDraftStorageKey, prompt);
  }

  $: if (prefillToken !== handledPrefillToken) {
    handledPrefillToken = prefillToken;
    void applyPrefill(prefillPrompt);
  }

  $: if (latestFinalAssistantMessageId !== previousFinalAssistantMessageId) {
    previousFinalAssistantMessageId = latestFinalAssistantMessageId;

    if (latestFinalAssistantMessageId && shouldAutoScroll) {
      requestAnimationFrame(() => {
        scrollWindowToBottom();
      });
    }
  }

  onMount(() => {
    const handleWindowScroll = () => {
      shouldAutoScroll = isNearViewportBottom();
    };

    const handleViewportResize = () => {
      shouldAutoScroll = isNearViewportBottom();
    };

    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    window.addEventListener('resize', handleViewportResize, { passive: true });
    handleWindowScroll();

    if (shouldAutoScroll) {
      requestAnimationFrame(() => {
        scrollWindowToBottom();
      });
    }

    return () => {
      window.removeEventListener('scroll', handleWindowScroll);
      window.removeEventListener('resize', handleViewportResize);

      if (copiedEntryResetTimer !== null) {
        window.clearTimeout(copiedEntryResetTimer);
        copiedEntryResetTimer = null;
      }
    };
  });

  function buildPromptDraftStorageKey(scope: string) {
    return `pimobile.chat.prompt-draft.${encodeURIComponent(scope)}`;
  }

  function hydratePromptDraft(storageKey: string) {
    if (typeof window === 'undefined') {
      hydratedPromptDraftStorageKey = storageKey;
      return;
    }

    try {
      prompt = window.localStorage.getItem(storageKey) ?? '';
    } catch {
      prompt = '';
    }

    hydratedPromptDraftStorageKey = storageKey;
  }

  function persistPromptDraft(storageKey: string, value: string) {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (value.length > 0) {
        window.localStorage.setItem(storageKey, value);
      } else {
        window.localStorage.removeItem(storageKey);
      }
    } catch {
      // Ignore storage access failures (private mode, quota, blocked storage).
    }
  }

  function submit() {
    if (prompt.trim().length === 0) {
      return;
    }

    dispatch('submit', { prompt: prompt.trim() });
    prompt = '';
    promptCursorIndex = 0;
  }

  async function applyPrefill(nextPrompt: string) {
    prompt = nextPrompt;
    await tick();
    promptField?.focus();
    promptField?.setSelectionRange(nextPrompt.length, nextPrompt.length);
    promptCursorIndex = nextPrompt.length;
  }

  function updatePromptCursorPosition() {
    if (promptField) {
      promptCursorIndex = promptField.selectionStart ?? prompt.length;
      return;
    }

    promptCursorIndex = prompt.length;
  }

  function handleComposerInput() {
    slashSuggestionsDismissed = false;
    updatePromptCursorPosition();
  }

  function handleComposerCursorActivity() {
    slashSuggestionsDismissed = false;
    updatePromptCursorPosition();
  }

  async function selectSlashCommandSuggestion(suggestion: SlashCommandSuggestion) {
    const cursorIndex = promptField?.selectionStart ?? promptCursorIndex;
    const nextValue = applySlashCommandSuggestion(prompt, cursorIndex, suggestion);
    prompt = nextValue.prompt;
    await tick();
    promptField?.focus();
    promptField?.setSelectionRange(nextValue.cursorIndex, nextValue.cursorIndex);
    promptCursorIndex = nextValue.cursorIndex;
    selectedSlashSuggestionIndex = 0;
    slashSuggestionsDismissed = false;
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if (slashCommandSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedSlashSuggestionIndex = (selectedSlashSuggestionIndex + 1) % slashCommandSuggestions.length;
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedSlashSuggestionIndex = (selectedSlashSuggestionIndex - 1 + slashCommandSuggestions.length) % slashCommandSuggestions.length;
        return;
      }

      if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        void selectSlashCommandSuggestion(slashCommandSuggestions[selectedSlashSuggestionIndex]);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        slashSuggestionsDismissed = true;
        return;
      }
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  function isNearViewportBottom() {
    if (!logEndAnchor) {
      return true;
    }

    const anchorRect = logEndAnchor.getBoundingClientRect();
    const visibleChatBottom = window.innerHeight - getViewportBottomObstruction();
    return anchorRect.top <= visibleChatBottom + 120;
  }

  function scrollWindowToBottom() {
    if (!logEndAnchor) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return;
    }

    const visibleChatBottom = window.innerHeight - getViewportBottomObstruction();
    const anchorTop = logEndAnchor.getBoundingClientRect().top;
    const targetTop = window.scrollY + anchorTop - (visibleChatBottom - 16);
    window.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
  }

  function getViewportBottomObstruction() {
    let obstruction = 0;

    if (composerPanel) {
      const composerRect = composerPanel.getBoundingClientRect();
      obstruction = Math.max(obstruction, window.innerHeight - composerRect.top);
    }

    const bottomNav = document.querySelector<HTMLElement>('.bottom-nav');

    if (bottomNav) {
      const navRect = bottomNav.getBoundingClientRect();
      obstruction = Math.max(obstruction, window.innerHeight - navRect.top);
    }

    return Math.max(0, obstruction);
  }

  function describeMessageStatus(message: ChatMessage) {
    if (message.role === 'assistant') {
      return message.status === 'streaming' ? 'working...' : 'ready';
    }

    return new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function getLatestFinalAssistantMessageId(messageList: ChatMessage[]) {
    for (let index = messageList.length - 1; index >= 0; index -= 1) {
      const message = messageList[index];

      if (message.role !== 'assistant') {
        continue;
      }

      if (message.status !== 'complete') {
        continue;
      }

      if (message.text.trim().length === 0) {
        continue;
      }

      return message.id;
    }

    return null;
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

  function displayEntryId(entry: DisplayEntry) {
    return entry.kind === 'chat' ? `chat:${entry.message.id}` : `tool:${entry.id}`;
  }

  function describeDisplayEntryPrompt(entry: DisplayEntry) {
    if (entry.kind === 'chat') {
      return describeMessagePrompt(entry.message);
    }

    return 'pi>';
  }

  function describeDisplayEntryRole(entry: DisplayEntry) {
    if (entry.kind === 'chat') {
      return describeMessageRole(entry.message);
    }

    return 'tools';
  }

  function toggleDisplayEntryHidden(entry: DisplayEntry) {
    const entryId = displayEntryId(entry);

    hiddenEntryMap = {
      ...hiddenEntryMap,
      [entryId]: !hiddenEntryMap[entryId],
    };
  }

  function isDisplayEntryHidden(entry: DisplayEntry) {
    return !!hiddenEntryMap[displayEntryId(entry)];
  }

  function isDisplayEntryCopied(entry: DisplayEntry) {
    return copiedEntryId === displayEntryId(entry);
  }

  function textForDisplayEntry(entry: DisplayEntry) {
    if (entry.kind === 'chat') {
      return entry.message.text;
    }

    return entry.toolCalls.map((toolCall) => formatToolCallLine(toolCall)).join('\n');
  }

  async function copyDisplayEntryText(entry: DisplayEntry) {
    const copied = await writeToClipboard(textForDisplayEntry(entry));

    if (!copied) {
      return;
    }

    copiedEntryId = displayEntryId(entry);

    if (copiedEntryResetTimer !== null) {
      window.clearTimeout(copiedEntryResetTimer);
    }

    copiedEntryResetTimer = window.setTimeout(() => {
      copiedEntryId = null;
      copiedEntryResetTimer = null;
    }, 1500);
  }

  async function writeToClipboard(value: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Fall through to legacy copy mechanism.
      }
    }

    if (typeof document === 'undefined') {
      return false;
    }

    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', 'true');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    helper.style.pointerEvents = 'none';
    document.body.appendChild(helper);
    helper.select();

    let copied = false;

    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }

    document.body.removeChild(helper);
    return copied;
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

  $: sendButtonModel = `(${modelLabelForSendButton(usage?.modelId ?? null)})`;
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

      {#if toolTraceExpanded && totalToolCount > 0}
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
      {:else}
        <p class="tool-trace-empty subdued">
          {totalToolCount === 0 ? 'No tool activity yet.' : `${totalToolCount} tool event${totalToolCount === 1 ? '' : 's'}. Expand to inspect.`}
        </p>
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
      {#if isDisplayEntryHidden(entry)}
        <article class="message-card message-card-hidden">
          <header>
            <div class="message-heading">
              <span class="message-prompt">{describeDisplayEntryPrompt(entry)}</span>
              <strong>{describeDisplayEntryRole(entry)}</strong>
            </div>
            <div class="message-meta-actions">
              <span class="message-status">hidden</span>
              <button class="ghost-button compact message-action" type="button" on:click={() => toggleDisplayEntryHidden(entry)}>Show</button>
            </div>
          </header>
          <p class="subdued">Entry hidden. Tap Show to reveal it again.</p>
        </article>
      {:else if entry.kind === 'chat'}
        <article class:assistant={entry.message.role === 'assistant'} class:system={entry.message.role === 'system'} class:user={entry.message.role === 'user'} class="message-card">
          <header>
            <div class="message-heading">
              <span class="message-prompt">{describeMessagePrompt(entry.message)}</span>
              <strong>{describeMessageRole(entry.message)}</strong>
            </div>
            <div class="message-meta-actions">
              <span class="message-status">{describeMessageStatus(entry.message)}</span>
              <button class="ghost-button compact message-action" type="button" on:click={() => copyDisplayEntryText(entry)}>{isDisplayEntryCopied(entry) ? 'Copied' : 'Copy'}</button>
              <button class="ghost-button compact message-action" type="button" on:click={() => toggleDisplayEntryHidden(entry)}>Hide</button>
            </div>
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
            <div class="message-meta-actions">
              <span class="message-status">{entry.statusLabel}</span>
              <button class="ghost-button compact message-action" type="button" on:click={() => copyDisplayEntryText(entry)}>{isDisplayEntryCopied(entry) ? 'Copied' : 'Copy'}</button>
              <button class="ghost-button compact message-action" type="button" on:click={() => toggleDisplayEntryHidden(entry)}>Hide</button>
            </div>
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

  <div class="composer" bind:this={composerPanel}>
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
        rows="3"
        placeholder="Ask pi to change the active repository..."
        on:input={handleComposerInput}
        on:click={handleComposerCursorActivity}
        on:focus={handleComposerCursorActivity}
        on:keyup={handleComposerCursorActivity}
        on:keydown={handleComposerKeydown}
      ></textarea>
    </label>
    {#if slashCommandSuggestions.length > 0}
      <div class="composer-suggestion-list" role="listbox" aria-label="Slash command suggestions">
        {#each slashCommandSuggestions as suggestion, index (`${suggestion.command}-${index}`)}
          <button
            class:selected={index === selectedSlashSuggestionIndex}
            class="composer-suggestion"
            type="button"
            role="option"
            aria-selected={index === selectedSlashSuggestionIndex}
            on:mousedown|preventDefault
            on:click={() => void selectSlashCommandSuggestion(suggestion)}
          >
            <strong>{suggestion.command}</strong>
            <span>{suggestion.description}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="composer-footer">
      <div class="composer-actions">
        <button class="secondary-button compact new-button" type="button" on:click={() => dispatch('newSession')} disabled={runtimePhase !== 'idle'}>
          NEW
        </button>
        <div class="cmd-split" role="group" aria-label="Command palette actions">
          <button class="secondary-button compact cmd-button" type="button" on:click={() => dispatch('openCommands')} disabled={runtimePhase !== 'idle'}>
            CMD
          </button>
          <button
            class="secondary-button compact cmd-button-shortcut"
            type="button"
            on:click={() => dispatch('openModelCommands')}
            disabled={runtimePhase !== 'idle'}
            aria-label="Open model switcher"
            title="Quick open model switcher"
          >
            ▾
          </button>
        </div>
        {#if showKeepRunning && runtimePhase !== 'idle'}
          <button class="secondary-button compact keep-running-button" type="button" on:click={() => dispatch('keepRunning')}>
            Keep running
          </button>
        {/if}
      </div>
      <button class="primary-button send-button" type="button" on:click={submit} disabled={prompt.trim().length === 0 || (showKeepRunning && runtimePhase !== 'idle')}>
        <span class="send-button-model">{sendButtonModel}</span>
      </button>
    </div>
  </div>
</section>