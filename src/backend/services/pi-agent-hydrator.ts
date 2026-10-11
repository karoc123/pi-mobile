import { randomUUID } from 'node:crypto';

import type { ChatMessage, ChatToolCall } from '../../shared/contracts.js';

export function hydrateMessagesFromSession(sessionMessages: readonly unknown[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const entry of sessionMessages) {
    if (!entry || typeof entry !== 'object' || !('role' in entry)) {
      continue;
    }

    const candidate = entry as {
      role?: string;
      createdAt?: unknown;
      timestamp?: unknown;
      content?: unknown;
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
      isError?: boolean;
    };

    if (candidate.role === 'toolResult' || candidate.role === 'tool-result') {
      const lastAssistant = [...result].reverse().find((message) => message.role === 'assistant');
      if (lastAssistant && lastAssistant.tools) {
        const matchingTool = lastAssistant.tools.find(
          (tool) =>
            tool.id === candidate.toolCallId ||
            (candidate.toolName && tool.name === candidate.toolName),
        );
        if (matchingTool) {
          matchingTool.status = candidate.isError ? 'error' : 'complete';
          const resultDetail = extractToolResultDetail(candidate);
          if (resultDetail) {
            matchingTool.detail = resultDetail;
          }
        }
      }
      continue;
    }

    if (candidate.role !== 'user' && candidate.role !== 'assistant') {
      continue;
    }

    const tools = candidate.role === 'assistant' ? extractToolCalls(candidate) : undefined;
    const text = flattenMessageText(candidate);

    if (candidate.role === 'assistant' && text.length === 0 && (!tools || tools.length === 0)) {
      continue;
    }

    result.push({
      id: randomUUID(),
      role: candidate.role,
      text,
      status: 'complete',
      timestamp: resolveMessageTimestamp(candidate),
      ...(tools && tools.length > 0 ? { tools } : {}),
    });
  }

  return result;
}

export function flattenMessageText(message: { content?: unknown }) {
  if (typeof message.content === 'string') {
    return message.content.trim();
  }

  if (!Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .map((chunk) => {
      if (typeof chunk === 'string') {
        return chunk;
      }

      if (!chunk || typeof chunk !== 'object') {
        return '';
      }

      const typedChunk = chunk as {
        type?: string;
        text?: string;
      };
      const type = typedChunk.type ?? '';

      if (type === 'text') {
        return typedChunk.text ?? '';
      }

      return '';
    })
    .join('')
    .trim();
}

export function summarizePayload(payload: unknown, maxLength: number | null = 240) {
  if (payload === null || payload === undefined) {
    return '';
  }

  const text = (() => {
    if (typeof payload === 'string') {
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
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (normalized.length === 0) {
    return 'No text';
  }

  return normalized.slice(0, 120);
}

function extractToolCalls(candidate: { content?: unknown }): ChatToolCall[] {
  if (!Array.isArray(candidate.content)) {
    return [];
  }

  const tools: ChatToolCall[] = [];

  for (const chunk of candidate.content) {
    if (!chunk || typeof chunk !== 'object') {
      continue;
    }

    const typedChunk = chunk as {
      type?: string;
      id?: string;
      toolCallId?: string;
      name?: string;
      toolName?: string;
      arguments?: unknown;
      args?: unknown;
    };

    const type = typedChunk.type ?? '';

    if (type === 'tool-call' || type === 'toolCall' || type === 'tool_call') {
      const toolId = String(typedChunk.id || typedChunk.toolCallId || randomUUID());
      const toolName = String(typedChunk.name || typedChunk.toolName || 'unknown');
      const toolArgs = typedChunk.arguments ?? typedChunk.args;
      const detail = toolArgs ? summarizePayload(toolArgs, null) : '';

      tools.push({
        id: toolId,
        name: toolName,
        status: 'complete',
        detail,
      });
    }
  }

  return tools;
}

function extractToolResultDetail(entry: { content?: unknown; result?: unknown }): string {
  if (typeof entry.content === 'string') {
    return entry.content.trim();
  }

  if (Array.isArray(entry.content)) {
    const text = entry.content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text: unknown }).text ?? '');
        }
        return '';
      })
      .join('')
      .trim();
    if (text.length > 0) {
      return text;
    }
  }

  return summarizePayload(entry.result ?? entry.content, null);
}

function resolveMessageTimestamp(candidate: { createdAt?: unknown; timestamp?: unknown }) {
  return (
    normalizeTimestampValue(candidate.createdAt) ??
    normalizeTimestampValue(candidate.timestamp) ??
    new Date().toISOString()
  );
}

function normalizeTimestampValue(value: unknown) {
  if (typeof value === 'string') {
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

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;

    if (!Number.isFinite(milliseconds)) {
      return null;
    }

    return new Date(milliseconds).toISOString();
  }

  return null;
}
