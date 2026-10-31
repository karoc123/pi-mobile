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

export function formatUsageCost(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.000';
  }

  if (value < 0.001) {
    return `$${value.toFixed(6)}`;
  }

  return `$${value.toFixed(3)}`;
}
