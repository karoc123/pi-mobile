import type { AgentSnapshot, ChatMessage, ToolActivity, WebsocketEnvelope } from "../../shared/contracts.js";

type Broadcast = (event: WebsocketEnvelope) => void;

type AgentStatusPayload = Extract<WebsocketEnvelope, { type: "agent_status" }> ["payload"];

export class PiAgentBroadcaster {
  constructor(private readonly broadcast: Broadcast) {}

  emit(event: WebsocketEnvelope) {
    this.broadcast(event);
  }

  chatMessageAdded(message: ChatMessage) {
    this.broadcast({
      type: "chat_message_added",
      payload: { message },
    });
  }

  chatMessageUpdated(messageId: string, text: string, status: ChatMessage["status"]) {
    this.broadcast({
      type: "chat_message_updated",
      payload: {
        messageId,
        text,
        status,
      },
    });
  }

  toolActivity(tool: ToolActivity) {
    this.broadcast({
      type: "tool_activity",
      payload: { tool },
    });
  }

  agentError(message: string) {
    this.broadcast({
      type: "agent_error",
      payload: { message },
    });
  }

  agentStatus(payload: AgentStatusPayload) {
    this.broadcast({
      type: "agent_status",
      payload,
    });
  }
}
