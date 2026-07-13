import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type {
  MarketplaceTemplateEntry,
  SkillDetail,
  SkillManifest,
  SkillMarketplaceBrowseResult,
  SkillSaveResult,
  SkillSource,
} from '@chamber/shared';
import type {
  GenesisMindTemplateMarketplaceResult,
  MarketplaceSkillCatalogResult,
} from '@chamber/services';

const mindIdSchema = z.string().min(1, 'must be a non-empty string');
const skillIdSchema = z.string().min(1, 'must be a non-empty string');
const saveRequestSchema = z.object({
  mindId: z.string().min(1, 'must be a non-empty string'),
  id: z.string().min(1, 'must be a non-empty string'),
  content: z.string(),
  expectedMtimeMs: z.number().nullable(),
});

export interface SkillsIpcMindProvider {
  getMindPath(mindId: string): string | undefined;
}

export interface MindSkillDiscoveryPort {
  list(mindPath: string): Promise<SkillManifest[]>;
  listDetails(mindPath: string): Promise<SkillDetail[]>;
}

export interface MindSkillAuthoringPort {
  readSource(mindPath: string, id: string): Promise<SkillSource>;
  save(
    mindPath: string,
    request: { id: string; content: string; expectedMtimeMs: number | null },
  ): Promise<SkillSaveResult>;
}

export interface MarketplaceSkillCatalogPort {
  listSkills(): Promise<MarketplaceSkillCatalogResult>;
}

export interface GenesisMindTemplateMarketplaceCatalogPort {
  listTemplates(): Promise<GenesisMindTemplateMarketplaceResult>;
}

export function setupSkillsIPC(
  mindProvider: SkillsIpcMindProvider,
  discovery: MindSkillDiscoveryPort,
  authoring: MindSkillAuthoringPort,
  marketplaceSkillCatalog?: MarketplaceSkillCatalogPort,
  templateCatalog?: GenesisMindTemplateMarketplaceCatalogPort,
): void {
  ipcMain.handle(IPC.SKILLS.LIST_FOR_MIND, async (_event, rawMindId: unknown) => {
    const mindId = parseIpcArgs(IPC.SKILLS.LIST_FOR_MIND, mindIdSchema, rawMindId);
    const mindPath = mindProvider.getMindPath(mindId);
    if (!mindPath) return [];
    return discovery.list(mindPath);
  });

  ipcMain.handle(IPC.SKILLS.LIST_FOR_MIND_DETAILS, async (_event, rawMindId: unknown) => {
    const mindId = parseIpcArgs(IPC.SKILLS.LIST_FOR_MIND_DETAILS, mindIdSchema, rawMindId);
    const mindPath = mindProvider.getMindPath(mindId);
    if (!mindPath) return [];
    return discovery.listDetails(mindPath);
  });

  ipcMain.handle(IPC.SKILLS.GET_SOURCE, async (_event, rawMindId: unknown, rawId: unknown) => {
    const [mindId, id] = parseIpcArgs(
      IPC.SKILLS.GET_SOURCE,
      z.tuple([mindIdSchema, skillIdSchema]),
      [rawMindId, rawId],
    );
    const mindPath = mindProvider.getMindPath(mindId);
    if (!mindPath) throw new Error(`Mind ${mindId} not found`);
    return authoring.readSource(mindPath, id);
  });

  ipcMain.handle(IPC.SKILLS.SAVE, async (_event, rawRequest: unknown) => {
    const request = parseIpcArgs(IPC.SKILLS.SAVE, saveRequestSchema, rawRequest);
    const mindPath = mindProvider.getMindPath(request.mindId);
    if (!mindPath) return { success: false, error: `Mind ${request.mindId} not found` };
    return authoring.save(mindPath, {
      id: request.id,
      content: request.content,
      expectedMtimeMs: request.expectedMtimeMs,
    });
  });

  ipcMain.handle(IPC.SKILLS.BROWSE_MARKETPLACE, async () => {
    const [skillResult, templateResult] = await Promise.all([
      marketplaceSkillCatalog?.listSkills() ?? emptySkillCatalogResult(),
      templateCatalog?.listTemplates() ?? emptyTemplateCatalogResult(),
    ]);
    return buildMarketplaceBrowseResult(skillResult, templateResult);
  });
}

function emptySkillCatalogResult(): MarketplaceSkillCatalogResult {
  return { skills: [], malformedEntries: [], sources: [], errors: [] };
}

function emptyTemplateCatalogResult(): GenesisMindTemplateMarketplaceResult {
  return { templates: [], sources: [] };
}

function buildMarketplaceBrowseResult(
  skillResult: MarketplaceSkillCatalogResult,
  templateResult: GenesisMindTemplateMarketplaceResult,
): SkillMarketplaceBrowseResult {
  return {
    skills: skillResult.skills,
    malformedSkills: skillResult.malformedEntries,
    skillSources: skillResult.sources,
    templates: templateResult.templates.map(toMarketplaceTemplateEntry),
    templateSources: templateResult.sources.map((source) => ({
      id: source.id,
      label: source.label,
      url: source.url,
      status: source.status,
      templateCount: source.templateCount,
      ...(source.message ? { message: source.message } : {}),
    })),
  };
}

function toMarketplaceTemplateEntry(
  template: GenesisMindTemplateMarketplaceResult['templates'][number],
): MarketplaceTemplateEntry {
  return {
    id: template.id,
    displayName: template.displayName,
    description: template.description,
    role: template.role,
    voice: template.voice,
    templateVersion: template.templateVersion,
    agent: template.agent,
    requiredFiles: template.requiredFiles,
    source: {
      owner: template.source.owner,
      repo: template.source.repo,
      ref: template.source.ref,
      plugin: template.source.plugin,
      marketplaceId: template.source.marketplaceId ?? `github:${template.source.owner}/${template.source.repo}`,
      marketplaceLabel: template.source.marketplaceLabel ?? `${template.source.owner}/${template.source.repo}`,
      marketplaceUrl: template.source.marketplaceUrl ?? `https://github.com/${template.source.owner}/${template.source.repo}`,
      manifestPath: template.source.manifestPath,
      rootPath: template.source.rootPath,
    },
  };
}
