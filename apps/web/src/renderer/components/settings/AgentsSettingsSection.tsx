import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { MindContext, MindInstructionPrecedence } from '@chamber/shared/types';
import { cn } from '@/renderer/lib/utils';
import type { AgentProfileSummary } from '../../lib/store/state';
import { useMindProfiles } from '../../hooks/useMindProfiles';
import { PerMindCustomInstructionsControls } from './PerMindCustomInstructionsControls';
import { AgentModelControls } from './AgentModelControls';
import { AgentDangerZone } from './AgentDangerZone';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { AgentAvatar } from '../profile/AgentAvatar';
import { AgentPersonaEditor } from '../profile/AgentPersonaEditor';

const AVATAR_FALLBACK_CLASS = 'flex items-center justify-center bg-muted font-semibold text-muted-foreground';

interface AgentsSettingsSectionProps {
  minds: MindContext[];
  initialSelectedMindId?: string;
  /**
   * Bumped every time a deep-link is consumed. It lets a repeated deep-link to
   * the same agent re-apply the selection even after the operator navigated to a
   * different agent inside this section.
   */
  selectionToken?: number;
  precedenceByMindId: Record<string, MindInstructionPrecedence>;
  savingMindId: string | null;
  onToggleInheritance: (mind: MindContext, enabled: boolean) => Promise<void>;
}

const STATUS_META: Record<MindContext['status'], { label: string; dotClass: string }> = {
  loading: { label: 'Loading', dotClass: 'bg-amber-500' },
  ready: { label: 'Ready', dotClass: 'bg-green-500' },
  error: { label: 'Error', dotClass: 'bg-red-500' },
  unloading: { label: 'Unloading', dotClass: 'bg-muted-foreground' },
};

/**
 * Master-detail surface for per-mind settings. A searchable agent list drives a
 * detail pane with bounded inner tabs, so configuration scales past a handful of
 * agents instead of enumerating every mind vertically.
 */
export function AgentsSettingsSection({
  minds,
  initialSelectedMindId,
  selectionToken,
  precedenceByMindId,
  savingMindId,
  onToggleInheritance,
}: AgentsSettingsSectionProps) {
  const agentProfileByMindId = useMindProfiles(minds);
  const [query, setQuery] = useState('');
  const [selectedMindId, setSelectedMindId] = useState<string | null>(() => initialSelectedMindId ?? null);
  const [restartingMindId, setRestartingMindId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ mindId: string; text: string } | null>(null);

  const sortedMinds = useMemo(
    () => [...minds].sort((a, b) => a.identity.name.localeCompare(b.identity.name)),
    [minds],
  );

  const filteredMinds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sortedMinds;
    return sortedMinds.filter((mind) => {
      const displayName = agentProfileByMindId[mind.mindId]?.displayName ?? mind.identity.name;
      return displayName.toLowerCase().includes(needle) || mind.identity.name.toLowerCase().includes(needle);
    });
  }, [agentProfileByMindId, query, sortedMinds]);

  const selectedMind = useMemo(
    () =>
      filteredMinds.find((mind) => mind.mindId === selectedMindId)
      ?? sortedMinds.find((mind) => mind.mindId === selectedMindId)
      ?? filteredMinds[0]
      ?? null,
    [filteredMinds, selectedMindId, sortedMinds],
  );

  // Anchor the selection to a mind that still exists so the detail pane never
  // renders against a removed agent.
  useEffect(() => {
    if (selectedMind && selectedMind.mindId !== selectedMindId) {
      setSelectedMindId(selectedMind.mindId);
    }
  }, [selectedMind, selectedMindId]);

  // A deep-link (the sidebar "Manage agent" action) can target a specific mind;
  // honor it even when the section is already mounted on a different agent. The
  // selectionToken changes on every deep-link, so re-selecting the same agent
  // still re-applies after the operator browsed to another agent in-section.
  useEffect(() => {
    if (initialSelectedMindId) setSelectedMindId(initialSelectedMindId);
  }, [initialSelectedMindId, selectionToken]);

  // Restart feedback belongs to one agent; clear it when the operator moves on.
  useEffect(() => {
    setActionMessage(null);
  }, [selectedMind?.mindId]);

  const handleRestart = async (mindId: string) => {
    setRestartingMindId(mindId);
    setActionMessage(null);
    try {
      await window.electronAPI.mindProfile.restart(mindId);
      setActionMessage({ mindId, text: 'Restart requested. The agent will reload with its latest configuration.' });
    } catch (error) {
      setActionMessage({ mindId, text: getErrorMessage(error) });
    } finally {
      setRestartingMindId(null);
    }
  };

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold text-foreground">Agents</h2>
        <p className="text-xs text-foreground/60">Manage each mind on its own: identity, status, model, and how it inherits your global custom instructions.</p>
      </header>

      {sortedMinds.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm font-medium text-foreground">No agents yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add an agent from the sidebar to configure it here.</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-4 md:flex-row">
          <div className="flex w-full shrink-0 flex-col gap-2 md:w-56">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
              aria-label="Search agents"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
            />
            {filteredMinds.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">No agents match your search.</p>
            ) : (
              <ul aria-label="Agents" className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
                {filteredMinds.map((mind) => {
                  const profile = agentProfileByMindId[mind.mindId];
                  const displayName = profile?.displayName ?? mind.identity.name;
                  const status = STATUS_META[mind.status];
                  const active = selectedMind?.mindId === mind.mindId;
                  return (
                    <li key={mind.mindId}>
                      <button
                        type="button"
                        onClick={() => setSelectedMindId(mind.mindId)}
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active ? 'bg-selected text-foreground' : 'text-foreground/80 hover:bg-hover hover:text-foreground',
                        )}
                      >
                        <AgentAvatar name={displayName} avatarDataUrl={profile?.avatarDataUrl ?? null} className="h-7 w-7 shrink-0 rounded-full text-xs" fallbackClassName={AVATAR_FALLBACK_CLASS} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{displayName}</span>
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className={cn('h-1.5 w-1.5 rounded-full', status.dotClass)} aria-hidden />
                            {status.label}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {selectedMind ? (
              <AgentDetail
                mind={selectedMind}
                profile={agentProfileByMindId[selectedMind.mindId]}
                precedenceByMindId={precedenceByMindId}
                savingMindId={savingMindId}
                onToggleInheritance={onToggleInheritance}
                restarting={restartingMindId === selectedMind.mindId}
                onRestart={() => { void handleRestart(selectedMind.mindId); }}
                actionMessage={actionMessage && actionMessage.mindId === selectedMind.mindId ? actionMessage.text : null}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select an agent to view its settings.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

interface AgentDetailProps {
  mind: MindContext;
  profile: AgentProfileSummary | undefined;
  precedenceByMindId: Record<string, MindInstructionPrecedence>;
  savingMindId: string | null;
  onToggleInheritance: (mind: MindContext, enabled: boolean) => Promise<void>;
  restarting: boolean;
  onRestart: () => void;
  actionMessage: string | null;
}

function AgentDetail({
  mind,
  profile,
  precedenceByMindId,
  savingMindId,
  onToggleInheritance,
  restarting,
  onRestart,
  actionMessage,
}: AgentDetailProps) {
  const displayName = profile?.displayName ?? mind.identity.name;
  const status = STATUS_META[mind.status];
  const model = mind.selectedModel ?? 'Default model';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <AgentAvatar name={displayName} avatarDataUrl={profile?.avatarDataUrl ?? null} className="h-12 w-12 shrink-0 rounded-full text-base" fallbackClassName={AVATAR_FALLBACK_CLASS} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{displayName}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', status.dotClass)} aria-hidden />
              {status.label}
            </Badge>
            <Badge variant="secondary">{model}</Badge>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="persona">Persona</TabsTrigger>
          <TabsTrigger value="model">Model</TabsTrigger>
          <TabsTrigger value="instructions">Instructions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3 space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DetailField label="Agent folder" value={mind.mindPath} mono />
            <DetailField label="Status" value={status.label} />
            <DetailField label="Model" value={model} />
            <DetailField label="Mind ID" value={mind.mindId} mono />
          </dl>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={onRestart}
              disabled={restarting}
              className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {restarting ? 'Restarting...' : 'Restart agent'}
            </button>
            <p className="text-xs text-muted-foreground">Reload this agent to apply persona or configuration changes.</p>
          </div>
          {actionMessage ? (
            <p role="status" className="text-xs text-muted-foreground">{actionMessage}</p>
          ) : null}
          <MemorySummary precedence={precedenceByMindId[mind.mindId]} />
          <AgentDangerZone mind={mind} displayName={displayName} />
        </TabsContent>

        <TabsContent value="persona" className="mt-3">
          <AgentPersonaEditor mindId={mind.mindId} />
        </TabsContent>

        <TabsContent value="model" className="mt-3">
          <AgentModelControls mind={mind} />
        </TabsContent>

        <TabsContent value="instructions" className="mt-3">
          <PerMindCustomInstructionsControls
            minds={[mind]}
            precedenceByMindId={precedenceByMindId}
            savingMindId={savingMindId}
            onToggle={onToggleInheritance}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface DetailFieldProps {
  label: string;
  value: string;
  mono?: boolean;
}

function DetailField({ label, value, mono }: DetailFieldProps) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-sm text-foreground', mono && 'font-mono text-xs')} title={value}>{value}</dd>
    </div>
  );
}

interface MemorySummaryProps {
  precedence: MindInstructionPrecedence | undefined;
}

/**
 * Read-only view of the agent's working memory. Working memory is agent-managed,
 * so this surfaces status and location from the instruction-precedence layers
 * without exposing an edit path.
 */
function MemorySummary({ precedence }: MemorySummaryProps) {
  const layer = precedence?.layers.find((entry) => entry.id === 'working-memory');

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
    </section>
  );
}

