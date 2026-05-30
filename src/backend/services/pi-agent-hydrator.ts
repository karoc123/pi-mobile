import { randomUUID } from "node:crypto";

import type { ChatMessage, ToolActivity } from "../../shared/contracts.js";

export function hydrateMessagesFromSession(sessionMessages: readonly unknown[]) {
  return sessionMessages.map((entry) => toChatMessage(entry)).filter((entry): entry is ChatMessage => entry !== null);
}

export function flattenMessageText(message: { content?: string | unknown[] }) {
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

export function upsertTool(tools: ToolActivity[], tool: ToolActivity) {
  const remainder = tools.filter((entry) => entry.id !== tool.id);
  return [tool, ...remainder].slice(0, 12);
}

export function summarizePayload(payload: unknown) {
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

export function summarizeText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return "No text";
  }

  return normalized.slice(0, 120);
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
