import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CapabilityHealth,
  CapabilityInventoryItem,
  CapabilityInventoryResult,
  CapabilityInventorySourceStatus,
  CapabilityKind,
  CapabilityLifecycle,
  CapabilityProvenance,
  CapabilityRequirement,
  CapabilityScope,
} from '@chamber/shared';
import { AlertTriangle, Blocks, FileText, Layout, PlugZap, Sparkles } from 'lucide-react';
import type { ExtensionsTab } from '../../lib/store/state';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { TabsList, TabsTrigger } from '../ui/tabs';
import { TabEmptyState, TabError, TabLoading } from './extensionsShared';

type InventoryStatus = 'loading' | 'ready' | 'error';
type AvailabilityFilter = 'all' | 'installed' | 'available';

export interface ExtensionCategory {
  readonly tab: ExtensionsTab;
  readonly kind: CapabilityKind;
  readonly label: string;
  readonly plural: string;
  readonly icon: typeof Sparkles;
}

export const EXTENSION_CATEGORIES: readonly ExtensionCategory[] = [
  { tab: 'skills', kind: 'skill', label: 'Skills', plural: 'skills', icon: Sparkles },
  { tab: 'mcp', kind: 'mcp-connector', label: 'Connectors', plural: 'connectors', icon: PlugZap },
  { tab: 'tools', kind: 'cli-tool', label: 'Tools', plural: 'tools', icon: Blocks },
  { tab: 'prompts', kind: 'prompt', label: 'Prompts', plural: 'prompts', icon: FileText },
  { tab: 'lens', kind: 'lens-view', label: 'Lens views', plural: 'Lens views', icon: Layout },
];

export interface CapabilityInventoryState {
  readonly status: InventoryStatus;
  readonly result: CapabilityInventoryResult;
  readonly reload: () => void;
}

export function useCapabilityInventory(activeMindId: string | null): CapabilityInventoryState {
  const [status, setStatus] = useState<InventoryStatus>('loading');
  const [result, setResult] = useState<CapabilityInventoryResult>({ items: [], sources: [] });
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setResult({ items: [], sources: [] });
    void window.electronAPI.capabilities
      .list(activeMindId ? { mindId: activeMindId, availability: 'all' } : { availability: 'all' })
      .then((inventory) => {
        if (cancelled) return;
        setResult(normalizeInventoryResult(inventory));
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ items: [], sources: [] });
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeMindId, reloadNonce]);

  return {
    status,
    result,
    reload: useCallback(() => setReloadNonce((nonce) => nonce + 1), []),
  };
}

export function CapabilityCategoryNavigation({
  items,
}: {
  readonly items: readonly CapabilityInventoryItem[];
}) {
  return (
    <TabsList aria-label="Extension categories" className="h-auto w-full flex-wrap justify-start gap-2 border-0 bg-transparent p-0">
      {EXTENSION_CATEGORIES.map((category) => {
        const count = items.filter((item) => item.ref.kind === category.kind).length;
        const Icon = category.icon;
        return (
          <TabsTrigger
            key={category.tab}
            value={category.tab}
            aria-label={`${category.label} ${count}`}
            className="h-auto border border-border bg-card px-3 py-2 data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10"
          >
            <Icon size={16} aria-hidden />
            <span>{category.label}</span>
            <span className="rounded bg-background/70 px-1.5 py-0.5 text-xs tabular-nums">{count}</span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

export function CapabilityInventoryPanel({
  activeTab,
  inventory,
}: {
  readonly activeTab: ExtensionsTab;
  readonly inventory: CapabilityInventoryState;
}) {
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const category = categoryForTab(activeTab);
  const categoryItems = useMemo(
    () => inventory.result.items.filter((item) => item.ref.kind === category.kind),
    [category.kind, inventory.result.items],
  );
  const installedCount = inventory.result.items.filter((item) => item.lifecycle.installation === 'installed').length;
  const availableCount = inventory.result.items.filter((item) => item.lifecycle.installation === 'available').length;
  const filteredItems = categoryItems.filter((item) =>
    availability === 'all' || item.lifecycle.installation === availability,
  );
  const categoryInstalledCount = categoryItems.filter((item) => item.lifecycle.installation === 'installed').length;
  const categoryAvailableCount = categoryItems.filter((item) => item.lifecycle.installation === 'available').length;
  const Icon = category.icon;

  if (inventory.status === 'loading') {
    return <TabLoading label="Loading installed capabilities" />;
  }

  if (inventory.status === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <TabError message="Could not load installed capabilities. Try again." />
        <div>
          <Button variant="outline" size="sm" onClick={inventory.reload}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">{inventory.result.items.length} capabilities in scope</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span>{installedCount} installed</span>, <span>{availableCount} available</span>
          </p>
        </div>
        <SourceHealth sources={inventory.result.sources} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{category.label}</h2>
          <p className="text-sm text-muted-foreground">
            {categoryInstalledCount} installed, {categoryAvailableCount} available
          </p>
        </div>
        <div aria-label={`${category.label} availability`} className="flex w-fit rounded-lg border border-border bg-card/60 p-1">
          {([
            ['all', 'All', categoryItems.length],
            ['installed', 'Installed', categoryInstalledCount],
            ['available', 'Available', categoryAvailableCount],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={availability === value}
              data-state={availability === value ? 'active' : 'inactive'}
              onClick={() => setAvailability(value)}
              className="rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-secondary data-[state=active]:text-foreground"
            >
              {label} {count}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {filteredItems.length} {availability === 'all' ? 'total' : availability} {pluralize(category.plural, filteredItems.length)}
      </p>

      {filteredItems.length === 0 ? (
        <TabEmptyState
          icon={<Icon size={22} />}
          title={`No ${availability === 'all' ? 'installed' : availability} ${category.plural}`}
          detail={emptyDetail(category, availability)}
        />
      ) : (
        <ul className="grid gap-3">
          {filteredItems.map((item) => <CapabilityCard key={capabilityKey(item)} item={item} />)}
        </ul>
      )}
    </div>
  );
}

export function categoryForTab(tab: ExtensionsTab): ExtensionCategory {
  const category = EXTENSION_CATEGORIES.find((entry) => entry.tab === tab);
  if (!category) {
    throw new Error(`Unknown Extensions category: ${tab}`);
  }
  return category;
}

function CapabilityCard({ item }: { readonly item: CapabilityInventoryItem }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{item.displayName}</h3>
            <Badge variant={item.lifecycle.installation === 'installed' ? 'secondary' : 'outline'}>
              {capitalize(item.lifecycle.installation)}
            </Badge>
            {item.lifecycle.activation !== 'not-applicable' ? (
              <Badge variant={item.lifecycle.activation === 'enabled' ? 'default' : 'outline'}>
                {capitalize(item.lifecycle.activation)}
              </Badge>
            ) : null}
            {item.lifecycle.availability !== 'available' ? (
              <Badge variant="destructive">{capitalize(item.lifecycle.availability)}</Badge>
            ) : null}
            {item.version ? <Badge variant="outline">v{item.version}</Badge> : null}
          </div>
          {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
        </div>
        <Badge variant="outline">{scopeLabel(item.ref.scope)}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Source: {item.provenance.label}</span>
        <span>Health: {capitalize(item.health.status)}</span>
        {item.requirements.map((requirement) => (
          <span key={`${requirement.label}:${requirement.status}`}>
            {requirement.label}: {capitalize(requirement.status)}
          </span>
        ))}
      </div>
    </li>
  );
}

function SourceHealth({ sources }: { readonly sources: readonly CapabilityInventorySourceStatus[] }) {
  if (sources.length === 0) return null;
  const unhealthy = sources.filter((source) => source.status === 'error').length;
  const disabled = sources.filter((source) => source.status === 'disabled').length;
  const label = unhealthy > 0
    ? `${unhealthy} ${pluralize('source', unhealthy)} ${unhealthy === 1 ? 'needs attention' : 'need attention'}`
    : disabled > 0
      ? `${disabled} ${pluralize('source', disabled)} disabled`
      : `${sources.length} healthy ${pluralize('source', sources.length)}`;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {unhealthy > 0 ? <AlertTriangle size={14} className="text-destructive" aria-hidden /> : null}
      <span>{label}</span>
    </div>
  );
}

function emptyDetail(category: ExtensionCategory, availability: AvailabilityFilter): string {
  if (availability === 'all') {
    return `No ${category.plural} are installed for the current scope. Open the management area to use the existing ${category.label.toLowerCase()} actions.`;
  }
  return `No ${availability} ${category.plural} match this filter.`;
}

function pluralize(label: string, count: number): string {
  if (count === 1) return label.endsWith('s') ? label.slice(0, -1) : label;
  return label.endsWith('s') ? label : `${label}s`;
}

function capabilityKey(item: CapabilityInventoryItem): string {
  return `${item.ref.kind}:${item.ref.scope.kind}:${item.ref.scope.kind === 'mind' ? item.ref.scope.mindId : 'global'}:${item.ref.id}`;
}

function scopeLabel(scope: CapabilityScope): string {
  return scope.kind === 'global' ? 'Global' : 'Mind scoped';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeInventoryResult(value: unknown): CapabilityInventoryResult {
  const record = recordValue(value);
  if (!record || !Array.isArray(record.items) || !Array.isArray(record.sources)) {
    throw new Error('Invalid capability inventory response');
  }
  return {
    items: record.items.flatMap((item) => {
      const normalized = normalizeItem(item);
      return normalized ? [normalized] : [];
    }),
    sources: record.sources.flatMap((source) => {
      const normalized = normalizeSource(source);
      return normalized ? [normalized] : [];
    }),
  };
}

function normalizeItem(value: unknown): CapabilityInventoryItem | null {
  const record = recordValue(value);
  if (!record) return null;
  const ref = normalizeRef(record.ref);
  const provenance = normalizeProvenance(record.provenance);
  const lifecycle = normalizeLifecycle(record.lifecycle);
  const health = normalizeHealth(record.health);
  const compatibility = normalizeCompatibility(record.compatibility);
  const displayName = boundedString(record.displayName);
  if (!ref || !provenance || !lifecycle || !health || !compatibility || !displayName) return null;
  const description = optionalBoundedString(record.description);
  const version = optionalBoundedString(record.version);
  return {
    ref,
    displayName,
    ...(description ? { description } : {}),
    ...(version ? { version } : {}),
    provenance,
    lifecycle,
    requirements: Array.isArray(record.requirements)
      ? record.requirements.flatMap((requirement) => {
        const normalized = normalizeRequirement(requirement);
        return normalized ? [normalized] : [];
      })
      : [],
    compatibility,
    declaredCapabilities: Array.isArray(record.declaredCapabilities)
      ? record.declaredCapabilities.flatMap((declaration) => {
        const normalized = normalizeDeclaration(declaration);
        return normalized ? [normalized] : [];
      })
      : [],
    health,
  };
}

function normalizeRef(value: unknown): CapabilityInventoryItem['ref'] | null {
  const record = recordValue(value);
  const scope = record ? normalizeScope(record.scope) : null;
  const kind = record ? enumValue(record.kind, ['skill', 'mcp-connector', 'cli-tool', 'prompt', 'lens-view'] as const) : null;
  const id = record ? boundedString(record.id) : null;
  return scope && kind && id ? { kind, id, scope } : null;
}

function normalizeScope(value: unknown): CapabilityScope | null {
  const record = recordValue(value);
  if (!record) return null;
  if (record.kind === 'global') return { kind: 'global' };
  const mindId = boundedString(record.mindId);
  return record.kind === 'mind' && mindId ? { kind: 'mind', mindId } : null;
}

function normalizeProvenance(value: unknown): CapabilityProvenance | null {
  const record = recordValue(value);
  const kind = record ? enumValue(record.kind, ['built-in', 'local', 'marketplace', 'user'] as const) : null;
  const label = record ? boundedString(record.label) : null;
  return kind && label ? { kind, label } : null;
}

function normalizeLifecycle(value: unknown): CapabilityLifecycle | null {
  const record = recordValue(value);
  if (!record) return null;
  const installation = enumValue(record.installation, ['installed', 'available', 'not-applicable'] as const);
  const activation = enumValue(record.activation, ['enabled', 'disabled', 'not-applicable'] as const);
  const availability = enumValue(record.availability, ['available', 'unavailable', 'error'] as const);
  return installation && activation && availability ? { installation, activation, availability } : null;
}

function normalizeHealth(value: unknown): CapabilityHealth | null {
  const record = recordValue(value);
  const status = record ? enumValue(record.status, ['healthy', 'degraded', 'unknown', 'error'] as const) : null;
  return status ? { status } : null;
}

function normalizeCompatibility(value: unknown): CapabilityInventoryItem['compatibility'] | null {
  const record = recordValue(value);
  const status = record ? enumValue(record.status, ['compatible', 'incompatible', 'unknown'] as const) : null;
  const code = record ? optionalBoundedString(record.code) : undefined;
  return status ? { status, ...(code ? { code } : {}) } : null;
}

function normalizeDeclaration(value: unknown): CapabilityInventoryItem['declaredCapabilities'][number] | null {
  const record = recordValue(value);
  const id = record ? boundedString(record.id) : null;
  const label = record ? optionalBoundedString(record.label) : undefined;
  return id ? { id, ...(label ? { label } : {}) } : null;
}

function normalizeRequirement(value: unknown): CapabilityRequirement | null {
  const record = recordValue(value);
  const label = record ? boundedString(record.label) : null;
  const status = record ? enumValue(record.status, ['met', 'unmet', 'unknown'] as const) : null;
  return label && status ? { label, status } : null;
}

function normalizeSource(value: unknown): CapabilityInventorySourceStatus | null {
  const record = recordValue(value);
  const id = record ? boundedString(record.id) : null;
  const label = record ? boundedString(record.label) : null;
  const status = record ? enumValue(record.status, ['healthy', 'disabled', 'error', 'unknown'] as const) : null;
  return id && label && status ? { id, label, status } : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}

function boundedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_000 ? value : null;
}

function optionalBoundedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_000 ? value : undefined;
}
