import path from "node:path";
import { randomUUID } from "node:crypto";

import { AuthStorage, ModelRegistry, SessionManager, createAgentSession, type AgentSession, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type {
  AgentCommandRequest,
  AgentCommandResponse,
  AgentCommandState,
  AgentResumeSession,
  AgentSnapshot,
  AgentThinkingLevel,
  AgentTreeEntry,
  AgentUsage,
  ChatMessage,
  SelectedRepo,
  ToolActivity,
  WebsocketEnvelope,
} from "../../shared/contracts.js";

import type { AppConfig } from "../config.js";
import { CostService } from "./cost-service.js";

type Broadcast = (event: WebsocketEnvelope) => void;

export class PiAgentService {
  private currentRepo: SelectedRepo | null = null;
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private messages: ChatMessage[] = [];
  private tools: ToolActivity[] = [];
  private lastError: string | null = null;
  private activeAssistantMessageId: string | null = null;
  private mockReplyTimeout: NodeJS.Timeout | null = null;
  private mockStreaming = false;
  private mockUsage: AgentUsage = createUsageSummary("mock/session", true);
  private activeCostSessionKey: string | null = null;
  private activeCostSessionStartedAt: string | null = null;
  private mockSessionId: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly broadcast: Broadcast,
    private readonly costService: CostService,
  ) {}

  getSnapshot(): AgentSnapshot {
    return {
      repo: this.currentRepo,
      isConfigured: this.currentRepo !== null,
      isStreaming: this.mockStreaming || this.session?.isStreaming || false,
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
      return this.getMockCommandState();
    }

    const session = await this.ensureSession();
    const sessionStats = session.getSessionStats();
    const currentModel = session.model;
    const currentSessionFile = session.sessionFile;
    const resumeSessions = await SessionManager.list(this.currentRepo.absolutePath, this.config.piSessionDir);

    return {
      session: {
        sessionFile: sessionStats.sessionFile ?? null,
        sessionId: sessionStats.sessionId,
        sessionName: session.sessionName ?? null,
        userMessages: sessionStats.userMessages,
        assistantMessages: sessionStats.assistantMessages,
        toolCalls: sessionStats.toolCalls,
        toolResults: sessionStats.toolResults,
        totalMessages: sessionStats.totalMessages,
      },
      models: session.modelRegistry
        .getAll()
        .map((model) => ({
          provider: model.provider,
          modelId: model.id,
          name: model.name,
          available: session.modelRegistry.hasConfiguredAuth(model),
          isCurrent: currentModel?.provider === model.provider && currentModel.id === model.id,
          usingSubscription: session.modelRegistry.isUsingOAuth(model),
        }))
        .filter((model) => model.available || model.isCurrent)
        .sort((left, right) => {
          if (left.isCurrent !== right.isCurrent) {
            return left.isCurrent ? -1 : 1;
          }

          if (left.available !== right.available) {
            return left.available ? -1 : 1;
          }

          return `${left.provider}/${left.modelId}`.localeCompare(`${right.provider}/${right.modelId}`);
        }),
      thinkingLevels: session.getAvailableThinkingLevels().map((level) => ({
        value: level as AgentThinkingLevel,
        isCurrent: session.thinkingLevel === level,
      })),
      autoCompactEnabled: session.autoCompactionEnabled,
      resumeSessions: resumeSessions.sort((left, right) => right.modified.getTime() - left.modified.getTime()).map((entry) => toResumeSession(entry, currentSessionFile)),
      treeEntries: flattenTreeEntries(session.sessionManager.getTree(), session.sessionManager.getLeafId()),
      forkEntries: session.getUserMessagesForForking().map((entry) => ({
        entryId: entry.entryId,
        preview: summarizeText(entry.text),
      })),
    };
  }

  async executeCommand(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    if (!request || typeof request !== "object" || typeof request.command !== "string") {
      throw new Error("Missing agent command.");
    }

    if (this.config.piMockMode) {
      return this.executeMockCommand(request);
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
        await this.openSessionManager(SessionManager.open(request.sessionPath), {
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

        await this.openSessionManager(SessionManager.open(sessionPath), {
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
    this.mockUsage = createUsageSummary(this.config.piMockMode ? "mock/session" : null, this.config.piMockMode);
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
      await this.promptWithMock(promptText);
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
    if (this.mockReplyTimeout) {
      clearTimeout(this.mockReplyTimeout);
      this.mockReplyTimeout = null;
      this.mockStreaming = false;
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
    this.mockUsage = createUsageSummary(this.config.piMockMode ? "mock/session" : null, this.config.piMockMode);

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

    if (this.session) {
      return this.session;
    }

    return this.createSession(true);
  }

  private async createSession(
    continueRecent: boolean,
    options: {
      preferredModel?: { provider: string; modelId: string } | null;
      preferredThinkingLevel?: AgentThinkingLevel;
      useConfiguredDefaults?: boolean;
    } = {
      useConfiguredDefaults: true,
    },
  ) {
    if (!this.currentRepo) {
      throw new Error("No repository selected for pi session.");
    }

    const sessionManager = continueRecent
      ? SessionManager.continueRecent(this.currentRepo.absolutePath, this.config.piSessionDir)
      : SessionManager.create(this.currentRepo.absolutePath, this.config.piSessionDir);

    return this.openSessionManager(sessionManager, options);
  }

  private resolvePreferredModel(modelRegistry: ModelRegistry, preferredModel: { provider: string; modelId: string } | null | undefined, useConfiguredDefaults: boolean) {
    if (preferredModel) {
      const model = modelRegistry.find(preferredModel.provider, preferredModel.modelId);

      if (model) {
        return model;
      }
    }

    return useConfiguredDefaults ? this.resolveConfiguredModel(modelRegistry) : undefined;
  }

  private async openSessionManager(
    sessionManager: SessionManager,
    options: {
      preferredModel?: { provider: string; modelId: string } | null;
      preferredThinkingLevel?: AgentThinkingLevel;
      useConfiguredDefaults?: boolean;
    },
  ) {
    if (!this.currentRepo) {
      throw new Error("No repository selected for pi session.");
    }

    const authStorage = this.config.piAgentDir ? AuthStorage.create(path.join(this.config.piAgentDir, "auth.json")) : AuthStorage.create();
    const modelRegistry = this.config.piAgentDir ? ModelRegistry.create(authStorage, path.join(this.config.piAgentDir, "models.json")) : ModelRegistry.create(authStorage);
    const model = this.resolvePreferredModel(modelRegistry, options.preferredModel, options.useConfiguredDefaults ?? false);
    const thinkingLevel = options.preferredThinkingLevel ?? (options.useConfiguredDefaults ? this.config.piThinkingLevel : undefined);
    const { session } = await createAgentSession({
      cwd: this.currentRepo.absolutePath,
      agentDir: this.config.piAgentDir,
      authStorage,
      modelRegistry,
      sessionManager,
      model,
      thinkingLevel,
    });

    this.finalizeTrackedSession();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();

    this.session = session;
    this.ensureTrackedSessionReference(new Date().toISOString());
    this.messages = hydrateMessagesFromSession(session.messages);
    this.tools = [];
    this.lastError = null;
    this.activeAssistantMessageId = null;
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

    if (event.type === "agent_end" || event.type === "turn_end") {
      this.emitStatus();
    }
  }

  private recordError(error: unknown) {
    const message = toErrorMessage(error);
    this.lastError = message;
    this.broadcast({
      type: "agent_error",
      payload: { message },
    });
    this.emitStatus();
  }

  private emitStatus() {
    this.persistCostSnapshot();
    this.broadcast({
      type: "agent_status",
      payload: {
        isConfigured: this.currentRepo !== null,
        isStreaming: this.mockStreaming || this.session?.isStreaming || false,
        lastError: this.lastError,
        repo: this.currentRepo,
        usage: this.getUsageSummary(),
      },
    });
  }

  private async resetSession() {
    this.finalizeTrackedSession();

    if (this.mockReplyTimeout) {
      clearTimeout(this.mockReplyTimeout);
      this.mockReplyTimeout = null;
    }

    this.mockStreaming = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
    this.mockSessionId = null;
  }

  private beginMockSession() {
    this.mockSessionId = randomUUID();
    this.ensureTrackedSessionReference(new Date().toISOString());
  }

  private ensureTrackedSessionReference(startedAt: string) {
    if (!this.currentRepo) {
      return null;
    }

    if (this.config.piMockMode) {
      if (!this.mockSessionId) {
        this.mockSessionId = randomUUID();
      }

      return this.registerTrackedSession(`mock:${this.currentRepo.absolutePath}:${this.mockSessionId}`, startedAt, this.mockSessionId, null);
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
      console.error("Failed to persist session costs", error);
    }
  }

  private finalizeTrackedSession() {
    if (!this.activeCostSessionKey) {
      return;
    }

    try {
      this.costService.finalizeSession(this.activeCostSessionKey, new Date().toISOString());
    } catch (error) {
      console.error("Failed to finalize session costs", error);
    } finally {
      this.activeCostSessionKey = null;
      this.activeCostSessionStartedAt = null;
    }
  }

  private getUsageSummary(): AgentUsage {
    if (this.session) {
      const sessionStats = this.session.getSessionStats();
      const contextUsage = this.session.getContextUsage();
      const model = this.session.model;

      return {
        inputTokens: sessionStats.tokens.input,
        outputTokens: sessionStats.tokens.output,
        cacheReadTokens: sessionStats.tokens.cacheRead,
        cacheWriteTokens: sessionStats.tokens.cacheWrite,
        totalTokens: sessionStats.tokens.total,
        totalCost: sessionStats.cost,
        contextTokens: contextUsage?.tokens ?? null,
        contextWindow: contextUsage?.contextWindow ?? model?.contextWindow ?? null,
        contextPercent: contextUsage?.percent ?? null,
        modelId: model?.id ?? null,
        usingSubscription: model ? this.session.modelRegistry.isUsingOAuth(model) : false,
        autoCompactEnabled: this.session.autoCompactionEnabled,
      };
    }

    if (this.config.piMockMode) {
      return this.mockUsage;
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

  private getMockCommandState(): AgentCommandState {
    const userMessages = this.messages.filter((message) => message.role === "user").length;
    const assistantMessages = this.messages.filter((message) => message.role === "assistant").length;

    return {
      session: this.currentRepo
        ? {
            sessionFile: null,
            sessionId: null,
            sessionName: null,
            userMessages,
            assistantMessages,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: this.messages.length,
          }
        : null,
      models: [],
      thinkingLevels: [],
      autoCompactEnabled: this.mockUsage.autoCompactEnabled,
      resumeSessions: [],
      treeEntries: [],
      forkEntries: [],
    };
  }

  private async executeMockCommand(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    switch (request.command) {
      case "new-session": {
        this.messages = [];
        this.tools = [];
        this.lastError = null;
        this.mockUsage = createUsageSummary("mock/session", this.mockUsage.autoCompactEnabled);
        this.emitStatus();
        return {
          message: "Started a new session.",
          prompt: null,
        };
      }

      case "set-auto-compact": {
        this.mockUsage = {
          ...this.mockUsage,
          autoCompactEnabled: request.enabled,
        };
        this.emitStatus();
        return {
          message: request.enabled ? "Auto compaction enabled." : "Auto compaction disabled.",
          prompt: null,
        };
      }

      default:
        throw new Error("This command is not available in mock mode.");
    }
  }

  private async promptWithMock(promptText: string) {
    if (!this.currentRepo) {
      throw new Error("No repository selected for pi session.");
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      text: promptText,
      status: "complete",
      timestamp: new Date().toISOString(),
    };
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      text: "",
      status: "streaming",
      timestamp: new Date().toISOString(),
    };

    this.messages = [...this.messages, userMessage, assistantMessage];
    this.activeAssistantMessageId = assistantMessage.id;
    this.lastError = null;
    this.mockStreaming = true;
    this.mockUsage = updateMockUsage(this.mockUsage, { inputDelta: estimateMockTokens(promptText) });

    this.broadcast({ type: "chat_message_added", payload: { message: userMessage } });
    this.broadcast({ type: "chat_message_added", payload: { message: assistantMessage } });
    this.emitStatus();

    const replyText = buildMockReply(promptText);
    await new Promise<void>((resolve) => {
      this.mockReplyTimeout = setTimeout(() => {
        const index = this.messages.findIndex((entry) => entry.id === assistantMessage.id);

        if (index >= 0) {
          const updatedMessage: ChatMessage = {
            ...assistantMessage,
            text: replyText,
            status: "complete",
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
        }

        this.activeAssistantMessageId = null;
        this.mockReplyTimeout = null;
        this.mockStreaming = false;
        this.mockUsage = updateMockUsage(this.mockUsage, { outputDelta: estimateMockTokens(replyText) });
        this.emitStatus();
        resolve();
      }, 120);
    });
  }
}

function createEmptyCommandState(): AgentCommandState {
  return {
    session: null,
    models: [],
    thinkingLevels: [],
    autoCompactEnabled: false,
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

function toResumeSession(entry: Awaited<ReturnType<typeof SessionManager.list>>[number], currentSessionFile: string | undefined): AgentResumeSession {
  return {
    path: entry.path,
    id: entry.id,
    name: entry.name ?? null,
    modifiedAt: entry.modified.toISOString(),
    messageCount: entry.messageCount,
    preview: summarizeText(entry.name ?? entry.firstMessage),
    isCurrent: currentSessionFile === entry.path,
  };
}

function flattenTreeEntries(nodes: ReturnType<SessionManager["getTree"]>, currentLeafId: string | null, depth = 0): AgentTreeEntry[] {
  return nodes.flatMap((node) => {
    const children = flattenTreeEntries(node.children, currentLeafId, depth + 1);

    if (node.entry.type !== "message") {
      return children;
    }

    if (node.entry.message.role !== "user" && node.entry.message.role !== "assistant") {
      return children;
    }

    return [
      {
        entryId: node.entry.id,
        role: node.entry.message.role,
        depth,
        preview: summarizeText(flattenMessageText(node.entry.message)),
        isCurrent: node.entry.id === currentLeafId,
      },
      ...children,
    ];
  });
}

function hydrateMessagesFromSession(sessionMessages: readonly unknown[]) {
  return sessionMessages.map((entry) => toChatMessage(entry)).filter((entry): entry is ChatMessage => entry !== null);
}

function toChatMessage(entry: unknown): ChatMessage | null {
  if (!entry || typeof entry !== "object" || !("role" in entry)) {
    return null;
  }

  const candidate = entry as { role?: string; createdAt?: string; content?: unknown[] };

  if (candidate.role !== "user" && candidate.role !== "assistant") {
    return null;
  }

  return {
    id: randomUUID(),
    role: candidate.role,
    text: flattenMessageText(candidate),
    status: "complete",
    timestamp: candidate.createdAt ?? new Date().toISOString(),
  };
}

function flattenMessageText(message: { content?: string | unknown[] }) {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .map((chunk) => {
      if (typeof chunk === "string") {
        return chunk;
      }

      if (!chunk || typeof chunk !== "object") {
        return "";
      }

      const typedChunk = chunk as {
        type?: string;
        text?: string;
        toolName?: string;
        name?: string;
        result?: unknown;
        arguments?: unknown;
        args?: unknown;
      };
      const type = typedChunk.type ?? "";

      if (type === "text") {
        return typedChunk.text ?? "";
      }

      if (type === "thinking" || type === "hidden" || type === "reasoning") {
        return "";
      }

      if (type === "tool-call" || type === "toolCall" || type === "tool_call") {
        const toolName = typedChunk.toolName ?? typedChunk.name ?? "unknown";
        const toolArgs = typedChunk.arguments ?? typedChunk.args;
        const argsSummary = toolArgs ? summarizePayload(toolArgs) : "";
        return `\n[tool:${toolName}]${argsSummary ? ` ${argsSummary}` : ""}`;
      }

      if (type === "tool-result" || type === "toolResult" || type === "tool_result") {
        return `\n${summarizePayload(typedChunk.result)}`;
      }

      return typedChunk.text ?? "";
    })
    .join("")
    .trim();
}

function upsertTool(tools: ToolActivity[], tool: ToolActivity) {
  const remainder = tools.filter((entry) => entry.id !== tool.id);
  return [tool, ...remainder].slice(0, 12);
}

function summarizePayload(payload: unknown) {
  if (typeof payload === "string") {
    return payload.slice(0, 240);
  }

  if (payload === null || payload === undefined) {
    return "";
  }

  try {
    return JSON.stringify(payload).slice(0, 240);
  } catch {
    return String(payload).slice(0, 240);
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown pi runtime error.";
}

function summarizeText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return "No text";
  }

  return normalized.slice(0, 120);
}

function createUsageSummary(modelId: string | null, autoCompactEnabled: boolean): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    contextTokens: 0,
    contextWindow: 400000,
    contextPercent: 0,
    modelId,
    usingSubscription: false,
    autoCompactEnabled,
  };
}

function updateMockUsage(usage: AgentUsage, deltas: { inputDelta?: number; outputDelta?: number }) {
  const inputTokens = usage.inputTokens + (deltas.inputDelta ?? 0);
  const outputTokens = usage.outputTokens + (deltas.outputDelta ?? 0);
  const totalTokens = inputTokens + outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const contextWindow = usage.contextWindow ?? 400000;
  const contextPercent = Number(((totalTokens / contextWindow) * 100).toFixed(1));
  const totalCost = Number(((inputTokens * 0.5 + outputTokens * 1.2) / 1000).toFixed(3));

  return {
    ...usage,
    inputTokens,
    outputTokens,
    totalTokens,
    totalCost,
    contextTokens: totalTokens,
    contextWindow,
    contextPercent,
  };
}

function estimateMockTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function buildMockReply(promptText: string) {
  const singleWordMatch = /single word\s+([A-Z0-9_-]+)/i.exec(promptText);

  if (singleWordMatch) {
    return singleWordMatch[1].toUpperCase();
  }

  if (/ready/i.test(promptText)) {
    return "READY";
  }

  return `Mock reply: ${promptText.slice(0, 120)}`;
}
