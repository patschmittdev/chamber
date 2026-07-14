import type { AppConfig, InstalledTool, MarketplaceToolEntry, ToolActionResult, ToolCatalogEntry } from '@chamber/shared/types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { Logger } from '../logger';
import { MarketplaceToolCatalog } from './MarketplaceToolCatalog';
import { ToolInstaller } from './ToolInstaller';

const log = Logger.create('ToolsService');

export interface ToolInventoryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly marketplaceId: string;
  readonly marketplaceLabel: string;
  readonly status: 'installed' | 'available';
  readonly installedVersion?: string;
}

export interface ToolInventorySourceStatus {
  readonly id: string;
  readonly label: string;
  readonly status: 'healthy' | 'disabled' | 'error';
  readonly capabilityCount?: number;
}

export interface ToolInventoryResult {
  readonly tools: readonly ToolInventoryEntry[];
  readonly sources: readonly ToolInventorySourceStatus[];
}

interface ConfigStore {
  load(): AppConfig;
  save(config: AppConfig): void;
}

/**
 * Orchestrates the marketplace-tool lifecycle: list (catalog ∪ installed),
 * install (npm i -g + persist), uninstall (npm uninstall -g + persist), and
 * startup reconciliation (install everything new since last run).
 */
export class ToolsService {
  constructor(
    private readonly catalog: MarketplaceToolCatalog,
    private readonly installer: ToolInstaller,
    private readonly configStore: ConfigStore,
  ) {}

  async list(): Promise<ToolCatalogEntry[]> {
    const installed = this.getInstalled();
    const installedById = new Map(installed.map((tool) => [tool.id, tool]));
    const result = await this.catalog.listTools();
    const catalogEntries: ToolCatalogEntry[] = result.tools.map((tool) => {
      const persisted = installedById.get(tool.id);
      return {
        ...tool,
        status: persisted ? 'installed' : 'available',
        ...(persisted ? { installedVersion: persisted.version } : {}),
      };
    });
    return catalogEntries;
  }

  /**
   * Projects persisted tools and marketplace catalog state without installation
   * details or catalog failure messages.
   */
  async listInventory(): Promise<ToolInventoryResult> {
    const installed = this.getInstalled();
    const installedByKey = new Map(installed.map((tool) => [toolInventoryKey(tool.id, tool.source.marketplaceId), tool]));
    const result = await this.catalog.listTools();
    const catalogKeys = new Set<string>();
    const tools = result.tools.map((tool) => {
      const key = toolInventoryKey(tool.id, tool.source.marketplaceId);
      catalogKeys.add(key);
      const persisted = installedByKey.get(key);
      return {
        id: tool.id,
        displayName: tool.displayName,
        description: tool.description,
        marketplaceId: tool.source.marketplaceId,
        marketplaceLabel: tool.source.marketplaceLabel,
        status: persisted ? 'installed' as const : 'available' as const,
        ...(persisted ? { installedVersion: persisted.version } : {}),
      };
    });
    tools.push(...installed
      .filter((tool) => !catalogKeys.has(toolInventoryKey(tool.id, tool.source.marketplaceId)))
      .map((tool) => ({
        id: tool.id,
        displayName: tool.displayName,
        description: tool.description,
        marketplaceId: tool.source.marketplaceId,
        marketplaceLabel: tool.source.marketplaceId,
        status: 'installed' as const,
        installedVersion: tool.version,
      })));

    return {
      tools,
      sources: result.sources.map((source) => ({
        id: source.id,
        label: source.label,
        status: source.status,
        ...(source.toolCount === undefined ? {} : { capabilityCount: source.toolCount }),
      })),
    };
  }

  async install(toolId: string, marketplaceId?: string): Promise<ToolActionResult> {
    const result = await this.catalog.listTools();
    const tool = result.tools.find((entry) =>
      entry.id === toolId
      && (!marketplaceId || entry.source.marketplaceId === marketplaceId),
    );
    if (!tool) {
      return { success: false, error: `Tool not found in marketplace: ${toolId}` };
    }
    return this.installEntry(tool);
  }

  async uninstall(toolId: string): Promise<{ success: boolean; error?: string }> {
    const installed = this.getInstalled();
    const tool = installed.find((entry) => entry.id === toolId);
    if (!tool) {
      return { success: false, error: `Tool not installed: ${toolId}` };
    }
    try {
      await this.installer.uninstall(tool);
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
    this.persist(installed.filter((entry) => entry.id !== toolId));
    return { success: true };
  }

  /**
   * Install any marketplace tools that are not already in installedTools[].
   * Errors on individual tools are logged and skipped — other tools still install.
   */
  async reconcile(): Promise<{ installed: InstalledTool[]; errors: Array<{ toolId: string; message: string }> }> {
    const result = await this.catalog.listTools();
    const installed = this.getInstalled();
    const installedById = new Map(installed.map((tool) => [tool.id, tool]));
    const newTools = result.tools.filter((tool) => {
      const persisted = installedById.get(tool.id);
      return !persisted || persisted.version !== marketplaceToolVersion(tool);
    });

    const newlyInstalled: InstalledTool[] = [];
    const errors: Array<{ toolId: string; message: string }> = [];

    for (const tool of newTools) {
      const outcome = await this.installEntry(tool);
      if (outcome.success) {
        newlyInstalled.push(outcome.tool);
      } else {
        log.warn(`Reconcile failed for tool ${tool.id}: ${outcome.error}`);
        errors.push({ toolId: tool.id, message: outcome.error });
      }
    }

    function marketplaceToolVersion(tool: MarketplaceToolEntry): string {
      return tool.install.type === 'npm-global' ? tool.install.version : tool.install.tag;
    }

    return { installed: newlyInstalled, errors };
  }

  private async installEntry(tool: MarketplaceToolEntry): Promise<ToolActionResult> {
    try {
      const installed = await this.installer.install(tool);
      const current = this.getInstalled();
      const next = [...current.filter((entry) => entry.id !== installed.id), installed];
      this.persist(next);
      return { success: true, tool: installed };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  private getInstalled(): InstalledTool[] {
    return this.configStore.load().installedTools ?? [];
  }

  private persist(tools: InstalledTool[]): void {
    const config = this.configStore.load();
    this.configStore.save({ ...config, installedTools: tools });
  }
}

function toolInventoryKey(id: string, marketplaceId: string): string {
  return `${marketplaceId}\u0000${id}`;
}
