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

export type WorkspaceCloneRequest = {
  remoteUrl: string;
  destinationPath?: string;
};

export type WorkspaceCloneResult = {
  ok: true;
  repo: SelectedRepo;
};

export type PiAuthProviderState = {
  provider: string;
  label: string;
  configured: boolean;
};

export type PiAuthStatusResponse = {
  providers: PiAuthProviderState[];
};

export type PiAuthLoginTokenRequest = {
  provider: string;
  token: string;
};

export type PiAuthLoginTokenResponse = {
  ok: true;
  provider: string;
  configured: true;
};

export type PiAuthLogoutRequest = {
  provider: string;
};

export type PiAuthLogoutResponse = {
  ok: true;
  provider: string;
  configured: false;
};

export type FileEntry = {
  name: string;
  relativePath: string;
  kind: "directory" | "file";
};

export type FileDocument = {
  path: string;
  content: string;
  kind: "text" | "image" | "binary";
  mimeType: string | null;
  imageDataUrl: string | null;
  /**
   * Binary content as Base64-encoded string.
   * Only present when kind is "binary".
   */
  binaryContentBase64: string | null;
};

export type FileCreateRequest = {
  path: string;
  content?: string;
};

export type FileCreateResult = {
  ok: true;
  path: string;
};

export type FileCreateDirectoryRequest = {
  path: string;
};

export type FileCreateDirectoryResult = {
  ok: true;
  path: string;
};

export type FileMoveRequest = {
  fromPath: string;
  toPath: string;
};

export type FileMoveResult = {
  ok: true;
  fromPath: string;
  toPath: string;
};

export type FileDuplicateRequest = {
  sourcePath: string;
  targetPath: string;
};

export type FileDuplicateResult = {
  ok: true;
  path: string;
};

export type FileDeleteRequest = {
  path: string;
};

export type FileDeleteResult = {
  ok: true;
  path: string;
};

export type FileUploadRequest = {
  path: string;
  /**
   * The file content as a Base64-encoded string.
   * The backend will decode and write the binary data.
   */
  contentBase64: string;
};

export type FileUploadResult = {
  ok: true;
  path: string;
};

export type FileDownloadInfo = {
  path: string;
  name: string;
  mimeType: string | null;
  /**
   * The file content as a Base64-encoded data URI.
   * Only included when the download is requested via JSON.
   */
  contentBase64: string | null;
};

export type DiffHunk = {
  id: string;
  header: string;
  diff: string;
  staged: boolean;
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

export type GitCommitResult = {
  commitSha: string;
};

export type GitRemoteSyncStatus = {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
};

export type GitDiffResponse = {
  files: DiffFile[];
  sync: GitRemoteSyncStatus;
};

export type GitSyncResult = {
  summary: string;
};

export type GitHunkMutationRequest = {
  diff: string;
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

export type AgentRuntimePhase = "idle" | "streaming" | "queued" | "compacting" | "retrying" | "bash-running";

export type AgentMinimalState = {
  repoName: string | null;
  runtimePhase: AgentRuntimePhase;
  pendingMessageCount: number;
  lastError: string | null;
  lastMessagePreview: string | null;
  lastMessageFull: string | null;
  usage: {
    totalCost: number;
    totalTokens: number;
    modelId: string | null;
  };
};

export type AgentSnapshot = {
  repo: SelectedRepo | null;
  isConfigured: boolean;
  isStreaming: boolean;
  runtimePhase: AgentRuntimePhase;
  pendingMessageCount: number;
  isCompacting: boolean;
  isRetrying: boolean;
  isBashRunning: boolean;
  messages: ChatMessage[];
  tools: ToolActivity[];
  lastError: string | null;
  usage: AgentUsage;
  interactivePrompt: InteractivePrompt | null;
};

export type CostFilterOption = {
  value: string;
  label: string;
};

export type CostSummary = {
  totalSessions: number;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type CostSession = {
  sessionKey: string;
  sessionId: string | null;
  sessionFile: string | null;
  repoName: string;
  repoRelativePath: string;
  repoAbsolutePath: string;
  modelId: string | null;
  modelsUsed: string[];
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  contextTokens: number | null;
  contextWindow: number | null;
  contextPercent: number | null;
  usingSubscription: boolean;
  autoCompactEnabled: boolean;
};

export type CostReport = {
  summary: CostSummary;
  sessions: CostSession[];
  filters: {
    repos: CostFilterOption[];
    models: CostFilterOption[];
  };
};

export type BackendHealthStatus = "healthy" | "degraded";

export type BackendResourceCheck = {
  key: "workspace_root" | "costs_db" | "logs_dir" | "pi_agent_dir" | "pi_session_dir";
  label: string;
  path: string;
  required: boolean;
  ok: boolean;
  detail: string | null;
};

export type BackendHealthResponse = {
  ok: true;
  status: BackendHealthStatus;
  serverTime: string;
  startedAt: string;
  uptimeSeconds: number;
  resources: {
    allRequiredAccessible: boolean;
    checks: BackendResourceCheck[];
  };
};

export type BackendLogLevel = "debug" | "info" | "warn" | "error";

export type BackendLogEntry = {
  seq: number;
  timestamp: string;
  level: BackendLogLevel;
  source: string;
  event: string | null;
  message: string;
  repo: string | null;
  requestId: string | null;
  details: unknown;
};

export type BackendLogQuery = {
  limit?: number;
  beforeSeq?: number;
  level?: BackendLogLevel;
  source?: string;
  search?: string;
};

export type BackendLogQueryResponse = {
  entries: BackendLogEntry[];
  hasMore: boolean;
  nextBeforeSeq: number | null;
};

export type ApiErrorCode = "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "validation_error" | "runtime_error" | "internal_error";

export type ApiErrorResponse = {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    retriable: boolean;
    details?: unknown;
  };
};

/** Eine einzelne Frage mit Auswahlmöglichkeiten */
export type InteractiveQuestion = {
  id: string;
  label: string;
  options: string[];
  allowFreeText: boolean;
  placeholder?: string;
  /**
   * If true, the user can select multiple options.
   * Defaults to false (single-select).
   */
  multiple?: boolean;
};

/** Vollständiger interaktiver Prompt */
export type InteractivePrompt = {
  promptId: string;
  title: string;
  questions: InteractiveQuestion[];
};

/** Antwort auf eine einzelne Frage.
 * `value` ist ein String bei Single-Select oder Freitext,
 * ein String-Array bei Multi-Select.
 */
export type InteractiveAnswer = {
  questionId: string;
  value: string | string[];
};

export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AgentModelOption = {
  provider: string;
  modelId: string;
  name: string;
  available: boolean;
  isCurrent: boolean;
  usingSubscription: boolean;
  usageCount?: number;
  lastUsedAt?: string | null;
};

export type AgentThinkingLevelOption = {
  value: AgentThinkingLevel;
  isCurrent: boolean;
};

export type AgentQueueMode = "all" | "one-at-a-time";

export type AgentSlashCommand = {
  name: string;
  description: string | null;
  source: "extension" | "prompt" | "skill";
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
  steeringMode: AgentQueueMode;
  followUpMode: AgentQueueMode;
  autoCompactEnabled: boolean;
  autoRetryEnabled: boolean;
  isRetrying: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  availableCommands: AgentSlashCommand[];
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
      command: "set-steering-mode";
      mode: AgentQueueMode;
    }
  | {
      command: "set-follow-up-mode";
      mode: AgentQueueMode;
    }
  | {
      command: "set-auto-retry";
      enabled: boolean;
    }
  | {
      command: "abort-retry";
    }
  | {
      command: "compact";
      customInstructions?: string;
    }
  | {
      command: "run-bash";
      commandText: string;
      excludeFromContext?: boolean;
    }
  | {
      command: "abort-bash";
    }
  | {
      command: "set-session-name";
      name: string;
    }
  | {
      command: "export-session";
      format: "html" | "jsonl";
      outputPath?: string;
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
      payload: Pick<AgentSnapshot, "isConfigured" | "isStreaming" | "runtimePhase" | "pendingMessageCount" | "isCompacting" | "isRetrying" | "isBashRunning" | "lastError" | "repo" | "usage">;
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
    }
  | {
      type: "interactive_prompt";
      payload: InteractivePrompt;
    };

export type SessionResponse = {
  authenticated: boolean;
  repo: SelectedRepo | null;
};
