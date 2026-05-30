// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ChatMessage, ToolActivity, WebsocketEnvelope } from "../../shared/contracts.js";
import { PiAgentBroadcaster } from "./pi-agent-broadcaster.js";

describe("PiAgentBroadcaster", () => {
  it("emits typed websocket envelopes for chat, tool, status, and error updates", () => {
    const events: WebsocketEnvelope[] = [];
    const broadcaster = new PiAgentBroadcaster((event) => {
      events.push(event);
    });

    const message: ChatMessage = {
      id: "msg-1",
      role: "assistant",
      text: "hello",
      status: "complete",
      timestamp: new Date().toISOString(),
    };

    const tool: ToolActivity = {
      id: "tool-1",
      toolName: "run-tests",
      status: "complete",
      detail: "ok",
    };

    broadcaster.chatMessageAdded(message);
    broadcaster.chatMessageUpdated(message.id, "updated", "streaming");
    broadcaster.toolActivity(tool);
    broadcaster.agentError("boom");
    broadcaster.agentStatus({
      isConfigured: true,
      isStreaming: false,
      runtimePhase: "idle",
      pendingMessageCount: 0,
      isCompacting: false,
      isRetrying: false,
      isBashRunning: false,
      lastError: null,
      repo: {
        name: "repo",
        relativePath: "repo",
        absolutePath: "/tmp/repo",
      },
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 3,
        totalCost: 0.01,
        contextTokens: 3,
        contextWindow: 400000,
        contextPercent: 0,
        modelId: "model",
        usingSubscription: false,
        autoCompactEnabled: false,
      },
    });

    expect(events.map((event) => event.type)).toEqual([
      "chat_message_added",
      "chat_message_updated",
      "tool_activity",
      "agent_error",
      "agent_status",
    ]);

    expect(events[0]).toEqual({
      type: "chat_message_added",
      payload: { message },
    });

    expect(events[1]).toEqual({
      type: "chat_message_updated",
      payload: {
        messageId: "msg-1",
        text: "updated",
        status: "streaming",
      },
    });

    expect(events[2]).toEqual({
      type: "tool_activity",
      payload: { tool },
    });

    expect(events[3]).toEqual({
      type: "agent_error",
      payload: { message: "boom" },
    });

    expect(events[4].type).toBe("agent_status");
  });
});
