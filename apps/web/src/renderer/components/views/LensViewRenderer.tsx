import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { LensViewManifest } from '@chamber/shared/types';
import { RefreshCw, Send, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Logger } from '../../lib/logger';
import { LensBriefing } from './LensBriefing';
import { LensTable } from './LensTable';
import { LensDetail } from './LensDetail';
import { LensStatusBoard } from './LensStatusBoard';
import { LensTimeline } from './LensTimeline';
import { LensEditor } from './LensEditor';
import { LensForm } from './LensForm';
import { CanvasLensView } from './CanvasLensView';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/empty-state';

interface Props {
  view: LensViewManifest;
}

const log = Logger.create('LensView');

const pendingRefreshes = new Map<string, Promise<Record<string, unknown> | null>>();

type LensOperation = 'loading' | 'ready' | 'loaded' | 'refreshing' | 'refreshed' | 'acting' | 'updated';
type LensErrorOperation = 'load' | 'refresh' | 'action';

function refreshLensView(viewId: string): Promise<Record<string, unknown> | null> {
  const existing = pendingRefreshes.get(viewId);
  if (existing) return existing;

  const refresh = window.electronAPI.lens.refreshView(viewId)
    .finally(() => {
      if (pendingRefreshes.get(viewId) === refresh) {
        pendingRefreshes.delete(viewId);
      }
    });
  pendingRefreshes.set(viewId, refresh);
  return refresh;
}

export function LensViewRenderer({ view }: Props) {
  if (view.view === 'canvas') {
    return <CanvasLensView view={view} />;
  }

  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [errorOperation, setErrorOperation] = useState<LensErrorOperation | null>(null);
  const [operation, setOperation] = useState<LensOperation>('loading');
  const [actionInput, setActionInput] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const pendingRefresh = pendingRefreshes.get(view.id);
      if (pendingRefresh) setLoading(true);
      setErrorOperation(null);
      setOperation('loading');
      try {
        const result = await window.electronAPI.lens.getViewData(view.id);
        if (cancelled) return;
        setData(result);
        if (pendingRefresh) {
          const refreshed = await pendingRefresh;
          if (cancelled) return;
          setData(refreshed);
          setOperation('refreshed');
        } else {
          setOperation(result ? 'loaded' : 'ready');
        }
      } catch (err) {
        log.error(`Failed to load data for ${view.id}:`, err);
        if (!cancelled) setErrorOperation('load');
      } finally {
        if (!cancelled && pendingRefresh) setLoading(false);
        if (!cancelled) setInitializing(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [view.id, loadAttempt]);

  const handleRefresh = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setErrorOperation(null);
    setOperation('refreshing');
    try {
      const result = await refreshLensView(view.id);
      if (mountedRef.current) {
        setData(result);
        setOperation('refreshed');
      }
    } catch (err) {
      log.error(`Failed to refresh ${view.id}:`, err);
      if (mountedRef.current) setErrorOperation('refresh');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [view.id, loading]);

  const submitAction = useCallback(async (action: string) => {
    if (loading || !action.trim()) return;
    setLoading(true);
    setErrorOperation(null);
    setOperation('acting');
    try {
      const result = await window.electronAPI.lens.sendAction(view.id, action.trim());
      if (mountedRef.current) {
        setData(result);
        setActionInput('');
        setOperation('updated');
      }
    } catch (err) {
      log.error(`Failed to apply action to ${view.id}:`, err);
      if (mountedRef.current) setErrorOperation('action');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [view.id, loading]);

  const handleAction = useCallback(() => {
    void submitAction(actionInput);
  }, [actionInput, submitAction]);

  const retry = useCallback(() => {
    if (errorOperation === 'refresh') {
      void handleRefresh();
      return;
    }
    if (errorOperation === 'action') {
      void submitAction(actionInput);
      return;
    }
    setLoadAttempt((attempt) => attempt + 1);
  }, [actionInput, errorOperation, handleRefresh, submitAction]);

  const isWideView = view.view === 'table' || view.view === 'status-board' || view.view === 'timeline';
  const isProseView = view.view === 'detail';
  const description = view.description?.trim();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6">
      {/* Wide views (table/status-board/timeline) fill the pane. Detail is
          running prose, so cap it at the ~65ch reading measure; other views
          (form/briefing/editor) stay at max-w-2xl for their grids. */}
      <div className={cn('mx-auto w-full space-y-6', isWideView ? 'max-w-none' : isProseView ? 'max-w-prose' : 'max-w-2xl')}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight truncate">{view.name}</h2>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">{view.view} view</p>
          </div>
          {view.prompt && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
        </div>

        {view.isSampleTemplate ? <SampleLensNotice view={view} /> : null}

        <LensStatus operation={operation} />

        {errorOperation ? (
          <Alert variant="destructive">
            <AlertTitle>{lensErrorTitle(errorOperation)}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{lensErrorMessage(errorOperation)}</span>
              <Button type="button" size="sm" variant="outline" onClick={retry}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Content */}
        {initializing && !data && !errorOperation ? (
          <LensViewSkeleton wide={isWideView} />
        ) : data ? (
          <div className="chamber-fade-in">
          <LensViewContent view={view} data={data} onAction={submitAction} />
          </div>
        ) : (
          <EmptyState
            icon={<Sparkles size={18} />}
            title={view.prompt ? 'No data yet' : 'No data available'}
            description={view.prompt ? description || 'Generate this view to populate it with live data from the mind.' : undefined}
            action={view.prompt ? (
              <Button type="button" onClick={handleRefresh} disabled={loading}>
                  <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
                  {loading ? 'Generating…' : 'Generate'}
              </Button>
            ) : undefined}
          />
        )}

        {/* Action input — write-back via agent */}
        {data && (
          <div className="focus-halo flex items-center gap-2 bg-secondary rounded-xl border border-border px-2 py-1.5 transition-[border-color,box-shadow] duration-200">
            <input
              type="text"
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAction(); }}
              placeholder="Ask the agent to modify this view…"
              disabled={loading}
              className="flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <Button
              type="button"
              size="icon"
              aria-label="Send action"
              onClick={handleAction}
              disabled={loading || !actionInput.trim()}
              className={cn('size-8',
                actionInput.trim() && !loading
                  ? ''
                  : 'bg-muted text-muted-foreground hover:bg-muted',
              )}
            >
              <Send size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SampleLensNotice({ view }: { view: LensViewManifest }) {
  const [hiding, setHiding] = useState(false);
  const [hideError, setHideError] = useState(false);

  const hideSample = async () => {
    setHiding(true);
    setHideError(false);
    try {
      await window.electronAPI.lens.setViewEnabled(view.id, false);
    } catch (err) {
      log.error(`Failed to hide sample Lens ${view.id}:`, err);
      setHideError(true);
    } finally {
      setHiding(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
      <p className="text-sm font-medium">Sample template</p>
      <p className="mt-1 text-sm text-muted-foreground">
        This starter view is safe to keep, hide, or replace.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        First use generates a current snapshot from this mind. Refresh runs the same request again.
      </p>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Hide or replace this sample</summary>
        <p className="mt-2 text-muted-foreground">
          Hide removes it from navigation without deleting it. Replace it by changing this template in your mind&apos;s Lens source.
        </p>
        <Button type="button" size="sm" variant="outline" className="mt-3" disabled={hiding} onClick={() => { void hideSample(); }}>
          {hiding ? 'Hiding…' : 'Hide sample'}
        </Button>
      </details>
      {hideError ? <p className="mt-2 text-sm text-destructive" role="alert">This sample could not be hidden. Try again.</p> : null}
    </div>
  );
}

function LensStatus({ operation }: { operation: LensOperation }) {
  const message = {
    loading: 'Loading this view.',
    ready: 'Ready to generate.',
    loaded: 'Current view data loaded.',
    refreshing: 'Refreshing this view.',
    refreshed: 'View refreshed.',
    acting: 'Sending action to the mind.',
    updated: 'View updated.',
  }[operation];

  return <p className="sr-only" role="status" aria-live="polite">{message}</p>;
}

function lensErrorTitle(operation: LensErrorOperation): string {
  return operation === 'action' ? 'Could not update this Lens view' : 'Could not load this Lens view';
}

function lensErrorMessage(operation: LensErrorOperation): string {
  if (operation === 'action') return 'This Lens view could not be updated. Try again.';
  if (operation === 'refresh') return 'This Lens view could not be refreshed. Try again.';
  return 'This Lens view could not be loaded. Try again.';
}

/**
 * Initial-load placeholder for a Lens view. Reserves the content area while
 * the first `getViewData` call resolves so the pane doesn't flash the empty
 * "No data yet" state before real content arrives. Generic card+rows shape
 * works for every view kind; `wide` widens the rows for table-style views.
 */
function LensViewSkeleton({ wide }: { wide?: boolean }) {
  return (
    <div className="space-y-4" data-testid="lens-view-skeleton" aria-busy="true">
      <div className="surface-card rounded-xl border border-border bg-card p-5 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className={cn('h-3', wide ? 'w-[90%]' : 'w-[70%]')} />
      </div>
      <div className="surface-card rounded-xl border border-border bg-card p-5 space-y-3">
        {Array.from({ length: wide ? 5 : 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LensViewContent({ view, data, onAction }: { view: LensViewManifest; data: Record<string, unknown>; onAction: (action: string) => Promise<void> }) {
  switch (view.view) {
    case 'briefing':
      return <LensBriefing data={data} schema={view.schema} />;
    case 'table':
      return <LensTable data={data} schema={view.schema} />;
    case 'detail':
      return <LensDetail data={data} schema={view.schema} />;
    case 'status-board':
      return <LensStatusBoard data={data} schema={view.schema} />;
    case 'timeline':
      return <LensTimeline data={data} schema={view.schema} />;
    case 'editor':
      return (
        <LensEditor
          data={data}
          schema={view.schema}
          onSave={(updates) => {
            const changes = Object.entries(updates)
              .filter(([k, v]) => String(v) !== String(data[k]))
              .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
              .join(', ');
            if (changes) onAction(`Update the following fields: ${changes}`);
          }}
        />
      );
    case 'form':
    default:
      return <LensForm data={data} schema={view.schema} />;
  }
}
