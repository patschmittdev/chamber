/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindContext } from '@chamber/shared/types';
import type { SkillDetail, SkillMarketplaceBrowseResult } from '@chamber/shared/skill-types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { SkillsTab } from './SkillsTab';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\minds\\lucy',
  identity: { name: 'Lucy', systemMessage: '' },
  status: 'ready',
};

function renderTab(api: ReturnType<typeof mockElectronAPI>, state?: Partial<AppState>) {
  installElectronAPI(api);
  return render(
    <AppStateProvider testInitialState={{ activeMindId: 'mind-1', minds: [mind], ...state }}>
      <SkillsTab />
    </AppStateProvider>,
  );
}

describe('SkillsTab', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  it('prompts to select a mind when none is active', () => {
    renderTab(api, { activeMindId: null, minds: [] });
    expect(screen.getByText('No mind selected')).toBeTruthy();
  });

  it('lists detailed local skills discovered for the active mind', async () => {
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([
      localSkill({ id: 'lens', name: 'Lens', version: '1.2.0', description: 'Build views' }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText('Lens')).toBeTruthy());
    expect(api.skills.listForMindDetails).toHaveBeenCalledWith('mind-1');
    expect(screen.getByText('v1.2.0')).toBeTruthy();
    expect(screen.getByText('Build views')).toBeTruthy();
    expect(screen.getByText('.github/skills/lens')).toBeTruthy();
  });

  it('renders managed core skill metadata', async () => {
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([
      localSkill({
        id: 'lens',
        name: 'Lens',
        isCore: true,
        isManaged: true,
        capabilities: ['lens-views'],
        managed: {
          version: '2.0.0',
          capabilities: ['lens-views'],
          metadataPath: '.github/skills/lens/.chamber-skill.json',
          files: [{ path: 'SKILL.md', status: 'present' }],
          source: {
            owner: 'ianphil',
            repo: 'genesis-minds',
            ref: 'master',
            plugin: 'genesis-minds',
            marketplaceId: 'github:ianphil/genesis-minds',
            marketplaceLabel: 'Public Genesis Minds',
            marketplaceUrl: 'https://github.com/ianphil/genesis-minds',
            root: 'skills/lens',
          },
        },
      }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText('Managed')).toBeTruthy());
    expect(screen.getByText('Core')).toBeTruthy();
    expect(screen.getByText('Chamber managed local skill')).toBeTruthy();
    expect(screen.getByText('lens-views')).toBeTruthy();
  });

  it('renders an empty state when the mind has no skills', async () => {
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([]);
    renderTab(api);
    await waitFor(() => expect(screen.getByText('No skills found')).toBeTruthy());
  });

  it('renders marketplace loading state', () => {
    vi.mocked(api.skills.listForMindDetails).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.skills.browseMarketplace).mockReturnValue(new Promise(() => {}));
    renderTab(api);

    expect(screen.getByText('Loading skills...')).toBeTruthy();
    expect(screen.getByText('Loading marketplace...')).toBeTruthy();
  });

  it('renders marketplace empty state', async () => {
    vi.mocked(api.skills.browseMarketplace).mockResolvedValue(emptyMarketplace());
    renderTab(api);

    await waitFor(() => expect(screen.getByText('No marketplace skills or templates')).toBeTruthy());
  });

  it('renders marketplace source errors', async () => {
    vi.mocked(api.skills.browseMarketplace).mockRejectedValue(new Error('Registry unavailable'));
    renderTab(api);

    await waitFor(() => expect(screen.getByText('Registry unavailable')).toBeTruthy());
  });

  it('renders marketplace skills, templates, malformed entries, and source health', async () => {
    vi.mocked(api.skills.browseMarketplace).mockResolvedValue(marketplaceWithEntries());
    renderTab(api);

    await waitFor(() => expect(screen.getByText('Team Helper')).toBeTruthy());
    expect(screen.getByText('Lucy Template')).toBeTruthy();
    expect(screen.getByText('Broken Helper')).toBeTruthy();
    expect(screen.getByText('1 skill, 1 malformed')).toBeTruthy();
    expect(screen.getByText('1 template')).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.getByText('Read-only template')).toBeTruthy();
  });

  it('escapes local detail dialog content instead of rendering HTML or executable UI', async () => {
    const untrusted = '<script>alert(1)</script> **bold**';
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([
      localSkill({ id: 'lens', name: 'Lens', description: untrusted }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'View details for Lens' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'View details for Lens' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText(untrusted).length).toBeGreaterThan(0);
    expect(document.querySelector('script')).toBeNull();
  });

  it('shows a New skill action when a mind is active', async () => {
    renderTab(api);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New skill' })).toBeTruthy());
  });

  it('creates a skill through the new skill dialog and reloads the list', async () => {
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([]);
    vi.mocked(api.skills.save).mockResolvedValue({ success: true });
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'New skill' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));

    fireEvent.change(screen.getByLabelText('Skill id'), { target: { value: 'note-taker' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Note Taker' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Takes notes.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }));

    await waitFor(() => expect(api.skills.save).toHaveBeenCalled());
    const request = vi.mocked(api.skills.save).mock.calls[0][0];
    expect(request.mindId).toBe('mind-1');
    expect(request.id).toBe('note-taker');
    expect(request.expectedMtimeMs).toBeNull();
    expect(request.content).toContain('name: Note Taker');
    expect(request.content).toContain('description: Takes notes.');
    await waitFor(() => expect(api.skills.listForMindDetails).toHaveBeenCalledTimes(2));
  });

  it('opens the create dialog from a pending create-skill intent', async () => {
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([]);
    renderTab(api, { pendingExtensionsIntent: { tab: 'skills', action: 'create-skill' } });

    await waitFor(() => expect(screen.getByLabelText('Skill id')).toBeTruthy());
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
  });

  it('rejects an invalid skill id before calling save', async () => {
    renderTab(api);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New skill' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));

    fireEvent.change(screen.getByLabelText('Skill id'), { target: { value: 'Bad Id' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bad.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }));

    await waitFor(() => expect(screen.getByText(/must be lowercase letters/i)).toBeTruthy());
    expect(api.skills.save).not.toHaveBeenCalled();
  });

  it('surfaces a create failure and keeps the dialog open', async () => {
    vi.mocked(api.skills.save).mockResolvedValue({ success: false, error: 'A skill with this id already exists.' });
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'New skill' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.change(screen.getByLabelText('Skill id'), { target: { value: 'dupe' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dupe' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Dup.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }));

    await waitFor(() => expect(screen.getByText('A skill with this id already exists.')).toBeTruthy());
  });

  it('surfaces a rejected save and clears the saving state in the create dialog', async () => {
    vi.mocked(api.skills.save).mockRejectedValue(new Error('Invalid save payload.'));
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'New skill' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.change(screen.getByLabelText('Skill id'), { target: { value: 'boom' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Boom' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Kaboom.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }));

    await waitFor(() => expect(screen.getByText('Invalid save payload.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Create skill' })).toBeTruthy();
  });

  it('edits an editable skill and saves with optimistic concurrency', async () => {
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([localSkill({ id: 'writer', name: 'Writer' })]);
    vi.mocked(api.skills.getSource).mockResolvedValue({
      id: 'writer',
      content: '---\nname: Writer\ndescription: Old.\n---\n',
      mtimeMs: 42,
    });
    vi.mocked(api.skills.save).mockResolvedValue({ success: true });
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Writer' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Writer' }));

    await waitFor(() => expect(api.skills.getSource).toHaveBeenCalledWith('mind-1', 'writer'));
    const textarea = await screen.findByLabelText('SKILL.md content');
    const next = '---\nname: Writer\ndescription: New.\n---\n';
    fireEvent.change(textarea, { target: { value: next } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.skills.save).toHaveBeenCalled());
    expect(vi.mocked(api.skills.save).mock.calls[0][0]).toEqual({
      mindId: 'mind-1',
      id: 'writer',
      content: next,
      expectedMtimeMs: 42,
    });
  });

  it('surfaces the browser degraded save failure in the edit dialog', async () => {
    const degraded = { success: false as const, error: 'Skill authoring is not available in browser mode yet.' };
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([localSkill({ id: 'writer', name: 'Writer' })]);
    vi.mocked(api.skills.getSource).mockResolvedValue({
      id: 'writer',
      content: '---\nname: Writer\ndescription: Old.\n---\n',
      mtimeMs: 42,
    });
    vi.mocked(api.skills.save).mockResolvedValue(degraded);
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Writer' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Writer' }));

    const textarea = await screen.findByLabelText('SKILL.md content');
    fireEvent.change(textarea, { target: { value: '---\nname: Writer\ndescription: New.\n---\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not available in browser mode'));
    expect(screen.getByLabelText('SKILL.md content')).toBeTruthy();
  });

  it('does not show an Edit action for managed or core skills', async () => {
    vi.mocked(api.skills.listForMindDetails).mockResolvedValue([
      localSkill({ id: 'lens', name: 'Lens', isCore: true }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText('Lens')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Edit Lens' })).toBeNull();
  });
});

function localSkill(overrides: Partial<SkillDetail> = {}): SkillDetail {
  const id = overrides.id ?? 'lens';
  return {
    id,
    name: overrides.name ?? 'Lens',
    source: {
      type: 'local',
      directory: `.github/skills/${id}`,
      manifestPath: `.github/skills/${id}/SKILL.md`,
    },
    isCore: false,
    isManaged: false,
    requiredFiles: [{ path: 'SKILL.md', status: 'present' }],
    capabilities: [],
    validationErrors: [],
    ...overrides,
  };
}

function emptyMarketplace(): SkillMarketplaceBrowseResult {
  return {
    skills: [],
    malformedSkills: [],
    skillSources: [],
    templates: [],
    templateSources: [],
  };
}

function marketplaceWithEntries(): SkillMarketplaceBrowseResult {
  return {
    skills: [{
      id: 'team-helper',
      displayName: 'Team Helper',
      description: 'Team guidance.',
      root: 'skills/team-helper',
      requiredFiles: ['SKILL.md'],
      capabilities: ['team-guidance'],
      reserved: false,
      source: marketplaceSource(),
    }],
    malformedSkills: [{
      source: marketplaceSource(),
      index: 1,
      rawId: 'broken-helper',
      rawDisplayName: 'Broken Helper',
      message: 'root must be a safe relative path',
    }],
    skillSources: [{
      id: 'github:contoso/genesis-minds',
      label: 'Contoso',
      url: 'https://github.com/contoso/genesis-minds',
      status: 'ok',
      skillCount: 1,
      malformedCount: 1,
    }],
    templates: [{
      id: 'lucy',
      displayName: 'Lucy Template',
      description: 'Lucy description.',
      role: 'Chief of Staff',
      voice: 'Calm',
      templateVersion: '0.1.0',
      agent: '.github/agents/lucy.agent.md',
      requiredFiles: ['SOUL.md'],
      source: {
        ...marketplaceSource(),
        manifestPath: 'plugins/genesis-minds/minds/lucy/mind.json',
        rootPath: 'plugins/genesis-minds/minds/lucy',
      },
    }],
    templateSources: [{
      id: 'github:contoso/genesis-minds',
      label: 'Contoso',
      url: 'https://github.com/contoso/genesis-minds',
      status: 'ok',
      templateCount: 1,
    }],
  };
}

function marketplaceSource() {
  return {
    owner: 'contoso',
    repo: 'genesis-minds',
    ref: 'main',
    plugin: 'genesis-minds',
    marketplaceId: 'github:contoso/genesis-minds',
    marketplaceLabel: 'Contoso',
    marketplaceUrl: 'https://github.com/contoso/genesis-minds',
    isDefault: false,
  };
}
