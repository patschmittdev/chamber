import React, { useCallback, useEffect, useRef, useState } from 'react';
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
