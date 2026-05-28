import { expect, test } from "@playwright/test";

test("mobile browser flow covers login, repo selection, chat, editor save, and hunk revert", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Mobile Git cockpit for your local repos" })).toBeVisible();
  await page.getByLabel("App password").fill("test-password");
  await page.getByRole("button", { name: "Unlock workspace" }).click();

  await expect(page.getByRole("button", { name: "Choose repo" })).toBeVisible();

  await page.getByRole("button", { name: "Choose repo" }).click();
  const repoRow = page.locator(".picker-entry").filter({ hasText: "playwright-smoke-repo" }).first();
  await expect(repoRow).toBeVisible();
  await repoRow.getByRole("button", { name: /Use repo|Active/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "playwright-smoke-repo" })).toBeVisible();

  await page.getByRole("textbox", { name: "Ask pi to change the active repository..." }).fill("Reply with the single word READY. Do not modify any files.");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.locator(".message-card.assistant")).toContainText("READY");

  await page.getByRole("button", { name: "Editor" }).click();
  await page.getByRole("button", { name: /notes\.txt/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "notes.txt" })).toBeVisible();
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("beta");

  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("alpha\nbeta changed\ngamma\n");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".notice.success")).toContainText("File saved.");

  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.getByText("modified · +1 / -1")).toBeVisible();
  await page.getByRole("button", { name: "Revert hunk" }).click();
  await expect(page.locator(".notice.success")).toContainText("Hunk reverted.");

  await page.getByRole("button", { name: "Editor" }).click();
  await page.getByRole("button", { name: /notes\.txt/ }).click();
  await expect(page.locator(".cm-content")).toContainText("beta");
  await expect(page.locator(".cm-content")).not.toContainText("beta changed");
});
