import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent
} from '@earendil-works/pi-coding-agent';

import type { AgentSnapshot, ChatMessage, SelectedRepo, ToolActivity, WebsocketEnvelope } from '../../shared/contracts.js';

import type { AppConfig } from '../config.js';

type Broadcast = (event: WebsocketEnvelope) => void;

export class PiAgentService {
  private currentRepo: SelectedRepo | null = null;
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private messages: ChatMessage[] = [];
  private tools: ToolActivity[] = [];
  private lastError: string | null = null;
  private activeAssistantMessageId: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly broadcast: Broadcast
  ) {}

  getSnapshot(): AgentSnapshot {
    return {
      repo: this.currentRepo,
      isConfigured: this.currentRepo !== null,
      isStreaming: this.session?.isStreaming ?? false,
      messages: this.messages,
      tools: this.tools,
      lastError: this.lastError
    };
  }

  async selectRepo(repo: SelectedRepo) {
    if (this.currentRepo?.absolutePath === repo.absolutePath) {
      return;
    }

    this.currentRepo = repo;
    this.messages = [];
    this.tools = [];
    this.lastError = null;
    this.activeAssistantMessageId = null;
    await this.resetSession();
    await this.restoreSession();
    this.emitStatus();
  }

  async prompt(promptText: string) {
    const session = await this.ensureSession();
    const accepted = await this.acceptPrompt(session, promptText);

    if (!accepted) {
      throw new Error('The prompt was rejected by the pi runtime.');
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      text: promptText,
      status: 'complete',
      timestamp: new Date().toISOString()
    };

    this.messages = [...this.messages, userMessage];
    this.broadcast({
      type: 'chat_message_added',
      payload: { message: userMessage }
    });
    this.lastError = null;
    this.emitStatus();
  }

  async abort() {
    await this.session?.abort();
    this.emitStatus();
  }

  async dispose() {
    await this.resetSession();
  }

  private async restoreSession() {
    try {
      await this.ensureSession();
    } catch (error) {
      this.recordError(error);
    }
  }

  private async ensureSession() {
    if (!this.currentRepo) {
      throw new Error('No repository selected for pi session.');
    }

    if (this.session) {
      return this.session;
    }

    const authStorage = this.config.piAgentDir
      ? AuthStorage.create(path.join(this.config.piAgentDir, 'auth.json'))
      : AuthStorage.create();
    const modelRegistry = this.config.piAgentDir
      ? ModelRegistry.create(authStorage, path.join(this.config.piAgentDir, 'models.json'))
      : ModelRegistry.create(authStorage);
    const sessionManager = SessionManager.continueRecent(this.currentRepo.absolutePath, this.config.piSessionDir);
    const configuredModel = this.resolveConfiguredModel(modelRegistry);
    const { session } = await createAgentSession({
      cwd: this.currentRepo.absolutePath,
      agentDir: this.config.piAgentDir,
      authStorage,
      modelRegistry,
      sessionManager,
      model: configuredModel,
      thinkingLevel: this.config.piThinkingLevel
    });

    this.session = session;
    this.messages = hydrateMessagesFromSession(session.messages);
    this.unsubscribe = session.subscribe((event) => {
      this.handleSessionEvent(event);
    });
    this.emitStatus();

    return session;
  }

  private resolveConfiguredModel(modelRegistry: ModelRegistry) {
    if (!this.config.piProvider || !this.config.piModel) {
      return undefined;
    }

    const model = modelRegistry.find(this.config.piProvider, this.config.piModel);

    if (!model) {
      throw new Error(`Configured pi model ${this.config.piProvider}/${this.config.piModel} was not found.`);
    }

    return model;
  }

  private async acceptPrompt(session: AgentSession, promptText: string) {
    return new Promise<boolean>((resolve, reject) => {
      let preflightSettled = false;

      try {
        const runPromise = session.prompt(promptText, {
          streamingBehavior: session.isStreaming ? 'steer' : undefined,
          preflightResult: (success) => {
            if (preflightSettled) {
              return;
            }

            preflightSettled = true;
            resolve(success);
          }
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
        timestamp: new Date().toISOString()
      };

      this.activeAssistantMessageId = message.id;
      this.messages = [...this.messages, message];
      this.broadcast({
        type: 'chat_message_added',
        payload: { message }
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
        status: 'streaming'
      };
      this.messages = [
        ...this.messages.slice(0, index),
        updatedMessage,
        ...this.messages.slice(index + 1)
      ];
      this.broadcast({
        type: 'chat_message_updated',
        payload: {
          messageId: updatedMessage.id,
          text: updatedMessage.text,
          status: updatedMessage.status
        }
      });
      return;
    }

    if (event.type === 'message_end' && event.message.role === 'assistant') {
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
        status: 'complete'
      };
      this.messages = [
        ...this.messages.slice(0, index),
        updatedMessage,
        ...this.messages.slice(index + 1)
      ];
      this.activeAssistantMessageId = null;
      this.broadcast({
        type: 'chat_message_updated',
        payload: {
          messageId: updatedMessage.id,
          text: updatedMessage.text,
          status: updatedMessage.status
        }
      });
      this.emitStatus();
      return;
    }

    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const tool: ToolActivity = {
        id: event.toolCallId,
        toolName: event.toolName,
        status:
          event.type === 'tool_execution_end'
            ? event.isError
              ? 'error'
              : 'complete'
            : 'running',
        detail:
          event.type === 'tool_execution_start'
            ? summarizePayload(event.args)
            : event.type === 'tool_execution_update'
              ? summarizePayload(event.partialResult)
              : summarizePayload(event.result)
      };

      this.tools = upsertTool(this.tools, tool);
      this.broadcast({
        type: 'tool_activity',
        payload: { tool }
      });
      this.emitStatus();
      return;
    }

    if (event.type === 'agent_end' || event.type === 'turn_end') {
      this.emitStatus();
    }
  }

  private recordError(error: unknown) {
    const message = toErrorMessage(error);
    this.lastError = message;
    this.broadcast({
      type: 'agent_error',
      payload: { message }
    });
    this.emitStatus();
  }

  private emitStatus() {
    this.broadcast({
      type: 'agent_status',
      payload: {
        isConfigured: this.currentRepo !== null,
        isStreaming: this.session?.isStreaming ?? false,
        lastError: this.lastError,
        repo: this.currentRepo
      }
    });
  }

  private async resetSession() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
  }
}

function hydrateMessagesFromSession(sessionMessages: readonly unknown[]) {
  return sessionMessages
    .map((entry) => toChatMessage(entry))
    .filter((entry): entry is ChatMessage => entry !== null);
}

function toChatMessage(entry: unknown): ChatMessage | null {
  if (!entry || typeof entry !== 'object' || !('role' in entry)) {
    return null;
  }

  const candidate = entry as { role?: string; createdAt?: string; content?: unknown[] };

  if (candidate.role !== 'user' && candidate.role !== 'assistant') {
    return null;
  }

  return {
    id: randomUUID(),
    role: candidate.role,
    text: flattenMessageText(candidate),
    status: 'complete',
    timestamp: candidate.createdAt ?? new Date().toISOString()
  };
}

function flattenMessageText(message: { content?: unknown[] }) {
  if (!Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .map((chunk) => {
      if (typeof chunk === 'string') {
        return chunk;
      }

      if (!chunk || typeof chunk !== 'object') {
        return '';
      }

      const typedChunk = chunk as { type?: string; text?: string; toolName?: string; name?: string; result?: unknown };

      if (typedChunk.type === 'text') {
        return typedChunk.text ?? '';
      }

      if (typedChunk.type === 'tool-call') {
        return `\n[tool:${typedChunk.toolName ?? typedChunk.name ?? 'unknown'}]`;
      }

      if (typedChunk.type === 'tool-result') {
        return `\n${summarizePayload(typedChunk.result)}`;
      }

      return typedChunk.text ?? '';
    })
    .join('')
    .trim();
}

function upsertTool(tools: ToolActivity[], tool: ToolActivity) {
  const remainder = tools.filter((entry) => entry.id !== tool.id);
  return [tool, ...remainder].slice(0, 12);
}

function summarizePayload(payload: unknown) {
  if (typeof payload === 'string') {
    return payload.slice(0, 240);
  }

  if (payload === null || payload === undefined) {
    return '';
  }

  try {
    return JSON.stringify(payload).slice(0, 240);
  } catch {
    return String(payload).slice(0, 240);
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown pi runtime error.';
}