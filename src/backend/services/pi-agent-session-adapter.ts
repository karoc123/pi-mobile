import path from "node:path";

import { AuthStorage, ModelRegistry, SessionManager, createAgentSession, type AgentSession, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type {
  AgentCommandState,
  AgentResumeSession,
  AgentRuntimePhase,
  AgentSlashCommand,
  AgentThinkingLevel,
  AgentTreeEntry,
  AgentUsage,
  SelectedRepo,
} from "../../shared/contracts.js";

import type { AppConfig } from "../config.js";
import { flattenMessageText, summarizeText } from "./pi-agent-hydrator.js";
import type { LogChannel } from "./log-service.js";

export type SessionOpenOptions = {
  preferredModel?: { provider: string; modelId: string } | null;
  preferredThinkingLevel?: AgentThinkingLevel;
  useConfiguredDefaults?: boolean;
};

export class PiAgentSessionAdapter {
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: LogChannel,
    private readonly onSessionEvent: (event: AgentSessionEvent) => void,
  ) {}

  getSession() {
    return this.session;
  }

  async reset() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
  }

  async ensureSession(repo: SelectedRepo) {
    if (this.session) {
      return this.session;
    }

    return this.createSession(repo, true);
  }

  async createSession(repo: SelectedRepo, continueRecent: boolean, options: SessionOpenOptions = { useConfiguredDefaults: true }) {
    const sessionManager = continueRecent ? SessionManager.continueRecent(repo.absolutePath, this.config.piSessionDir) : SessionManager.create(repo.absolutePath, this.config.piSessionDir);
    return this.openSessionManager(repo, sessionManager, options);
  }

  async openSessionPath(repo: SelectedRepo, sessionPath: string, options: SessionOpenOptions = { useConfiguredDefaults: false }) {
    return this.openSessionManager(repo, SessionManager.open(sessionPath), options);
  }

  getRuntimeState() {
    const isStreaming = this.session?.isStreaming || false;
    const isCompacting = this.session?.isCompacting || false;
    const isRetrying = this.session?.isRetrying || false;
    const isBashRunning = this.session?.isBashRunning || false;
    const pendingMessageCount = this.session?.pendingMessageCount || 0;

    return {
      isStreaming,
      runtimePhase: deriveRuntimePhase({ isStreaming, isCompacting, isRetrying, isBashRunning, pendingMessageCount }),
      pendingMessageCount,
      isCompacting,
      isRetrying,
      isBashRunning,
    } satisfies {
      isStreaming: boolean;
      runtimePhase: AgentRuntimePhase;
      pendingMessageCount: number;
      isCompacting: boolean;
      isRetrying: boolean;
      isBashRunning: boolean;
    };
  }

  getUsageSummary(): AgentUsage | null {
    if (!this.session) {
      return null;
    }

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

  async getCommandState(repo: SelectedRepo): Promise<AgentCommandState> {
    const session = await this.ensureSession(repo);
    const sessionStats = session.getSessionStats();
    const currentModel = session.model;
    const currentSessionFile = session.sessionFile;
    const resumeSessions = await SessionManager.list(repo.absolutePath, this.config.piSessionDir);
    const availableCommands = this.getAvailableSlashCommands(session, repo.absolutePath);

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
      steeringMode: session.steeringMode,
      followUpMode: session.followUpMode,
      autoCompactEnabled: session.autoCompactionEnabled,
      autoRetryEnabled: session.autoRetryEnabled,
      isRetrying: session.isRetrying,
      isCompacting: session.isCompacting,
      isBashRunning: session.isBashRunning,
      pendingMessageCount: session.pendingMessageCount,
      availableCommands,
      resumeSessions: resumeSessions.sort((left, right) => right.modified.getTime() - left.modified.getTime()).map((entry) => toResumeSession(entry, currentSessionFile)),
      treeEntries: flattenTreeEntries(session.sessionManager.getTree(), session.sessionManager.getLeafId()),
      forkEntries: session.getUserMessagesForForking().map((entry) => ({
        entryId: entry.entryId,
        preview: summarizeText(entry.text),
      })),
    };
  }

  private async openSessionManager(repo: SelectedRepo, sessionManager: SessionManager, options: SessionOpenOptions) {
    const authStorage = this.config.piAgentDir ? AuthStorage.create(path.join(this.config.piAgentDir, "auth.json")) : AuthStorage.create();
    const modelRegistry = this.config.piAgentDir ? ModelRegistry.create(authStorage, path.join(this.config.piAgentDir, "models.json")) : ModelRegistry.create(authStorage);
    const model = this.resolvePreferredModel(modelRegistry, options.preferredModel, options.useConfiguredDefaults ?? false);
    const thinkingLevel = options.preferredThinkingLevel ?? (options.useConfiguredDefaults ? this.config.piThinkingLevel : undefined);

    const { session } = await createAgentSession({
      cwd: repo.absolutePath,
      agentDir: this.config.piAgentDir,
      authStorage,
      modelRegistry,
      sessionManager,
      model,
      thinkingLevel,
    });

    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();

    this.session = session;
    this.unsubscribe = session.subscribe((event) => {
      this.onSessionEvent(event);
    });

    return session;
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

  private getAvailableSlashCommands(session: AgentSession, repoPath: string): AgentSlashCommand[] {
    try {
      const extensionCommands: AgentSlashCommand[] = session.extensionRunner.getRegisteredCommands().map((command) => ({
        name: command.invocationName,
        description: command.description ?? null,
        source: "extension",
      }));

      const promptCommands: AgentSlashCommand[] = session.promptTemplates.map((template) => ({
        name: template.name,
        description: template.description ?? null,
        source: "prompt",
      }));

      const skillCommands: AgentSlashCommand[] = session.resourceLoader.getSkills().skills.map((skill) => ({
        name: `skill:${skill.name}`,
        description: skill.description ?? null,
        source: "skill",
      }));

      return [...extensionCommands, ...promptCommands, ...skillCommands].sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      this.logger.warn("Could not resolve slash commands for command palette.", {
        event: "slash_commands_unavailable",
        repo: repoPath,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      });

      return [];
    }
  }
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
