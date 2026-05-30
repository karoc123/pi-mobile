import { randomUUID } from "node:crypto";

import { type AgentSession, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type {
  AgentCommandRequest,
  AgentCommandResponse,
  AgentCommandState,
  AgentSnapshot,
  AgentThinkingLevel,
  AgentUsage,
  ChatMessage,
  SelectedRepo,
  ToolActivity,
  WebsocketEnvelope,
} from "../../shared/contracts.js";

import type { AppConfig } from "../config.js";
import { CostService } from "./cost-service.js";
import { flattenMessageText, hydrateMessagesFromSession, summarizePayload, summarizeText, upsertTool } from "./pi-agent-hydrator.js";
import { PiAgentMockAdapter } from "./pi-agent-mock-adapter.js";
import { PiAgentSessionAdapter, type SessionOpenOptions } from "./pi-agent-session-adapter.js";
import type { LogChannel } from "./log-service.js";

type Broadcast = (event: WebsocketEnvelope) => void;

export class PiAgentService {
  private currentRepo: SelectedRepo | null = null;
  private messages: ChatMessage[] = [];
  private tools: ToolActivity[] = [];
  private lastError: string | null = null;
  private activeAssistantMessageId: string | null = null;
  private readonly mockAdapter = new PiAgentMockAdapter();
  private readonly sessionAdapter: PiAgentSessionAdapter;
  private activeCostSessionKey: string | null = null;
  private activeCostSessionStartedAt: string | null = null;
  private readonly logger: LogChannel;

  constructor(
    private readonly config: AppConfig,
    private readonly broadcast: Broadcast,
    private readonly costService: CostService,
    logger?: LogChannel,
  ) {
    this.logger = logger ?? createNoopLogger();
    this.sessionAdapter = new PiAgentSessionAdapter(this.config, this.logger, (event) => {
      this.handleSessionEvent(event);
    });
  }

  private get session() {
    return this.sessionAdapter.getSession();
  }

  getSnapshot(): AgentSnapshot {
    const runtimeState = this.getRuntimeState();

    return {
      repo: this.currentRepo,
      isConfigured: this.currentRepo !== null,
      ...runtimeState,
      messages: this.messages,
      tools: this.tools,
      lastError: this.lastError,
      usage: this.getUsageSummary(),
    };
  }

  async getCommandState(): Promise<AgentCommandState> {
    if (!this.currentRepo) {
      return createEmptyCommandState();
    }

    if (this.config.piMockMode) {
      return this.mockAdapter.getCommandState(this.currentRepo, this.messages);
    }

    return this.sessionAdapter.getCommandState(this.currentRepo);
  }

  async executeCommand(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    if (!request || typeof request !== "object" || typeof request.command !== "string") {
      throw new Error("Missing agent command.");
    }

    if (this.config.piMockMode) {
      return this.mockAdapter.executeCommand(request, {
        getCurrentRepo: () => this.currentRepo,
        getMessages: () => this.messages,
        setMessages: (messages) => {
          this.messages = messages;
        },
        setTools: (tools) => {
          this.tools = tools;
        },
        setLastError: (message) => {
          this.lastError = message;
        },
        setActiveAssistantMessageId: (messageId) => {
          this.activeAssistantMessageId = messageId;
        },
        broadcast: this.broadcast,
        emitStatus: () => {
          this.emitStatus();
        },
      });
    }

    const session = await this.ensureSession();

    switch (request.command) {
      case "set-model": {
        const model = session.modelRegistry.find(request.provider, request.modelId);

        if (!model) {
          throw new Error(`Configured pi model ${request.provider}/${request.modelId} was not found.`);
        }

        await session.setModel(model);
        this.lastError = null;
        this.emitStatus();
        return {
          message: `Model switched to ${request.provider}/${request.modelId}.`,
          prompt: null,
        };
      }

      case "set-thinking": {
        session.setThinkingLevel(request.level);
        this.lastError = null;
        this.emitStatus();
        return {
          message: `Thinking set to ${session.thinkingLevel}.`,
          prompt: null,
        };
      }

      case "set-auto-compact": {
        session.setAutoCompactionEnabled(request.enabled);
        this.lastError = null;
        this.emitStatus();
        return {
          message: request.enabled ? "Auto compaction enabled." : "Auto compaction disabled.",
          prompt: null,
        };
      }

      case "set-steering-mode": {
        session.setSteeringMode(request.mode);
        this.lastError = null;
        this.emitStatus();
        return {
          message: `Steering mode set to ${request.mode}.`,
          prompt: null,
        };
      }

      case "set-follow-up-mode": {
        session.setFollowUpMode(request.mode);
        this.lastError = null;
        this.emitStatus();
        return {
          message: `Follow-up mode set to ${request.mode}.`,
          prompt: null,
        };
      }

      case "set-auto-retry": {
        session.setAutoRetryEnabled(request.enabled);
        this.lastError = null;
        this.emitStatus();
        return {
          message: request.enabled ? "Auto retry enabled." : "Auto retry disabled.",
          prompt: null,
        };
      }

      case "abort-retry": {
        session.abortRetry();
        this.lastError = null;
        this.emitStatus();
        return {
          message: "Retry aborted.",
          prompt: null,
        };
      }

      case "compact": {
        const customInstructions = typeof request.customInstructions === "string" && request.customInstructions.trim().length > 0 ? request.customInstructions.trim() : undefined;
        await session.compact(customInstructions);
        this.messages = hydrateMessagesFromSession(session.messages);
        this.lastError = null;
        this.emitStatus();
        return {
          message: "Context compacted.",
          prompt: null,
        };
      }

      case "run-bash": {
        const commandText = request.commandText.trim();

        if (commandText.length === 0) {
          throw new Error("Bash command cannot be empty.");
        }

        const runPromise = session.executeBash(commandText, undefined, {
          excludeFromContext: request.excludeFromContext,
        });

        this.lastError = null;
        this.emitStatus();

        const result = await runPromise;
        this.messages = hydrateMessagesFromSession(session.messages);
        this.emitStatus();

        return {
          message: formatBashResultMessage(result.exitCode, result.cancelled, result.truncated),
          prompt: null,
        };
      }

      case "abort-bash": {
        session.abortBash();
        this.lastError = null;
        this.emitStatus();
        return {
          message: "Bash command aborted.",
          prompt: null,
        };
      }

      case "set-session-name": {
        const nextName = request.name.trim();

        if (nextName.length === 0) {
          throw new Error("Session name cannot be empty.");
        }

        session.setSessionName(nextName);
        this.lastError = null;
        this.emitStatus();
        return {
          message: `Session renamed to \"${nextName}\".`,
          prompt: null,
        };
      }

      case "export-session": {
        const outputPath = typeof request.outputPath === "string" && request.outputPath.trim().length > 0 ? request.outputPath.trim() : undefined;
        const exportedPath = request.format === "html" ? await session.exportToHtml(outputPath) : session.exportToJsonl(outputPath);

        this.lastError = null;
        this.emitStatus();

        return {
          message: `Session exported to ${exportedPath}.`,
          prompt: null,
        };
      }

      case "new-session": {
        await this.createSession(false, {
          preferredModel: getModelReference(session),
          preferredThinkingLevel: session.thinkingLevel as AgentThinkingLevel,
          useConfiguredDefaults: true,
        });
        return {
          message: "Started a new session.",
          prompt: null,
        };
      }

      case "resume-session": {
        await this.openSessionPath(request.sessionPath, {
          useConfiguredDefaults: false,
        });
        return {
          message: "Session resumed.",
          prompt: null,
        };
      }

      case "navigate-tree": {
        const result = await session.navigateTree(request.entryId);

        if (result.cancelled) {
          return {
            message: "Tree navigation cancelled.",
            prompt: null,
          };
        }

        this.messages = hydrateMessagesFromSession(session.messages);
        this.tools = [];
        this.lastError = null;
        this.emitStatus();
        return {
          message: "Moved to the selected session point.",
          prompt: result.editorText ?? null,
        };
      }

      case "fork-session": {
        const userMessage = session.getUserMessagesForForking().find((entry) => entry.entryId === request.entryId);
        const sessionPath = session.sessionManager.createBranchedSession(request.entryId);

        if (!userMessage || !sessionPath) {
          throw new Error("Could not fork the selected session entry.");
        }

        await this.openSessionPath(sessionPath, {
          useConfiguredDefaults: false,
        });
        return {
          message: "Forked a new session from the selected prompt.",
          prompt: userMessage.text,
        };
      }
    }
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

    if (this.config.piMockMode) {
      this.mockAdapter.resetForRepoSelection();
    }

    await this.resetSession();

    if (!this.config.piMockMode) {
      await this.restoreSession();
    } else {
      this.beginMockSession();
    }

    this.emitStatus();
  }

  async prompt(promptText: string) {
    if (this.config.piMockMode) {
      await this.mockAdapter.prompt(promptText, {
        getCurrentRepo: () => this.currentRepo,
        getMessages: () => this.messages,
        setMessages: (messages) => {
          this.messages = messages;
        },
        setTools: (tools) => {
          this.tools = tools;
        },
        setLastError: (message) => {
          this.lastError = message;
        },
        setActiveAssistantMessageId: (messageId) => {
          this.activeAssistantMessageId = messageId;
        },
        broadcast: this.broadcast,
        emitStatus: () => {
          this.emitStatus();
        },
      });
      return;
    }

    const session = await this.ensureSession();
    const accepted = await this.acceptPrompt(session, promptText);

    if (!accepted) {
      throw new Error("The prompt was rejected by the pi runtime.");
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      text: promptText,
      status: "complete",
      timestamp: new Date().toISOString(),
    };

    this.messages = [...this.messages, userMessage];
    this.broadcast({
      type: "chat_message_added",
      payload: { message: userMessage },
    });
    this.lastError = null;
    this.emitStatus();
  }

  async abort() {
    if (this.config.piMockMode) {
      this.mockAdapter.abort();
    }

    await this.session?.abort();
    this.emitStatus();
  }

  async startNewSession() {
    if (!this.currentRepo) {
      throw new Error("No repository selected for pi session.");
    }

    this.messages = [];
    this.tools = [];
    this.lastError = null;
    this.activeAssistantMessageId = null;

    if (this.config.piMockMode) {
      this.mockAdapter.resetForNewSession();
    }

    await this.resetSession();

    if (!this.config.piMockMode) {
      try {
        await this.createSession(false);
      } catch (error) {
        this.recordError(error);
      }
    } else {
      this.beginMockSession();
    }

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
      throw new Error("No repository selected for pi session.");
    }

    if (this.config.piMockMode) {
      throw new Error("Mock mode does not create a real pi session.");
    }

    return this.sessionAdapter.ensureSession(this.currentRepo);
  }

  private async createSession(
    continueRecent: boolean,
    options: SessionOpenOptions = {
      useConfiguredDefaults: true,
    },
  ) {
    if (!this.currentRepo) {
      throw new Error("No repository selected for pi session.");
    }

    this.finalizeTrackedSession();
    const session = await this.sessionAdapter.createSession(this.currentRepo, continueRecent, options);
    this.ensureTrackedSessionReference(new Date().toISOString());
    this.syncFromSession(session);
    this.emitStatus();
    return session;
  }

  private async openSessionPath(sessionPath: string, options: SessionOpenOptions) {
    if (!this.currentRepo) {
      throw new Error("No repository selected for pi session.");
    }

    this.finalizeTrackedSession();
    const session = await this.sessionAdapter.openSessionPath(this.currentRepo, sessionPath, options);
    this.ensureTrackedSessionReference(new Date().toISOString());
    this.syncFromSession(session);
    this.emitStatus();
  }

  private syncFromSession(session: AgentSession) {
    this.messages = hydrateMessagesFromSession(session.messages);
    this.tools = [];
    this.lastError = null;
    this.activeAssistantMessageId = null;
  }

  private async acceptPrompt(session: AgentSession, promptText: string) {
    return new Promise<boolean>((resolve, reject) => {
      let preflightSettled = false;

      try {
        const runPromise = session.prompt(promptText, {
          streamingBehavior: session.isStreaming ? "steer" : undefined,
          preflightResult: (success) => {
            if (preflightSettled) {
              return;
            }

            preflightSettled = true;
            resolve(success);
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
    if (event.type === "message_start" && event.message.role === "assistant") {
      const message: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        text: "",
        status: "streaming",
        timestamp: new Date().toISOString(),
      };

      this.activeAssistantMessageId = message.id;
      this.messages = [...this.messages, message];
      this.broadcast({
        type: "chat_message_added",
        payload: { message },
      });
      this.emitStatus();
      return;
    }

    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
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
        status: "streaming",
      };
      this.messages = [...this.messages.slice(0, index), updatedMessage, ...this.messages.slice(index + 1)];
      this.broadcast({
        type: "chat_message_updated",
        payload: {
          messageId: updatedMessage.id,
          text: updatedMessage.text,
          status: updatedMessage.status,
        },
      });
      return;
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
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
        status: "complete",
      };
      this.messages = [...this.messages.slice(0, index), updatedMessage, ...this.messages.slice(index + 1)];
      this.activeAssistantMessageId = null;
      this.broadcast({
        type: "chat_message_updated",
        payload: {
          messageId: updatedMessage.id,
          text: updatedMessage.text,
          status: updatedMessage.status,
        },
      });
      this.emitStatus();
      return;
    }

    if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
      const tool: ToolActivity = {
        id: event.toolCallId,
        toolName: event.toolName,
        status: event.type === "tool_execution_end" ? (event.isError ? "error" : "complete") : "running",
        detail: event.type === "tool_execution_start" ? summarizePayload(event.args) : event.type === "tool_execution_update" ? summarizePayload(event.partialResult) : summarizePayload(event.result),
      };

      this.tools = upsertTool(this.tools, tool);
      this.broadcast({
        type: "tool_activity",
        payload: { tool },
      });
      this.emitStatus();
      return;
    }

    if (
      event.type === "agent_start" ||
      event.type === "turn_start" ||
      event.type === "agent_end" ||
      event.type === "turn_end" ||
      event.type === "queue_update" ||
      event.type === "compaction_start" ||
      event.type === "compaction_end" ||
      event.type === "auto_retry_start" ||
      event.type === "auto_retry_end"
    ) {
      this.emitStatus();
    }
  }

  private recordError(error: unknown) {
    const message = toErrorMessage(error);
    this.logger.error("Pi agent runtime reported an error.", {
      event: "pi_agent_error",
      repo: this.currentRepo?.absolutePath ?? null,
      details: {
        message,
      },
    });
    this.lastError = message;
    this.broadcast({
      type: "agent_error",
      payload: { message },
    });
    this.emitStatus();
  }

  private emitStatus() {
    const runtimeState = this.getRuntimeState();

    this.persistCostSnapshot();
    this.broadcast({
      type: "agent_status",
      payload: {
        isConfigured: this.currentRepo !== null,
        ...runtimeState,
        lastError: this.lastError,
        repo: this.currentRepo,
        usage: this.getUsageSummary(),
      },
    });
  }

  private getRuntimeState() {
    if (this.config.piMockMode) {
      return this.mockAdapter.getRuntimeState();
    }

    return this.sessionAdapter.getRuntimeState();
  }

  private async resetSession() {
    this.finalizeTrackedSession();

    this.mockAdapter.dispose();
    await this.sessionAdapter.reset();
  }

  private beginMockSession() {
    this.mockAdapter.beginSession();
    this.ensureTrackedSessionReference(new Date().toISOString());
  }

  private ensureTrackedSessionReference(startedAt: string) {
    if (!this.currentRepo) {
      return null;
    }

    if (this.config.piMockMode) {
      const session = this.mockAdapter.ensureSessionReference(this.currentRepo.absolutePath);
      return this.registerTrackedSession(session.sessionKey, startedAt, session.sessionId, session.sessionFile);
    }

    if (!this.session) {
      return null;
    }

    const sessionStats = this.session.getSessionStats();
    const sessionId = sessionStats.sessionId ?? null;
    const sessionFile = this.session.sessionFile ?? sessionStats.sessionFile ?? null;
    const identity = sessionId ?? sessionFile;

    if (!identity) {
      return null;
    }

    return this.registerTrackedSession(`${this.currentRepo.absolutePath}:${identity}`, startedAt, sessionId, sessionFile);
  }

  private registerTrackedSession(sessionKey: string, startedAt: string, sessionId: string | null, sessionFile: string | null) {
    if (this.activeCostSessionKey !== sessionKey) {
      this.activeCostSessionKey = sessionKey;
      this.activeCostSessionStartedAt = startedAt;
    }

    return {
      sessionKey,
      sessionId,
      sessionFile,
      startedAt: this.activeCostSessionStartedAt ?? startedAt,
    };
  }

  private persistCostSnapshot() {
    const usage = this.getUsageSummary();

    if (!this.currentRepo || (usage.totalTokens === 0 && usage.totalCost === 0)) {
      return;
    }

    const trackedSession = this.ensureTrackedSessionReference(new Date().toISOString());

    if (!trackedSession) {
      return;
    }

    try {
      this.costService.recordSession({
        sessionKey: trackedSession.sessionKey,
        sessionId: trackedSession.sessionId,
        sessionFile: trackedSession.sessionFile,
        repoName: this.currentRepo.name,
        repoRelativePath: this.currentRepo.relativePath,
        repoAbsolutePath: this.currentRepo.absolutePath,
        modelId: usage.modelId,
        startedAt: trackedSession.startedAt,
        updatedAt: new Date().toISOString(),
        endedAt: null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        totalTokens: usage.totalTokens,
        totalCost: usage.totalCost,
        contextTokens: usage.contextTokens,
        contextWindow: usage.contextWindow,
        contextPercent: usage.contextPercent,
        usingSubscription: usage.usingSubscription,
        autoCompactEnabled: usage.autoCompactEnabled,
      });
    } catch (error) {
      this.logger.error("Failed to persist session costs.", {
        event: "cost_persist_failed",
        repo: this.currentRepo?.absolutePath ?? null,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private finalizeTrackedSession() {
    if (!this.activeCostSessionKey) {
      return;
    }

    try {
      this.costService.finalizeSession(this.activeCostSessionKey, new Date().toISOString());
    } catch (error) {
      this.logger.error("Failed to finalize session costs.", {
        event: "cost_finalize_failed",
        repo: this.currentRepo?.absolutePath ?? null,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      this.activeCostSessionKey = null;
      this.activeCostSessionStartedAt = null;
    }
  }

  private getUsageSummary(): AgentUsage {
    const realUsage = this.sessionAdapter.getUsageSummary();

    if (realUsage) {
      return realUsage;
    }

    if (this.config.piMockMode) {
      return this.mockAdapter.getUsageSummary();
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
}

function createEmptyCommandState(): AgentCommandState {
  return {
    session: null,
    models: [],
    thinkingLevels: [],
    steeringMode: "all",
    followUpMode: "one-at-a-time",
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
  return error instanceof Error ? error.message : "Unknown pi runtime error.";
}

function formatBashResultMessage(exitCode: number | undefined, cancelled: boolean, truncated: boolean) {
  const exitLabel = typeof exitCode === "number" ? String(exitCode) : "n/a";
  const suffix = truncated ? " Output was truncated." : "";

  if (cancelled) {
    return `Bash run cancelled (exit ${exitLabel}).${suffix}`;
  }

  return `Bash run finished with exit ${exitLabel}.${suffix}`;
}

function createNoopLogger(): LogChannel {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}
