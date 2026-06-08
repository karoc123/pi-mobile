import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import PiLoginModal from "./PiLoginModal.svelte";

describe("PiLoginModal", () => {
  it("enables token submission only after token input", async () => {
    render(PiLoginModal, {
      open: true,
      loading: false,
      submitting: false,
      providers: [
        { provider: "anthropic", label: "Anthropic", configured: false },
        { provider: "openai", label: "OpenAI", configured: false },
      ],
      errorMessage: "",
    });

    const saveButton = screen.getByRole("button", { name: "Save token" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await fireEvent.input(screen.getByLabelText("API token"), { target: { value: "secret-token" } });

    expect(saveButton.disabled).toBe(false);
  });

  it("shows configured provider state and logout action", () => {
    render(PiLoginModal, {
      open: true,
      loading: false,
      submitting: false,
      providers: [{ provider: "anthropic", label: "Anthropic", configured: true }],
      errorMessage: "",
    });

    expect(screen.getByRole("option", { name: "Anthropic · configured" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Logout provider" })).toBeTruthy();
  });
});
