import type {
  CapabilityCompatibility,
  CapabilityDeclaration,
  CapabilityHealth,
  CapabilityInventoryItem,
  CapabilityInventoryQuery,
  CapabilityInventoryResult,
  CapabilityInventorySourceStatus,
  CapabilityLifecycle,
  CapabilityProvenance,
  LensViewManifest,
  MarketplaceSkillSourceStatus,
  Prompt,
  SkillDetail,
  ToolCatalogEntry,
} from '@chamber/shared';
import type { MarketplaceSkillCatalogResult } from '../skills';
import type { McpServerSummary } from '../mind/mcpServerStore';

const GLOBAL_SCOPE = { kind: 'global' } as const;
const COMPATIBLE: CapabilityCompatibility = { status: 'compatible' };
const HEALTHY: CapabilityHealth = { status: 'healthy' };
const INSTALLED_ENABLED: CapabilityLifecycle = {
  installation: 'installed',
  activation: 'enabled',
  availability: 'available',
};
const AVAILABLE_DISABLED: CapabilityLifecycle = {
  installation: 'available',
  activation: 'disabled',
  availability: 'available',
};

export interface CapabilityInventoryDependencies {
  readonly listSkills: (mindPath: string) => Promise<SkillDetail[]>;
  readonly listMarketplaceSkills: () => Promise<MarketplaceSkillCatalogResult>;
  readonly listMcpServers: (mindPath: string) => readonly McpServerSummary[];
  readonly listTools: () => Promise<ToolCatalogEntry[]>;
  readonly listPrompts: () => readonly Prompt[];
  readonly listLensViews: (mindPath: string) => readonly LensViewManifest[];
  readonly isLensViewEnabled: (mindId: string, viewId: string) => boolean;
}

/**
 * Projects existing capability owners into a display-safe, read-only inventory.
 * It does not install, run, save, or expose source configuration for any item.
 */
export class CapabilityInventoryService {
  constructor(private readonly dependencies: CapabilityInventoryDependencies) {}

  async list(query: CapabilityInventoryQuery = {}, mindPath?: string): Promise<CapabilityInventoryResult> {
    const availability = query.availability ?? 'all';
    const global = await this.listGlobal();
    const mind = query.mindId && mindPath
      ? await this.listMind(query.mindId, mindPath)
      : { items: [], sources: [] };
    const items = [...global.items, ...mind.items]
      .filter((item) => matchesAvailability(item, availability))
      .sort(compareItems);
    return {
      items,
      sources: [...global.sources, ...mind.sources].sort((left, right) => left.label.localeCompare(right.label)),
    };
  }

  private async listGlobal(): Promise<CapabilityInventoryResult> {
    const items: CapabilityInventoryItem[] = [];
    const sources: CapabilityInventorySourceStatus[] = [];

    try {
      items.push(...this.dependencies.listPrompts().map(toPromptItem));
    } catch {
      sources.push(sourceFailure('prompt-library', 'Prompt library'));
    }

    try {
      items.push(...(await this.dependencies.listTools()).map(toToolItem));
    } catch {
      sources.push(sourceFailure('cli-tools', 'CLI tools'));
    }

    return { items, sources };
  }

  private async listMind(mindId: string, mindPath: string): Promise<CapabilityInventoryResult> {
    const items: CapabilityInventoryItem[] = [];
    const sources: CapabilityInventorySourceStatus[] = [];
    let installedSkillIds = new Set<string>();

    try {
      const skills = await this.dependencies.listSkills(mindPath);
      installedSkillIds = new Set(skills.map((skill) => skill.id));
      items.push(...skills.map((skill) => toSkillItem(mindId, skill)));
    } catch {
      sources.push(sourceFailure(`mind:${mindId}:skills`, 'Installed skills'));
    }

    try {
      items.push(...this.dependencies.listMcpServers(mindPath).map((server) => toMcpItem(mindId, server)));
    } catch {
      sources.push(sourceFailure(`mind:${mindId}:mcp`, 'MCP connectors'));
    }

    try {
      items.push(...this.dependencies.listLensViews(mindPath).map((view) =>
        toLensItem(mindId, view, this.dependencies.isLensViewEnabled(mindId, view.id)),
      ));
    } catch {
      sources.push(sourceFailure(`mind:${mindId}:lens`, 'Lens views'));
    }

    try {
      const marketplace = await this.dependencies.listMarketplaceSkills();
      items.push(...marketplace.skills
        .filter((skill) => !installedSkillIds.has(skill.id))
        .map((skill) => ({
          ref: { kind: 'skill' as const, id: skill.id, scope: { kind: 'mind' as const, mindId } },
          displayName: skill.displayName,
          description: skill.description,
          ...(skill.version ? { version: skill.version } : {}),
          provenance: marketplaceProvenance(skill.source),
          lifecycle: AVAILABLE_DISABLED,
          requirements: skill.requiredFiles.length === 0
            ? []
            : [{ label: 'Required skill files', status: 'unknown' as const }],
          compatibility: { status: 'unknown' as const },
          declaredCapabilities: toDeclarations(skill.capabilities),
          health: { status: 'unknown' as const },
        })));
      sources.push(...marketplace.sources.map(toMarketplaceSourceStatus));
    } catch {
      sources.push(sourceFailure('marketplace-skills', 'Marketplace skills'));
    }

    return { items, sources };
  }
}

function toPromptItem(prompt: Prompt): CapabilityInventoryItem {
  return {
    ref: { kind: 'prompt', id: prompt.id, scope: GLOBAL_SCOPE },
    displayName: prompt.title,
    ...(prompt.description ? { description: prompt.description } : {}),
    provenance: { kind: 'user', label: 'This device' },
    lifecycle: INSTALLED_ENABLED,
    requirements: [],
    compatibility: COMPATIBLE,
    declaredCapabilities: [],
    health: HEALTHY,
  };
}

function toToolItem(tool: ToolCatalogEntry): CapabilityInventoryItem {
  const installed = tool.status === 'installed';
  return {
    ref: { kind: 'cli-tool', id: `${tool.source.marketplaceId}:${tool.id}`, scope: GLOBAL_SCOPE },
    displayName: tool.displayName,
    description: tool.description,
    ...(tool.installedVersion ? { version: tool.installedVersion } : {}),
    provenance: marketplaceProvenance(tool.source),
    lifecycle: installed ? INSTALLED_ENABLED : AVAILABLE_DISABLED,
    requirements: [],
    compatibility: tool.status === 'error' ? { status: 'unknown', code: 'catalog-error' } : COMPATIBLE,
    declaredCapabilities: [],
    health: tool.status === 'error' ? { status: 'error', code: 'catalog-error' } : HEALTHY,
  };
}

function toSkillItem(mindId: string, skill: SkillDetail): CapabilityInventoryItem {
  const unmet = skill.requiredFiles.some((file) => file.status !== 'present');
  const invalid = skill.validationErrors.length > 0;
  return {
    ref: { kind: 'skill', id: skill.id, scope: { kind: 'mind', mindId } },
    displayName: skill.name,
    ...(skill.description ? { description: skill.description } : {}),
    ...(skill.version ? { version: skill.version } : {}),
    provenance: skill.managed?.source
      ? marketplaceProvenance(skill.managed.source)
      : skill.isCore
        ? { kind: 'built-in', label: 'Chamber' }
        : { kind: 'local', label: 'Mind local files' },
    lifecycle: INSTALLED_ENABLED,
    requirements: skill.requiredFiles.length === 0
      ? []
      : [{ label: 'Required skill files', status: unmet ? 'unmet' : 'met' }],
    compatibility: invalid ? { status: 'unknown', code: 'validation-required' } : COMPATIBLE,
    declaredCapabilities: toDeclarations(skill.capabilities),
    health: invalid
      ? { status: 'error', code: 'skill-validation' }
      : unmet
        ? { status: 'degraded', code: 'required-files' }
        : HEALTHY,
  };
}

function toMcpItem(mindId: string, server: McpServerSummary): CapabilityInventoryItem {
  return {
    ref: { kind: 'mcp-connector', id: server.name, scope: { kind: 'mind', mindId } },
    displayName: server.name,
    description: server.transport === 'stdio' ? 'Local stdio connector' : 'Remote HTTP connector',
    provenance: { kind: 'local', label: 'Mind MCP configuration' },
    lifecycle: INSTALLED_ENABLED,
    requirements: [],
    compatibility: COMPATIBLE,
    declaredCapabilities: [],
    health: HEALTHY,
  };
}

function toLensItem(mindId: string, view: LensViewManifest, enabled: boolean): CapabilityInventoryItem {
  return {
    ref: { kind: 'lens-view', id: view.id, scope: { kind: 'mind', mindId } },
    displayName: view.name,
    ...(view.description ? { description: view.description } : {}),
    provenance: { kind: 'local', label: 'Mind Lens directory' },
    lifecycle: {
      installation: 'installed',
      activation: enabled ? 'enabled' : 'disabled',
      availability: 'available',
    },
    requirements: [],
    compatibility: COMPATIBLE,
    declaredCapabilities: [{ id: view.view, label: 'Lens view type' }],
    health: HEALTHY,
  };
}

function marketplaceProvenance(source: {
  marketplaceId: string;
  marketplaceLabel: string;
  marketplaceUrl: string;
}): CapabilityProvenance {
  return {
    kind: 'marketplace',
    label: source.marketplaceLabel,
    marketplace: {
      id: source.marketplaceId,
      label: source.marketplaceLabel,
      url: source.marketplaceUrl,
    },
  };
}

function toDeclarations(capabilities: readonly string[]): CapabilityDeclaration[] {
  return capabilities.map((id) => ({ id }));
}

function toMarketplaceSourceStatus(source: MarketplaceSkillSourceStatus): CapabilityInventorySourceStatus {
  return {
    id: source.id,
    label: source.label,
    status: source.status === 'ok' ? 'healthy' : source.status,
    capabilityCount: source.skillCount,
  };
}

function sourceFailure(id: string, label: string): CapabilityInventorySourceStatus {
  return { id, label, status: 'error' };
}

function matchesAvailability(item: CapabilityInventoryItem, availability: NonNullable<CapabilityInventoryQuery['availability']>): boolean {
  return availability === 'all' || item.lifecycle.installation === availability;
}

function compareItems(left: CapabilityInventoryItem, right: CapabilityInventoryItem): number {
  return left.ref.kind.localeCompare(right.ref.kind)
    || left.displayName.localeCompare(right.displayName)
    || left.ref.id.localeCompare(right.ref.id);
}
