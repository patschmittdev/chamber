import { useCallback, useEffect, useState } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import type {
  MindInstructionPrecedence,
  MindWorkingMemory,
  MindWorkingMemoryFile,
} from '@chamber/shared/types';
import { Badge } from '../ui/badge';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription } from '../ui/alert';
import { EmptyState } from '../ui/empty-state';
import { TooltipFor } from '../ui/tooltip';

const PROSE_CLASS =
  'prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [overflow-wrap:anywhere]';
const MEMORY_LOAD_ERROR = 'Could not load working memory. Try again.';

function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

interface WorkingMemoryViewerProps {
  mindId: string;
  precedence: MindInstructionPrecedence | undefined;
}

/**
 * Read-only viewer for a mind's working memory. The status header and source
 * path come from the instruction-precedence layer; the file bodies are loaded
 * on demand through the mindMemory bridge and rendered with the shared markdown
 * renderer. Working memory is agent-managed, so nothing here writes back.
 * A refresh button lets the operator pull the latest files without leaving the panel.
 */
export function WorkingMemoryViewer({ mindId, precedence }: WorkingMemoryViewerProps) {
  const layer = precedence?.layers.find((entry) => entry.id === 'working-memory');
  const [memory, setMemory] = useState<MindWorkingMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMemory(null);
    window.electronAPI.mindMemory
      .read(mindId)
      .then((loaded) => {
        if (!cancelled) {
          setMemory(loaded);
          setLastFetchedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setError(MEMORY_LOAD_ERROR);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mindId, refreshToken]);

  const handleRefresh = useCallback(() => {
    setRefreshToken((t) => t + 1);
  }, []);

  let statusLabel = 'Empty';
  let statusVariant: 'secondary' | 'outline' = 'outline';
  if (layer?.present) {
    const active = layer.included && layer.enabled;
    statusLabel = active ? 'Active' : 'Not in context';
    statusVariant = active ? 'secondary' : 'outline';
  }

  return (
    <section className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground">Working memory</h4>
        <div className="flex items-center gap-2">
          {layer ? <Badge variant={statusVariant}>{statusLabel}</Badge> : null}
          <TooltipFor label="Refresh">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              aria-label="Refresh working memory"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
            </button>
          </TooltipFor>
        </div>
      </div>

      {layer ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">{layer.description}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Managed within this agent.</p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Working memory files appear after the agent is fully loaded.
        </p>
      )}

      {lastFetchedAt ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          Updated {formatTimestamp(lastFetchedAt)}
        </p>
      ) : null}

      <div className="mt-3 space-y-3 border-t border-border pt-3">
        {loading ? (
          <MemoryLoadingSkeleton />
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : memory && !memory.present ? (
          <EmptyState
            icon={<Brain size={24} />}
            title="No working memory yet"
            description="The agent will create memory files here as it works with you."
            className="py-6"
          />
        ) : memory ? (
          memory.files.map((file) => (
            <MemoryFile key={file.name} file={file} />
          ))
        ) : null}
      </div>
    </section>
  );
}

function MemoryLoadingSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      {[3, 2].map((lines, i) => (
        <div key={i} className="rounded-md border border-border/60 bg-background/60 p-3 space-y-2">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: lines }).map((_, j) => (
            <Skeleton key={j} className={j === lines - 1 ? 'h-3 w-3/4' : 'h-3 w-full'} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MemoryFile({ file }: { file: MindWorkingMemoryFile }) {
  const hasContent = file.present && file.content.trim().length > 0;

  return (
    <article className="rounded-md border border-border/60 bg-background/60">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
        <TooltipFor label={file.name}>
          <h5 className="cursor-default text-xs font-medium text-foreground">{file.label}</h5>
        </TooltipFor>
        {file.mtimeMs ? (
          <span
            className="text-[10px] text-muted-foreground"
            aria-label={`Last modified ${formatTimestamp(file.mtimeMs)}`}
          >
            {formatTimestamp(file.mtimeMs)}
          </span>
        ) : null}
      </header>
      <div className="px-3 py-2">
        {hasContent ? (
          <>
            <div className={PROSE_CLASS}>
              <MarkdownContent content={file.content} />
            </div>
            {file.truncated ? (
              <div className="mt-2 rounded border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium">File truncated</span> — showing the beginning only.
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            {file.present ? 'This file is empty.' : `No ${file.label.toLowerCase()} file yet.`}
          </p>
        )}
      </div>
    </article>
  );
}
