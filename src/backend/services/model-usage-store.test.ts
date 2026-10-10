// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentModelOption } from "../../shared/contracts.js";
import { ModelUsageStore } from "./model-usage-store.js";

const tempDirs: string[] = [];

function createTempFilePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pimobile-model-usage-"));
  tempDirs.push(dir);
  return path.join(dir, "nested", "model-usage.json");
}

function model(provider: string, modelId: string, overrides: Partial<AgentModelOption> = {}): AgentModelOption {
  return { provider, modelId, name: modelId, available: true, isCurrent: false, usingSubscription: false, ...overrides };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ModelUsageStore", () => {
  it("ranks current model first, then usage count, availability and name", () => {
    const store = new ModelUsageStore(createTempFilePath());
    store.record("openai", "gpt-5");
    store.record("openai", "gpt-5");
    store.record("anthropic", "claude");

    const ranked = store.rank([
      model("zeta", "unused"),
      model("alpha", "unavailable", { available: false }),
      model("anthropic", "claude"),
      model("openai", "gpt-5"),
      model("beta", "current", { isCurrent: true }),
    ]);

    expect(ranked.map((entry) => `${entry.provider}/${entry.modelId}:${entry.usageCount}`)).toEqual([
      "beta/current:0",
      "openai/gpt-5:2",
      "anthropic/claude:1",
      "zeta/unused:0",
      "alpha/unavailable:0",
    ]);
  });

  it("persists counts across instances", () => {
    const filePath = createTempFilePath();
    new ModelUsageStore(filePath).record("openai", "gpt-5");

    expect(new ModelUsageStore(filePath).rank([model("openai", "gpt-5")])[0]?.usageCount).toBe(1);
  });

  it("starts empty when the file is missing or corrupt", () => {
    const filePath = createTempFilePath();
    expect(new ModelUsageStore(filePath).rank([model("openai", "gpt-5")])[0]?.usageCount).toBe(0);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{not json");
    expect(new ModelUsageStore(filePath).rank([model("openai", "gpt-5")])[0]?.usageCount).toBe(0);

    fs.writeFileSync(filePath, JSON.stringify({ "openai/gpt-5": "many", "a/b": 3 }));
    const ranked = new ModelUsageStore(filePath).rank([model("openai", "gpt-5"), model("a", "b")]);
    expect(ranked.map((entry) => entry.usageCount)).toEqual([3, 0]);
  });
});
