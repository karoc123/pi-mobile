import type {
  AgentSnapshot,
  AgentUsage,
  SelectedRepo,
  SessionResponse,
  WebsocketEnvelope,
} from '../../shared/contracts.js';
import { apiFetch } from './api.js';

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export const emptyUsage: AgentUsage = {
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

export const emptyAgentSnapshot: AgentSnapshot = {
  repo: null,
  isStreaming: false,
  runtimePhase: 'idle',
  pendingMessageCount: 0,
  isCompacting: false,
  isRetrying: false,
  isBashRunning: false,
  messages: [],
  lastError: null,
  usage: emptyUsage,
  interactivePrompt: null,
};

export interface LiveConnectionOptions {
  onWorkspaceChange?: (path: string) => void;
  onRepoSelected?: (repo: SelectedRepo) => void;
  onUnauthorized?: () => void;
}

export class LiveConnection {
  status = $state<SocketStatus>('offline');
  reconnectAttempt = $state(0);
  agentSnapshot = $state<AgentSnapshot>(emptyAgentSnapshot);

  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private manualClose = false;
  private dismissedPromptId: string | null = null;
  private options: LiveConnectionOptions;

  private onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      if (this.status !== 'connected') {
        this.reconnectNow();
      }
    }
  };

  private onOnline = () => {
    if (this.status !== 'connected') {
      this.reconnectNow();
    }
  };

  constructor(options: LiveConnectionOptions = {}) {
    this.options = options;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
    }
  }

  connect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (typeof WebSocket === 'undefined') {
      return;
    }

    this.manualClose = true;
    this.socket?.close();
    this.manualClose = false;

    const protocol =
      typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
    const nextSocket = new WebSocket(`${protocol}://${host}/ws`);
    this.socket = nextSocket;
    this.status = this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';

    nextSocket.onopen = () => {
      if (this.socket !== nextSocket) {
        return;
      }
      this.status = 'connected';
      this.reconnectAttempt = 0;
    };

    nextSocket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data as string) as WebsocketEnvelope;
        this.handleMessage(envelope);
      } catch {
        // ignore malformed payloads
      }
    };

    nextSocket.onerror = () => {
      if (this.socket !== nextSocket) {
        return;
      }
      if (this.status !== 'connected') {
        this.status = 'reconnecting';
      }
    };

    nextSocket.onclose = () => {
      if (this.socket !== nextSocket) {
        return;
      }
      this.socket = null;

      if (this.manualClose) {
        this.status = 'offline';
        return;
      }

      this.status = 'reconnecting';
      this.reconnectAttempt += 1;
      const retryDelay = Math.min(10_000, 1_200 * Math.max(1, this.reconnectAttempt));

      this.reconnectTimer = window.setTimeout(() => {
        this.connect();
      }, retryDelay);

      void this.checkSessionValid();
    };
  }

  reconnectNow(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.manualClose = true;
      this.socket.close();
      this.manualClose = false;
      this.socket = null;
    }

    this.status = 'offline';
  }

  destroy(): void {
    this.disconnect();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
    }
  }

  dismissPrompt(): void {
    this.dismissedPromptId = this.agentSnapshot.interactivePrompt?.promptId ?? null;
    this.agentSnapshot = {
      ...this.agentSnapshot,
      interactivePrompt: null,
    };
  }

  private async checkSessionValid(): Promise<void> {
    try {
      const session = await apiFetch<SessionResponse>('/api/auth/session');
      if (!session.authenticated) {
        this.options.onUnauthorized?.();
      }
    } catch {
      // transient network failure; backoff will retry
    }
  }

  private handleMessage(event: WebsocketEnvelope): void {
    if (event.type === 'snapshot') {
      const serverPrompt = event.payload.interactivePrompt ?? null;
      const interactivePrompt =
        serverPrompt && serverPrompt.promptId === this.dismissedPromptId ? null : serverPrompt;

      this.agentSnapshot = {
        ...event.payload,
        interactivePrompt,
      };
      this.status = 'connected';
      return;
    }

    if (event.type === 'agent_status') {
      this.agentSnapshot = {
        ...this.agentSnapshot,
        ...event.payload,
        repo: event.payload.repo ?? this.agentSnapshot.repo,
      };
      return;
    }

    if (event.type === 'chat_message_added') {
      this.agentSnapshot = {
        ...this.agentSnapshot,
        messages: [...this.agentSnapshot.messages, event.payload.message],
      };
      return;
    }

    if (event.type === 'chat_message_updated') {
      this.agentSnapshot = {
        ...this.agentSnapshot,
        messages: this.agentSnapshot.messages.map((message) =>
          message.id === event.payload.messageId
            ? {
                ...message,
                text: event.payload.text,
                status: event.payload.status,
                ...(event.payload.tools ? { tools: event.payload.tools } : {}),
              }
            : message,
        ),
      };
      return;
    }

    if (event.type === 'workspace_changed') {
      this.options.onWorkspaceChange?.(event.payload.path);
      return;
    }

    if (event.type === 'interactive_prompt') {
      this.dismissedPromptId = null;
      this.agentSnapshot = {
        ...this.agentSnapshot,
        interactivePrompt: event.payload,
      };
      return;
    }

    if (event.type === 'repo_selected') {
      this.agentSnapshot = {
        ...emptyAgentSnapshot,
        repo: event.payload.repo,
      };
      this.options.onRepoSelected?.(event.payload.repo);
    }
  }
}
