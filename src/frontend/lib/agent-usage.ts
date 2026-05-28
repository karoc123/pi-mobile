import type { AgentUsage } from '../../shared/contracts.js';

export function formatCompactTokenCount(value: number) {
  if (value < 1000) {
    return String(value);
  }

  if (value < 10_000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }

  if (value < 1_000_000) {
    return `${Math.round(value / 1000)}k`;
  }

  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0).replace(/\.0$/, '')}m`;
}

export function formatUsageSummary(usage: AgentUsage) {
  const parts: string[] = [];

  if (usage.inputTokens > 0) {
    parts.push(`↑${formatCompactTokenCount(usage.inputTokens)}`);
  }

  if (usage.outputTokens > 0) {
    parts.push(`↓${formatCompactTokenCount(usage.outputTokens)}`);
  }

  if (usage.totalCost > 0 || usage.usingSubscription) {
    parts.push(`$${usage.totalCost.toFixed(3)}${usage.usingSubscription ? ' (sub)' : ''}`);
  }

  const contextWindow = usage.contextWindow ? formatCompactTokenCount(usage.contextWindow) : '?';
  const contextPercent = usage.contextPercent === null ? '?' : `${usage.contextPercent.toFixed(1)}%`;
  const autoIndicator = usage.autoCompactEnabled ? ' (auto)' : '';
  parts.push(`${contextPercent}/${contextWindow}${autoIndicator}`);

  return parts.join(' ');
}

export function formatModelLabel(modelId: string | null) {
  if (!modelId) {
    return 'No model';
  }

  return modelId;
}