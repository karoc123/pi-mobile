export type WorkspaceEntry = {
  name: string;
  relativePath: string;
  kind: "directory";
  isGitRepo: boolean;
};

export type SelectedRepo = {
  name: string;
  relativePath: string;
  absolutePath: string;
};

export type FileEntry = {
  name: string;
  relativePath: string;
  kind: "directory" | "file";
};

export type FileDocument = {
  path: string;
  content: string;
};

export type DiffHunk = {
  id: string;
  header: string;
  diff: string;
  addedLines: number;
  removedLines: number;
};

export type DiffFile = {
  path: string;
  oldPath: string;
  newPath: string;
  status: "modified" | "added" | "deleted" | "renamed";
  diff: string;
  hunks: DiffHunk[];
  addedLines: number;
  removedLines: number;
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  status: "streaming" | "complete";
  timestamp: string;
};

export type ToolActivity = {
  id: string;
  toolName: string;
  status: "running" | "complete" | "error";
  detail: string;
};

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  contextTokens: number | null;
  contextWindow: number | null;
  contextPercent: number | null;
  modelId: string | null;
  usingSubscription: boolean;
  autoCompactEnabled: boolean;
};

export type AgentSnapshot = {
  repo: SelectedRepo | null;
  isConfigured: boolean;
  isStreaming: boolean;
  messages: ChatMessage[];
  tools: ToolActivity[];
  lastError: string | null;
  usage: AgentUsage;
};

export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AgentModelOption = {
  provider: string;
  modelId: string;
  name: string;
  available: boolean;
  isCurrent: boolean;
  usingSubscription: boolean;
};

export type AgentThinkingLevelOption = {
  value: AgentThinkingLevel;
  isCurrent: boolean;
};

export type AgentSessionSummary = {
  sessionFile: string | null;
  sessionId: string | null;
  sessionName: string | null;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
};

export type AgentResumeSession = {
  path: string;
  id: string;
  name: string | null;
  modifiedAt: string;
  messageCount: number;
  preview: string;
  isCurrent: boolean;
};

export type AgentTreeEntry = {
  entryId: string;
  role: "user" | "assistant";
  depth: number;
  preview: string;
  isCurrent: boolean;
};

export type AgentForkEntry = {
  entryId: string;
  preview: string;
};

export type AgentCommandState = {
  session: AgentSessionSummary | null;
  models: AgentModelOption[];
  thinkingLevels: AgentThinkingLevelOption[];
  autoCompactEnabled: boolean;
  resumeSessions: AgentResumeSession[];
  treeEntries: AgentTreeEntry[];
  forkEntries: AgentForkEntry[];
};

export type AgentCommandRequest =
  | {
      command: "set-model";
      provider: string;
      modelId: string;
    }
  | {
      command: "set-thinking";
      level: AgentThinkingLevel;
    }
  | {
      command: "set-auto-compact";
      enabled: boolean;
    }
  | {
      command: "compact";
      customInstructions?: string;
    }
  | {
      command: "new-session";
    }
  | {
      command: "resume-session";
      sessionPath: string;
    }
  | {
      command: "navigate-tree";
      entryId: string;
    }
  | {
      command: "fork-session";
      entryId: string;
    };

export type AgentCommandResponse = {
  message: string | null;
  prompt: string | null;
};

export type WebsocketEnvelope =
  | {
      type: "connected";
      payload: AgentSnapshot;
    }
  | {
      type: "agent_status";
      payload: Pick<AgentSnapshot, "isConfigured" | "isStreaming" | "lastError" | "repo" | "usage">;
    }
  | {
      type: "chat_message_added";
      payload: {
        message: ChatMessage;
      };
    }
  | {
      type: "chat_message_updated";
      payload: {
        messageId: string;
        text: string;
        status: ChatMessage["status"];
      };
    }
  | {
      type: "tool_activity";
      payload: {
        tool: ToolActivity;
      };
    }
  | {
      type: "workspace_changed";
      payload: {
        path: string;
        kind: "add" | "change" | "unlink";
      };
    }
  | {
      type: "repo_selected";
      payload: {
        repo: SelectedRepo;
      };
    }
  | {
      type: "agent_error";
      payload: {
        message: string;
      };
    };

export type SessionResponse = {
  authenticated: boolean;
  repo: SelectedRepo | null;
};
