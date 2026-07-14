/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ElectronAPI } from '@chamber/shared/electron-types';
import { appearanceStore } from '../../lib/appearanceStore';
import { APPEARANCE_STORAGE_KEYS } from '../../lib/appearance';
import { CanvasLensView } from './CanvasLensView';

describe('CanvasLensView', () => {
  let emitCanvasActionStatus: ((status: {
    actionId: string;
    mindId: string;
    status: 'accepted' | 'running' | 'completed' | 'failed';
    viewId: string;
  }) => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'light');
    appearanceStore.resetForTests();
    appearanceStore.start();
    window.electronAPI = {
      lens: {
        getCanvasUrl: vi.fn(async () => 'http://127.0.0.1:4312/mind-1/lens-abc.html'),
        getViewData: vi.fn(),
        getViews: vi.fn(),
        getDisabledViewIds: vi.fn(),
        onViewsChanged: vi.fn(),
        onVisibilityChanged: vi.fn(),
        onCanvasActionStatus: vi.fn((listener) => {
          emitCanvasActionStatus = listener;
          return () => {
            emitCanvasActionStatus = null;
          };
        }),
        refreshView: vi.fn(),
        sendAction: vi.fn(),
        setViewEnabled: vi.fn(),
      },
    } as unknown as ElectronAPI;
  });

  afterEach(() => {
    appearanceStore.resetForTests();
  });

  it('renders Canvas Lens content in a sandboxed iframe', async () => {
    render(<CanvasLensView view={{
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      source: 'index.html',
      view: 'canvas',
    }} />);

    const iframe = await screen.findByTitle('Command Center');

    expect(iframe.getAttribute('src')).toBe('http://127.0.0.1:4312/mind-1/lens-abc.html');
    expect(iframe.getAttribute('sandbox')).toBe('allow-forms allow-same-origin allow-scripts');
  });

  it('delivers inherited and fixed appearance to the exact Canvas origin', async () => {
    const { rerender } = render(<CanvasLensView view={{
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      source: 'index.html',
      view: 'canvas',
    }} />);

    const inheritedFrame = await screen.findByTitle('Command Center') as HTMLIFrameElement;
    const inheritedPostMessage = vi.spyOn(inheritedFrame.contentWindow!, 'postMessage');
    fireEvent.load(inheritedFrame);

    expect(inheritedPostMessage).toHaveBeenCalledWith(
      { theme: 'light', type: 'chamber:canvas-appearance' },
      'http://127.0.0.1:4312',
    );

    appearanceStore.setThemePreference('dark');
    await waitFor(() => {
      expect(inheritedPostMessage).toHaveBeenLastCalledWith(
        { theme: 'dark', type: 'chamber:canvas-appearance' },
        'http://127.0.0.1:4312',
      );
    });

    rerender(<CanvasLensView view={{
      appearance: 'light',
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      source: 'index.html',
      view: 'canvas',
    }} />);
    const fixedFrame = await screen.findByTitle('Command Center') as HTMLIFrameElement;
    const fixedPostMessage = vi.spyOn(fixedFrame.contentWindow!, 'postMessage');
    fireEvent.load(fixedFrame);

    expect(fixedPostMessage).toHaveBeenCalledWith(
      { theme: 'light', type: 'chamber:canvas-appearance' },
      'http://127.0.0.1:4312',
    );
  });

  it('shows only trusted iframe action statuses', async () => {
    render(<CanvasLensView view={{
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      source: 'index.html',
      view: 'canvas',
    }} />);

    await screen.findByTitle('Command Center');
    emitCanvasActionStatus?.({
      actionId: 'action-1',
      mindId: 'mind-1',
      status: 'completed',
      viewId: 'command-center',
    });

    expect(await screen.findByText('Action completed.')).toBeTruthy();

    emitCanvasActionStatus?.({
      actionId: 'action-2',
      mindId: 'mind-1',
      status: 'failed',
      viewId: 'another-view',
    });

    expect(screen.queryByText('Action failed.')).toBeNull();

    emitCanvasActionStatus?.({
      actionId: 'action-3',
      mindId: 'other-mind',
      status: 'failed',
      viewId: 'command-center',
    });

    expect(screen.queryByText('Action failed.')).toBeNull();
  });

  it('announces the bounded Canvas action lifecycle without treating acceptance as completion', async () => {
    render(<CanvasLensView view={{
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      source: 'index.html',
      view: 'canvas',
    }} />);

    await screen.findByTitle('Command Center');
    emitCanvasActionStatus?.({
      actionId: 'action-1',
      mindId: 'mind-1',
      status: 'accepted',
      viewId: 'command-center',
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Action received.');
    });

    emitCanvasActionStatus?.({
      actionId: 'action-1',
      mindId: 'mind-1',
      status: 'running',
      viewId: 'command-center',
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Action in progress.');
    });

    emitCanvasActionStatus?.({
      actionId: 'action-1',
      mindId: 'mind-1',
      status: 'completed',
      viewId: 'command-center',
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Action completed.');
    });
  });

  it('presents a safe retry when the Canvas source cannot load', async () => {
    const api = window.electronAPI;
    vi.mocked(api.lens.getCanvasUrl).mockRejectedValue(new Error('C:\\private\\mind\\canvas\\failure.html'));

    render(<CanvasLensView view={{
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      source: 'index.html',
      view: 'canvas',
    }} />);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('This Canvas Lens could not be loaded. Try again.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
    expect(screen.queryByText('C:\\private\\mind\\canvas\\failure.html')).toBeNull();
  });

  it('refreshes the view before reloading the iframe url', async () => {
    render(<CanvasLensView view={{
      icon: 'layout',
      id: 'command-center',
      name: 'Command Center',
      prompt: 'Build the dashboard',
      source: 'index.html',
      view: 'canvas',
    }} />);

    await screen.findByTitle('Command Center');
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(window.electronAPI.lens.refreshView).toHaveBeenCalledWith('command-center');
      expect(window.electronAPI.lens.getCanvasUrl).toHaveBeenCalledTimes(2);
    });
  });
});
