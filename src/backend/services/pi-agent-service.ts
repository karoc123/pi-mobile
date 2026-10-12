import { randomUUID } from 'node:crypto';

import { type AgentSession, type AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type {
  AgentCommandRequest,
  AgentCommandResponse,
  AgentCommandState,
  AgentMinimalState,
  AgentSnapshot,
  AgentThinkingLevel,
  AgentUsage,
  ChatMessage,
  ChatToolCall,
  InteractivePrompt,
  SelectedRepo,
  WebsocketEnvelope,
} from '../../shared/contracts.js';

import type { AppConfig } from '../config.js';
import {
  flattenMessageText,
  hydrateMessagesFromSession,
  summarizePayload,
} from './pi-agent-hydrator.js';
import { PiAgentSessionAdapter, type SessionOpenOptions } from './pi-agent-session-adapter.js';
import type { LogChannel } from './log-service.js';
import type { ModelUsageStore } from './model-usage-store.js';

type Broadcast = (event: WebsocketEnvelope) => void;

export class PiAgentService {
  private repoSelection: Promise<void> = Promise.resolve();
  private currentRepo: SelectedRepo | null = null;
  private messages: ChatMessage[] = [];
  private lastError: string | null = null;
  private activeAssistantMessageId: string | null = null;
  private interactivePrompt: InteractivePrompt | null = null;
  private readonly sessionAdapter: PiAgentSessionAdapter;

  constructor(
    private readonly config: AppConfig,
    private readonly broadcast: Broadcast,
    private readonly modelUsage: ModelUsageStore,
    private readonly logger: LogChannel,
  ) {
    this.sessionAdapter = new PiAgentSessionAdapter(this.config, this.logger, (event) => {
      this.handleSessionEvent(event);
    });
  }

  private emitSnapshot() {
    this.broadcast({
      type: 'snapshot',
      payload: this.getSnapshot(),
    });
  }

  private get session() {
    return this.sessionAdapter.getSession();
  }

  getCurrentRepo(): SelectedRepo | null {
    return this.currentRepo;
  }

  getSnapshot(): AgentSnapshot {
    const runtimeState = this.getRuntimeState();

    return {
      repo: this.currentRepo,
      ...runtimeState,
      messages: this.messages,
      lastError: this.lastError,
      usage: this.getUsageSummary(),
      interactivePrompt: this.interactivePrompt,
    };
  }

  getMinimalSnapshot(): AgentMinimalState {
    const runtimeState = this.getRuntimeState();
    const usage = this.getUsageSummary();

    // Letzte Nachricht als Vorschau (max 120 Zeichen)
    const lastAssistantMsg = [...this.messages].reverse().find((m) => m.role === 'assistant');
    const lastMessagePreview = lastAssistantMsg
      ? lastAssistantMsg.text.length > 120
        ? lastAssistantMsg.text.slice(0, 120) + '…'
        : lastAssistantMsg.text
      : null;
    const lastMessageFull = lastAssistantMsg?.text ?? null;

    return {
      repoName: this.currentRepo?.name ?? null,
      ...runtimeState,
      pendingMessageCount: runtimeState.pendingMessageCount ?? 0,
      lastError: this.lastError,
      lastMessagePreview,
      lastMessageFull,
      usage: {
        totalCost: usage.totalCost,
        totalTokens: usage.totalTokens,
        modelId: usage.modelId,
      },
    };
  }

  async getCommandState(): Promise<AgentCommandState> {
    if (!this.currentRepo) {
      return createEmptyCommandState();
    }

    const baseState = await this.sessionAdapter.getCommandState(this.currentRepo);

    return {
      ...baseState,
      models: this.modelUsage.rank(baseState.models),
    };
  }

  async executeCommand(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    if (!request || typeof request !== 'object' || typeof request.command !== 'string') {
      throw new Error('Missing agent command.');
    }

    const session = await this.ensureSession();

    switch (request.command) {
      case 'set-model': {
        const model = session.modelRuntime.getModel(request.provider, request.modelId);

        if (!model) {
          throw new Error(
            `Configured pi model ${request.provider}/${request.modelId} was not found.`,
          );
        }

        await session.setModel(model);
        return this.completeCommand(`Model switched to ${request.provider}/${request.modelId}.`);
      }

      case 'set-thinking': {
        session.setThinkingLevel(request.level);
        return this.completeCommand(`Thinking set to ${session.thinkingLevel}.`);
      }

      case 'set-auto-compact': {
        session.setAutoCompactionEnabled(request.enabled);
        return this.completeCommand(
          request.enabled ? 'Auto compaction enabled.' : 'Auto compaction disabled.',
        );
      }

      case 'set-steering-mode': {
        session.setSteeringMode(request.mode);
        return this.completeCommand(`Steering mode set to ${request.mode}.`);
      }

      case 'set-follow-up-mode': {
        session.setFollowUpMode(request.mode);
        return this.completeCommand(`Follow-up mode set to ${request.mode}.`);
      }

      case 'set-auto-retry': {
        session.setAutoRetryEnabled(request.enabled);
        return this.completeCommand(
          request.enabled ? 'Auto retry enabled.' : 'Auto retry disabled.',
        );
      }

      case 'abort-retry': {
        session.abortRetry();
        return this.completeCommand('Retry aborted.');
      }

      case 'compact': {
        const customInstructions =
          typeof request.customInstructions === 'string' &&
          request.customInstructions.trim().length > 0
            ? request.customInstructions.trim()
            : undefined;
        await session.compact(customInstructions);
        this.messages = hydrateMessagesFromSession(session.messages);
        this.emitSnapshot();
        return this.completeCommand('Context compacted.');
      }

      case 'run-bash': {
        const commandText = request.commandText.trim();

        if (commandText.length === 0) {
          throw new Error('Bash command cannot be empty.');
        }

        const runPromise = session.executeBash(commandText, undefined, {
          excludeFromContext: request.excludeFromContext,
        });

        this.lastError = null;
        this.emitStatus();

        const result = await runPromise;
        if (!session.isStreaming) {
          this.syncFromSession(session);
          this.emitSnapshot();
        }
        this.emitStatus();

        return {
          message: formatBashResultMessage(result.exitCode, result.cancelled, result.truncated),
          prompt: null,
        };
      }

      case 'abort-bash': {
        session.abortBash();
        return this.completeCommand('Bash command aborted.');
      }

      case 'set-session-name': {
        const nextName = request.name.trim();

        if (nextName.length === 0) {
          throw new Error('Session name cannot be empty.');
        }

        session.setSessionName(nextName);
        return this.completeCommand(`Session renamed to \"${nextName}\".`);
      }

      case 'export-session': {
        const outputPath =
          typeof request.outputPath === 'string' && request.outputPath.trim().length > 0
            ? request.outputPath.trim()
            : undefined;
        const exportedPath =
          request.format === 'html'
            ? await session.exportToHtml(outputPath)
            : session.exportToJsonl(outputPath);

        return this.completeCommand(`Session exported to ${exportedPath}.`);
      }

      case 'new-session': {
        await this.createSession(false, {
          preferredModel: getModelReference(session),
          preferredThinkingLevel: session.thinkingLevel as AgentThinkingLevel,
          useConfiguredDefaults: true,
        });
        this.emitSnapshot();
        return {
          message: 'Started a new session.',
          prompt: null,
        };
      }

      case 'resume-session': {
        await this.openSessionPath(request.sessionPath, {
          useConfiguredDefaults: false,
        });
        this.emitSnapshot();
        return {
          message: 'Session resumed.',
          prompt: null,
        };
      }

      case 'navigate-tree': {
        this.interactivePrompt = null;
        const result = await session.navigateTree(request.entryId);

        if (result.cancelled) {
          return {
            message: 'Tree navigation cancelled.',
            prompt: null,
          };
        }

        this.messages = hydrateMessagesFromSession(session.messages);
        this.emitSnapshot();
        return this.completeCommand(
          'Moved to the selected session point.',
          result.editorText ?? null,
        );
      }

      case 'fork-session': {
        const userMessage = session
          .getUserMessagesForForking()
          .find((entry) => entry.entryId === request.entryId);
        const sessionPath = session.sessionManager.createBranchedSession(request.entryId);

        if (!userMessage || !sessionPath) {
          throw new Error('Could not fork the selected session entry.');
        }

        await this.openSessionPath(sessionPath, {
          useConfiguredDefaults: false,
        });
        this.emitSnapshot();
        return {
          message: 'Forked a new session from the selected prompt.',
          prompt: userMessage.text,
        };
      }
    }
  }

  async selectRepo(repo: SelectedRepo) {
    const selection = this.repoSelection.then(() => this.activateRepo(repo));
    this.repoSelection = selection.catch(() => {});
    return selection;
  }

  private async activateRepo(repo: SelectedRepo) {
    if (this.currentRepo?.absolutePath === repo.absolutePath) {
      return;
    }

    this.currentRepo = repo;
    this.messages = [];
    this.lastError = null;
    this.activeAssistantMessageId = null;
    this.interactivePrompt = null;

    await this.resetSession();
    await this.restoreSession();

    this.emitStatus();
    this.emitSnapshot();
  }

  async prompt(promptText: string) {
    const session = await this.ensureSession();
    const accepted = await this.acceptPrompt(session, promptText);

    if (!accepted) {
      throw new Error('The prompt was rejected by the pi runtime.');
    }

    if (session.model) {
      this.modelUsage.record(session.model.provider, session.model.id);
    }

    // Clear any pending interactive prompt – the user is responding (or starting fresh).
    this.interactivePrompt = null;

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      text: promptText,
      status: 'complete',
      timestamp: new Date().toISOString(),
    };

    this.messages = [...this.messages, userMessage];
    this.broadcast({
      type: 'chat_message_added',
      payload: { message: userMessage },
    });
    this.lastError = null;
    this.emitStatus();
  }

  async abort() {
    await this.session?.abort();

    // Also clear queued steering/follow-up prompts so UI can't remain stuck in `queued`.
    this.session?.clearQueue?.();

    this.emitStatus();
  }

  async startNewSession() {
    if (!this.currentRepo) {
      throw new Error('No repository selected for pi session.');
    }

    this.messages = [];
    this.lastError = null;
    this.activeAssistantMessageId = null;
    this.interactivePrompt = null;

    await this.resetSession();

    try {
      await this.createSession(false);
    } catch (error) {
      this.recordError(error);
    }

    this.emitStatus();
    this.emitSnapshot();
  }

  async dispose() {
    await this.resetSession();
  }

  private async restoreSession() {
    try {
      const session = await this.ensureSession();
      this.syncFromSession(session);
    } catch (error) {
      this.recordError(error);
    }
  }

  private async ensureSession() {
    if (!this.currentRepo) {
      throw new Error('No repository selected for pi session.');
    }

    const repo = this.currentRepo;
    const session = await this.sessionAdapter.ensureSession(repo);
    if (this.currentRepo?.absolutePath !== repo.absolutePath)
      throw new Error('Repository changed while opening the session.');
    return session;
  }

  private async createSession(
    continueRecent: boolean,
    options: SessionOpenOptions = {
      useConfiguredDefaults: true,
    },
  ) {
    if (!this.currentRepo) {
      throw new Error('No repository selected for pi session.');
    }

    const session = await this.sessionAdapter.createSession(
      this.currentRepo,
      continueRecent,
      options,
    );
    this.interactivePrompt = null;
    this.lastError = null;
    this.syncFromSession(session);
    this.emitStatus();
    return session;
  }

  private async openSessionPath(sessionPath: string, options: SessionOpenOptions) {
    if (!this.currentRepo) {
      throw new Error('No repository selected for pi session.');
    }

    const session = await this.sessionAdapter.openSessionPath(
      this.currentRepo,
      sessionPath,
      options,
    );
    this.interactivePrompt = null;
    this.lastError = null;
    this.syncFromSession(session);
    this.emitStatus();
  }

  private syncFromSession(session: AgentSession) {
    this.messages = hydrateMessagesFromSession(session.messages);
    this.activeAssistantMessageId = null;
  }

  private async acceptPrompt(session: AgentSession, promptText: string) {
    return new Promise<boolean>((resolve, reject) => {
      let preflightSettled = false;

      try {
        const runPromise = session.prompt(promptText, {
          streamingBehavior: session.isStreaming ? 'steer' : undefined,
          preflightResult: (disposition) => {
            if (preflightSettled) {
              return;
            }

            preflightSettled = true;
            resolve(Boolean(disposition));
          },
        });

        void runPromise.catch((error) => {
          if (!preflightSettled) {
            preflightSettled = true;
            reject(error);
            return;
          }

          this.recordError(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleSessionEvent(event: AgentSessionEvent) {
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      const message: ChatMessage = {
        id: randomUUID(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        timestamp: new Date().toISOString(),
      };

      this.activeAssistantMessageId = message.id;
      this.messages = [...this.messages, message];
      this.broadcast({
        type: 'chat_message_added',
        payload: { message },
      });
      this.emitStatus();
      return;
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      if (!this.activeAssistantMessageId) {
        return;
      }

      const index = this.messages.findIndex((entry) => entry.id === this.activeAssistantMessageId);

      if (index === -1) {
        return;
      }

      const currentMessage = this.messages[index];
      const updatedMessage: ChatMessage = {
        ...currentMessage,
        text: `${currentMessage.text}${event.assistantMessageEvent.delta}`,
        status: 'streaming',
      };
      this.messages = [
        ...this.messages.slice(0, index),
        updatedMessage,
        ...this.messages.slice(index + 1),
      ];
      this.broadcast({
        type: 'chat_message_updated',
        payload: {
          messageId: updatedMessage.id,
          text: updatedMessage.text,
          status: updatedMessage.status,
        },
      });
      return;
    }

    if (event.type === 'message_end' && event.message.role === 'assistant') {
      if (event.message.stopReason === 'error')
        this.recordError(event.message.errorMessage || 'Provider request failed.');
      if (!this.activeAssistantMessageId) {
        return;
      }

      const index = this.messages.findIndex((entry) => entry.id === this.activeAssistantMessageId);

      if (index === -1) {
        this.activeAssistantMessageId = null;
        return;
      }

      const currentMessage = this.messages[index];
      const updatedMessage: ChatMessage = {
        ...currentMessage,
        text: currentMessage.text || flattenMessageText(event.message),
        status: 'complete',
      };
      this.messages = [
        ...this.messages.slice(0, index),
        updatedMessage,
        ...this.messages.slice(index + 1),
      ];
      this.activeAssistantMessageId = null;
      this.broadcast({
        type: 'chat_message_updated',
        payload: {
          messageId: updatedMessage.id,
          text: updatedMessage.text,
          status: updatedMessage.status,
        },
      });
      this.emitStatus();
      return;
    }

    if (event.type === 'tool_execution_start' && event.toolName === 'ask_user') {
      const prompt = parseInteractivePromptArgs(event.args);

      if (prompt) {
        this.interactivePrompt = prompt;
        this.broadcast({
          type: 'interactive_prompt',
          payload: prompt,
        });
      } else {
        this.logger.warn('Invalid ask_user tool arguments – skipping interactive prompt.', {
          event: 'ask_user_invalid',
          repo: this.currentRepo?.absolutePath ?? null,
          details: { args: event.args },
        });
      }

      this.updateAssistantTool(event.toolCallId, () => ({
        id: event.toolCallId,
        name: event.toolName,
        status: 'running',
        detail: `ask_user: ${summarizePayload(event.args)}`,
      }));
      this.emitStatus();
      return;
    }

    if (event.type === 'tool_execution_start') {
      this.updateAssistantTool(event.toolCallId, () => ({
        id: event.toolCallId,
        name: event.toolName,
        status: 'running',
        detail: summarizePayload(event.args),
      }));
      this.emitStatus();
      return;
    }

    if (event.type === 'tool_execution_update') {
      this.updateAssistantTool(event.toolCallId, (existing) => ({
        id: event.toolCallId,
        name: event.toolName,
        status: 'running',
        detail: summarizePayload(event.partialResult, 4096) || existing?.detail,
      }));
      this.emitStatus();
      return;
    }

    if (event.type === 'tool_execution_end') {
      const endDetail = extractToolExecutionEndDetail(event.result);
      this.updateAssistantTool(event.toolCallId, (existing) => ({
        id: event.toolCallId,
        name: event.toolName,
        status: event.isError ? 'error' : 'complete',
        detail: summarizePayload(endDetail, 4096) || existing?.detail,
      }));
      this.emitStatus();
      return;
    }

    if (event.type === 'compaction_end' && event.result && this.session) {
      this.syncFromSession(this.session);
      this.emitSnapshot();
    }
    if (event.type === 'auto_retry_end' && event.finalError) this.recordError(event.finalError);

    if (event.type === 'agent_settled') {
      if (this.session) {
        this.syncFromSession(this.session);
        this.emitSnapshot();
      }
      this.emitStatus();
      return;
    }

    if (
      event.type === 'agent_start' ||
      event.type === 'turn_start' ||
      event.type === 'agent_end' ||
      event.type === 'turn_end' ||
      event.type === 'queue_update' ||
      event.type === 'compaction_start' ||
      event.type === 'compaction_end' ||
      event.type === 'auto_retry_start' ||
      event.type === 'auto_retry_end'
    ) {
      this.emitStatus();
    }
  }

  private completeCommand(message: string, prompt: string | null = null): AgentCommandResponse {
    this.lastError = null;
    this.emitStatus();
    return { message, prompt };
  }

  private recordError(error: unknown) {
    const message = toErrorMessage(error);
    this.logger.error('Pi agent runtime reported an error.', {
      event: 'pi_agent_error',
      repo: this.currentRepo?.absolutePath ?? null,
      details: {
        message,
      },
    });
    this.lastError = message;
    this.broadcast({
      type: 'agent_error',
      payload: { message },
    });
    this.emitStatus();
  }

  private emitStatus() {
    const runtimeState = this.getRuntimeState();

    this.broadcast({
      type: 'agent_status',
      payload: {
        ...runtimeState,
        lastError: this.lastError,
        repo: this.currentRepo,
        usage: this.getUsageSummary(),
      },
    });
  }

  private getRuntimeState() {
    return this.sessionAdapter.getRuntimeState();
  }

  private async resetSession() {
    this.interactivePrompt = null;
    await this.sessionAdapter.reset();
  }

  private getUsageSummary(): AgentUsage {
    const realUsage = this.sessionAdapter.getUsageSummary();

    if (realUsage) {
      return realUsage;
    }

    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      contextTokens: null,
      contextWindow: null,
      contextPercent: null,
      modelId: null,
      usingSubscription: false,
      autoCompactEnabled: false,
    };
  }

  private updateAssistantTool(
    toolCallId: string,
    updateFn: (existing?: ChatToolCall) => ChatToolCall,
  ): void {
    const lastAssistantIndex = [...this.messages]
      .reverse()
      .findIndex((entry) => entry.role === 'assistant');

    if (lastAssistantIndex === -1) {
      return;
    }

    const index = this.messages.length - 1 - lastAssistantIndex;
    const currentMessage = this.messages[index];
    const tools = currentMessage.tools ? [...currentMessage.tools] : [];
    const existingIndex = tools.findIndex((entry) => entry.id === toolCallId);
    const updatedTool = updateFn(existingIndex >= 0 ? tools[existingIndex] : undefined);

    if (existingIndex >= 0) {
      tools[existingIndex] = updatedTool;
    } else {
      tools.push(updatedTool);
    }

    const updatedMessage: ChatMessage = {
      ...currentMessage,
      tools,
    };

    this.messages = [
      ...this.messages.slice(0, index),
      updatedMessage,
      ...this.messages.slice(index + 1),
    ];

    this.broadcast({
      type: 'chat_message_updated',
      payload: {
        messageId: updatedMessage.id,
        text: updatedMessage.text,
        status: updatedMessage.status,
        tools: updatedMessage.tools,
      },
    });
  }
}

function createEmptyCommandState(): AgentCommandState {
  return {
    session: null,
    models: [],
    thinkingLevels: [],
    steeringMode: 'all',
    followUpMode: 'one-at-a-time',
    autoCompactEnabled: false,
    autoRetryEnabled: false,
    isRetrying: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    availableCommands: [],
    resumeSessions: [],
    treeEntries: [],
    forkEntries: [],
  };
}

function getModelReference(session: AgentSession) {
  if (!session.model) {
    return null;
  }

  return {
    provider: session.model.provider,
    modelId: session.model.id,
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unknown pi runtime error.';
}

function formatBashResultMessage(
  exitCode: number | undefined,
  cancelled: boolean,
  truncated: boolean,
) {
  const exitLabel = typeof exitCode === 'number' ? String(exitCode) : 'n/a';
  const suffix = truncated ? ' Output was truncated.' : '';

  if (cancelled) {
    return `Bash run cancelled (exit ${exitLabel}).${suffix}`;
  }

  return `Bash run finished with exit ${exitLabel}.${suffix}`;
}

/**
 * Parse and validate the args of the "ask_user" tool into an InteractivePrompt.
 * Returns null if the payload is malformed.
 */
export function parseInteractivePromptArgs(args: unknown): InteractivePrompt | null {
  if (!args || typeof args !== 'object') {
    return null;
  }

  const raw = args as Record<string, unknown>;

  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
    return null;
  }

  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    return null;
  }

  const questions: InteractivePrompt['questions'] = [];

  for (const q of raw.questions) {
    if (!q || typeof q !== 'object') {
      return null;
    }

    const qRaw = q as Record<string, unknown>;

    if (typeof qRaw.id !== 'string' || qRaw.id.trim().length === 0) {
      return null;
    }

    if (typeof qRaw.label !== 'string' || qRaw.label.trim().length === 0) {
      return null;
    }

    if (
      !Array.isArray(qRaw.options) ||
      qRaw.options.length === 0 ||
      !qRaw.options.every((opt: unknown) => typeof opt === 'string')
    ) {
      return null;
    }

    questions.push({
      id: qRaw.id.trim(),
      label: qRaw.label.trim(),
      options: qRaw.options as string[],
      allowFreeText: qRaw.allowFreeText === true,
      multiple: qRaw.multiple === true,
      placeholder:
        typeof qRaw.placeholder === 'string' && qRaw.placeholder.trim().length > 0
          ? qRaw.placeholder.trim()
          : undefined,
    });
  }

  return {
    promptId: randomUUID(),
    title: raw.title.trim(),
    questions,
  };
}

function extractToolExecutionEndDetail(result: unknown): string {
  if (result === null || result === undefined) {
    return '';
  }

  if (typeof result === 'string') {
    return result;
  }

  if (typeof result === 'object' && 'content' in result) {
    const content = (result as { content: unknown }).content;
    if (typeof content === 'string') {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'text' in item) {
            return String((item as { text: unknown }).text ?? '');
          }
          return '';
        })
        .join('')
        .trim();
      if (text.length > 0) {
        return text;
      }
    }
  }

  return summarizePayload(result, null);
}
