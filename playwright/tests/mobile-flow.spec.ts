import { expect, test } from '@playwright/test';

test('mobile browser flow covers login, repo selection, chat, editor save, and hunk revert', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Mobile Git cockpit for your local repos' }),
  ).toBeVisible();
  await page.getByLabel('App password').fill('test-password');
  await page.getByRole('button', { name: 'Unlock workspace' }).click();

  await expect(page.getByRole('button', { name: 'Open workspace menu' })).toBeVisible();

  await page.getByRole('button', { name: 'Open workspace menu' }).click();
  await expect(page.getByRole('dialog', { name: 'App menu' })).toBeVisible();
  await page.getByRole('button', { name: 'VS Code Light' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('vscode-light');

  await page.getByRole('button', { name: 'Pi Login' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Provider token' })).toBeVisible();
  await page.getByLabel('API token').fill(`token-${Date.now()}`);
  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(page.locator('.notice.success')).toContainText('Pi token for');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Open workspace menu' }).click();
  await page.getByRole('button', { name: 'Choose repo' }).click();

  const repoRow = page
    .locator('.picker-entry')
    .filter({ hasText: 'playwright-smoke-repo' })
    .first();
  await expect(repoRow).toBeVisible();
  await repoRow.getByRole('button', { name: /Use repo|Active/ }).click();

  await page.getByRole('button', { name: 'Chat' }).click();

  const promptInput = page.getByPlaceholder('Ask pi to change the active repository...');
  await expect(promptInput).toBeVisible();
  const runToken = `READY_${Date.now()}`;
  await promptInput.fill(`Reply with the single word ${runToken}. Do not modify any files.`);

  await page.locator('button.send-button').click();
  await expect(page.locator('.message-card.assistant').last()).toContainText(runToken);

  await page.locator('.composer-status-title').click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: /notes\.txt/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'notes.txt' })).toBeVisible();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('beta');

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('alpha\nbeta changed\ngamma\n');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.notice.success')).toContainText('File saved.');

  await page.getByRole('button', { name: 'Diff' }).click();
  await expect(page.getByText('modified · +1 / -1')).toBeVisible();
  await page.getByRole('button', { name: 'Revert hunk' }).click();
  await expect(page.locator('.notice.success')).toContainText('Hunk reverted.');

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: /notes\.txt/ }).click();
  await expect(page.locator('.cm-content')).toContainText('beta');
  await expect(page.locator('.cm-content')).not.toContainText('beta changed');
});

test('mobile browser flow covers file actions, hunk staging, and commit', async ({ page }) => {
  page.on(
    'dialog',
    (dialog) => void dialog.accept(dialog.type() === 'prompt' ? 'e2e commit' : undefined),
  );

  await page.goto('/');
  await page.getByLabel('App password').fill('test-password');
  await page.getByRole('button', { name: 'Unlock workspace' }).click();
  await page.getByRole('button', { name: 'Open workspace menu' }).click();
  await page.getByRole('button', { name: 'Choose repo' }).click();
  await page
    .locator('.picker-entry')
    .filter({ hasText: 'playwright-smoke-repo' })
    .first()
    .getByRole('button', { name: /Use repo|Active/ })
    .click();

  const notice = page.locator('.notice.success');
  const editorActions = page.getByRole('dialog', { name: 'Editor actions' });

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await editorActions.getByRole('button', { name: 'New file' }).click();
  await page.getByLabel('File path').fill('docs/todo.md');
  await page.getByLabel('Initial content').fill('draft\n');
  await editorActions.getByRole('button', { name: 'Create file' }).click();
  await expect(notice).toContainText('File created.');
  await expect(page.getByRole('heading', { level: 2, name: 'docs/todo.md' })).toBeVisible();

  await page.getByRole('button', { name: 'Actions' }).click();
  await editorActions.getByRole('button', { name: 'Rename file' }).click();
  await page.getByLabel('Target path').fill('docs/done.md');
  await editorActions.getByRole('button', { name: 'Rename file' }).click();
  await expect(notice).toContainText('File renamed.');
  await expect(page.getByRole('heading', { level: 2, name: 'docs/done.md' })).toBeVisible();

  await page.getByRole('button', { name: 'Actions' }).click();
  await editorActions.getByRole('button', { name: 'Delete file' }).click();
  await editorActions.getByRole('button', { name: 'Delete file' }).click();
  await expect(notice).toContainText('File deleted.');

  await page.getByRole('button', { name: '↑' }).click();
  await page.getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('button', { name: /notes\.txt/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('alpha\nbeta staged\ngamma\n');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(notice).toContainText('File saved.');

  await page.getByRole('button', { name: 'Diff' }).click();
  await page.getByRole('button', { name: 'Stage hunk' }).click();
  await expect(notice).toContainText('Hunk staged.');
  await page.getByRole('button', { name: 'Open git actions' }).click();
  await page.getByRole('menuitem', { name: 'Commit staged' }).click();
  await expect(notice).toContainText('Committed');
  await expect(page.getByRole('heading', { name: 'Working tree clean' })).toBeVisible();
});

async function unlockAndSelectRepo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('App password').fill('test-password');
  await page.getByRole('button', { name: 'Unlock workspace' }).click();
  await page.getByRole('button', { name: 'Open workspace menu' }).click();
  await page.getByRole('button', { name: 'Choose repo' }).click();
  await page
    .locator('.picker-entry')
    .filter({ hasText: 'playwright-smoke-repo' })
    .first()
    .getByRole('button', { name: /Use repo|Active/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Workspace root' })).toBeHidden();
}

test('mobile browser flow displays tool calls and completion', async ({ page }) => {
  await unlockAndSelectRepo(page);
  await page.getByRole('button', { name: 'Chat' }).click();

  const promptInput = page.getByPlaceholder('Ask pi to change the active repository...');
  await expect(promptInput).toBeVisible();
  await promptInput.fill('trigger:tool_read');
  await page.locator('button.send-button').click();

  await expect(page.locator('.message-card.assistant').last()).toContainText(
    'Finished tool execution for read.',
  );
  await expect(page.locator('.tool-inline-item').filter({ hasText: 'read' }).first()).toBeVisible();
});

test('mobile browser flow handles interactive prompt', async ({ page }) => {
  await unlockAndSelectRepo(page);
  await page.getByRole('button', { name: 'Chat' }).click();

  const promptInput = page.getByPlaceholder('Ask pi to change the active repository...');
  await expect(promptInput).toBeVisible();
  await promptInput.fill('trigger:ask_user');
  await page.locator('button.send-button').click();

  const interactiveCard = page.locator('.interactive-card');
  await expect(interactiveCard).toBeVisible();
  await expect(interactiveCard.getByText('Question')).toBeVisible();

  const yesChip = interactiveCard.getByRole('button', { name: 'Yes' });
  await expect(yesChip).toBeVisible();
  await yesChip.click();

  const submitButton = interactiveCard.getByRole('button', { name: 'Antwort senden' });
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await expect(page.locator('.message-card.assistant').last()).toContainText('Antworten auf');
});

test('mobile browser flow handles command palette session operations', async ({ page }) => {
  await unlockAndSelectRepo(page);
  await page.getByRole('button', { name: 'Chat' }).click();

  const cmdButton = page.locator('.cmd-button');
  await expect(cmdButton).toBeVisible();
  await cmdButton.click();

  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('faux/faux-1')).toBeVisible();

  await dialog.locator('.command-tab').filter({ hasText: '/session' }).click();
  const sessionNameInput = page.locator('#session-name-input');
  await expect(sessionNameInput).toBeVisible();
  await sessionNameInput.fill('e2e-session-name');
  await dialog.getByRole('button', { name: 'Save session name' }).click();
  await expect(page.locator('.notice.success')).toContainText('Session renamed to');

  await dialog.getByRole('button', { name: 'Start new session' }).click();
  await expect(page.locator('.notice.success')).toContainText('Started a new session.');
});

test('mobile browser flow views logs with search and filters', async ({ page }) => {
  await unlockAndSelectRepo(page);

  await page.getByRole('button', { name: 'Open workspace menu' }).click();
  await page.getByRole('button', { name: 'Open log' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Backend activity stream' }),
  ).toBeVisible();
  await expect(page.locator('.log-filter-card')).toBeVisible();

  const searchInput = page.getByPlaceholder('message, event, repo, request id');
  await expect(searchInput).toBeVisible();
  await searchInput.fill('health');
  await page.getByRole('button', { name: 'Apply' }).click();

  const levelSelect = page.locator('.log-filter-grid select').first();
  await levelSelect.selectOption('info');

  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(searchInput).toHaveValue('');
});

test('mobile browser flow creates and switches branches', async ({ page }) => {
  await unlockAndSelectRepo(page);
  await page.getByRole('button', { name: 'Diff' }).click();

  await page.getByRole('button', { name: 'Open git actions' }).click();
  await page.getByRole('menuitem', { name: 'Create branch…' }).click();

  const branchNameInput = page.locator('#new-branch-name');
  await expect(branchNameInput).toBeVisible();
  const branchName = `feature/review-${Date.now()}`;
  await branchNameInput.fill(branchName);
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.locator('.notice.success')).toContainText(`Created branch ${branchName}.`);

  await page.getByRole('button', { name: 'Open git actions' }).click();
  await page.getByRole('menuitem', { name: 'Switch branch…' }).click();

  const switchSheet = page.getByRole('dialog', { name: 'Switch branch' });
  await expect(switchSheet).toBeVisible();
  const baseBranchButton = switchSheet.getByRole('button', { name: /master|main/ });
  await expect(baseBranchButton).toBeVisible();
  await baseBranchButton.click();
  await expect(page.locator('.notice.success')).toContainText(/Switched to (master|main)\./);
});

test('mobile browser flow previews image and downloads it', async ({ page }) => {
  await unlockAndSelectRepo(page);
  await page.getByRole('button', { name: 'Editor' }).click();

  await page.getByRole('button', { name: /pixel\.png/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'pixel.png' })).toBeVisible();

  const imagePreview = page.locator('.editor-image-preview img');
  await expect(imagePreview).toBeVisible();
  await expect(imagePreview).toHaveAttribute('src', /\/api\/files\/raw\?path=/);
  await expect
    .poll(() => imagePreview.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Actions' }).click();
  const editorActions = page.getByRole('dialog', { name: 'Editor actions' });
  await editorActions.getByRole('button', { name: 'Download file' }).click();
  const downloaded = page.waitForEvent('download');
  await editorActions.getByRole('button', { name: 'Download file' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('pixel.png');
  expect(await download.failure()).toBeNull();

  await expect(page.locator('.notice.success')).toContainText('File downloaded.');
});

test('chat follows long responses and keeps manual scrolling stable', async ({ page }) => {
  await unlockAndSelectRepo(page);
  await page.request.post('/api/agent/new-session');
  await expect(page.locator('.message-card')).toHaveCount(0);
  const longPrompt = `${'A long transcript paragraph used to verify mobile scrolling.\n\n'.repeat(80)}LAST_AUTOSCROLL`;
  await page.request.post('/api/agent/prompt', { data: { prompt: longPrompt } });
  await expect(page.locator('.message-card.assistant').last()).toContainText('LAST_AUTOSCROLL');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cards = document.querySelectorAll('.message-card.assistant');
        const bottom = cards[cards.length - 1].getBoundingClientRect().bottom;
        const composer = document.querySelector('.composer')!.getBoundingClientRect();
        return bottom <= composer.top && bottom > 0;
      }),
    )
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.request.post('/api/agent/prompt', { data: { prompt: 'single word MANUAL_SCROLL' } });
  await expect(page.locator('.message-card.assistant').last()).toContainText('MANUAL_SCROLL');
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(100);
});

test('mobile composer supports multiline input and releases space while focused', async ({
  page,
}) => {
  await unlockAndSelectRepo(page);
  const input = page.getByPlaceholder('Ask pi to change the active repository...');
  await input.fill('first line');
  await expect(input).toHaveValue('first line');
  await input.press('End');
  await input.press('Enter');
  await input.press('a');
  await expect(input).toHaveValue('first line\na');
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect
    .poll(() => page.locator('.composer').evaluate((el) => getComputedStyle(el).bottom))
    .toBe('8px');
  await page.locator('.composer-status-title').click();
  await expect(page.locator('.bottom-nav')).toBeVisible();
});

test('login failures and expired sessions show errors on the login screen', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('App password').fill('wrong');
  await page.getByRole('button', { name: 'Unlock workspace' }).click();
  await expect(page.locator('.inline-error')).toContainText('Invalid password');
  await page.getByLabel('App password').fill('test-password');
  const stateLoaded = page.waitForResponse(
    (response) => response.url().endsWith('/api/agent/command-state') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Unlock workspace' }).click();
  await stateLoaded;
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Open workspace menu' }).click();
  await page.getByRole('button', { name: 'Pi Login' }).click();
  await expect(page.getByLabel('App password')).toBeVisible();
  await expect(page.locator('.inline-error')).toContainText('Session expired');
});

test('review surfaces fit mobile and desktop in both themes', async ({ page }, testInfo) => {
  await unlockAndSelectRepo(page);
  await page.request.post('/api/agent/new-session');
  await page.request.post('/api/agent/prompt', { data: { prompt: 'trigger:tool_read' } });
  await expect(page.locator('.tool-inline-item')).toBeVisible();
  await page.locator('.tool-inline-item summary').click();
  await expect(page.locator('.tool-summary-detail')).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['vscode-dark', 'vscode-light']) {
      await page.getByRole('button', { name: 'Open workspace menu' }).click();
      await page
        .getByRole('button', { name: theme === 'vscode-dark' ? 'VS Code Dark' : 'VS Code Light' })
        .click();
      await page
        .getByRole('dialog', { name: 'App menu' })
        .getByRole('button', { name: 'Close' })
        .click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`review-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
});
