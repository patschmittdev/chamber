import { useCallback, useEffect, useState } from 'react';
import type { ToolOperationEntry, ToolOperationListResult, ToolOperationResult } from '@chamber/shared/types';
import { Blocks, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { TabEmptyState, TabError, TabLoading } from './extensionsShared';

type ToolAction = 'install' | 'update' | 'remove';

export function ToolsTab({ onInventoryChanged }: { readonly onInventoryChanged?: () => void }) {
  const [result, setResult] = useState<ToolOperationListResult>({ tools: [], sources: [] });
  const [loading, setLoading] = useState(true);
  const [failedLoad, setFailedLoad] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, ToolOperationResult>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setFailedLoad(false);
    try {
      setResult(await window.electronAPI.tools.listOperations());
    } catch {
      setResult({ tools: [], sources: [] });
      setFailedLoad(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (tool: ToolOperationEntry, action: ToolAction) => {
    const key = toolKey(tool);
    setBusyId(key);
    let outcome: ToolOperationResult;
    try {
      if (action === 'install') {
        outcome = await window.electronAPI.tools.install(tool.id, tool.marketplaceId);
      } else if (action === 'update') {
        outcome = await window.electronAPI.tools.update(tool.id, tool.marketplaceId);
      } else {
        outcome = await window.electronAPI.tools.remove(tool.id, tool.marketplaceId);
      }
    } catch {
      outcome = { status: 'failed', action };
    }
    setOutcomes((current) => ({ ...current, [key]: outcome }));
    setBusyId(null);
    await load();
    onInventoryChanged?.();
  };

  if (loading) return <TabLoading label="Loading tools" />;

  if (failedLoad) {
    return (
      <div className="flex flex-col gap-3">
        <TabError message="Could not load tool operations. Try again." />
        <div><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Tools</h2>
        <p className="text-sm text-muted-foreground">
          Marketplace tools install globally and are available to every mind.
        </p>
      </div>

      {result.tools.length === 0 ? (
        <TabEmptyState
          icon={<Blocks size={22} />}
          title="No tools available"
          detail="Add a tool marketplace in Settings to populate this catalog."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {result.tools.map((tool) => {
            const key = toolKey(tool);
            const outcome = outcomes[key];
            const action = actionFor(tool);
            const busy = busyId === key;
            const failed = outcome?.status === 'failed' && outcome.action === action;
            return (
              <li key={key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{tool.displayName}</span>
                      <Badge variant={tool.installation === 'installed' ? 'secondary' : 'outline'}>
                        {tool.installation === 'installed' ? 'Installed' : 'Available'}
                      </Badge>
                      {tool.updateAvailable ? <Badge variant="outline">Update available</Badge> : null}
                      <Badge variant="outline">Global</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{tool.marketplaceLabel}</p>
                    {outcome ? (
                      <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">
                        {outcomeMessage(outcome)}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant={action === 'install' ? 'default' : 'outline'}
                    disabled={busyId !== null}
                    onClick={() => void run(tool, action)}
                    aria-label={`${failed ? `Retry ${actionLabel(action).toLowerCase()}` : actionLabel(action)} ${tool.displayName}`}
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : actionIcon(action)}
                    {busy ? `${progressLabel(action)}...` : failed ? `Retry ${actionLabel(action).toLowerCase()}` : actionLabel(action)}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function actionFor(tool: ToolOperationEntry): ToolAction {
  if (tool.installation === 'available') return 'install';
  return tool.updateAvailable ? 'update' : 'remove';
}

function actionLabel(action: ToolAction): string {
  return action === 'remove' ? 'Remove' : action[0].toUpperCase() + action.slice(1);
}

function progressLabel(action: ToolAction): string {
  return action === 'remove' ? 'Removing' : `${actionLabel(action)}ing`;
}

function actionIcon(action: ToolAction) {
  if (action === 'install') return <Download size={16} aria-hidden />;
  if (action === 'update') return <RefreshCw size={16} aria-hidden />;
  return <Trash2 size={16} aria-hidden />;
}

function outcomeMessage(outcome: ToolOperationResult): string {
  if (outcome.status === 'completed') return `Tool ${outcome.action} completed.`;
  if (outcome.status === 'already-current') return 'This tool is already current.';
  if (outcome.status === 'not-installed') return 'This tool is no longer installed. Refresh the catalog and try again.';
  if (outcome.status === 'not-available') return 'This tool is unavailable from configured marketplaces. Refresh marketplaces and try again.';
  if (outcome.action === 'remove') return 'Tool removal failed. Close any process using it, then retry.';
  return `Tool ${outcome.action} failed. Check marketplace access, then retry.`;
}

function toolKey(tool: ToolOperationEntry): string {
  return `${tool.marketplaceId}:${tool.id}`;
}
