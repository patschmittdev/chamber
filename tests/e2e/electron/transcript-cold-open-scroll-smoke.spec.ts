import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_TRANSCRIPT_SCROLL_CDP_PORT ?? 9368);
const TAIL_MARKER = 'C9_M1_TAIL_MARKER';

test.describe('electron transcript cold-open scroll smoke', () => {
  test.setTimeout(480_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
  });

  test('cold-open long transcript lands at the true bottom after row remeasure', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-transcript-cold-open-smoke-'));
    userDataPath = path.join(root, 'user-data');
    const mindPath = path.join(root, 'monica');
    seedMind(mindPath, 'Monica');

    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    const page = await findRendererPage(app.browser, app.logs);
    await waitForMindApi(page);
    const mind = await loadAndActivateMind(page, mindPath, 'Monica');

    const activeSessionId = await activeConversationSessionId(page, mind.mindId);
    const textarea = page.getByPlaceholder('Message your agent… (paste an image to attach)');
    for (let index = 1; index <= 70; index += 1) {
      const marker = index === 70 ? TAIL_MARKER : `row-${index}`;
      await sendTurnAndStop(page, textarea, buildTallPrompt(marker));
    }

    await expect.poll(
      () => page.evaluate(
        async ({ mindId, sessionId }) => {
          const messages = await window.electronAPI.conversationHistory.messages(mindId, sessionId);
          return messages.length;
        },
        { mindId: mind.mindId, sessionId: activeSessionId },
      ),
      { timeout: 240_000 },
    ).toBeGreaterThan(60);

    await app.close();
    app = await launchElectronApp({
      cdpPort: cdpPort + 1,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    const restartedPage = await findRendererPage(app.browser, app.logs);
    await waitForMindApi(restartedPage);
    await restartedPage.getByRole('button', { name: 'Monica' }).first().click();

    const readBottomDelta = () => restartedPage.evaluate(({ marker }) => {
      const transcriptScroller = Array.from(document.querySelectorAll<HTMLDivElement>('div.overflow-y-auto.px-4.py-4'))
        .find((candidate) => candidate.querySelector('[data-window-key]'));
      if (!transcriptScroller) return Number.POSITIVE_INFINITY;
      const markerVisible = Array.from(document.querySelectorAll<HTMLElement>('p'))
        .some((node) => node.textContent?.includes(marker) && node.getBoundingClientRect().height > 0);
      if (!markerVisible) return Number.POSITIVE_INFINITY;
      return transcriptScroller.scrollHeight - transcriptScroller.scrollTop - transcriptScroller.clientHeight;
    }, { marker: TAIL_MARKER });

    await restartedPage.evaluate(() => {
      const transcriptScroller = Array.from(document.querySelectorAll<HTMLDivElement>('div.overflow-y-auto.px-4.py-4'))
        .find((candidate) => candidate.querySelector('[data-window-key]'));
      if (transcriptScroller) {
        transcriptScroller.style.overflowAnchor = 'none';
      }
    });

    await expect.poll(readBottomDelta, { timeout: 20_000 }).toBeLessThan(10);

    await restartedPage.evaluate(() => {
      const transcriptScroller = Array.from(document.querySelectorAll<HTMLDivElement>('div.overflow-y-auto.px-4.py-4'))
        .find((candidate) => candidate.querySelector('[data-window-key]'));
      if (!transcriptScroller) return;
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-window-key]'));
      // Simulate the cold-open underestimate sequence: pin to bottom while rows
      // are constrained near the fallback height, then release constraints so
      // real measured heights expand after the pin.
      for (const row of rows) {
        row.style.maxHeight = '140px';
        row.style.overflow = 'hidden';
      }
      transcriptScroller.scrollTop = transcriptScroller.scrollHeight;
      for (const row of rows) {
        row.style.maxHeight = '';
        row.style.overflow = '';
      }
    });

    await expect.poll(readBottomDelta, { timeout: 20_000 }).toBeLessThan(10);
  });
});

function buildTallPrompt(marker: string): string {
  const paragraph = [
    'Write a detailed paragraph about deterministic Chamber smoke testing.',
    'Explain transcript virtualization with explicit mention of row measurement stability.',
    'Describe scroll pinning behavior during cold-open hydration and why it matters.',
    'Keep this paragraph verbose with complete sentences so the rendered row is tall.',
  ].join(' ');
  const sections = Array.from({ length: 60 }, (_, index) => `Section ${index + 1}: ${paragraph}`);
  return [`Marker: ${marker}`, ...sections].join('\n\n');
}

async function sendTurnAndStop(
  page: Page,
  textarea: ReturnType<Page['getByPlaceholder']>,
  prompt: string,
): Promise<void> {
  await textarea.click();
  await textarea.fill(prompt);
  await textarea.press('Enter');

  const stopButton = page.getByRole('button', { name: 'Stop streaming' });
  await expect(stopButton).toBeVisible({ timeout: 20_000 });
  await stopButton.click();
  await expect(stopButton).toHaveCount(0, { timeout: 20_000 });
  await expect(textarea).toBeEnabled();
}

async function waitForMindApi(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => typeof window.electronAPI?.mind?.add);
    } catch {
      return 'unavailable';
    }
  }, { timeout: 30_000 }).toBe('function');
}

async function loadAndActivateMind(page: Page, mindPath: string, name: string) {
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  const mindButton = page.getByRole('button', { name }).first();
  await mindButton.click();
  await expect(mindButton).toHaveClass(/bg-accent/);
  return mind;
}

async function activeConversationSessionId(page: Page, mindId: string): Promise<string> {
  const getActiveSessionId = () => page.evaluate(async (activeMindId) => {
    const conversations = await window.electronAPI.conversationHistory.list(activeMindId);
    return conversations.find((conversation) => conversation.active)?.sessionId ?? '';
  }, mindId);

  await expect.poll(
    getActiveSessionId,
    { timeout: 10_000 },
  ).not.toBe('');
  return getActiveSessionId();
}

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'A deterministic mind used by the transcript cold-open scroll smoke.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', 'monica.agent.md'),
    [
      '---',
      `name: ${name}`,
      'description: Transcript cold-open smoke persona',
      '---',
      '',
      `# ${name}`,
      '',
      'Reply with enough structure that each user turn remains easy to inspect.',
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
        console.warn(`[transcript-cold-open-scroll-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
