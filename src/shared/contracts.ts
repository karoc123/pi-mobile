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

export type AgentSnapshot = {
  repo: SelectedRepo | null;
  isConfigured: boolean;
  isStreaming: boolean;
  messages: ChatMessage[];
  tools: ToolActivity[];
  lastError: string | null;
};

export type WebsocketEnvelope =
  | {
      type: "connected";
      payload: AgentSnapshot;
    }
  | {
      type: "agent_status";
      payload: Pick<AgentSnapshot, "isConfigured" | "isStreaming" | "lastError" | "repo">;
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
