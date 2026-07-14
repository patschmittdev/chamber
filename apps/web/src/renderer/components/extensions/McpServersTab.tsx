import { useCallback, useEffect, useRef, useState } from 'react';
import type { McpConnectorCheckResult, McpConnectorStatusResult } from '@chamber/shared/mcp-types';
import { Globe, Server, Terminal } from 'lucide-react';
import { useAppState } from '../../lib/store';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { TabEmptyState, TabError, TabLoading } from './extensionsShared';

export function McpServersTab({ onInventoryChanged }: { readonly onInventoryChanged?: () => void }) {
  const { activeMindId, minds } = useAppState();
  const activeMind = minds.find((mind) => mind.mindId === activeMindId) ?? null;
  const [status, setStatus] = useState<McpConnectorStatusResult>({ connectors: [], sourceStatus: 'ready' });
  const [loading, setLoading] = useState(true);
  const [failedLoad, setFailedLoad] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, McpConnectorCheckResult>>({});
  const requestSeq = useRef(0);
  const activeMindIdRef = useRef(activeMindId);

  useEffect(() => {
    activeMindIdRef.current = activeMindId;
    setBusyName(null);
    setResults({});
  }, [activeMindId]);

  const load = useCallback(async () => {
    const sequence = ++requestSeq.current;
    const mindId = activeMindId;
    if (!mindId) {
      setStatus({ connectors: [], sourceStatus: 'ready' });
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailedLoad(false);
    try {
      const next = await window.electronAPI.mcp.listStatus(mindId);
      if (requestSeq.current === sequence) setStatus(next);
    } catch {
      if (requestSeq.current === sequence) {
        setStatus({ connectors: [], sourceStatus: 'needs-attention' });
        setFailedLoad(true);
      }
    } finally {
      if (requestSeq.current === sequence) setLoading(false);
    }
  }, [activeMindId]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = async (name: string) => {
    if (!activeMindId || busyName) return;
    const sequence = requestSeq.current;
    const targetMindId = activeMindId;
    setBusyName(name);
    try {
      const result = await window.electronAPI.mcp.checkConnector(name, targetMindId);
      if (requestSeq.current === sequence && activeMindIdRef.current === targetMindId) {
        setResults((current) => ({ ...current, [name]: result }));
      }
    } finally {
      if (activeMindIdRef.current === targetMindId) {
        setBusyName(null);
        await load();
        onInventoryChanged?.();
      }
    }
  };

  if (!activeMindId) {
    return (
      <TabEmptyState
        icon={<Server size={22} />}
        title="No mind selected"
        detail="Select a mind to review its connector configuration."
      />
    );
  }

  if (loading) return <TabLoading label="Loading connector status" />;

  if (failedLoad) {
    return (
      <div className="flex flex-col gap-3">
        <TabError message="Could not load connector status. Try again." />
        <div><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Connectors</h2>
        <p className="text-sm text-muted-foreground">
          Configured for <span className="font-medium text-foreground">{activeMind?.identity.name ?? 'this mind'}</span>.
          Connector configuration is mind scoped and stays private.
        </p>
      </div>

      {status.sourceStatus === 'needs-attention' ? (
        <TabError message="Connector configuration needs attention. Update the required configuration, then reload this view." />
      ) : null}

      {status.connectors.length === 0 ? (
        <TabEmptyState
          icon={<Server size={22} />}
          title="No connectors configured"
          detail="Add connector configuration for this mind before Chamber can load it."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {status.connectors.map((connector) => {
            const result = results[connector.name];
            const busy = busyName === connector.name;
            const canCheck = connector.configuration === 'ready';
            const retry = result?.status === 'reload-failed';
            return (
              <li key={connector.name} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {connector.transport === 'stdio'
                        ? <Terminal size={16} className="text-muted-foreground" aria-hidden />
                        : <Globe size={16} className="text-muted-foreground" aria-hidden />}
                      <span className="font-medium">{connector.name}</span>
                      <Badge variant="outline">{connector.transport === 'unknown' ? 'Unknown transport' : connector.transport}</Badge>
                      <Badge variant={connector.configuration === 'ready' ? 'secondary' : 'destructive'}>
                        {connector.configuration === 'ready' ? 'Configuration ready' : 'Configuration required'}
                      </Badge>
                      <Badge variant="outline">Connection unknown</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Chamber can verify configuration through session setup, not live connector reachability or authentication.
                    </p>
                    {result ? <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">{resultMessage(result)}</p> : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canCheck || busy}
                    onClick={() => void check(connector.name)}
                  >
                    {busy ? 'Checking configuration...' : retry ? 'Retry configuration check' : 'Check configuration'}
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

function resultMessage(result: McpConnectorCheckResult): string {
  switch (result.status) {
    case 'configuration-applied':
      return 'Configuration was applied. Connection health remains unknown until this connector is used.';
    case 'configuration-required':
      return 'Required configuration is incomplete. Update it, then check again.';
    case 'connector-not-found':
      return 'This connector is no longer configured. Refresh the list and try again.';
    case 'reload-failed':
      return 'Chamber could not reload this connector configuration. Retry the check.';
  }
}
