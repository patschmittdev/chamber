import type {
  AppConfig,
  InstalledTool,
  MarketplaceToolEntry,
  ToolActionResult,
  ToolCatalogEntry,
  ToolOperationEntry,
  ToolOperationListResult,
  ToolOperationResult,
} from '@chamber/shared/types';
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
  readonly updateAvailable: boolean;
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
  private operationQueue = Promise.resolve();

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
        updateAvailable: persisted ? isUpdateAvailable(persisted, tool) : false,
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
        updateAvailable: false,
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

  /** Returns only marketplace and lifecycle metadata required by the operator UI. */
  async listOperations(): Promise<ToolOperationListResult> {
    const inventory = await this.listInventory();
    const toolsById = new Map<string, ToolInventoryEntry>();
    for (const tool of inventory.tools) {
      const current = toolsById.get(tool.id);
      if (!current || (tool.status === 'installed' && current.status !== 'installed')) {
        toolsById.set(tool.id, tool);
      }
    }
    return {
      tools: [...toolsById.values()].map((tool): ToolOperationEntry => ({
        id: tool.id,
        displayName: tool.displayName,
        description: tool.description,
        marketplaceId: tool.marketplaceId,
        marketplaceLabel: tool.marketplaceLabel,
        installation: tool.status,
        updateAvailable: tool.updateAvailable,
      })),
      sources: inventory.sources,
    };
  }

  async installForOperator(toolId: string, marketplaceId: string): Promise<ToolOperationResult> {
    return this.serializeOperation(async () => {
      try {
        const existing = this.getInstalled().find((entry) => entry.id === toolId);
        if (existing && existing.source.marketplaceId !== marketplaceId) {
          return { status: 'not-available', action: 'install' };
        }
        const tool = await this.findCatalogTool(toolId, marketplaceId);
        if (!tool) return { status: 'not-available', action: 'install' };
        return this.installForOperatorResult(tool, 'install');
      } catch {
        log.warn(`Marketplace tool install lookup failed for ${toolId}.`);
        return { status: 'failed', action: 'install' };
      }
    });
  }

  async updateForOperator(toolId: string, marketplaceId: string): Promise<ToolOperationResult> {
    return this.serializeOperation(async () => {
      const installed = this.getInstalled().find((tool) =>
        tool.id === toolId && tool.source.marketplaceId === marketplaceId,
      );
      if (!installed) return { status: 'not-installed', action: 'update' };
      try {
        const tool = await this.findCatalogTool(toolId, marketplaceId);
        if (!tool) return { status: 'not-available', action: 'update' };
        if (!isUpdateAvailable(installed, tool)) return { status: 'already-current', action: 'update' };
        return this.installForOperatorResult(tool, 'update');
      } catch {
        log.warn(`Marketplace tool update lookup failed for ${toolId}.`);
        return { status: 'failed', action: 'update' };
      }
    });
  }

  async removeForOperator(toolId: string, marketplaceId: string): Promise<ToolOperationResult> {
    return this.serializeOperation(async () => {
      const installed = this.getInstalled();
      const tool = installed.find((entry) => entry.id === toolId && entry.source.marketplaceId === marketplaceId);
      if (!tool) return { status: 'not-installed', action: 'remove' };
      if (installed.some((entry) => entry.id === toolId && entry !== tool)) {
        log.warn(`Marketplace tool removal requires a single source record for ${tool.id}.`);
        return { status: 'failed', action: 'remove' };
      }
      try {
        await this.installer.uninstall(tool);
        this.persist(installed.filter((entry) => entry !== tool));
        return { status: 'completed', action: 'remove' };
      } catch {
        log.warn(`Marketplace tool removal failed for ${tool.id}.`);
        return { status: 'failed', action: 'remove' };
      }
    });
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

  private async findCatalogTool(toolId: string, marketplaceId: string): Promise<MarketplaceToolEntry | undefined> {
    const result = await this.catalog.listTools();
    return result.tools.find((entry) =>
      entry.id === toolId && entry.source.marketplaceId === marketplaceId,
    );
  }

  private async serializeOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async installForOperatorResult(
    tool: MarketplaceToolEntry,
    action: 'install' | 'update',
  ): Promise<ToolOperationResult> {
    try {
      const installed = await this.installer.install(tool);
      const current = this.getInstalled();
      this.persist([...current.filter((entry) => entry.id !== installed.id), installed]);
      return { status: 'completed', action };
    } catch {
      log.warn(`Marketplace tool ${action} failed for ${tool.id}.`);
      return { status: 'failed', action };
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

function isUpdateAvailable(installed: InstalledTool, candidate: MarketplaceToolEntry): boolean {
  const candidateVersion = candidate.install.type === 'npm-global'
    ? candidate.install.version
    : candidate.install.tag;
  return installed.version !== candidateVersion;
}
