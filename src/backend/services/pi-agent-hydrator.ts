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

export function summarizePayload(payload: unknown, maxLength: number | null = 240) {
  if (payload === null || payload === undefined) {
    return "";
  }

  const text = (() => {
    if (typeof payload === "string") {
      return payload;
    }

    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  })();

  if (maxLength === null || maxLength < 0) {
    return text;
  }

  return text.slice(0, maxLength);
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

  const candidate = entry as {
    role?: string;
    createdAt?: unknown;
    timestamp?: unknown;
    content?: unknown[];
  };

  if (candidate.role !== "user" && candidate.role !== "assistant") {
    return null;
  }

  return {
    id: randomUUID(),
    role: candidate.role,
    text: flattenMessageText(candidate),
    status: "complete",
    timestamp: resolveMessageTimestamp(candidate),
  };
}

function resolveMessageTimestamp(candidate: { createdAt?: unknown; timestamp?: unknown }) {
  return normalizeTimestampValue(candidate.createdAt) ?? normalizeTimestampValue(candidate.timestamp) ?? new Date().toISOString();
}

function normalizeTimestampValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Date.parse(trimmed);

    if (!Number.isFinite(parsed)) {
      return null;
    }

    return new Date(parsed).toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;

    if (!Number.isFinite(milliseconds)) {
      return null;
    }

    return new Date(milliseconds).toISOString();
  }

  return null;
}
