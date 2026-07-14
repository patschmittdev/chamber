import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_CROSS_SURFACE_CDP_PORT ?? 9353);

test.describe('electron cross-surface quality gate', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-cross-surface-gate-'));
    mindPath = path.join(root, 'quality-gate-mind');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    seedMind(mindPath);

    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
  });

  test('keeps the Extensions scope, rail resizing, and Settings tasks keyboard reachable', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    const mind = await page.evaluate(async (pathToMind) => {
      const loaded = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(loaded.mindId);
      return loaded;
    }, mindPath);

    await page.locator('button').filter({ hasText: new RegExp(`\\b${mind.identity.name}\\b`) }).click();
    await page.getByRole('button', { name: 'Extensions' }).click();

    await expect(page.getByRole('heading', { name: 'Extensions', exact: true })).toBeVisible();
    await expect(page.getByText('Installed capabilities for the active mind and global workspace.')).toBeVisible();

    const skills = page.getByRole('tab', { name: /^Skills \d+$/ });
    await skills.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /^Connectors \d+$/ })).toHaveAttribute('data-state', 'active');

    const resizeAgents = page.getByRole('separator', { name: 'Resize agents panel' });
    const initialWidth = Number(await resizeAgents.getAttribute('aria-valuenow'));
    await resizeAgents.focus();
    await page.keyboard.press('ArrowRight');
    await expect(resizeAgents).toHaveAttribute('aria-valuenow', String(initialWidth + 20));

    await page.getByRole('button', { name: 'Settings' }).click();
    const settingsNavigation = page.getByRole('navigation', { name: 'Settings sections' });
    const sources = settingsNavigation.getByRole('button', { name: 'Sources & security' });
    await sources.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Sources & security' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enrolled marketplace sources' })).toBeVisible();
  });
});

function seedMind(targetMindPath: string): void {
  fs.mkdirSync(path.join(targetMindPath, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(targetMindPath, 'SOUL.md'),
    [
      '# Quality Gate Mind',
      '',
      'A deterministic mind used by the cross-surface Electron quality gate.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(targetMindPath, '.github', 'agents', 'quality-gate-mind.agent.md'),
    [
      '---',
      'name: Quality Gate Mind',
      'description: Chamber cross-surface quality gate persona',
      '---',
      '',
      '# Quality Gate Mind',
      '',
    ].join('\n'),
  );
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[cross-surface-quality-gate] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
