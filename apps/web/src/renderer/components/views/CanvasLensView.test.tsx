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

const CANVAS_URL = 'http://127.0.0.1:4312/mind-1/lens-abc.html';

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
        getCanvasUrl: vi.fn(async () => CANVAS_URL),
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
        registerCanvasGrant: vi.fn(async () => undefined),
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

    expect(iframe.getAttribute('src')).toBe(CANVAS_URL);
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

  describe('gesture grant', () => {
    it('shows Approve button when Canvas requests an action via postMessage', async () => {
      render(<CanvasLensView view={{
        icon: 'layout',
        id: 'command-center',
        name: 'Command Center',
        source: 'index.html',
        view: 'canvas',
      }} />);

      const iframe = await screen.findByTitle('Command Center') as HTMLIFrameElement;

      // Simulate Canvas bridge sending an action request from the Canvas origin
      const messageEvent = new MessageEvent('message', {
        data: {
          type: 'chamber:canvas-action-request',
          request: { schemaVersion: 1, variant: 'user-action', label: 'submit', fields: {} },
        },
        origin: 'http://127.0.0.1:4312',
        source: iframe.contentWindow,
      });
      window.dispatchEvent(messageEvent);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy();
      });
    });

    it('mints a grant, registers it via IPC, and sends it to the iframe on Approve click', async () => {
      render(<CanvasLensView view={{
        icon: 'layout',
        id: 'command-center',
        name: 'Command Center',
        source: 'index.html',
        view: 'canvas',
      }} />);

      const iframe = await screen.findByTitle('Command Center') as HTMLIFrameElement;
      const iframePostMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

      // Simulate action request from Canvas bridge
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'chamber:canvas-action-request',
          request: { schemaVersion: 1, variant: 'user-action', label: 'approve-item', fields: { id: '42' } },
        },
        origin: 'http://127.0.0.1:4312',
        source: iframe.contentWindow,
      }));

      await waitFor(() => screen.getByRole('button', { name: /approve/i }));

      // Click the Approve button
      const approveButton = screen.getByRole('button', { name: /approve/i });
      fireEvent.click(approveButton);

      await waitFor(() => {
        expect(window.electronAPI.lens.registerCanvasGrant).toHaveBeenCalledOnce();
      });

      // Grant should be sent to the iframe with exact Canvas origin
      const [grantCall] = vi.mocked(window.electronAPI.lens.registerCanvasGrant).mock.calls;
      expect(grantCall[0]).toMatchObject({
        mindId: 'mind-1',
        viewId: 'command-center',
        actionVariant: 'user-action',
        nonce: expect.any(String),
        expiresAt: expect.any(Number),
        issuedAt: expect.any(Number),
        requestHash: expect.any(String),
      });
      expect(grantCall[0].expiresAt - grantCall[0].issuedAt).toBe(5000);

      expect(iframePostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chamber:canvas-gesture-grant',
          grant: expect.objectContaining({ nonce: expect.any(String) }),
        }),
        'http://127.0.0.1:4312',
      );
    });

    it('does not mint a grant when there is no pending action (Approve button absent)', async () => {
      render(<CanvasLensView view={{
        icon: 'layout',
        id: 'command-center',
        name: 'Command Center',
        source: 'index.html',
        view: 'canvas',
      }} />);

      // No chamber:canvas-action-request dispatched, so no pendingAction is set.
      await screen.findByTitle('Command Center');

      // Approve button must not be present without a pending action.
      expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();

      // Attempting to register a grant must not occur.
      expect(window.electronAPI.lens.registerCanvasGrant).not.toHaveBeenCalled();
    });

    it('discards pending action after Approve click (grant is single-use)', async () => {
      render(<CanvasLensView view={{
        icon: 'layout',
        id: 'command-center',
        name: 'Command Center',
        source: 'index.html',
        view: 'canvas',
      }} />);

      const iframe = await screen.findByTitle('Command Center') as HTMLIFrameElement;

      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'chamber:canvas-action-request',
          request: { schemaVersion: 1, variant: 'user-action', label: 'click', fields: {} },
        },
        origin: 'http://127.0.0.1:4312',
        source: iframe.contentWindow,
      }));

      await waitFor(() => screen.getByRole('button', { name: /approve/i }));

      // Click Approve
      const approveButton = screen.getByRole('button', { name: /approve/i });
      fireEvent.click(approveButton);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
      });
    });

    it('ignores action requests from a non-Canvas origin', async () => {
      render(<CanvasLensView view={{
        icon: 'layout',
        id: 'command-center',
        name: 'Command Center',
        source: 'index.html',
        view: 'canvas',
      }} />);

      await screen.findByTitle('Command Center');

      // Message from wrong origin
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'chamber:canvas-action-request',
          request: { schemaVersion: 1, variant: 'user-action', label: 'click', fields: {} },
        },
        origin: 'http://evil.example.com',
        source: window, // not the iframe
      }));

      // Should not show approve button
      await new Promise(r => setTimeout(r, 50));
      expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    });

    it('grant does not appear in any DOM attribute or URL', async () => {
      render(<CanvasLensView view={{
        icon: 'layout',
        id: 'command-center',
        name: 'Command Center',
        source: 'index.html',
        view: 'canvas',
      }} />);

      const iframe = await screen.findByTitle('Command Center') as HTMLIFrameElement;

      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'chamber:canvas-action-request',
          request: { schemaVersion: 1, variant: 'user-action', label: 'click', fields: {} },
        },
        origin: 'http://127.0.0.1:4312',
        source: iframe.contentWindow,
      }));

      await waitFor(() => screen.getByRole('button', { name: /approve/i }));

      // Approve with a click to trigger grant creation
      const approveButton = screen.getByRole('button', { name: /approve/i });
      fireEvent.click(approveButton);

      await waitFor(() => {
        expect(window.electronAPI.lens.registerCanvasGrant).toHaveBeenCalled();
      });

      // The grant nonce must not appear in the DOM
      const [grant] = vi.mocked(window.electronAPI.lens.registerCanvasGrant).mock.calls[0];
      const domHtml = document.documentElement.innerHTML;
      expect(domHtml).not.toContain(grant.nonce);

      // The iframe src must not contain the nonce
      expect(iframe.getAttribute('src')).not.toContain(grant.nonce);
    });
  });
});


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
