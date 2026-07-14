import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type {
  MarketplaceSkillEntry,
  MarketplaceSkillMalformedEntry,
  MarketplaceSkillSourceStatus,
  MarketplaceTemplateEntry,
  MarketplaceTemplateSourceStatus,
  SkillDetail,
  SkillFileReference,
  SkillMarketplaceBrowseResult,
  SkillValidationError,
} from '@chamber/shared/skill-types';
import { buildSkillMarkdown, validateSkillFrontmatter, validateSkillId } from '@chamber/shared/skill-authoring';
import { AlertTriangle, PackageSearch, Pencil, Plus, Sparkles, Store } from 'lucide-react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { TabEmptyState, TabError, TabLoading } from './extensionsShared';

const fieldInputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

type DetailSelection =
  | { type: 'local'; item: SkillDetail }
  | { type: 'marketplace-skill'; item: MarketplaceSkillEntry }
  | { type: 'marketplace-template'; item: MarketplaceTemplateEntry }
  | { type: 'malformed-skill'; item: MarketplaceSkillMalformedEntry };

export function SkillsTab({
  onInventoryChanged,
  onEditorDirtyChange,
}: {
  readonly onInventoryChanged?: () => void;
  readonly onEditorDirtyChange?: (dirty: boolean) => void;
}) {
  const { activeMindId, minds, pendingExtensionsIntent } = useAppState();
  const dispatch = useAppDispatch();
  const activeMind = minds.find((mind) => mind.mindId === activeMindId) ?? null;

  const [skills, setSkills] = useState<SkillDetail[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [marketplace, setMarketplace] = useState<SkillMarketplaceBrowseResult | null>(null);
  const [marketplaceLoading, setMarketplaceLoading] = useState(true);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [detailSelection, setDetailSelection] = useState<DetailSelection | null>(null);
  const [localReloadNonce, setLocalReloadNonce] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SkillDetail | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingDraftHandoff, setPendingDraftHandoff] = useState(false);
  const reloadLocalSkills = useCallback(() => setLocalReloadNonce((nonce) => nonce + 1), []);

  useEffect(() => {
    onEditorDirtyChange?.(editorDirty);
    return () => onEditorDirtyChange?.(false);
  }, [editorDirty, onEditorDirtyChange]);

  useEffect(() => {
    setCreateOpen(false);
    setEditTarget(null);
  }, [activeMindId]);

  useEffect(() => {
    if (pendingExtensionsIntent?.action !== 'create-skill') return;
    setCreateOpen(true);
    dispatch({ type: 'SET_PENDING_EXTENSIONS_INTENT', payload: null });
  }, [pendingExtensionsIntent, dispatch]);

  const runDraftHandoff = () => {
    if (!activeMindId) return;
    dispatch({
      type: 'SET_COMPOSE_DRAFT',
      payload: { mindId: activeMindId, draft: 'Create a new skill for this mind. Propose an id, name, and description first.' },
    });
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  };

  const requestDraftHandoff = () => {
    if (editorDirty) {
      setPendingDraftHandoff(true);
      return;
    }
    runDraftHandoff();
  };

  useEffect(() => {
    let cancelled = false;
    if (!activeMindId) {
      setSkills([]);
      setLocalLoading(false);
      setLocalError(null);
      return () => {
        cancelled = true;
      };
    }

    setLocalLoading(true);
    setLocalError(null);
    void window.electronAPI.skills.listForMindDetails(activeMindId)
      .then((items) => {
        if (!cancelled) setSkills(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLocalError(safeAuthoringError(err, 'Could not load skills.'));
      })
      .finally(() => {
        if (!cancelled) setLocalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeMindId, localReloadNonce]);

  useEffect(() => {
    let cancelled = false;
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    void window.electronAPI.skills.browseMarketplace()
      .then((result) => {
        if (!cancelled) setMarketplace(result);
      })
      .catch(() => {
        if (!cancelled) setMarketplaceError('Marketplace entries could not be loaded. Try again.');
      })
      .finally(() => {
        if (!cancelled) setMarketplaceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Skills</h2>
        <p className="text-sm text-muted-foreground">
          Skills discovered in{' '}
          <span className="font-medium text-foreground">{activeMind?.identity.name ?? 'the selected mind'}</span>
          {' '}and read-only marketplace entries from enrolled registries.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Installed skills"
          detail="Local and Chamber-managed skills available to the active mind."
          action={
            activeMindId ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={requestDraftHandoff}
                >
                  Draft with active mind
                </Button>
                <Button disabled={editTarget !== null} onClick={() => setCreateOpen(true)}>
                  <Plus size={16} />
                  New skill
                </Button>
              </div>
            ) : undefined
          }
        />
        {!activeMindId ? (
          <TabEmptyState
            icon={<Sparkles size={22} />}
            title="No mind selected"
            detail="Select a mind from the sidebar to see the skills it discovers on disk."
          />
        ) : (
          <LocalSkillsWorkspace
            skills={skills}
            loading={localLoading}
            error={localError}
            onDetails={(item) => setDetailSelection({ type: 'local', item })}
            onEdit={(item) => {
              if (!createOpen) setEditTarget(item);
            }}
            editingDisabled={createOpen}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Marketplace browse"
          detail="Browse skills and Genesis mind templates exposed by enrolled registries. This view is read-only."
        />
        <MarketplaceSection
          result={marketplace}
          loading={marketplaceLoading}
          error={marketplaceError}
          onSkillDetails={(item) => setDetailSelection({ type: 'marketplace-skill', item })}
          onTemplateDetails={(item) => setDetailSelection({ type: 'marketplace-template', item })}
          onMalformedDetails={(item) => setDetailSelection({ type: 'malformed-skill', item })}
        />
      </section>

      {detailSelection ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">{detailTitle(detailSelection)}</h3>
              <p className="text-sm text-muted-foreground">{detailDescription(detailSelection)}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDetailSelection(null)}>Close details</Button>
          </div>
          <div className="flex flex-col gap-4 text-sm">{renderDetailBody(detailSelection)}</div>
        </section>
      ) : null}

      {activeMindId ? (
        <SkillCreateDialog
          open={createOpen}
          mindId={activeMindId}
          onClose={() => setCreateOpen(false)}
          onDirtyChange={setEditorDirty}
          onCreated={() => {
            setCreateOpen(false);
            reloadLocalSkills();
            onInventoryChanged?.();
          }}
        />
      ) : null}

      {activeMindId ? (
        <SkillSourceEditor
          mindId={activeMindId}
          skill={editTarget}
          onClose={() => setEditTarget(null)}
          onDirtyChange={setEditorDirty}
          onSaved={() => {
            setEditTarget(null);
            setEditorDirty(false);
            reloadLocalSkills();
            onInventoryChanged?.();
          }}
        />
      ) : null}
      {pendingDraftHandoff ? (
        <Alert variant="destructive">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>You have unsaved edits. Discard them and draft with the active mind?</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingDraftHandoff(false)}>Keep editing</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setEditTarget(null);
                  setEditorDirty(false);
                  setPendingDraftHandoff(false);
                  runDraftHandoff();
                }}
              >
                Discard edits
              </Button>
            </span>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}

function LocalSkillsWorkspace({
  skills,
  loading,
  error,
  onDetails,
  onEdit,
  editingDisabled,
}: {
  skills: SkillDetail[];
  loading: boolean;
  error: string | null;
  onDetails: (skill: SkillDetail) => void;
  onEdit: (skill: SkillDetail) => void;
  editingDisabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (loading) return <TabLoading label="Loading skills" />;
  if (error) return <TabError message={error} />;
  if (skills.length === 0) {
    return (
      <TabEmptyState
        icon={<Sparkles size={22} />}
        title="No skills found"
        detail="Create a skill to extend the active mind with focused guidance."
      />
    );
  }

  const selectedSkill = skills.find((skill) => skill.id === selectedId) ?? skills[0];
  return (
    <div className="grid min-h-[22rem] gap-4 lg:grid-cols-[minmax(14rem,0.38fr)_minmax(0,1fr)]">
      <aside className="rounded-xl border border-border bg-card p-2" aria-label="Installed skills">
        <div className="mb-2 flex items-center justify-between px-2 pt-1">
          <h4 className="text-sm font-semibold">Installed skills</h4>
          <span className="text-xs text-muted-foreground">{skills.length}</span>
        </div>
        <div role="listbox" aria-label="Installed skills" className="grid gap-1">
          {skills.map((skill) => {
            const selected = skill.id === selectedSkill.id;
            return (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => setSelectedId(skill.id)}
                className={cn(
                  'rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'bg-selected text-selected-foreground' : 'hover:bg-hover',
                )}
              >
                <span className="block truncate text-sm font-medium">{skill.name}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{skill.id}</span>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold">{selectedSkill.name}</h4>
            {selectedSkill.description ? <p className="mt-1 text-sm text-muted-foreground">{selectedSkill.description}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Mind scope</Badge>
            {selectedSkill.version ? <Badge variant="outline">v{selectedSkill.version}</Badge> : null}
            {selectedSkill.isCore ? <Badge variant="secondary">Core</Badge> : null}
            {selectedSkill.isManaged ? <Badge variant="default">Managed</Badge> : <Badge variant="secondary">User authored</Badge>}
          </div>
        </div>
        <MetadataList
          items={[
            ['Source', selectedSkill.isManaged ? 'Chamber managed local skill' : 'Local user skill'],
            ['Status', selectedSkill.validationErrors.length > 0 ? 'Needs review' : 'Ready'],
            ['Capabilities', summarizeList(selectedSkill.capabilities)],
            ['Required files', summarizeFiles(selectedSkill.requiredFiles)],
          ]}
        />
        {selectedSkill.validationErrors.length > 0 ? <ValidationErrors errors={selectedSkill.validationErrors} /> : null}
        {isEditableSkill(selectedSkill) ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-3 text-sm text-muted-foreground">Edit this skill's authorized source content.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => onDetails(selectedSkill)}>
                View details
              </Button>
              <Button aria-label={`Edit ${selectedSkill.name}`} disabled={editingDisabled} onClick={() => onEdit(selectedSkill)}>
              <Pencil size={16} />
              Edit skill
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">This skill is managed by Chamber and is read-only here.</p>
            <Button variant="outline" size="sm" onClick={() => onDetails(selectedSkill)}>View details</Button>
          </div>
        )}
      </section>
    </div>
  );
}

function isEditableSkill(skill: SkillDetail): boolean {
  return !skill.isCore && !skill.isManaged;
}

function MarketplaceSection({
  result,
  loading,
  error,
  onSkillDetails,
  onTemplateDetails,
  onMalformedDetails,
}: {
  result: SkillMarketplaceBrowseResult | null;
  loading: boolean;
  error: string | null;
  onSkillDetails: (skill: MarketplaceSkillEntry) => void;
  onTemplateDetails: (template: MarketplaceTemplateEntry) => void;
  onMalformedDetails: (entry: MarketplaceSkillMalformedEntry) => void;
}) {
  if (loading) return <TabLoading label="Loading marketplace" />;
  if (error) return <TabError message={error} />;
  if (!result) return null;

  const hasEntries = result.skills.length > 0 || result.templates.length > 0 || result.malformedSkills.length > 0;
  const sourceErrors = [
    ...result.skillSources.filter((source) => source.status === 'error').map((source) => `skills:${source.id}`),
    ...result.templateSources.filter((source) => source.status === 'error').map((source) => `templates:${source.id}`),
  ];

  return (
    <div className="flex flex-col gap-4">
      <SourceStatusList skillSources={result.skillSources} templateSources={result.templateSources} />
      {sourceErrors.map((sourceId) => (
        <TabError key={sourceId} message="A marketplace source could not be loaded. Try again." />
      ))}
      {!hasEntries ? (
        <TabEmptyState
          icon={<Store size={22} />}
          title="No marketplace skills or templates"
          detail="Enabled registries did not expose any browseable skills or templates."
        />
      ) : (
        <>
          {result.skills.length > 0 && (
            <MarketplaceCardGroup title="Marketplace skills">
              {result.skills.map((skill) => (
                <MarketplaceSkillCard key={`${skill.source.marketplaceId}:${skill.id}`} skill={skill} onDetails={onSkillDetails} />
              ))}
            </MarketplaceCardGroup>
          )}
          {result.templates.length > 0 && (
            <MarketplaceCardGroup title="Genesis mind templates">
              {result.templates.map((template) => (
                <MarketplaceTemplateCard
                  key={`${template.source.marketplaceId}:${template.id}`}
                  template={template}
                  onDetails={onTemplateDetails}
                />
              ))}
            </MarketplaceCardGroup>
          )}
          {result.malformedSkills.length > 0 && (
            <MarketplaceCardGroup title="Malformed marketplace entries">
              {result.malformedSkills.map((entry) => (
                <MalformedSkillCard
                  key={`${entry.source.marketplaceId}:${entry.index}:${entry.rawId ?? 'unknown'}`}
                  entry={entry}
                  onDetails={onMalformedDetails}
                />
              ))}
            </MarketplaceCardGroup>
          )}
        </>
      )}
    </div>
  );
}

function MarketplaceSkillCard({
  skill,
  onDetails,
}: {
  skill: MarketplaceSkillEntry;
  onDetails: (skill: MarketplaceSkillEntry) => void;
}) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{skill.displayName}</span>
        {skill.version && <Badge variant="outline">v{skill.version}</Badge>}
        {skill.reserved ? <Badge variant="secondary">Core managed</Badge> : <Badge variant="outline">Read-only</Badge>}
        <span className="text-xs text-muted-foreground">{skill.id}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
      <MetadataList
        items={[
          ['Registry', skill.source.marketplaceLabel],
          ['Required files', summarizeList(skill.requiredFiles)],
          ['Capabilities', summarizeList(skill.capabilities)],
        ]}
      />
      <DetailsButton label={`View details for ${skill.displayName}`} onClick={() => onDetails(skill)} />
    </li>
  );
}

function MarketplaceTemplateCard({
  template,
  onDetails,
}: {
  template: MarketplaceTemplateEntry;
  onDetails: (template: MarketplaceTemplateEntry) => void;
}) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{template.displayName}</span>
        <Badge variant="outline">v{template.templateVersion}</Badge>
        <Badge variant="outline">Read-only template</Badge>
        <span className="text-xs text-muted-foreground">{template.id}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
      <MetadataList
        items={[
          ['Registry', template.source.marketplaceLabel],
          ['Role', template.role],
          ['Required files', summarizeList(template.requiredFiles)],
        ]}
      />
      <DetailsButton label={`View details for ${template.displayName}`} onClick={() => onDetails(template)} />
    </li>
  );
}

function MalformedSkillCard({
  entry,
  onDetails,
}: {
  entry: MarketplaceSkillMalformedEntry;
  onDetails: (entry: MarketplaceSkillMalformedEntry) => void;
}) {
  const label = entry.rawDisplayName ?? entry.rawId ?? `Entry ${entry.index + 1}`;
  return (
    <li className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={16} className="text-destructive" />
        <span className="font-medium">{label}</span>
        <Badge variant="destructive">Malformed</Badge>
        <span className="text-xs text-muted-foreground">{entry.source.marketplaceLabel}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{entry.message}</p>
      <DetailsButton label={`View details for ${label}`} onClick={() => onDetails(entry)} />
    </li>
  );
}

function renderDetailBody(selection: DetailSelection) {
  if (selection.type === 'local') {
    const { item } = selection;
    return (
      <>
        <MetadataList
          items={[
            ['ID', item.id],
            ['Source', item.isManaged ? 'Chamber managed local skill' : 'Local skill'],
            ['Core status', item.isCore ? 'Core skill' : 'Non-core skill'],
            ['Managed status', item.isManaged ? 'Managed by Chamber' : 'User managed'],
            ['Version', item.version ?? item.managed?.version ?? 'N/A'],
            ['Capabilities', summarizeList(item.capabilities)],
            ['Required files', summarizeFiles(item.requiredFiles)],
            ['Marketplace source', item.isManaged ? item.managed?.source?.marketplaceLabel ?? 'N/A' : 'N/A'],
          ]}
        />
        {item.description && <EscapedTextBlock label="Description" text={item.description} />}
        {item.validationErrors.length > 0 && <ValidationErrors errors={item.validationErrors} />}
      </>
    );
  }
  if (selection.type === 'marketplace-skill') {
    const { item } = selection;
    return (
      <>
        <MetadataList
          items={[
            ['ID', item.id],
            ['Registry', item.source.marketplaceLabel],
            ['Repository', `${item.source.owner}/${item.source.repo}`],
            ['Ref', item.source.ref],
            ['Core status', item.reserved ? 'Core managed skill' : 'Non-core read-only skill'],
            ['Version', item.version ?? 'N/A'],
            ['Capabilities', summarizeList(item.capabilities)],
            ['Required files', summarizeList(item.requiredFiles)],
          ]}
        />
        <EscapedTextBlock label="Description" text={item.description} />
      </>
    );
  }
  if (selection.type === 'marketplace-template') {
    const { item } = selection;
    return (
      <>
        <MetadataList
          items={[
            ['ID', item.id],
            ['Registry', item.source.marketplaceLabel],
            ['Repository', `${item.source.owner}/${item.source.repo}`],
            ['Ref', item.source.ref],
            ['Version', item.templateVersion],
            ['Role', item.role],
            ['Voice', item.voice],
            ['Required files', summarizeList(item.requiredFiles)],
          ]}
        />
        <EscapedTextBlock label="Description" text={item.description} />
      </>
    );
  }
  const { item } = selection;
  return (
    <>
      <MetadataList
        items={[
          ['Registry', item.source.marketplaceLabel],
          ['Repository', `${item.source.owner}/${item.source.repo}`],
          ['Entry index', String(item.index)],
          ['Raw ID', item.rawId ?? 'N/A'],
          ['Raw display name', item.rawDisplayName ?? 'N/A'],
        ]}
      />
      <EscapedTextBlock label="Validation error" text={item.message} />
    </>
  );
}

function SourceStatusList({
  skillSources,
  templateSources,
}: {
  skillSources: MarketplaceSkillSourceStatus[];
  templateSources: MarketplaceTemplateSourceStatus[];
}) {
  const sources = [
    ...skillSources.map((source) => ({
      id: `skills:${source.id}`,
      label: source.label,
      detail: `${source.skillCount} skill${source.skillCount === 1 ? '' : 's'}, ${source.malformedCount} malformed`,
      status: source.status,
    })),
    ...templateSources.map((source) => ({
      id: `templates:${source.id}`,
      label: source.label,
      detail: `${source.templateCount} template${source.templateCount === 1 ? '' : 's'}`,
      status: source.status,
    })),
  ];
  if (sources.length === 0) return null;

  return (
    <div className="grid gap-2">
      {sources.map((source) => (
        <div key={source.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm">
          <span className="font-medium">{source.label}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={source.status === 'error' ? 'destructive' : source.status === 'disabled' ? 'outline' : 'secondary'}>
              {source.status}
            </Badge>
            {source.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function MarketplaceCardGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <PackageSearch size={16} />
        {title}
      </h4>
      <ul className="grid gap-3">{children}</ul>
    </div>
  );
}

function MetadataList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="break-words text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ValidationErrors({ errors }: { errors: SkillValidationError[] }) {
  return (
    <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
      <div className="font-medium">Validation errors</div>
      <ul className="mt-2 grid gap-1">
        {errors.map((error, index) => (
          <li key={`${error.path ?? 'error'}:${index}`} className="text-muted-foreground">
            {error.path ? `${error.path}: ${error.message}` : error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EscapedTextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-sans text-sm">
        {text}
      </pre>
    </div>
  );
}

function DetailsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="mt-3" onClick={onClick}>
      {label}
    </Button>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SkillCreateDialog({
  open,
  mindId,
  onClose,
  onDirtyChange,
  onCreated,
}: {
  open: boolean;
  mindId: string;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onCreated: () => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = id.length > 0 || name.length > 0 || description.length > 0;

  useEffect(() => {
    if (open) {
      setId('');
      setName('');
      setDescription('');
      setError(null);
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    onDirtyChange(open && dirty);
  }, [dirty, onDirtyChange, open]);

  const canSubmit = id.trim().length > 0 && name.trim().length > 0 && description.trim().length > 0 && !saving;
  const validateDraft = () => {
    const idError = validateSkillId(id.trim());
    if (idError) return idError;
    if (!name.trim() || !description.trim()) return 'Name and description are required.';
    return null;
  };

  const handleCreate = async () => {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return;
    }
    const trimmedId = id.trim();

    setSaving(true);
    setError(null);
    const content = buildSkillMarkdown({ name: name.trim(), description: description.trim() });
    try {
      const result = await window.electronAPI.skills.save({
        mindId,
        id: trimmedId,
        content,
        expectedMtimeMs: null,
      });
      setSaving(false);
      if (result.success) {
        onCreated();
      } else {
        setError(safeAuthoringMessage(result.error, 'Could not create the skill.'));
      }
    } catch (err) {
      setSaving(false);
      setError(safeAuthoringError(err, 'Could not create the skill.'));
    }
  };

  if (!open) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">New skill</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create a user-authored skill for the active mind.</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">Mind scope</Badge>
          <Badge variant="secondary">User authored</Badge>
        </div>
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="mt-4 flex flex-col gap-3">
          <Field label="Skill id" htmlFor="skill-create-id" hint="Lowercase letters, numbers, and single hyphens, for example note-taker.">
            <input
              id="skill-create-id"
              value={id}
              onChange={(event) => setId(event.target.value)}
              onBlur={() => setError(validateDraft())}
              spellCheck={false}
              autoComplete="off"
              className={fieldInputClass}
            />
          </Field>
          <Field label="Name" htmlFor="skill-create-name">
            <input
              id="skill-create-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setError(validateDraft())}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Description" htmlFor="skill-create-description">
            <textarea
              id="skill-create-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => setError(validateDraft())}
              className={cn(fieldInputClass, 'min-h-[80px] resize-none')}
            />
          </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className="mr-auto text-xs text-muted-foreground">The skill source is created only after validation succeeds.</span>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleCreate} disabled={!canSubmit}>{saving ? 'Creating...' : 'Create skill'}</Button>
      </div>
    </section>
  );
}

function SkillSourceEditor({
  mindId,
  skill,
  onClose,
  onDirtyChange,
  onSaved,
}: {
  mindId: string;
  skill: SkillDetail | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [baselineMtimeMs, setBaselineMtimeMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardRequested, setDiscardRequested] = useState(false);

  useEffect(() => {
    if (!skill) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setDiscardRequested(false);
    void window.electronAPI.skills.getSource(mindId, skill.id)
      .then((source) => {
        if (cancelled) return;
        setContent(source.content);
        setInitialContent(source.content);
        setBaselineMtimeMs(source.mtimeMs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(safeAuthoringError(err, 'Could not load the skill editor.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill, mindId]);

  const dirty = content !== initialContent;

  useEffect(() => {
    onDirtyChange(skill ? dirty : false);
  }, [dirty, onDirtyChange, skill]);

  const handleSave = async () => {
    if (!skill) return;
    const validationError = validateSkillFrontmatter(content);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.skills.save({
        mindId,
        id: skill.id,
        content,
        expectedMtimeMs: baselineMtimeMs,
      });
      setSaving(false);
      if (result.success) {
        onSaved();
      } else {
        setError(safeAuthoringMessage(result.error, 'Could not save the skill.'));
      }
    } catch (err) {
      setSaving(false);
      setError(safeAuthoringError(err, 'Could not save the skill.'));
    }
  };

  const requestClose = () => {
    if (dirty) {
      setDiscardRequested(true);
      return;
    }
    onClose();
  };

  if (!skill) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Editing {skill.name}</h3>
        <p className="text-xs text-muted-foreground">Authorized SKILL.md source editor</p>
        </div>
      <Button variant="outline" size="sm" onClick={requestClose}>
          Close editor
        </Button>
      </div>
      {loadError ? <Alert variant="destructive">{loadError}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {discardRequested ? (
      <Alert variant="destructive">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>You have unsaved edits. Discard them and close the editor?</span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDiscardRequested(false)}>Keep editing</Button>
            <Button variant="destructive" size="sm" onClick={onClose}>Discard edits</Button>
          </span>
        </div>
      </Alert>
      ) : null}
      <textarea
        aria-label="SKILL.md content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        spellCheck={false}
        disabled={loading}
        className="min-h-[260px] w-full resize-y rounded-xl border border-border bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none focus:border-primary disabled:opacity-50"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        {dirty ? <span className="mr-auto text-xs text-amber-600 dark:text-amber-300">Unsaved edits</span> : null}
        <Button variant="outline" onClick={requestClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!dirty || saving || loading}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </section>
  );
}

function detailTitle(selection: DetailSelection): string {
  if (selection.type === 'local') return selection.item.name;
  if (selection.type === 'marketplace-skill') return selection.item.displayName;
  if (selection.type === 'marketplace-template') return selection.item.displayName;
  return selection.item.rawDisplayName ?? selection.item.rawId ?? `Entry ${selection.item.index + 1}`;
}

function detailDescription(selection: DetailSelection): string {
  if (selection.type === 'local') return 'Local skill details';
  if (selection.type === 'marketplace-skill') return 'Read-only marketplace skill details';
  if (selection.type === 'marketplace-template') return 'Read-only marketplace template details';
  return 'Malformed marketplace entry';
}

function summarizeFiles(files: SkillFileReference[]): string {
  if (files.length === 0) return 'None';
  return files.map((file) => `${file.path} (${file.status})`).join(', ');
}

function summarizeList(items: string[]): string {
  return items.length > 0 ? items.join(', ') : 'None';
}

function safeAuthoringError(error: unknown, fallback: string): string {
  return safeAuthoringMessage(getErrorMessage(error), fallback);
}

function safeAuthoringMessage(message: string | undefined, fallback: string): string {
  if (!message || /(?:[A-Za-z]:[\\/]|\\\\|(?:^|\s)\/\S+|\b[a-z][a-z0-9+.-]*:)/i.test(message)) return fallback;
  return message;
}
