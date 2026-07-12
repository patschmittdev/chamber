/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@chamber/shared/electron-types';
import { mockElectronAPI, makeLensViewManifest } from '../../../test/helpers';
import { LensViewRenderer } from './LensViewRenderer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function installElectronAPI(api: ElectronAPI): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
}

describe('LensViewRenderer', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
  });

  it('renders the Lens description in the prompt empty state', async () => {
    const api = mockElectronAPI();
    installElectronAPI(api);

    render(
      <LensViewRenderer
        view={makeLensViewManifest({
          description: 'Generate a concise daily briefing.',
          prompt: 'Build the briefing',
        })}
      />,
    );

    expect(await screen.findByText('No data yet')).toBeTruthy();
    expect(screen.getByText('Generate a concise daily briefing.')).toBeTruthy();
  });

  it('renders the default prompt empty-state copy without a Lens description', async () => {
    const api = mockElectronAPI();
    installElectronAPI(api);

    render(
      <LensViewRenderer
        view={makeLensViewManifest({
          prompt: 'Build the briefing',
        })}
      />,
    );

    expect(await screen.findByText('No data yet')).toBeTruthy();
    expect(screen.getByText('Generate this view to populate it with live data from the mind.')).toBeTruthy();
  });

  it('applies an in-flight refresh result after the view remounts', async () => {
    const api = mockElectronAPI();
    vi.mocked(api.lens.getViewData).mockResolvedValue({ status: 'stale' });
    const refresh = deferred<Record<string, unknown> | null>();
    vi.mocked(api.lens.refreshView).mockReturnValue(refresh.promise);
    installElectronAPI(api);

    const view = makeLensViewManifest({
      id: 'daily-briefing',
      name: 'Daily Briefing',
      prompt: 'Refresh this briefing',
      view: 'briefing',
    });

    const { unmount } = render(<LensViewRenderer view={view} />);
    expect(await screen.findByText('stale')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    unmount();

    render(<LensViewRenderer view={view} />);
    expect(await screen.findByText('stale')).toBeTruthy();

    refresh.resolve({ status: 'fresh' });

    await waitFor(() => {
      expect(screen.getByText('fresh')).toBeTruthy();
    });
  });
});
