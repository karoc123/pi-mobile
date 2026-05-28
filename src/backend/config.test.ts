// @vitest-environment node

import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("treats blank optional environment values as unset", () => {
    const config = loadConfig({
      APP_PASSWORD: "secret-pass",
      WORKSPACE_ROOT: "/workspace",
      DEFAULT_REPO: "",
      PI_PROVIDER: "",
      PI_MODEL: "",
      PI_THINKING_LEVEL: "",
    });

    expect(config.defaultRepo).toBeUndefined();
    expect(config.piProvider).toBeUndefined();
    expect(config.piModel).toBeUndefined();
    expect(config.piThinkingLevel).toBeUndefined();
  });
});
