import { useMemo, useState } from 'react';
import type { CapabilityInventoryItem } from '@chamber/shared';
import { Compass, Search } from 'lucide-react';
import type { CapabilityInventoryState } from './CapabilityInventory';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { TabEmptyState, TabError, TabLoading } from './extensionsShared';

type DirectoryFilter = 'all' | 'skill' | 'cli-tool';

interface CuratedEntry {
  readonly item: CapabilityInventoryItem;
  readonly summary: string;
  readonly useCases: readonly string[];
  readonly declaredCapabilities: readonly string[];
  readonly requirementStates: readonly string[];
  readonly installPath: 'tools-management' | 'unavailable';
}

const FILTERS: ReadonlyArray<{ readonly value: DirectoryFilter; readonly label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'skill', label: 'Skills' },
  { value: 'cli-tool', label: 'Tools' },
];

/**
 * A discovery-only directory. It curates the safe marketplace classes already
 * projected by CapabilityInventoryService, without fetching or retaining source
 * bodies, configuration, URLs, or installer details.
 */
export function CuratedDirectory({
  inventory,
  onManageTools,
}: {
  readonly inventory: CapabilityInventoryState;
  readonly onManageTools: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DirectoryFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [preflightVisible, setPreflightVisible] = useState(false);
  const entries = useMemo(() => curateEntries(inventory.result.items), [inventory.result.items]);
  const filteredEntries = useMemo(
    () => entries.filter((entry) => matchesDirectoryFilter(entry, filter, query)),
    [entries, filter, query],
  );
  const selectedEntry = entries.find((entry) => entryKey(entry) === selectedKey) ?? null;

  if (inventory.status === 'loading') {
    return (
      <section aria-labelledby="curated-directory-heading" className="rounded-xl border border-border bg-card p-4">
        <h2 id="curated-directory-heading" className="text-lg font-semibold">Discover curated extensions</h2>
        <div className="mt-4"><TabLoading label="Loading curated extensions" /></div>
      </section>
    );
  }

  if (inventory.status === 'error') {
    return (
      <section aria-labelledby="curated-directory-heading" className="rounded-xl border border-border bg-card p-4">
        <h2 id="curated-directory-heading" className="text-lg font-semibold">Discover curated extensions</h2>
        <div className="mt-4 flex flex-col gap-3">
          <TabError message="Could not discover curated extensions. Try again." />
          <div><Button variant="outline" size="sm" onClick={inventory.reload}>Retry discovery</Button></div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="curated-directory-heading" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-2.5 text-primary">
              <Compass size={20} aria-hidden />
            </div>
            <div>
              <h2 id="curated-directory-heading" className="text-lg font-semibold">Discover curated extensions</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Browse Chamber-curated options from enrolled sources. Installed capabilities stay above.
              </p>
            </div>
          </div>
          <Badge variant="outline">{entries.length} discoverable</Badge>
        </div>

        <div className="flex flex-col gap-3 border-y border-border py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block min-w-0 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <span className="sr-only">Search curated extensions</span>
            <input
              type="search"
              role="searchbox"
              aria-label="Search curated extensions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search curated extensions"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div aria-label="Curated extension categories" className="flex w-fit rounded-lg border border-border bg-card/60 p-1">
            {FILTERS.map((option) => {
              const count = entries.filter((entry) => option.value === 'all' || entry.item.ref.kind === option.value).length;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  aria-label={`${option.label} ${count}`}
                  onClick={() => setFilter(option.value)}
                  className="rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-secondary aria-pressed:text-foreground"
                >
                  {option.label} {count}
                </button>
              );
            })}
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <TabEmptyState
            icon={<Compass size={22} />}
            title={entries.length === 0 ? 'No curated extensions available' : 'No curated extensions match'}
            detail={entries.length === 0
              ? 'Enroll a supported source in Settings to discover its safe metadata here.'
              : 'Try a different search or category.'}
          />
        ) : (
          <ul className="grid gap-3">
            {filteredEntries.map((entry) => (
              <li key={entryKey(entry)} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-background p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{safeText(entry.item.displayName, 'Curated extension')}</h3>
                    <Badge variant="outline">{entry.item.ref.kind === 'skill' ? 'Skill' : 'Tool'}</Badge>
                    <Badge variant="outline">{scopeLabel(entry.item)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{entry.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Source: Enrolled source</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-expanded={selectedKey === entryKey(entry)}
                  onClick={() => {
                    const nextKey = selectedKey === entryKey(entry) ? null : entryKey(entry);
                    setSelectedKey(nextKey);
                    setPreflightVisible(false);
                  }}
                >
                  {selectedKey === entryKey(entry) ? 'Hide details' : `View details for ${displayName(entry.item)}`}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {selectedEntry ? (
          <CuratedDetail
            entry={selectedEntry}
            preflightVisible={preflightVisible}
            onTogglePreflight={() => setPreflightVisible((visible) => !visible)}
            onManageTools={onManageTools}
          />
        ) : null}
      </div>
    </section>
  );
}

function CuratedDetail({
  entry,
  preflightVisible,
  onTogglePreflight,
  onManageTools,
}: {
  readonly entry: CuratedEntry;
  readonly preflightVisible: boolean;
  readonly onTogglePreflight: () => void;
  readonly onManageTools: () => void;
}) {
  const item = entry.item;
  return (
    <article aria-label={`${displayName(item)} details`} className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{displayName(item)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{entry.summary}</p>
        </div>
        <Badge variant={item.compatibility.status === 'incompatible' ? 'destructive' : 'outline'}>
          {compatibilityLabel(item.compatibility.status)}
        </Badge>
      </div>

      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <DetailList title="Provenance" values={['Enrolled source']} />
        <DetailList title="Declared capabilities" values={entry.declaredCapabilities} emptyLabel="No declared capabilities" />
        <DetailList title="Requirements" values={entry.requirementStates} emptyLabel="No declared requirements" />
        <DetailList title="Illustrative use cases" values={entry.useCases} />
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={preflightVisible}
          onClick={onTogglePreflight}
        >
          {preflightVisible ? 'Hide install preflight' : 'Review install preflight'}
        </Button>
        {preflightVisible ? (
          <InstallPreflight entry={entry} onManageTools={onManageTools} />
        ) : null}
      </div>
    </article>
  );
}

function InstallPreflight({ entry, onManageTools }: { readonly entry: CuratedEntry; readonly onManageTools: () => void }) {
  if (entry.installPath === 'unavailable') {
    return (
      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <p className="font-medium">Installation unavailable from this directory.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Chamber has no established, safe installation flow for this source. No configuration will be changed.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <p role="status" className="font-medium">Preflight ready</p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <DetailList title="Target scope" values={['Global workspace']} />
        <DetailList title="Declared result" values={['Registers this tool as installed in the global workspace.']} />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Continue in Tools management to use the existing source-specific installation flow.
      </p>
      <Button className="mt-3" size="sm" onClick={onManageTools}>Open tools management</Button>
    </div>
  );
}

function DetailList({ title, values, emptyLabel }: { readonly title: string; readonly values: readonly string[]; readonly emptyLabel?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</dt>
      <dd className="mt-1">{values.length > 0 ? values.join(', ') : emptyLabel}</dd>
    </div>
  );
}

function curateEntries(items: readonly CapabilityInventoryItem[]): CuratedEntry[] {
  return items
    .filter((item) =>
      item.lifecycle.installation === 'available'
      && item.lifecycle.availability === 'available'
      && item.provenance.kind === 'marketplace'
      && (item.ref.kind === 'skill' || item.ref.kind === 'cli-tool'),
    )
    .map((item) => ({
      item,
      summary: summaryFor(item.ref.kind),
      useCases: item.ref.kind === 'skill'
        ? ['Guide a mind through a focused recurring task.', 'Add a reusable workflow to the active mind.']
        : ['Support a repeatable workspace task.', 'Make a source-defined tool available to every mind.'],
      declaredCapabilities: item.declaredCapabilities.flatMap((capability) => {
        const id = safeCapabilityId(capability.id);
        return id ? [id] : [];
      }),
      requirementStates: item.requirements.map((requirement, index) => `Requirement ${index + 1}: ${capitalize(requirement.status)}`),
      installPath: item.ref.kind === 'cli-tool' && item.ref.scope.kind === 'global'
        ? 'tools-management' as const
        : 'unavailable' as const,
    }))
    .sort((left, right) => left.item.displayName.localeCompare(right.item.displayName));
}

function matchesDirectoryFilter(entry: CuratedEntry, filter: DirectoryFilter, query: string): boolean {
  if (filter !== 'all' && entry.item.ref.kind !== filter) return false;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return [
    displayName(entry.item),
    entry.summary,
    ...entry.declaredCapabilities,
  ].some((value) => safeText(value, '').toLocaleLowerCase().includes(normalizedQuery));
}

function entryKey(entry: CuratedEntry): string {
  const scope = entry.item.ref.scope.kind === 'mind' ? entry.item.ref.scope.mindId : 'global';
  return `${entry.item.ref.kind}:${scope}:${entry.item.ref.id}`;
}

function scopeLabel(item: CapabilityInventoryItem): string {
  return item.ref.scope.kind === 'global' ? 'Global' : 'Mind scoped';
}

function compatibilityLabel(status: CapabilityInventoryItem['compatibility']['status']): string {
  return status === 'compatible' ? 'Compatible' : status === 'incompatible' ? 'Incompatible' : 'Compatibility unknown';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function summaryFor(kind: CapabilityInventoryItem['ref']['kind']): string {
  return kind === 'skill'
    ? 'A curated reusable workflow for an active mind.'
    : 'A curated source-defined tool for the global workspace.';
}

function displayName(item: CapabilityInventoryItem): string {
  return safeText(item.displayName, 'Curated extension');
}

function safeCapabilityId(value: string): string | null {
  return /^[a-z][a-z0-9-]{0,63}$/.test(value) ? value : null;
}

function safeText(value: string | undefined, fallback: string): string {
  if (!value || value.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9 .,'()&+_-]*$/.test(value)
    || /authorization|token|secret|password|header|command|args|environment|\benv\b/i.test(value)) {
    return fallback;
  }
  return value;
}
