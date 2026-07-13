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
import { buildSkillMarkdown, validateSkillId } from '@chamber/shared/skill-authoring';
import { AlertTriangle, PackageSearch, Pencil, Plus, Sparkles, Store } from 'lucide-react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Skeleton } from '../ui/skeleton';
import { TabEmptyState, TabError } from './extensionsShared';

const secondaryButtonClass =
  'rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50';
const primaryButtonClass =
  'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50';
const alertClass = 'rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive';
const fieldInputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

type DetailSelection =
  | { type: 'local'; item: SkillDetail }
  | { type: 'marketplace-skill'; item: MarketplaceSkillEntry }
  | { type: 'marketplace-template'; item: MarketplaceTemplateEntry }
  | { type: 'malformed-skill'; item: MarketplaceSkillMalformedEntry };

export function SkillsTab() {
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
  const reloadLocalSkills = useCallback(() => setLocalReloadNonce((nonce) => nonce + 1), []);

  useEffect(() => {
    setCreateOpen(false);
    setEditTarget(null);
  }, [activeMindId]);

  useEffect(() => {
    if (pendingExtensionsIntent?.action !== 'create-skill') return;
    setCreateOpen(true);
    dispatch({ type: 'SET_PENDING_EXTENSIONS_INTENT', payload: null });
  }, [pendingExtensionsIntent, dispatch]);

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
        if (!cancelled) setLocalError(getErrorMessage(err));
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
      .catch((err: unknown) => {
        if (!cancelled) setMarketplaceError(getErrorMessage(err));
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
          detail="Local and Chamber-managed skills are read from bounded metadata under .github/skills."
          action={
            activeMindId ? (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className={cn(primaryButtonClass, 'flex items-center gap-1.5')}
              >
                <Plus size={16} />
                New skill
              </button>
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
          <LocalSkillsSection
            skills={skills}
            loading={localLoading}
            error={localError}
            onDetails={(item) => setDetailSelection({ type: 'local', item })}
            onEdit={(item) => setEditTarget(item)}
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

      <SkillDetailDialog
        selection={detailSelection}
        onOpenChange={(open) => {
          if (!open) setDetailSelection(null);
        }}
      />

      {activeMindId ? (
        <SkillCreateDialog
          open={createOpen}
          mindId={activeMindId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reloadLocalSkills();
          }}
        />
      ) : null}

      {activeMindId ? (
        <SkillSourceEditor
          mindId={activeMindId}
          skill={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            reloadLocalSkills();
          }}
        />
      ) : null}
    </div>
  );
}

function LocalSkillsSection({
  skills,
  loading,
  error,
  onDetails,
  onEdit,
}: {
  skills: SkillDetail[];
  loading: boolean;
  error: string | null;
  onDetails: (skill: SkillDetail) => void;
  onEdit: (skill: SkillDetail) => void;
}) {
  if (loading) return <LoadingRows label="Loading skills" />;
  if (error) return <TabError message={error} />;
  if (skills.length === 0) {
    return (
      <TabEmptyState
        icon={<Sparkles size={22} />}
        title="No skills found"
        detail="Add SKILL.md directories under this mind's .github/skills to extend it."
      />
    );
  }

  return (
    <ul className="grid gap-3">
      {skills.map((skill) => (
        <li key={skill.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{skill.name}</span>
            {skill.version && <Badge variant="outline">v{skill.version}</Badge>}
            {skill.isCore && <Badge variant="secondary">Core</Badge>}
            {skill.isManaged && <Badge variant="default">Managed</Badge>}
            {skill.validationErrors.length > 0 && <Badge variant="destructive">Needs review</Badge>}
            <span className="text-xs text-muted-foreground">{skill.id}</span>
          </div>
          {skill.description && <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>}
          <MetadataList
            items={[
              ['Source', skill.isManaged ? 'Chamber managed local skill' : 'Local skill'],
              ['Path', skill.source.directory],
              ['Required files', summarizeFiles(skill.requiredFiles)],
              ['Capabilities', summarizeList(skill.capabilities)],
            ]}
          />
          {skill.validationErrors.length > 0 && (
            <ValidationErrors errors={skill.validationErrors} />
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <CardActionButton label={`View details for ${skill.name}`} onClick={() => onDetails(skill)} />
            {isEditableSkill(skill) ? (
              <CardActionButton
                label={`Edit ${skill.name}`}
                icon={<Pencil size={14} />}
                onClick={() => onEdit(skill)}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
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
  if (loading) return <LoadingRows label="Loading marketplace" />;
  if (error) return <TabError message={error} />;
  if (!result) return null;

  const hasEntries = result.skills.length > 0 || result.templates.length > 0 || result.malformedSkills.length > 0;
  const sourceErrors = [
    ...result.skillSources.filter((source) => source.status === 'error').map((source) => source.message ?? `${source.label} could not be read.`),
    ...result.templateSources.filter((source) => source.status === 'error').map((source) => source.message ?? `${source.label} could not be read.`),
  ];

  return (
    <div className="flex flex-col gap-4">
      <SourceStatusList skillSources={result.skillSources} templateSources={result.templateSources} />
      {sourceErrors.map((message) => (
        <TabError key={message} message={message} />
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
          ['Root', skill.root],
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
          ['Agent', template.agent],
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

function SkillDetailDialog({
  selection,
  onOpenChange,
}: {
  selection: DetailSelection | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={selection !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
        {selection && (
          <>
            <DialogHeader>
              <DialogTitle>{detailTitle(selection)}</DialogTitle>
              <DialogDescription>{detailDescription(selection)}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 text-sm">
              {renderDetailBody(selection)}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
            ['Directory', item.source.directory],
            ['Manifest', item.source.manifestPath],
            ['Managed metadata', item.managed?.metadataPath ?? 'N/A'],
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
            ['Root', item.root],
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
            ['Manifest', item.source.manifestPath],
            ['Root', item.source.rootPath],
            ['Version', item.templateVersion],
            ['Role', item.role],
            ['Voice', item.voice],
            ['Agent', item.agent],
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
    <button
      type="button"
      className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function CardActionButton({ label, onClick, icon }: { label: string; onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
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
  onCreated,
}: {
  open: boolean;
  mindId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setId('');
      setName('');
      setDescription('');
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const canSubmit = id.trim().length > 0 && name.trim().length > 0 && description.trim().length > 0 && !saving;

  const handleCreate = async () => {
    const trimmedId = id.trim();
    const idError = validateSkillId(trimmedId);
    if (idError) {
      setError(idError);
      return;
    }
    if (!name.trim() || !description.trim()) {
      setError('Name and description are required.');
      return;
    }

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
        setError(result.error ?? 'Could not create the skill.');
      }
    } catch (err) {
      setSaving(false);
      setError(getErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>Create a SKILL.md under this mind&apos;s .github/skills directory.</DialogDescription>
        </DialogHeader>
        {error ? <div role="alert" className={alertClass}>{error}</div> : null}
        <div className="flex flex-col gap-3">
          <Field label="Skill id" htmlFor="skill-create-id" hint="Lowercase letters, numbers, and single hyphens, for example note-taker.">
            <input
              id="skill-create-id"
              value={id}
              onChange={(event) => setId(event.target.value)}
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
              className={fieldInputClass}
            />
          </Field>
          <Field label="Description" htmlFor="skill-create-description">
            <textarea
              id="skill-create-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={cn(fieldInputClass, 'min-h-[80px] resize-none')}
            />
          </Field>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="button" onClick={handleCreate} disabled={!canSubmit} className={primaryButtonClass}>
            {saving ? 'Creating...' : 'Create skill'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillSourceEditor({
  mindId,
  skill,
  onClose,
  onSaved,
}: {
  mindId: string;
  skill: SkillDetail | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [baselineMtimeMs, setBaselineMtimeMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!skill) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    void window.electronAPI.skills.getSource(mindId, skill.id)
      .then((source) => {
        if (cancelled) return;
        setContent(source.content);
        setInitialContent(source.content);
        setBaselineMtimeMs(source.mtimeMs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill, mindId]);

  const dirty = content !== initialContent;

  const handleSave = async () => {
    if (!skill) return;
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
        setError(result.error ?? 'Could not save the skill.');
      }
    } catch (err) {
      setSaving(false);
      setError(getErrorMessage(err));
    }
  };

  return (
    <Dialog open={Boolean(skill)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{skill ? `Edit ${skill.name}` : 'Edit skill'}</DialogTitle>
          <DialogDescription>{skill?.source.manifestPath ?? 'SKILL.md'}</DialogDescription>
        </DialogHeader>
        {loadError ? <div role="alert" className={alertClass}>{loadError}</div> : null}
        {error ? <div role="alert" className={alertClass}>{error}</div> : null}
        <textarea
          aria-label="SKILL.md content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
          disabled={loading}
          className="min-h-[240px] w-full flex-1 resize-none rounded-xl border border-border bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none focus:border-primary disabled:opacity-50"
        />
        <DialogFooter>
          {dirty ? <span className="mr-auto self-center text-xs text-amber-600 dark:text-amber-300">Unsaved edits</span> : null}
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={!dirty || saving || loading} className={primaryButtonClass}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoadingRows({ label }: { label: string }) {
  return (
    <div aria-label={label} className="grid gap-3">
      <p className="text-sm text-muted-foreground">{label}...</p>
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
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
