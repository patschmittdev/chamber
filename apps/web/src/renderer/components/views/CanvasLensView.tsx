import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasActionRequest, CanvasGestureGrant } from '@chamber/shared/canvas-action-types';
import type { LensViewManifest } from '@chamber/shared/types';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Logger } from '../../lib/logger';
import { useTheme } from '../../hooks/useTheme';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';

interface Props {
  view: LensViewManifest;
}

const log = Logger.create('CanvasLensView');
const ACTION_STATUS_LABELS = {
  accepted: 'Action received.',
  running: 'Action in progress.',
  completed: 'Action completed.',
  failed: 'Action failed.',
} as const;

type CanvasActionStatus = keyof typeof ACTION_STATUS_LABELS;

/** 5 seconds — grant expiry window matching the spec. */
const GRANT_EXPIRY_MS = 5_000;

function canvasMindId(url: string | null): string | null {
  if (!url) return null;
  try {
    const [mindId] = new URL(url).pathname.split('/').filter(Boolean);
    return mindId ? decodeURIComponent(mindId) : null;
  } catch {
    return null;
  }
}

export function CanvasLensView({ view }: Props) {
  const { resolvedTheme } = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'load' | 'refresh' | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [frameKey, setFrameKey] = useState(0);
  const [actionStatus, setActionStatus] = useState<CanvasActionStatus | null>(null);
  const [pendingAction, setPendingAction] = useState<CanvasActionRequest | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mindId = canvasMindId(url);
  const canvasTheme = view.appearance === 'light' || view.appearance === 'dark'
    ? view.appearance
    : resolvedTheme;

  const postAppearance = useCallback(() => {
    if (!url || !iframeRef.current?.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage(
        { type: 'chamber:canvas-appearance', theme: canvasTheme },
        new URL(url).origin,
      );
    } catch (err) {
      log.warn(`Failed to deliver Canvas Lens appearance for ${view.id}:`, err);
    }
  }, [canvasTheme, url, view.id]);

  const loadCanvasUrl = useCallback(async () => {
    const result = await window.electronAPI.lens.getCanvasUrl(view.id);
    setUrl(result);
    setFrameKey((key) => key + 1);
  }, [view.id]);

  useEffect(() => {
    postAppearance();
  }, [postAppearance]);

  useEffect(() => window.electronAPI.lens.onCanvasActionStatus((status) => {
    if (status.mindId === mindId && status.viewId === view.id) setActionStatus(status.status);
  }), [mindId, view.id]);

  // Listen for Canvas bridge action requests. Only accept messages from the
  // exact Canvas iframe window and origin.
  useEffect(() => {
    if (!url) return;
    let canvasOrigin: string;
    try {
      canvasOrigin = new URL(url).origin;
    } catch {
      return;
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== canvasOrigin) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      const payload = e.data as Record<string, unknown> | null;
      if (!payload || payload.type !== 'chamber:canvas-action-request') return;
      const req = payload.request;
      if (!req || typeof req !== 'object' || Array.isArray(req)) return;
      const r = req as Record<string, unknown>;
      if (r.variant !== 'user-action') return;
      // Store the pending request — a user gesture on the Approve button will
      // mint the grant and send it to the iframe.
      setPendingAction(req as CanvasActionRequest);
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.electronAPI.lens.getCanvasUrl(view.id);
        if (!cancelled) {
          setUrl(result);
          setFrameKey((key) => key + 1);
        }
      } catch (err) {
        log.error(`Failed to load Canvas Lens ${view.id}:`, err);
        if (!cancelled) {
          setError('load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [view.id, loadAttempt]);

  const handleRefresh = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await window.electronAPI.lens.refreshView(view.id);
      await loadCanvasUrl();
    } catch (err) {
      log.error(`Failed to refresh Canvas Lens ${view.id}:`, err);
      setError('refresh');
    } finally {
      setLoading(false);
    }
  }, [loadCanvasUrl, loading, view.id]);

  /**
   * Mint and dispatch a gesture grant. Only callable from the Approve button's
   * onClick handler. Canvas scripts cannot trigger this because the iframe is
   * sandboxed in a separate origin; the only path here is a real user click.
   */
  const handleApproveAction = useCallback(() => {
    if (!pendingAction || !url || !iframeRef.current?.contentWindow || !mindId) return;

    const now = Date.now();
    const grant: CanvasGestureGrant = {
      mindId,
      viewId: view.id,
      actionVariant: 'user-action',
      nonce: crypto.randomUUID(),
      expiresAt: now + GRANT_EXPIRY_MS,
      issuedAt: now,
    };

    // Register with main process BEFORE sending to iframe so CanvasServer
    // can validate it when the bridge dispatches the action.
    void window.electronAPI.lens.registerCanvasGrant(grant).catch((err: unknown) => {
      log.warn('Failed to register Canvas gesture grant:', err);
    });

    // Send to iframe via exact-origin postMessage.
    try {
      iframeRef.current.contentWindow.postMessage(
        { type: 'chamber:canvas-gesture-grant', grant },
        new URL(url).origin,
      );
    } catch (err) {
      log.warn('Failed to deliver gesture grant to Canvas iframe:', err);
    }

    // Clear the pending action — grant is single-use.
    setPendingAction(null);
  }, [mindId, pendingAction, url, view.id]);

  const handleDismissAction = useCallback(() => {
    setPendingAction(null);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{view.name}</h2>
          <p className="text-xs text-muted-foreground">Canvas Lens</p>
        </div>
        {view.prompt && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            disabled={loading}
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        )}
      </div>

      {error && (
        <Alert className="m-4 w-auto" variant="destructive">
          <AlertTitle>{error === 'refresh' ? 'Could not refresh this Canvas Lens' : 'Could not load this Canvas Lens'}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error === 'refresh' ? 'This Canvas Lens could not be refreshed. Try again.' : 'This Canvas Lens could not be loaded. Try again.'}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => {
              if (error === 'refresh') {
                void handleRefresh();
              } else {
                setLoadAttempt((attempt) => attempt + 1);
              }
            }}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {actionStatus && (
        <div className="mx-4 mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground" role="status">
          {ACTION_STATUS_LABELS[actionStatus]}
        </div>
      )}
      {pendingAction && (
        <div className="mx-4 mt-4 rounded-lg border border-border bg-card p-3 text-sm" role="status">
          <p className="text-muted-foreground mb-2">
            Canvas action request: <span className="font-mono">{(pendingAction as { label?: string }).label ?? 'action'}</span>
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={handleApproveAction}>Approve</Button>
            <Button type="button" size="sm" variant="secondary" onClick={handleDismissAction}>Dismiss</Button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 p-3">
        {url ? (
          <iframe
            key={frameKey}
            ref={iframeRef}
            title={view.name}
            src={url}
            onLoad={postAppearance}
            sandbox="allow-forms allow-same-origin allow-scripts"
            className="h-full w-full rounded-lg border border-border bg-background"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
            {loading ? 'Loading Canvas Lens...' : 'Canvas Lens source not found.'}
          </div>
        )}
      </div>
    </div>
  );
}
