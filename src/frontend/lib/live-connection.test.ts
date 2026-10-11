import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSnapshot, WebsocketEnvelope } from '../../shared/contracts.js';
import { emptyAgentSnapshot, LiveConnection } from './live-connection.svelte.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor() {
    MockWebSocket.instances.push(this);
  }

  close = vi.fn(() => {
    if (this.onclose) {
      this.onclose();
    }
  });

  send = vi.fn();
}

describe('LiveConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('initializes with offline status and empty snapshot', () => {
    const live = new LiveConnection();
    expect(live.status).toBe('offline');
    expect(live.agentSnapshot.runtimePhase).toBe('idle');
    expect(live.agentSnapshot.messages).toEqual([]);
    live.destroy();
  });

  it('updates status and snapshot upon WebSocket connection and snapshot message', () => {
    const live = new LiveConnection();
    live.connect();

    expect(live.status).toBe('connecting');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();

    expect(live.status).toBe('connected');

    const testSnapshot: AgentSnapshot = {
      ...emptyAgentSnapshot,
      runtimePhase: 'streaming',
      pendingMessageCount: 2,
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          text: 'Hello',
          status: 'complete',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'snapshot',
        payload: testSnapshot,
      } satisfies WebsocketEnvelope),
    });

    expect(live.agentSnapshot.runtimePhase).toBe('streaming');
    expect(live.agentSnapshot.messages).toHaveLength(1);
    expect(live.agentSnapshot.messages[0]?.text).toBe('Hello');

    live.destroy();
  });

  it('handles chat messages added and updated', () => {
    const live = new LiveConnection();
    live.connect();
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'chat_message_added',
        payload: {
          message: {
            id: 'msg-2',
            role: 'assistant',
            text: 'Thinking...',
            status: 'streaming',
            timestamp: new Date().toISOString(),
          },
        },
      } satisfies WebsocketEnvelope),
    });

    expect(live.agentSnapshot.messages).toHaveLength(1);
    expect(live.agentSnapshot.messages[0]?.text).toBe('Thinking...');

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'chat_message_updated',
        payload: {
          messageId: 'msg-2',
          text: 'Done!',
          status: 'complete',
        },
      } satisfies WebsocketEnvelope),
    });

    expect(live.agentSnapshot.messages[0]?.text).toBe('Done!');
    expect(live.agentSnapshot.messages[0]?.status).toBe('complete');

    live.destroy();
  });

  it('handles interactive prompt and dismissPrompt', () => {
    const live = new LiveConnection();
    live.connect();
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'interactive_prompt',
        payload: {
          promptId: 'prompt-1',
          title: 'Confirmation',
          questions: [
            {
              id: 'q1',
              label: 'Are you sure?',
              options: ['yes', 'no'],
              allowFreeText: false,
            },
          ],
        },
      } satisfies WebsocketEnvelope),
    });

    expect(live.agentSnapshot.interactivePrompt?.promptId).toBe('prompt-1');

    live.dismissPrompt();
    expect(live.agentSnapshot.interactivePrompt).toBeNull();

    live.destroy();
  });

  it('forwards workspace_changed to callback', () => {
    const onWorkspaceChange = vi.fn();
    const live = new LiveConnection({ onWorkspaceChange });
    live.connect();
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'workspace_changed',
        payload: { path: 'src/index.ts', kind: 'change' },
      } satisfies WebsocketEnvelope),
    });

    expect(onWorkspaceChange).toHaveBeenCalledWith('src/index.ts');

    live.destroy();
  });

  it('disconnects and marks status offline', () => {
    const live = new LiveConnection();
    live.connect();
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    expect(live.status).toBe('connected');

    live.disconnect();
    expect(live.status).toBe('offline');
    expect(ws.close).toHaveBeenCalled();

    live.destroy();
  });
});
