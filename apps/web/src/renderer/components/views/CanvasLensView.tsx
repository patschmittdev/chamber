import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LensViewManifest } from '@chamber/shared/types';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Logger } from '../../lib/logger';
import { useTheme } from '../../hooks/useTheme';

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

export function CanvasLensView({ view }: Props) {
  const { resolvedTheme } = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [actionStatus, setActionStatus] = useState<CanvasActionStatus | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
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
    if (status.viewId === view.id) setActionStatus(status.status);
  }), [view.id]);

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
          setError(err instanceof Error ? err.message : 'Failed to load Canvas Lens');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [view.id]);

  const handleRefresh = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await window.electronAPI.lens.refreshView(view.id);
      await loadCanvasUrl();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
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
          <button
            onClick={handleRefresh}
            disabled={loading}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
              'bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground',
              loading && 'opacity-50 cursor-not-allowed'
            )}
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>

      {error && (
        <div className="m-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
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
