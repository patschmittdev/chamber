import { memo } from 'react';
import { cn } from '../../lib/utils';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { WorkGroup, hasRunningTool } from './WorkGroup';
import { groupBlocksIntoChunks } from './WorkGroup.logic';
import type { ContentBlock, TextBlock } from '@chamber/shared/types';

interface Props {
  blocks: ContentBlock[];
  isStreaming?: boolean;
  contextOnly?: boolean;
}

export function StreamingMessage({ blocks, isStreaming, contextOnly = false }: Props) {
  if (blocks.length === 0 && isStreaming) {
    return <ThinkingDots label="Thinking…" />;
  }

  if (blocks.length === 0) {
    return <p className="text-sm italic text-muted-foreground/60">No response.</p>;
  }

  const chunks = groupBlocksIntoChunks(blocks);
  const lastChunk = chunks[chunks.length - 1];
  // Hide the trailing indicator only when the final chunk is a work group
  // that actually contains a running tool — the running tool's spinner
  // conveys progress in that case. If the last chunk is work but every tool
  // is already done (and we're still streaming because more content is
  // expected), keep the dots so the UI doesn't look idle.
  const lastChunkHasRunningTool =
    !contextOnly && !!lastChunk && lastChunk.kind === 'work' && hasRunningTool(lastChunk.entries);
  const showTrailingIndicator =
    isStreaming &&
    !lastChunkHasRunningTool &&
    (!lastChunk || lastChunk.kind !== 'text');

  return (
    <div className="flex flex-col" aria-live="polite" aria-busy={Boolean(isStreaming)}>
      {chunks.map((chunk, i) => {
        const isLast = i === chunks.length - 1;
        if (chunk.kind === 'text') {
          return (
            <TextChunk
              key={chunk.id}
              block={chunk.block}
              streaming={Boolean(isStreaming) && isLast}
            />
          );
        }
        return (
          <WorkGroup
            key={chunk.id}
            entries={chunk.entries}
            isActive={Boolean(isStreaming) && isLast}
            contextOnly={contextOnly}
          />
        );
      })}
      {showTrailingIndicator && (
        <div className="chamber-fade-in mt-2 flex items-center gap-1.5 text-muted-foreground">
          <BounceDots />
        </div>
      )}
    </div>
  );
}

const TextChunk = memo(function TextChunk({ block, streaming }: { block: TextBlock; streaming: boolean }) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed',
        // Long unbroken tokens (Windows paths, URLs) must wrap inside the
        // message column instead of forcing a horizontal scrollbar on the
        // whole chat surface. `anywhere` keeps regular prose flowing.
        '[overflow-wrap:anywhere]',
      )}
    >
      <MarkdownContent content={block.content} streaming={streaming} />
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-[3px] rounded-full bg-genesis align-text-bottom chamber-caret" />
      )}
    </div>
  );
});

function ThinkingDots({ label }: { label: string }) {
  return (
    <div className="chamber-fade-in flex items-center gap-1.5 text-muted-foreground">
      <BounceDots />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function BounceDots() {
  return (
    <div className="flex gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:300ms]" />
    </div>
  );
}
