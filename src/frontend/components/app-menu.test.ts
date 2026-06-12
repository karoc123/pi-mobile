import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import AppMenu from "./AppMenu.svelte";

describe("AppMenu", () => {
  it("shows the Pi Login action in the session section", () => {
    render(AppMenu, {
      open: true,
      currentRepo: null,
      theme: "vscode-dark",
      followUpCostGuardEnabled: true,
      followUpCostGuardEnabledHasOverride: false,
      followUpCostSoftLimitUsd: 0.5,
      followUpCostSoftLimitUsdDefault: 0.5,
      followUpCostSoftLimitHasOverride: false,
    });

    expect(screen.getByRole("button", { name: "Pi Login" })).toBeTruthy();
  });

  it("keeps logout and Pi Login grouped in the session section", () => {
    render(AppMenu, {
      open: true,
      currentRepo: null,
      theme: "vscode-dark",
      followUpCostGuardEnabled: true,
      followUpCostGuardEnabledHasOverride: false,
      followUpCostSoftLimitUsd: 0.5,
      followUpCostSoftLimitUsdDefault: 0.5,
      followUpCostSoftLimitHasOverride: false,
    });

    expect(screen.getByRole("button", { name: "Pi Login" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Logout" })).toBeTruthy();
  });
});
