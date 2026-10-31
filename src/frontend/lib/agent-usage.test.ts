import { describe, expect, it } from 'vitest';

import { formatCompactTokenCount, formatUsageCost } from './agent-usage.js';

describe('agent usage helpers', () => {
  it('formats compact token values', () => {
    expect(formatCompactTokenCount(5)).toBe('5');
    expect(formatCompactTokenCount(4700)).toBe('4.7k');
    expect(formatCompactTokenCount(400000)).toBe('400k');
  });

  it('formats tiny session costs with micro precision', () => {
    expect(formatUsageCost(0)).toBe('$0.000');
    expect(formatUsageCost(0.00041)).toBe('$0.000410');
    expect(formatUsageCost(0.0041)).toBe('$0.004');
  });
});
