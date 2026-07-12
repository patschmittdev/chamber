import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { ToolCatalogEntry } from '@chamber/shared/types';
import { Blocks, Download, Loader2, Trash2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import { TabEmptyState, TabError } from './extensionsShared';

export function ToolsTab() {
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTools(await window.electronAPI.tools.list());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (tool: ToolCatalogEntry) => {
    setBusyId(tool.id);
    setError(null);
    try {
      const result = await window.electronAPI.tools.install(tool.id, tool.source.marketplaceId);
      await load();
      if (!result.success) {
        setError(result.error);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const uninstall = async (tool: ToolCatalogEntry) => {
    setBusyId(tool.id);
    setError(null);
    try {
      const result = await window.electronAPI.tools.uninstall(tool.id);
      await load();
      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Tools</h2>
        <p className="text-sm text-muted-foreground">
          CLI tools from your configured marketplaces. Installing runs the tool&apos;s package installer and makes it
          available to every mind.
        </p>
      </div>

      {error && <TabError message={error} />}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading tools…</p>
      ) : tools.length === 0 ? (
        <TabEmptyState
          icon={<Blocks size={22} />}
          title="No tools available"
          detail="Add a tool marketplace in Settings to populate this catalog."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {tools.map((tool) => {
            const installed = tool.status === 'installed';
            const busy = busyId === tool.id;
            return (
              <li
                key={`${tool.source.marketplaceId}:${tool.id}`}
                className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tool.displayName}</span>
                    {installed ? (
                      <Badge variant="secondary">
                        Installed{tool.installedVersion ? ` · ${tool.installedVersion}` : ''}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Available</Badge>
                    )}
                    {tool.status === 'error' && <Badge variant="destructive">Error</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{tool.source.marketplaceLabel}</p>
                  {tool.errorMessage && <p className="mt-1 text-xs text-red-300">{tool.errorMessage}</p>}
                </div>
                <div className="shrink-0">
                  {installed ? (
                    <button
                      aria-label={`Uninstall ${tool.displayName}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-60"
                      onClick={() => void uninstall(tool)}
                      disabled={busy}
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      Uninstall
                    </button>
                  ) : (
                    <button
                      aria-label={`Install ${tool.displayName}`}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-60"
                      onClick={() => void install(tool)}
                      disabled={busy}
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      Install
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
