import { describe, expect, it } from 'vitest';

import { formatCompactTokenCount, formatModelLabel, formatUsageSummary } from './agent-usage.js';

describe('agent usage helpers', () => {
  it('formats compact token values', () => {
    expect(formatCompactTokenCount(5)).toBe('5');
    expect(formatCompactTokenCount(4700)).toBe('4.7k');
    expect(formatCompactTokenCount(400000)).toBe('400k');
  });

  it('formats the Pi-style footer summary', () => {
    expect(
      formatUsageSummary({
        inputTokens: 4700,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 4705,
        totalCost: 0.008,
        contextTokens: 4800,
        contextWindow: 400000,
        contextPercent: 1.2,
        modelId: 'anthropic/claude-sonnet-4-5',
        usingSubscription: false,
        autoCompactEnabled: true,
      }),
    ).toBe('↑4.7k ↓5 $0.008 1.2%/400k (auto)');
  });

  it('falls back to a readable model label', () => {
    expect(formatModelLabel('anthropic/claude-sonnet-4-5')).toBe('anthropic/claude-sonnet-4-5');
    expect(formatModelLabel(null)).toBe('No model');
  });
});