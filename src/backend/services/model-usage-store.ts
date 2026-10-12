import fs from 'node:fs';
import path from 'node:path';

import type { AgentModelOption } from '../../shared/contracts.js';
import type { LogChannel } from './log-service.js';

type ModelUsageCounts = Record<string, number>;

export class ModelUsageStore {
  private readonly counts: ModelUsageCounts;

  constructor(
    private readonly filePath: string,
    private readonly logger?: LogChannel,
  ) {
    this.counts = readCounts(filePath);
  }

  record(provider: string, modelId: string) {
    const key = toKey(provider, modelId);
    this.counts[key] = (this.counts[key] ?? 0) + 1;

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.counts));
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      this.logger?.warn('Failed to persist model usage.', {
        event: 'model_usage_persist_failed',
        details: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  rank(models: AgentModelOption[]): AgentModelOption[] {
    return models
      .map((model) => ({
        ...model,
        usageCount: this.counts[toKey(model.provider, model.modelId)] ?? 0,
      }))
      .sort(
        (left, right) =>
          Number(right.isCurrent) - Number(left.isCurrent) ||
          right.usageCount - left.usageCount ||
          Number(right.available) - Number(left.available) ||
          toKey(left.provider, left.modelId).localeCompare(toKey(right.provider, right.modelId)),
      );
  }
}

function toKey(provider: string, modelId: string) {
  return `${provider}/${modelId}`;
}

function readCounts(filePath: string): ModelUsageCounts {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => Number.isInteger(entry[1]) && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}
