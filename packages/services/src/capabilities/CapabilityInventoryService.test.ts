import { describe, expect, it } from 'vitest';
import type {
  LensViewManifest,
  MarketplaceSkillEntry,
  MarketplaceSkillSourceStatus,
  Prompt,
  SkillDetail,
} from '@chamber/shared';
import type { McpServerSummary } from '../mind/mcpServerStore';
import type { ToolInventoryEntry } from '../tools/ToolsService';
import { CapabilityInventoryService, type CapabilityInventoryDependencies } from './CapabilityInventoryService';

describe('CapabilityInventoryService', () => {
  it('projects installed and available capabilities with the correct scopes and lifecycle', async () => {
    const service = createService();

    const result = await service.list({ mindId: 'lucy', availability: 'all' }, 'C:\\minds\\lucy');

    expect(result.items.map((item) => [item.ref.kind, item.ref.id, item.ref.scope.kind])).toEqual([
      ['cli-tool', 'github:example/catalog:tool', 'global'],
      ['lens-view', 'dashboard', 'mind'],
      ['mcp-connector', 'filesystem', 'mind'],
      ['prompt', 'prompt-1', 'global'],
      ['skill', 'available-skill', 'mind'],
      ['skill', 'installed-skill', 'mind'],
    ]);
    expect(result.items.find((item) => item.ref.id === 'available-skill')?.lifecycle).toEqual({
      installation: 'available',
      activation: 'disabled',
      availability: 'available',
    });
    expect(result.items.find((item) => item.ref.id === 'dashboard')?.lifecycle.activation).toBe('disabled');
    expect(result.items.find((item) => item.ref.id === 'installed-skill')?.health).toEqual({
      status: 'degraded',
      code: 'required-files',
    });
    expect(result.sources).toEqual([{
      id: 'github:example/catalog',
      label: 'Example catalog',
      status: 'healthy',
      capabilityCount: 1,
    }]);
  });

  it('filters installed and available records without changing source ownership', async () => {
    const service = createService();

    await expect(service.list({ mindId: 'lucy', availability: 'installed' }, 'C:\\minds\\lucy'))
      .resolves.toMatchObject({
        items: expect.not.arrayContaining([
          expect.objectContaining({ ref: expect.objectContaining({ id: 'available-skill' }) }),
        ]),
      });
    await expect(service.list({ mindId: 'lucy', availability: 'available' }, 'C:\\minds\\lucy'))
      .resolves.toEqual(expect.objectContaining({
        items: [expect.objectContaining({ ref: expect.objectContaining({ id: 'available-skill' }) })],
      }));
  });

  it('does not expose source bodies, paths, credentials, connector configuration, or installers', async () => {
    const service = createService();

    const serialized = JSON.stringify(await service.list({ mindId: 'lucy' }, 'C:\\minds\\lucy'));

    for (const value of [
      'PROMPT_BODY_SECRET',
      'C:\\absolute\\lens\\path',
      'C:\\minds\\lucy\\.github\\skills',
      'Authorization',
      'super-secret-token',
      'https://mcp.example.test/secret',
      '@scope/tool',
      'C:\\tools\\tool.exe',
      'RAW_ERROR_DETAIL',
      'marketplace-secret',
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it('treats discovered skill metadata as local and omits marketplace URLs', async () => {
    const service = new CapabilityInventoryService({
      ...dependencies(),
      listSkills: async () => [{
        ...installedSkill(),
        managed: {
          version: '1.0.0',
          capabilities: [],
          metadataPath: '.github/skills/installed-skill/.chamber-skill.json',
          files: [],
          source: {
            type: 'marketplace',
            marketplaceId: 'untrusted-marketplace',
            marketplaceLabel: 'Untrusted marketplace',
            marketplaceUrl: 'https://catalog-user:marketplace-secret@example.test/catalog?token=secret',
            owner: 'example',
            repo: 'catalog',
            ref: 'main',
            plugin: 'catalog',
            root: 'skills',
          },
        },
      }],
    });

    const result = await service.list({ mindId: 'lucy' }, 'C:\\minds\\lucy');
    const skill = result.items.find((item) => item.ref.id === 'installed-skill');

    expect(skill?.provenance).toEqual({ kind: 'local', label: 'Mind local files' });
    expect(JSON.stringify(result)).not.toContain('marketplace-secret');
  });

  it('reports a display-safe source failure while retaining unrelated items', async () => {
    const service = new CapabilityInventoryService({
      ...dependencies(),
      listMarketplaceSkills: async () => {
        throw new Error('RAW_ERROR_DETAIL super-secret-token');
      },
    });

    const result = await service.list({ mindId: 'lucy' }, 'C:\\minds\\lucy');

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: expect.objectContaining({ kind: 'prompt' }) }),
      expect.objectContaining({ ref: expect.objectContaining({ kind: 'mcp-connector' }) }),
    ]));
    expect(result.sources).toContainEqual({
      id: 'marketplace-skills',
      label: 'Marketplace skills',
      status: 'error',
    });
    expect(JSON.stringify(result)).not.toContain('RAW_ERROR_DETAIL');
  });
});

function createService(): CapabilityInventoryService {
  return new CapabilityInventoryService(dependencies());
}

function dependencies(): CapabilityInventoryDependencies {
  return {
    listSkills: async () => [installedSkill()],
    listMarketplaceSkills: async () => ({
      skills: [availableSkill()],
      malformedEntries: [],
      sources: [marketplaceSource()],
      errors: [],
    }),
    listMcpServers: () => [{ name: 'filesystem', transport: 'stdio' } satisfies McpServerSummary],
    listTools: async () => ({ tools: [tool()], sources: [] }),
    listPrompts: () => [prompt()],
    listLensViews: () => [lens()],
    isLensViewEnabled: () => false,
  };
}

function installedSkill(): SkillDetail {
  return {
    id: 'installed-skill',
    name: 'Installed skill',
    description: 'Safe description',
    source: {
      type: 'local',
      directory: 'C:\\minds\\lucy\\.github\\skills\\installed-skill',
      manifestPath: 'C:\\minds\\lucy\\.github\\skills\\installed-skill\\SKILL.md',
    },
    isCore: false,
    isManaged: false,
    requiredFiles: [{ path: 'SKILL.md', status: 'missing' }],
    capabilities: ['read-project'],
    validationErrors: [],
  };
}

function availableSkill(): MarketplaceSkillEntry {
  return {
    id: 'available-skill',
    displayName: 'Available skill',
    description: 'From a catalog',
    root: 'C:\\hidden\\root',
    requiredFiles: ['SKILL.md'],
    capabilities: ['catalog-capability'],
    reserved: false,
    source: {
      owner: 'example',
      repo: 'catalog',
      ref: 'main',
      plugin: 'catalog',
      marketplaceId: 'github:example/catalog',
      marketplaceLabel: 'Example catalog',
      marketplaceUrl: 'https://catalog-user:marketplace-secret@example.test/catalog?token=secret',
    },
  };
}

function marketplaceSource(): MarketplaceSkillSourceStatus {
  return {
    id: 'github:example/catalog',
    label: 'Example catalog',
    url: 'https://github.com/example/catalog',
    status: 'ok',
    skillCount: 1,
    malformedCount: 0,
  };
}

function prompt(): Prompt {
  return {
    id: 'prompt-1',
    title: 'Prompt title',
    description: 'Prompt description',
    body: 'PROMPT_BODY_SECRET',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
  };
}

function tool(): ToolInventoryEntry {
  return {
    id: 'tool',
    displayName: 'Tool',
    description: 'Catalog tool',
    marketplaceId: 'github:example/catalog',
    marketplaceLabel: 'Example catalog',
    status: 'installed',
    installedVersion: '1.0.0',
  };
}

function lens(): LensViewManifest {
  return {
    id: 'dashboard',
    name: 'Dashboard',
    icon: 'layout',
    view: 'canvas',
    source: 'index.html',
    _basePath: 'C:\\absolute\\lens\\path',
  };
}
