import { useEffect, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type {
  MindInstructionPrecedence,
  MindWorkingMemory,
  MindWorkingMemoryFile,
} from '@chamber/shared/types';
import { Badge } from '../ui/badge';
import { MarkdownContent } from '../markdown/MarkdownContent';

interface WorkingMemoryViewerProps {
  mindId: string;
  precedence: MindInstructionPrecedence | undefined;
}

const PROSE_CLASS =
  'prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [overflow-wrap:anywhere]';

/**
 * Read-only viewer for a mind's working memory. The status header and source
 * path come from the instruction-precedence layer; the file bodies are loaded
 * on demand through the mindMemory bridge and rendered with the shared markdown
 * renderer. Working memory is agent-managed, so nothing here writes back.
 */
export function WorkingMemoryViewer({ mindId, precedence }: WorkingMemoryViewerProps) {
  const layer = precedence?.layers.find((entry) => entry.id === 'working-memory');
  const [memory, setMemory] = useState<MindWorkingMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMemory(null);
    window.electronAPI.mindMemory
      .read(mindId)
      .then((loaded) => {
        if (!cancelled) setMemory(loaded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mindId]);

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
        {layer ? <Badge variant={statusVariant}>{statusLabel}</Badge> : null}
      </div>
      {layer ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">{layer.description}</p>
          <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{layer.source}</p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Memory details load with this agent&apos;s instruction precedence.
        </p>
      )}

      <div className="mt-3 space-y-3 border-t border-border pt-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading memory files...</p>
        ) : error ? (
          <p role="status" className="text-xs text-muted-foreground">
            {error}
          </p>
        ) : memory ? (
          memory.files.map((file) => <MemoryFile key={file.name} file={file} />)
        ) : null}
      </div>
    </section>
  );
}

function MemoryFile({ file }: { file: MindWorkingMemoryFile }) {
  const hasContent = file.present && file.content.trim().length > 0;

  return (
    <article className="rounded-md border border-border/60 bg-background/60">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
        <h5 className="text-xs font-medium text-foreground">{file.label}</h5>
        <span className="font-mono text-[10px] text-muted-foreground">{file.name}</span>
      </header>
      <div className="px-3 py-2">
        {hasContent ? (
          <>
            <div className={PROSE_CLASS}>
              <MarkdownContent content={file.content} />
            </div>
            {file.truncated ? (
              <p className="mt-2 text-[11px] italic text-muted-foreground">
                Showing the first part of a large file.
              </p>
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
