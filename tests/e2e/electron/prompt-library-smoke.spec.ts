import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const COMPOSER_PLACEHOLDER = 'Message your agent… (paste an image to attach)';

test.describe('electron prompt library smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
  });

  test('a saved prompt authored in Extensions inserts into the composer via the slash menu', async () => {
    const mindPath = await launchWithMind(9360, 'Monica');
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await addMind(page, mindPath);

    const title = 'Standup summary';
    const body = 'Summarize what I shipped today and my current blockers.';
    await createPrompt(page, title, body);

    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
    await expect(composer).toBeVisible();

    await composer.click();
    await composer.fill('/');
    const popover = page.getByTestId('slash-popover');
    await expect(popover).toBeVisible();
    await popover.getByText(title).click();

    await expect(composer).toHaveValue(body);
  });

  async function launchWithMind(cdpPort: number, name: string): Promise<string> {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-prompt-smoke-'));
    userDataPath = path.join(root, 'user-data');
    const mindPath = path.join(root, name.toLowerCase());
    seedMind(mindPath, name);
    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    return mindPath;
  }
});

async function addMind(page: Page, mindPath: string) {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => typeof window.electronAPI?.mind?.add)).toBe('function');
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  await page.getByRole('button', { name: mind.identity.name }).first().click();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
  return mind;
}

async function createPrompt(page: Page, title: string, body: string): Promise<void> {
  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('tab', { name: 'Prompts' }).click();
  await page.getByRole('button', { name: 'Manage prompts' }).click();
  await page.getByRole('button', { name: 'New prompt' }).click();

  await expect(page.getByText('Global scope')).toBeVisible();
  await expect(page.getByText('User authored')).toBeVisible();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Prompt body').fill(body);
  await page.getByRole('button', { name: 'Save prompt' }).click();

  await expect(page.getByText(title)).toBeVisible();
}

function seedMind(targetMindPath: string, name: string): void {
  fs.mkdirSync(path.join(targetMindPath, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(targetMindPath, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      `You are ${name}, a concise Chamber smoke-test assistant.`,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(targetMindPath, '.github', 'agents', `${name.toLowerCase()}.agent.md`),
    [
      '---',
      `name: ${name}`,
      'description: Chamber prompt library smoke persona',
      '---',
      '',
      `# ${name} Agent`,
      '',
    ].join('\n'),
  );
}

async function removeTempRoot(targetRoot: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(targetRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[prompt-library-smoke] Failed to remove temp root ${targetRoot}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
