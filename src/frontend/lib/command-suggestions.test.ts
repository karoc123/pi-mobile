import { describe, expect, it } from "vitest";

import {
  applySlashCommandSuggestion,
  findSlashCommandQuery,
  getSlashCommandSuggestions,
  getSubmittedSlashCommand,
  toRuntimeSlashCommandSuggestions,
} from "./command-suggestions.js";

describe("slash command suggestions", () => {
  it("detects the active slash query near the cursor", () => {
    expect(findSlashCommandQuery("/mo", 3)).toEqual({
      value: "/mo",
      start: 0,
      end: 3,
    });
  });

  it("suggests matching Pi commands", () => {
    expect(getSlashCommandSuggestions("/mo", 3).map((entry) => entry.command)).toContain("/model");
    expect(getSlashCommandSuggestions("hello", 5)).toEqual([]);
  });

  it("applies a selected slash command suggestion", () => {
    expect(applySlashCommandSuggestion("/mo", 3, { command: "/model", description: "Switch models" })).toEqual({
      prompt: "/model ",
      cursorIndex: 7,
    });
  });

  it("parses a submitted slash command before prompt dispatch", () => {
    expect(getSubmittedSlashCommand("  /compact keep file history  ")).toEqual({
      suggestion: { command: "/compact", description: "Compact the current context" },
      args: "keep file history",
    });
    expect(getSubmittedSlashCommand("write a summary")).toBeNull();
  });

  it("supports runtime slash commands with skill prefixes", () => {
    const runtimeSuggestions = toRuntimeSlashCommandSuggestions([
      {
        name: "skill:repo-review",
        description: "Review repository health",
        source: "skill",
      },
    ]);

    expect(getSlashCommandSuggestions("/skill:r", 8, runtimeSuggestions)).toEqual([
      {
        command: "/skill:repo-review",
        description: "Review repository health",
      },
    ]);

    expect(getSubmittedSlashCommand("/skill:repo-review run", runtimeSuggestions)).toEqual({
      suggestion: {
        command: "/skill:repo-review",
        description: "Review repository health",
      },
      args: "run",
    });
  });
});
