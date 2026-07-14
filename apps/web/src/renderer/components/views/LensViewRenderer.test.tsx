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

  it('frames the default Hello World Lens as a sample template', async () => {
    const api = mockElectronAPI();
    installElectronAPI(api);

    render(
      <LensViewRenderer
        view={makeLensViewManifest({
          id: 'hello-world',
          isSampleTemplate: true,
          name: 'Hello World',
          prompt: 'Build a snapshot',
        })}
      />,
    );

    expect(await screen.findByText('Sample template')).toBeTruthy();
    expect(screen.getByText('This starter view is safe to keep, hide, or replace.')).toBeTruthy();
    expect(screen.getByText('First use generates a current snapshot from this mind. Refresh runs the same request again.')).toBeTruthy();
    expect(screen.getByText('Hide or replace this sample')).toBeTruthy();
  });

  it('announces refresh progress and completion only after the refreshed data arrives', async () => {
    const api = mockElectronAPI();
    vi.mocked(api.lens.getViewData).mockResolvedValue({ status: 'stale' });
    const refresh = deferred<Record<string, unknown> | null>();
    vi.mocked(api.lens.refreshView).mockReturnValue(refresh.promise);
    installElectronAPI(api);

    render(<LensViewRenderer view={makeLensViewManifest({ id: 'refresh-status', prompt: 'Refresh status' })} />);
    expect(await screen.findByText('stale')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByRole('status').textContent).toContain('Refreshing this view.');
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeTruthy();

    refresh.resolve({ status: 'fresh' });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('View refreshed.');
      expect(screen.getByText('fresh')).toBeTruthy();
    });
  });

  it('reports action completion only after the mind returns updated view data', async () => {
    const api = mockElectronAPI();
    vi.mocked(api.lens.getViewData).mockResolvedValue({ status: 'pending' });
    const action = deferred<Record<string, unknown> | null>();
    vi.mocked(api.lens.sendAction).mockReturnValue(action.promise);
    installElectronAPI(api);

    render(<LensViewRenderer view={makeLensViewManifest({ id: 'action-lifecycle' })} />);
    await screen.findByText('pending');

    fireEvent.change(screen.getByPlaceholderText('Ask the agent to modify this view…'), {
      target: { value: 'Mark this complete' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send action' }));

    expect(screen.getByRole('status').textContent).toContain('Sending action to the mind.');

    action.resolve({ status: 'complete' });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('View updated.');
      expect(screen.getByText('complete')).toBeTruthy();
    });
  });

  it('presents a safe retry after a refresh failure', async () => {
    const api = mockElectronAPI();
    vi.mocked(api.lens.getViewData).mockResolvedValue({ status: 'stale' });
    vi.mocked(api.lens.refreshView).mockRejectedValue(new Error('C:\\private\\mind\\secret-output.json'));
    installElectronAPI(api);

    render(<LensViewRenderer view={makeLensViewManifest({ id: 'retry-status', prompt: 'Refresh status' })} />);
    await screen.findByText('stale');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('This Lens view could not be refreshed. Try again.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
    expect(screen.queryByText('C:\\private\\mind\\secret-output.json')).toBeNull();
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
