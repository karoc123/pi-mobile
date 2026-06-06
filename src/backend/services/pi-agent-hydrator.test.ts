// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { hydrateMessagesFromSession } from "./pi-agent-hydrator.js";

describe("hydrateMessagesFromSession", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses createdAt when available", () => {
    const createdAt = "2026-06-07T14:33:22.000Z";

    const messages = hydrateMessagesFromSession([
      {
        role: "user",
        createdAt,
        content: "hello",
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].timestamp).toBe(createdAt);
  });

  it("hydrates timestamp from numeric milliseconds", () => {
    const timestampMs = 1780823602123;

    const messages = hydrateMessagesFromSession([
      {
        role: "assistant",
        timestamp: timestampMs,
        content: [{ type: "text", text: "answer" }],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].timestamp).toBe(new Date(timestampMs).toISOString());
  });

  it("hydrates timestamp from numeric seconds", () => {
    const timestampSeconds = 1780823602;

    const messages = hydrateMessagesFromSession([
      {
        role: "user",
        timestamp: timestampSeconds,
        content: "hello",
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].timestamp).toBe(new Date(timestampSeconds * 1000).toISOString());
  });

  it("falls back to now when no valid timestamp is present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T18:05:00.000Z"));

    const messages = hydrateMessagesFromSession([
      {
        role: "assistant",
        timestamp: "not-a-date",
        content: [{ type: "text", text: "answer" }],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].timestamp).toBe("2026-06-07T18:05:00.000Z");
  });
});
