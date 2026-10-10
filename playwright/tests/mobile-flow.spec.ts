import { expect, test } from "@playwright/test";

test("mobile browser flow covers login, repo selection, chat, editor save, and hunk revert", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Mobile Git cockpit for your local repos" })).toBeVisible();
  await page.getByLabel("App password").fill("test-password");
  await page.getByRole("button", { name: "Unlock workspace" }).click();

  await expect(page.getByRole("button", { name: "Open workspace menu" })).toBeVisible();

  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await expect(page.getByRole("dialog", { name: "App menu" })).toBeVisible();
  await page.getByRole("button", { name: "VS Code Light" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("vscode-light");

  await page.getByRole("button", { name: "Pi Login" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Provider token" })).toBeVisible();
  await page.getByLabel("API token").fill(`token-${Date.now()}`);
  await page.getByRole("button", { name: "Save token" }).click();
  await expect(page.locator(".notice.success")).toContainText("Pi token for");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Choose repo" }).click();

  const repoRow = page.locator(".picker-entry").filter({ hasText: "playwright-smoke-repo" }).first();
  await expect(repoRow).toBeVisible();
  await repoRow.getByRole("button", { name: /Use repo|Active/ }).click();

  await page.getByRole("button", { name: "Chat" }).click();

  const promptInput = page.getByPlaceholder("Ask pi to change the active repository...");
  await expect(promptInput).toBeVisible();
  const runToken = `READY_${Date.now()}`;
  await promptInput.fill(`Reply with the single word ${runToken}. Do not modify any files.`);

  await page.locator("button.send-button").click();
  await expect(page.locator(".message-card.assistant").last()).toContainText(runToken);

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

test("mobile browser flow covers file actions, hunk staging, and commit", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept(dialog.type() === "prompt" ? "e2e commit" : undefined));

  await page.goto("/");
  await page.getByLabel("App password").fill("test-password");
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Choose repo" }).click();
  await page.locator(".picker-entry").filter({ hasText: "playwright-smoke-repo" }).first().getByRole("button", { name: /Use repo|Active/ }).click();

  const notice = page.locator(".notice.success");
  const editorActions = page.getByRole("dialog", { name: "Editor actions" });

  await page.getByRole("button", { name: "Editor" }).click();
  await page.getByRole("button", { name: "Actions" }).click();
  await editorActions.getByRole("button", { name: "New file" }).click();
  await page.getByLabel("File path").fill("docs/todo.md");
  await page.getByLabel("Initial content").fill("draft\n");
  await editorActions.getByRole("button", { name: "Create file" }).click();
  await expect(notice).toContainText("File created.");
  await expect(page.getByRole("heading", { level: 2, name: "docs/todo.md" })).toBeVisible();

  await page.getByRole("button", { name: "Actions" }).click();
  await editorActions.getByRole("button", { name: "Rename file" }).click();
  await page.getByLabel("Target path").fill("docs/done.md");
  await editorActions.getByRole("button", { name: "Rename file" }).click();
  await expect(notice).toContainText("File renamed.");
  await expect(page.getByRole("heading", { level: 2, name: "docs/done.md" })).toBeVisible();

  await page.getByRole("button", { name: "Actions" }).click();
  await editorActions.getByRole("button", { name: "Delete file" }).click();
  await editorActions.getByRole("button", { name: "Delete file" }).click();
  await expect(notice).toContainText("File deleted.");

  await page.getByRole("button", { name: "↑" }).click();
  await page.getByRole("button", { name: "Expand" }).click();
  await page.getByRole("button", { name: /notes\.txt/ }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("alpha\nbeta staged\ngamma\n");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(notice).toContainText("File saved.");

  await page.getByRole("button", { name: "Diff" }).click();
  await page.getByRole("button", { name: "Stage hunk" }).click();
  await expect(notice).toContainText("Hunk staged.");
  await page.getByRole("button", { name: "Open git actions" }).click();
  await page.getByRole("menuitem", { name: "Commit staged" }).click();
  await expect(notice).toContainText("Committed");
  await expect(page.getByRole("heading", { name: "Working tree clean" })).toBeVisible();
});
