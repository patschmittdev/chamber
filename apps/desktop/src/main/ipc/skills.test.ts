import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import type { SkillDetail, SkillSaveResult, SkillSource } from '@chamber/shared';
import type { GenesisMindTemplateMarketplaceResult, MarketplaceSkillCatalogResult } from '@chamber/services';
import { setupSkillsIPC } from './skills';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

describe('Skills IPC', () => {
  const getMindPath = vi.fn<(mindId: string) => string | undefined>();
  const list = vi.fn<(mindPath: string) => Promise<Array<{ id: string; name: string }>>>();
  const listDetails = vi.fn<(mindPath: string) => Promise<SkillDetail[]>>();
  const readSource = vi.fn<(mindPath: string, id: string) => Promise<SkillSource>>();
  const save = vi.fn<
    (mindPath: string, request: { id: string; content: string; expectedMtimeMs: number | null }) => Promise<SkillSaveResult>
  >();

  beforeEach(() => {
    vi.clearAllMocks();
    getMindPath.mockReturnValue(undefined);
    list.mockResolvedValue([]);
    listDetails.mockResolvedValue([]);
    readSource.mockResolvedValue({ id: 'helper', content: '', mtimeMs: null });
    save.mockResolvedValue({ success: true });
    setupSkillsIPC({ getMindPath }, { list, listDetails }, { readSource, save });
  });

  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['object', { mindId: 'lucy' }],
  ] as const) {
    it(`rejects ${label} mindId without resolving a mind`, async () => {
      await expect(getHandler(IPC.SKILLS.LIST_FOR_MIND)(EVT, value)).rejects.toThrow(TypeError);
      expect(getMindPath).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    });
  }

  it('rejects an empty mindId with a channel-labeled TypeError', async () => {
    const handler = getHandler(IPC.SKILLS.LIST_FOR_MIND);
    await expect(handler(EVT, '')).rejects.toThrow(TypeError);
    await expect(handler(EVT, '')).rejects.toThrow(/skills:listForMind/);
    expect(getMindPath).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('returns [] for a stale unknown mindId', async () => {
    await expect(getHandler(IPC.SKILLS.LIST_FOR_MIND)(EVT, 'stale-mind')).resolves.toEqual([]);
    expect(getMindPath).toHaveBeenCalledWith('stale-mind');
    expect(list).not.toHaveBeenCalled();
  });

  it('lists skills only through the trusted resolved mind path', async () => {
    getMindPath.mockReturnValue('C:\\minds\\lucy');
    list.mockResolvedValue([{ id: 'lens', name: 'Lens' }]);

    await expect(getHandler(IPC.SKILLS.LIST_FOR_MIND)(EVT, 'lucy')).resolves.toEqual([
      { id: 'lens', name: 'Lens' },
    ]);
    expect(getMindPath).toHaveBeenCalledWith('lucy');
    expect(list).toHaveBeenCalledWith('C:\\minds\\lucy');
  });

  it('lists detailed skills only through the trusted resolved mind path', async () => {
    getMindPath.mockReturnValue('C:\\minds\\lucy');
    listDetails.mockResolvedValue([skillDetail('lens')]);

    await expect(getHandler(IPC.SKILLS.LIST_FOR_MIND_DETAILS)(EVT, 'lucy')).resolves.toEqual([
      skillDetail('lens'),
    ]);
    expect(getMindPath).toHaveBeenCalledWith('lucy');
    expect(listDetails).toHaveBeenCalledWith('C:\\minds\\lucy');
  });

  it('returns read-only marketplace skills, malformed entries, templates, and source statuses', async () => {
    vi.clearAllMocks();
    const skillCatalog = { listSkills: vi.fn<() => Promise<MarketplaceSkillCatalogResult>>() };
    const templateCatalog = { listTemplates: vi.fn<() => Promise<GenesisMindTemplateMarketplaceResult>>() };
    skillCatalog.listSkills.mockResolvedValue(marketplaceSkillResult());
    templateCatalog.listTemplates.mockResolvedValue(templateMarketplaceResult());
    setupSkillsIPC({ getMindPath }, { list, listDetails }, { readSource, save }, skillCatalog, templateCatalog);

    await expect(getHandler(IPC.SKILLS.BROWSE_MARKETPLACE)(EVT)).resolves.toEqual({
      skills: [expect.objectContaining({ id: 'team-helper', displayName: 'Team Helper' })],
      malformedSkills: [expect.objectContaining({ rawId: 'broken-helper' })],
      skillSources: [expect.objectContaining({ id: 'github:contoso/genesis-minds', status: 'ok' })],
      templates: [expect.objectContaining({
        id: 'lucy',
        displayName: 'Lucy',
        source: expect.objectContaining({
          marketplaceId: 'github:contoso/genesis-minds',
          manifestPath: 'plugins/genesis-minds/minds/lucy/mind.json',
          rootPath: 'plugins/genesis-minds/minds/lucy',
        }),
      })],
      templateSources: [expect.objectContaining({ id: 'github:contoso/genesis-minds', status: 'ok' })],
    });
  });
  it('reads a skill source only through the trusted resolved mind path', async () => {
    getMindPath.mockReturnValue('C:\\minds\\lucy');
    readSource.mockResolvedValue({ id: 'writer', content: '# writer\n', mtimeMs: 12 });

    await expect(getHandler(IPC.SKILLS.GET_SOURCE)(EVT, 'lucy', 'writer')).resolves.toEqual({
      id: 'writer',
      content: '# writer\n',
      mtimeMs: 12,
    });
    expect(getMindPath).toHaveBeenCalledWith('lucy');
    expect(readSource).toHaveBeenCalledWith('C:\\minds\\lucy', 'writer');
  });

  it('rejects a non-string skill id for getSource without resolving a mind', async () => {
    await expect(getHandler(IPC.SKILLS.GET_SOURCE)(EVT, 'lucy', 42)).rejects.toThrow(TypeError);
    expect(getMindPath).not.toHaveBeenCalled();
    expect(readSource).not.toHaveBeenCalled();
  });

  it('throws when getSource targets an unknown mind', async () => {
    await expect(getHandler(IPC.SKILLS.GET_SOURCE)(EVT, 'ghost', 'writer')).rejects.toThrow(/ghost/);
    expect(readSource).not.toHaveBeenCalled();
  });

  it('saves a skill only through the trusted resolved mind path', async () => {
    getMindPath.mockReturnValue('C:\\minds\\lucy');
    const request = { mindId: 'lucy', id: 'writer', content: '---\nname: writer\ndescription: x\n---\n', expectedMtimeMs: null };

    await expect(getHandler(IPC.SKILLS.SAVE)(EVT, request)).resolves.toEqual({ success: true });
    expect(getMindPath).toHaveBeenCalledWith('lucy');
    expect(save).toHaveBeenCalledWith('C:\\minds\\lucy', {
      id: 'writer',
      content: request.content,
      expectedMtimeMs: null,
    });
  });

  it('rejects a malformed save payload without resolving a mind', async () => {
    await expect(getHandler(IPC.SKILLS.SAVE)(EVT, { mindId: 'lucy', id: 'writer' })).rejects.toThrow(TypeError);
    expect(getMindPath).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('returns a failure result when save targets an unknown mind', async () => {
    const request = { mindId: 'ghost', id: 'writer', content: 'x', expectedMtimeMs: null };
    await expect(getHandler(IPC.SKILLS.SAVE)(EVT, request)).resolves.toEqual({
      success: false,
      error: 'Mind ghost not found',
    });
    expect(save).not.toHaveBeenCalled();
  });
});

function getHandler(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}

function skillDetail(id: string): SkillDetail {
  return {
    id,
    name: 'Lens',
    source: {
      type: 'local',
      directory: `.github/skills/${id}`,
      manifestPath: `.github/skills/${id}/SKILL.md`,
    },
    isCore: true,
    isManaged: false,
    requiredFiles: [{ path: 'SKILL.md', status: 'present' }],
    capabilities: [],
    validationErrors: [],
  };
}

function marketplaceSkillResult(): MarketplaceSkillCatalogResult {
  return {
    skills: [{
      id: 'team-helper',
      displayName: 'Team Helper',
      description: 'Team guidance.',
      root: 'skills/team-helper',
      requiredFiles: ['SKILL.md'],
      capabilities: ['team-guidance'],
      reserved: false,
      source: {
        owner: 'contoso',
        repo: 'genesis-minds',
        ref: 'main',
        plugin: 'genesis-minds',
        marketplaceId: 'github:contoso/genesis-minds',
        marketplaceLabel: 'Contoso',
        marketplaceUrl: 'https://github.com/contoso/genesis-minds',
        isDefault: false,
      },
    }],
    malformedEntries: [{
      index: 1,
      rawId: 'broken-helper',
      message: 'root must be a safe relative path',
      source: {
        owner: 'contoso',
        repo: 'genesis-minds',
        ref: 'main',
        plugin: 'genesis-minds',
        marketplaceId: 'github:contoso/genesis-minds',
        marketplaceLabel: 'Contoso',
        marketplaceUrl: 'https://github.com/contoso/genesis-minds',
        isDefault: false,
      },
    }],
    sources: [{
      id: 'github:contoso/genesis-minds',
      label: 'Contoso',
      url: 'https://github.com/contoso/genesis-minds',
      status: 'ok',
      skillCount: 1,
      malformedCount: 1,
    }],
    errors: [],
  };
}

function templateMarketplaceResult(): GenesisMindTemplateMarketplaceResult {
  return {
    templates: [{
      id: 'lucy',
      displayName: 'Lucy',
      description: 'Lucy description.',
      role: 'Chief of Staff',
      voice: 'Calm',
      templateVersion: '0.1.0',
      agent: '.github/agents/lucy.agent.md',
      requiredFiles: ['SOUL.md'],
      source: {
        owner: 'contoso',
        repo: 'genesis-minds',
        ref: 'main',
        plugin: 'genesis-minds',
        manifestPath: 'plugins/genesis-minds/minds/lucy/mind.json',
        rootPath: 'plugins/genesis-minds/minds/lucy',
        marketplaceId: 'github:contoso/genesis-minds',
        marketplaceLabel: 'Contoso',
        marketplaceUrl: 'https://github.com/contoso/genesis-minds',
      },
    }],
    sources: [{
      id: 'github:contoso/genesis-minds',
      label: 'Contoso',
      url: 'https://github.com/contoso/genesis-minds',
      status: 'ok',
      templateCount: 1,
    }],
  };
}
