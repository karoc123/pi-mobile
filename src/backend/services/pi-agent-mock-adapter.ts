import { randomUUID } from "node:crypto";

import type {
  AgentCommandRequest,
  AgentCommandResponse,
  AgentCommandState,
  AgentQueueMode,
  AgentRuntimePhase,
  AgentUsage,
  ChatMessage,
  SelectedRepo,
  ToolActivity,
  WebsocketEnvelope,
} from "../../shared/contracts.js";

type MockRuntimeContext = {
  getCurrentRepo: () => SelectedRepo | null;
  getMessages: () => ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  setTools: (tools: ToolActivity[]) => void;
  setLastError: (message: string | null) => void;
  setActiveAssistantMessageId: (messageId: string | null) => void;
  broadcast: (event: WebsocketEnvelope) => void;
  emitStatus: () => void;
};

export class PiAgentMockAdapter {
  private replyTimeout: NodeJS.Timeout | null = null;
  private isStreaming = false;
  private steeringMode: AgentQueueMode = "all";
  private followUpMode: AgentQueueMode = "one-at-a-time";
  private autoRetryEnabled = false;
  private isRetrying = false;
  private isBashRunning = false;
  private sessionName: string | null = null;
  private usage: AgentUsage = createUsageSummary("mock/session", true);
  private sessionId: string | null = null;

  resetForRepoSelection() {
    this.resetSessionState(true);
  }

  resetForNewSession() {
    this.resetSessionState(true);
  }

  dispose() {
    this.clearReplyTimeout();
    this.isStreaming = false;
    this.isRetrying = false;
    this.isBashRunning = false;
    this.sessionName = null;
    this.sessionId = null;
  }

  abort() {
    this.clearReplyTimeout();
    this.isStreaming = false;
  }

  beginSession() {
    this.sessionId = randomUUID();
  }

  ensureSessionReference(repoAbsolutePath: string) {
    if (!this.sessionId) {
      this.sessionId = randomUUID();
    }

    return {
      sessionKey: `mock:${repoAbsolutePath}:${this.sessionId}`,
      sessionId: this.sessionId,
      sessionFile: null,
    };
  }

  getRuntimeState(): {
    isStreaming: boolean;
    runtimePhase: AgentRuntimePhase;
    pendingMessageCount: number;
    isCompacting: boolean;
    isRetrying: boolean;
    isBashRunning: boolean;
  } {
    return {
      isStreaming: this.isStreaming,
      runtimePhase: deriveRuntimePhase({
        isStreaming: this.isStreaming,
        isCompacting: false,
        isRetrying: this.isRetrying,
        isBashRunning: this.isBashRunning,
        pendingMessageCount: 0,
      }),
      pendingMessageCount: 0,
      isCompacting: false,
      isRetrying: this.isRetrying,
      isBashRunning: this.isBashRunning,
    };
  }

  getUsageSummary() {
    return this.usage;
  }

  getCommandState(currentRepo: SelectedRepo | null, messages: ChatMessage[]): AgentCommandState {
    const userMessages = messages.filter((message) => message.role === "user").length;
    const assistantMessages = messages.filter((message) => message.role === "assistant").length;

    return {
      session: currentRepo
        ? {
            sessionFile: null,
            sessionId: null,
            sessionName: this.sessionName,
            userMessages,
            assistantMessages,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: messages.length,
          }
        : null,
      models: [],
      thinkingLevels: [],
      steeringMode: this.steeringMode,
      followUpMode: this.followUpMode,
      autoCompactEnabled: this.usage.autoCompactEnabled,
      autoRetryEnabled: this.autoRetryEnabled,
      isRetrying: this.isRetrying,
      isCompacting: false,
      isBashRunning: this.isBashRunning,
      pendingMessageCount: 0,
      availableCommands: [],
      resumeSessions: [],
      treeEntries: [],
      forkEntries: [],
    };
  }

  async executeCommand(request: AgentCommandRequest, context: MockRuntimeContext): Promise<AgentCommandResponse> {
    switch (request.command) {
      case "new-session": {
        context.setMessages([]);
        context.setTools([]);
        context.setLastError(null);
        context.setActiveAssistantMessageId(null);
        this.sessionName = null;
        this.isRetrying = false;
        this.isBashRunning = false;
        this.usage = createUsageSummary("mock/session", this.usage.autoCompactEnabled);
        context.emitStatus();
        return {
          message: "Started a new session.",
          prompt: null,
        };
      }

      case "set-auto-compact": {
        this.usage = {
          ...this.usage,
          autoCompactEnabled: request.enabled,
        };
        context.emitStatus();
        return {
          message: request.enabled ? "Auto compaction enabled." : "Auto compaction disabled.",
          prompt: null,
        };
      }

      case "set-steering-mode": {
        this.steeringMode = request.mode;
        context.emitStatus();
        return {
          message: `Steering mode set to ${request.mode}.`,
          prompt: null,
        };
      }

      case "set-follow-up-mode": {
        this.followUpMode = request.mode;
        context.emitStatus();
        return {
          message: `Follow-up mode set to ${request.mode}.`,
          prompt: null,
        };
      }

      case "set-auto-retry": {
        this.autoRetryEnabled = request.enabled;
        context.emitStatus();
        return {
          message: request.enabled ? "Auto retry enabled." : "Auto retry disabled.",
          prompt: null,
        };
      }

      case "abort-retry": {
        this.isRetrying = false;
        context.emitStatus();
        return {
          message: "Retry aborted.",
          prompt: null,
        };
      }

      case "compact": {
        context.emitStatus();
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

        this.isBashRunning = true;
        context.emitStatus();

        this.isBashRunning = false;
        context.emitStatus();

        return {
          message: "Mock bash completed (exit code 0).",
          prompt: null,
        };
      }

      case "abort-bash": {
        this.isBashRunning = false;
        context.emitStatus();
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

        this.sessionName = nextName;
        context.emitStatus();
        return {
          message: `Session renamed to \"${nextName}\".`,
          prompt: null,
        };
      }

      case "export-session": {
        context.emitStatus();
        return {
          message: `Session exported to mock-session.${request.format === "html" ? "html" : "jsonl"}.`,
          prompt: null,
        };
      }

      default:
        throw new Error("This command is not available in mock mode.");
    }
  }

  async prompt(promptText: string, context: MockRuntimeContext) {
    if (!context.getCurrentRepo()) {
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

    context.setMessages([...context.getMessages(), userMessage, assistantMessage]);
    context.setActiveAssistantMessageId(assistantMessage.id);
    context.setLastError(null);
    this.isStreaming = true;
    this.usage = updateMockUsage(this.usage, { inputDelta: estimateMockTokens(promptText) });

    context.broadcast({ type: "chat_message_added", payload: { message: userMessage } });
    context.broadcast({ type: "chat_message_added", payload: { message: assistantMessage } });
    context.emitStatus();

    const replyText = buildMockReply(promptText);
    await new Promise<void>((resolve) => {
      this.replyTimeout = setTimeout(() => {
        const index = context.getMessages().findIndex((entry) => entry.id === assistantMessage.id);

        if (index >= 0) {
          const updatedMessage: ChatMessage = {
            ...assistantMessage,
            text: replyText,
            status: "complete",
          };
          const nextMessages = [...context.getMessages()];
          nextMessages[index] = updatedMessage;
          context.setMessages(nextMessages);
          context.broadcast({
            type: "chat_message_updated",
            payload: {
              messageId: updatedMessage.id,
              text: updatedMessage.text,
              status: updatedMessage.status,
            },
          });
        }

        context.setActiveAssistantMessageId(null);
        this.replyTimeout = null;
        this.isStreaming = false;
        this.usage = updateMockUsage(this.usage, { outputDelta: estimateMockTokens(replyText) });
        context.emitStatus();
        resolve();
      }, 120);
    });
  }

  private resetSessionState(autoCompactEnabled: boolean) {
    this.clearReplyTimeout();
    this.isStreaming = false;
    this.isRetrying = false;
    this.isBashRunning = false;
    this.sessionName = null;
    this.usage = createUsageSummary("mock/session", autoCompactEnabled);
  }

  private clearReplyTimeout() {
    if (this.replyTimeout) {
      clearTimeout(this.replyTimeout);
      this.replyTimeout = null;
    }
  }
}

function deriveRuntimePhase(input: { isStreaming: boolean; isCompacting: boolean; isRetrying: boolean; isBashRunning: boolean; pendingMessageCount: number }): AgentRuntimePhase {
  if (input.isRetrying) {
    return "retrying";
  }

  if (input.isCompacting) {
    return "compacting";
  }

  if (input.isBashRunning) {
    return "bash-running";
  }

  if (input.isStreaming) {
    return "streaming";
  }

  if (input.pendingMessageCount > 0) {
    return "queued";
  }

  return "idle";
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
