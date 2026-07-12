/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AgentsSettingsSection } from './AgentsSettingsSection';
import { AppStateProvider } from '../../lib/store';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { MindContext, MindInstructionPrecedence } from '@chamber/shared/types';

const minds: MindContext[] = [
  { mindId: 'ada-1', mindPath: 'C:\\agents\\ada', identity: { name: 'Ada', systemMessage: '' }, status: 'ready', selectedModel: 'claude-sonnet' },
  { mindId: 'boru-2', mindPath: 'C:\\agents\\boru', identity: { name: 'Boru', systemMessage: '' }, status: 'loading' },
];

function makePrecedence(mindId: string, enabled = true): MindInstructionPrecedence {
  return {
    mindId,
    mindName: mindId,
    globalCustomInstructionsEnabled: enabled,
    hasGlobalCustomInstructions: true,
    layers: [],
  };
}

const precedenceByMindId: Record<string, MindInstructionPrecedence> = {
  'ada-1': makePrecedence('ada-1'),
  'boru-2': makePrecedence('boru-2'),
};

function renderSection(onToggleInheritance = vi.fn().mockResolvedValue(undefined)) {
  render(
    <AppStateProvider
      testInitialState={{
        minds,
        agentProfileByMindId: {
          'ada-1': { mindId: 'ada-1', displayName: 'Ada', avatarDataUrl: null },
          'boru-2': { mindId: 'boru-2', displayName: 'Boru', avatarDataUrl: null },
        },
      }}
    >
      <AgentsSettingsSection
        minds={minds}
        precedenceByMindId={precedenceByMindId}
        savingMindId={null}
        onToggleInheritance={onToggleInheritance}
      />
    </AppStateProvider>,
  );
  return { onToggleInheritance };
}

describe('AgentsSettingsSection', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    api = installElectronAPI();
  });

  it('lists every agent and shows the first one in the detail pane by default', () => {
    renderSection();
    const list = screen.getByRole('list', { name: /agents/i });
    expect(within(list).getByText('Ada')).toBeTruthy();
    expect(within(list).getByText('Boru')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy();
  });

  it('filters the agent list by search query', () => {
    renderSection();
    fireEvent.change(screen.getByRole('searchbox', { name: /search agents/i }), { target: { value: 'boru' } });
    const list = screen.getByRole('list', { name: /agents/i });
    expect(within(list).queryByText('Ada')).toBeNull();
    expect(within(list).getByText('Boru')).toBeTruthy();
  });

  it('switches the detail pane when a different agent is selected', () => {
    renderSection();
    const list = screen.getByRole('list', { name: /agents/i });
    fireEvent.click(within(list).getByText('Boru'));
    expect(screen.getByRole('heading', { name: 'Boru' })).toBeTruthy();
    expect(screen.getByText('C:\\agents\\boru')).toBeTruthy();
  });

  it('restarts the selected agent through the profile bridge', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Restart agent' }));
    await waitFor(() => {
      expect(api.mindProfile.restart).toHaveBeenCalledWith('ada-1');
    });
    expect(await screen.findByText(/Restart requested/i)).toBeTruthy();
  });

  it('delegates per-mind inheritance changes from the Instructions tab', async () => {
    const onToggleInheritance = vi.fn().mockResolvedValue(undefined);
    renderSection(onToggleInheritance);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Instructions' }));
    const toggle = await screen.findByRole('checkbox', { name: /apply global custom instructions to ada/i });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(onToggleInheritance).toHaveBeenCalledWith(minds[0], false);
    });
  });

  it('renders the persona editor for the selected agent on the Persona tab', async () => {
    (api.mindProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      mindId: 'ada-1',
      mindPath: 'C:\\agents\\ada',
      displayName: 'Ada',
      folderName: 'ada',
      avatarDataUrl: null,
      soul: { kind: 'soul', label: 'SOUL.md', relativePath: 'SOUL.md', content: '# Ada', exists: true, mtimeMs: 1 },
      agentFiles: [],
      needsRestart: false,
    });
    renderSection();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Persona' }));
    expect(await screen.findByRole('button', { name: /SOUL.md/ })).toBeTruthy();
  });

  it('summarizes working memory on the Overview tab', () => {
    const precedence: Record<string, MindInstructionPrecedence> = {
      'ada-1': {
        mindId: 'ada-1',
        mindName: 'Ada',
        globalCustomInstructionsEnabled: true,
        hasGlobalCustomInstructions: true,
        layers: [
          {
            id: 'working-memory',
            label: 'Working memory',
            source: 'C:\\agents\\ada\\.working-memory',
            description: 'Notes the agent keeps across turns.',
            included: true,
            present: true,
            enabled: true,
            contentExposed: false,
          },
        ],
      },
      'boru-2': makePrecedence('boru-2'),
    };
    render(
      <AppStateProvider
        testInitialState={{
          minds,
          agentProfileByMindId: {
            'ada-1': { mindId: 'ada-1', displayName: 'Ada', avatarDataUrl: null },
            'boru-2': { mindId: 'boru-2', displayName: 'Boru', avatarDataUrl: null },
          },
        }}
      >
        <AgentsSettingsSection
          minds={minds}
          precedenceByMindId={precedence}
          savingMindId={null}
          onToggleInheritance={vi.fn().mockResolvedValue(undefined)}
        />
      </AppStateProvider>,
    );
    expect(screen.getByText('Working memory')).toBeTruthy();
    expect(screen.getByText('C:\\agents\\ada\\.working-memory')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('lists the agent models on the Model tab', async () => {
    (api.chat.listModels as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'claude-sonnet', name: 'Claude Sonnet' },
    ]);
    renderSection();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Model' }));
    expect(await screen.findByRole('radio', { name: /Claude Sonnet/ })).toBeTruthy();
    expect(api.chat.listModels).toHaveBeenCalledWith('ada-1');
  });
});
