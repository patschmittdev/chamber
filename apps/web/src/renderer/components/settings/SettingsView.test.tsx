/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { version } from '../../../../../../package.json';
import { SettingsView } from './SettingsView';
import { AppStateProvider, useAppState } from '../../lib/store';
import { APPEARANCE_STORAGE_KEYS } from '../../lib/appearance';
import { appearanceStore } from '../../lib/appearanceStore';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { MindContext, MindInstructionPrecedence } from '@chamber/shared/types';

// Settings is now tabbed. Tests that assert on Account / Marketplaces /
// feature-specific content must first activate that tab (the Profile tab is the
// default). Profile-tab tests don't need this helper.
function gotoTab(label: 'Profile' | 'Custom instructions' | 'Agents' | 'Account' | 'Appearance' | 'Models and providers' | 'Sources & security') {
  const nav = screen.getByRole('navigation', { name: /settings sections/i });
  fireEvent.click(within(nav).getByRole('button', { name: label }));
}

function StateProbe() {
  const { activeView, pendingExtensionsIntent, pendingSettingsIntent } = useAppState();
  return (
    <>
      <div data-testid="active-view">{activeView}</div>
      <div data-testid="pending-extensions">{pendingExtensionsIntent?.tab ?? 'none'}</div>
      <div data-testid="pending-settings">{pendingSettingsIntent?.section ?? 'none'}</div>
    </>
  );
}

const settingsMind: MindContext = {
  mindId: 'q-a1b2',
  mindPath: 'C:\\agents\\q',
  identity: { name: 'Q', systemMessage: 'Secret prompt content' },
  status: 'ready',
};

function makePrecedence(overrides: Partial<MindInstructionPrecedence> = {}): MindInstructionPrecedence {
  const enabled = overrides.globalCustomInstructionsEnabled ?? true;
  return {
    mindId: 'q-a1b2',
    mindName: 'Q',
    globalCustomInstructionsEnabled: enabled,
    hasGlobalCustomInstructions: overrides.hasGlobalCustomInstructions ?? true,
    layers: overrides.layers ?? [
      {
        id: 'mind-identity',
        label: 'Mind identity',
        source: 'SOUL.md and .github/agents/*.agent.md',
        description: 'Defines the mind role, personality, and agent-specific instructions.',
        included: true,
        present: true,
        enabled: true,
        contentExposed: false,
      },
      {
        id: 'working-memory',
        label: 'Working memory',
        source: '.working-memory/memory.md, rules.md, and log.md',
        description: 'Private mind memory is included when present. Its contents are not shown here.',
        included: true,
        present: true,
        enabled: true,
        contentExposed: false,
      },
      {
        id: 'global-custom-instructions',
        label: 'Global custom instructions',
        source: 'Settings > Custom instructions',
        description: 'Operator preferences shared across minds when this mind inherits them.',
        included: enabled,
        present: true,
        enabled,
        contentExposed: false,
      },
      {
        id: 'chamber-guidance',
        label: 'Chamber safety guidance',
        source: 'Chamber runtime',
        description: 'Host operating and safety guidance remains authoritative for every mind.',
        included: true,
        present: true,
        enabled: true,
        contentExposed: false,
      },
      {
        id: 'tools',
        label: 'Installed tool guidance',
        source: 'Installed Chamber tools',
        description: 'Tool capability hints do not override Chamber safety guidance.',
        included: false,
        present: false,
        enabled: true,
        contentExposed: false,
      },
    ],
    ...overrides,
  };
}

vi.mock('./VoiceDictationSettingsSection', async () => {
  const React = await import('react');
  return {
    VoiceDictationSettingsSection: () => React.createElement(
      'section',
      { 'data-testid': 'voice-dictation-settings-section' },
      'Voice dictation',
    ),
  };
});

describe('SettingsView', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    api = installElectronAPI();
  });

  it('displays the current login', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'ianphil_microsoft' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'ianphil_microsoft' }]);
    render(<SettingsView />);
    gotoTab('Account');
    await waitFor(() => {
      expect(screen.getByText('ianphil_microsoft')).toBeTruthy();
    });
  });

  it('shows "Not signed in" when no login is available', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: false });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<SettingsView />);
    gotoTab('Account');
    await waitFor(() => {
      expect(screen.getByText('Not signed in')).toBeTruthy();
    });
  });

  it('calls auth.logout when Logout button is clicked', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'ianphil_microsoft' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'ianphil_microsoft' }]);
    render(<SettingsView />);
    gotoTab('Account');
    await waitFor(() => {
      expect(screen.getByText('ianphil_microsoft')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(api.auth.logout).toHaveBeenCalled();
  });

  it('renders a Settings heading', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /settings/i })).toBeTruthy();
    });
  });

  it('organizes settings by workspace, agents, models, and sources tasks', async () => {
    render(
      <AppStateProvider testInitialState={{ featureFlags: { switchboardRelay: false, byoLlm: true, chamberCopilot: false, voiceDictation: true, wtdTopology: false } }}>
        <SettingsView />
      </AppStateProvider>,
    );

    const nav = screen.getByRole('navigation', { name: /settings sections/i });
    expect(within(nav).getByRole('heading', { name: 'Workspace' })).toBeTruthy();
    expect(within(nav).getByRole('heading', { name: 'Agents' })).toBeTruthy();
    expect(within(nav).getByRole('heading', { name: 'Models and providers' })).toBeTruthy();
    expect(within(nav).getByRole('heading', { name: 'Sources and security' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Account' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Agents' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Models and providers' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Sources & security' })).toBeTruthy();
  });

  it('migrates legacy marketplace deep links to Sources & security', async () => {
    render(
      <AppStateProvider testInitialState={{ pendingSettingsIntent: { section: 'marketplaces' } }}>
        <SettingsView />
        <StateProbe />
      </AppStateProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Sources & security' })).toBeTruthy();
    expect(screen.getByTestId('pending-settings').textContent).toBe('none');
  });

  it('hides Local & Custom LLM settings when BYO LLM is feature-flagged off', async () => {
    render(<SettingsView />);
    await screen.findByRole('heading', { name: /settings/i });
    expect(screen.queryByRole('heading', { name: /local & custom llm/i })).toBeNull();
  });

  it('shows Local & Custom LLM settings when BYO LLM is feature-flagged on', async () => {
    render(
      <AppStateProvider testInitialState={{ featureFlags: { switchboardRelay: false, byoLlm: true, chamberCopilot: false, voiceDictation: false, wtdTopology: false } }}>
        <SettingsView />
      </AppStateProvider>,
    );
    gotoTab('Models and providers');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /local & custom llm/i })).toBeTruthy();
    });
  });

  it('hides Voice dictation settings when voice dictation is feature-flagged off', async () => {
    render(
      <AppStateProvider testInitialState={{ featureFlags: { switchboardRelay: false, byoLlm: false, chamberCopilot: false, voiceDictation: false, wtdTopology: false } }}>
        <SettingsView />
      </AppStateProvider>,
    );
    await screen.findByRole('heading', { name: /settings/i });
    expect(screen.queryByRole('button', { name: 'Voice dictation' })).toBeNull();
    expect(screen.queryByTestId('voice-dictation-settings-section')).toBeNull();
  });

  it('shows Voice dictation settings when voice dictation is feature-flagged on', async () => {
    render(
      <AppStateProvider testInitialState={{ featureFlags: { switchboardRelay: false, byoLlm: false, chamberCopilot: false, voiceDictation: true, wtdTopology: false } }}>
        <SettingsView />
      </AppStateProvider>,
    );
    expect(screen.getByRole('button', { name: 'Sources & security' })).toBeTruthy();
    gotoTab('Sources & security');
    expect(await screen.findByTestId('voice-dictation-settings-section')).toBeTruthy();
  });

  it('renders an Account section heading', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);
    render(<SettingsView />);
    gotoTab('Account');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /account/i })).toBeTruthy();
    });
  });

  it('renders user profile fields and work account import affordance', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);
    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /profile/i })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /import profile photo from microsoft 365/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /import from work account/i })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText('Work')).toBeTruthy();
    expect(screen.getByLabelText('Location')).toBeTruthy();
    expect(screen.getByLabelText('About')).toBeTruthy();
  });

  it('loads the persisted user profile into settings fields', async () => {
    (api.userProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      displayName: 'Ian Philpot',
      work: 'Principal SWE Manager',
      location: 'Atlanta',
      about: 'Builds Chamber.',
      avatarDataUrl: null,
      source: 'local',
      updatedAt: '2026-05-09T00:00:00.000Z',
    });

    render(<SettingsView />);

    await waitFor(() => {
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ian Philpot');
    });
    expect((screen.getByLabelText('Work') as HTMLInputElement).value).toBe('Principal SWE Manager');
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe('Atlanta');
    expect((screen.getByLabelText('About') as HTMLTextAreaElement).value).toBe('Builds Chamber.');
  });

  it('saves edited user profile fields', async () => {
    render(<SettingsView />);

    await screen.findByRole('button', { name: /save profile/i });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ian Philpot' } });
    fireEvent.change(screen.getByLabelText('Work'), { target: { value: 'Principal SWE Manager' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Atlanta' } });
    fireEvent.change(screen.getByLabelText('About'), { target: { value: 'Builds Chamber.' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(api.userProfile.save).toHaveBeenCalledWith({
        displayName: 'Ian Philpot',
        work: 'Principal SWE Manager',
        location: 'Atlanta',
        about: 'Builds Chamber.',
        avatarDataUrl: null,
      });
    });
    expect(await screen.findByText('Profile saved.')).toBeTruthy();
  });

  it('imports a Microsoft profile into the editable fields', async () => {
    (api.userProfile.importFromMicrosoft as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      importedFields: ['displayName', 'work', 'location', 'avatarDataUrl'],
      profile: {
        displayName: 'Ian Philpot',
        work: 'Principal SWE Manager',
        location: 'ATLANTA',
        about: '',
        avatarDataUrl: 'data:image/png;base64,AQID',
        source: 'microsoft',
        microsoftAccount: 'ianphil@microsoft.com',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
    });

    render(<SettingsView />);

    fireEvent.click(await screen.findByRole('button', { name: /import from work account/i }));

    await waitFor(() => {
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ian Philpot');
    });
    expect((screen.getByLabelText('Work') as HTMLInputElement).value).toBe('Principal SWE Manager');
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe('ATLANTA');
    expect(screen.getByText(/imported microsoft 365 profile/i)).toBeTruthy();
  });

  it('shows bounded Microsoft import errors without overwriting fields', async () => {
    (api.userProfile.importFromMicrosoft as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'Microsoft Graph profile request failed (403).',
      profile: {
        displayName: '',
        work: '',
        location: '',
        about: '',
        avatarDataUrl: null,
        source: 'local',
        updatedAt: null,
      },
    });

    render(<SettingsView />);

    fireEvent.click(await screen.findByRole('button', { name: /import from work account/i }));

    expect(await screen.findByText('Could not update your profile. Try again.')).toBeTruthy();
    expect(screen.queryByText('Microsoft Graph profile request failed (403).')).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('loads persisted custom instructions into the Custom instructions tab', async () => {
    (api.userProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      displayName: '',
      work: '',
      location: '',
      about: '',
      avatarDataUrl: null,
      customInstructions: 'Always answer concisely.',
      source: 'local',
      updatedAt: null,
    });

    render(<SettingsView />);
    gotoTab('Custom instructions');

    await waitFor(() => {
      expect((screen.getByLabelText('Instructions for all minds') as HTMLTextAreaElement).value)
        .toBe('Always answer concisely.');
    });
  });

  it('saves global custom instructions', async () => {
    render(<SettingsView />);
    gotoTab('Custom instructions');

    const textarea = await screen.findByLabelText('Instructions for all minds');
    fireEvent.change(textarea, { target: { value: 'Prefer TypeScript examples.' } });
    fireEvent.click(screen.getByRole('button', { name: /save custom instructions/i }));

    await waitFor(() => {
      expect(api.userProfile.save).toHaveBeenCalledWith({ customInstructions: 'Prefer TypeScript examples.' });
    });
    expect(await screen.findByText(/custom instructions saved/i)).toBeTruthy();
  });

  it('shows per-mind inheritance status and ordered precedence without prompt content', async () => {
    (api.mind.getInstructionPrecedence as ReturnType<typeof vi.fn>).mockResolvedValue(makePrecedence());
    render(
      <AppStateProvider testInitialState={{ minds: [settingsMind] }}>
        <SettingsView />
      </AppStateProvider>,
    );
    gotoTab('Custom instructions');

    expect(await screen.findByText('Per-mind inheritance')).toBeTruthy();
    expect(screen.getByText(/Chamber safety guidance remains authoritative/i)).toBeTruthy();
    expect(await screen.findByText('Inherits global custom instructions.')).toBeTruthy();
    expect(screen.queryByText('Secret prompt content')).toBeNull();

    const list = await screen.findByRole('list', { name: /instruction precedence for q/i });
    const items = within(list).getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(items.map((item) => item.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Mind identity'),
      expect.stringContaining('Working memory'),
      expect.stringContaining('Global custom instructions'),
      expect.stringContaining('Chamber safety guidance'),
      expect.stringContaining('Installed tool guidance'),
    ]);
  });

  it('toggles per-mind global custom instructions inheritance', async () => {
    (api.mind.getInstructionPrecedence as ReturnType<typeof vi.fn>).mockResolvedValue(makePrecedence());
    (api.mind.setGlobalCustomInstructionsEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(makePrecedence({
      globalCustomInstructionsEnabled: false,
    }));
    render(
      <AppStateProvider testInitialState={{ minds: [settingsMind] }}>
        <SettingsView />
      </AppStateProvider>,
    );
    gotoTab('Custom instructions');

    const toggle = await screen.findByRole('checkbox', { name: /apply global custom instructions to q/i });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(api.mind.setGlobalCustomInstructionsEnabled).toHaveBeenCalledWith('q-a1b2', false);
    });
    expect(await screen.findByText('Q now skips global custom instructions.')).toBeTruthy();
    expect(await screen.findByText('Global custom instructions are disabled for this mind.')).toBeTruthy();
  });

  it('shows when inheritance is enabled but no global custom instructions are saved', async () => {
    (api.mind.getInstructionPrecedence as ReturnType<typeof vi.fn>).mockResolvedValue(makePrecedence({
      hasGlobalCustomInstructions: false,
      layers: makePrecedence().layers.map((layer) => layer.id === 'global-custom-instructions'
        ? { ...layer, present: false, included: false }
        : layer),
    }));
    render(
      <AppStateProvider testInitialState={{ minds: [settingsMind] }}>
        <SettingsView />
      </AppStateProvider>,
    );
    gotoTab('Custom instructions');

    expect(await screen.findByText('Inheritance is enabled, but no global custom instructions are saved.')).toBeTruthy();
  });

  it('shows the app version from package.json', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText(`Chamber v${version}`)).toBeTruthy();
    });
  });

  it('shows error fallback when getStatus rejects', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IPC failed'));
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<SettingsView />);
    gotoTab('Account');
    await waitFor(() => {
      expect(screen.getByText('Unable to load account info')).toBeTruthy();
    });
  });

  it('renders a dropdown when multiple accounts exist', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }, { login: 'bob' }]);

    render(<SettingsView />);
    gotoTab('Account');

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });
  });

  it('shows accounts sorted alphabetically with Add Account at the bottom', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'zebra' }, { login: 'alice' }]);

    render(<SettingsView />);
    gotoTab('Account');

    const trigger = await screen.findByRole('combobox', { name: /select account/i });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['alice', 'zebra', '+ Add Account']);
  });

  it('preselects the active account', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'bob' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }, { login: 'bob' }]);

    render(<SettingsView />);
    gotoTab('Account');

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /select account/i }).textContent).toContain('bob');
    });
  });

  it('switches accounts when a different account is selected', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }, { login: 'bob' }]);

    render(<SettingsView />);
    gotoTab('Account');

    const trigger = await screen.findByRole('combobox', { name: /select account/i });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'bob' }));

    await waitFor(() => {
      expect(api.auth.switchAccount).toHaveBeenCalledWith('bob');
    });
  });

  it('starts device flow when Add Account is clicked', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);

    render(<SettingsView />);
    gotoTab('Account');

    // With a single account, the UI renders a static chip plus an inline
    // "+ Add account" button (no dropdown), since switching is not possible.
    fireEvent.click(await screen.findByRole('button', { name: /\+ add account/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /add a github account/i })).toBeTruthy();
    });
    await waitFor(() => {
      expect(api.auth.startLogin).toHaveBeenCalled();
    });
    expect(api.auth.onProgress).toHaveBeenCalled();
  });

  it('refreshes account state after auth:accountSwitched', async () => {
    let onAccountSwitched: (() => void) | undefined;
    (api.auth.getStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ authenticated: true, login: 'alice' })
      .mockResolvedValueOnce({ authenticated: true, login: 'bob' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ login: 'alice' }, { login: 'bob' }])
      .mockResolvedValueOnce([{ login: 'alice' }, { login: 'bob' }]);
    (api.auth.onAccountSwitched as ReturnType<typeof vi.fn>).mockImplementation((callback: () => void) => {
      onAccountSwitched = callback;
      return vi.fn();
    });

    render(<SettingsView />);
    gotoTab('Account');

    await screen.findByText('alice');
    onAccountSwitched!();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /select account/i }).textContent).toContain('bob');
    });
  });

  it('refreshes account state after a freshly added login broadcasts auth:accountSwitched', async () => {
    let onAccountSwitched: (() => void) | undefined;
    (api.auth.getStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ authenticated: true, login: 'alice' })
      .mockResolvedValueOnce({ authenticated: true, login: 'newuser' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ login: 'alice' }])
      .mockResolvedValueOnce([{ login: 'alice' }, { login: 'newuser' }]);
    (api.auth.onAccountSwitched as ReturnType<typeof vi.fn>).mockImplementation((callback: () => void) => {
      onAccountSwitched = callback;
      return vi.fn();
    });

    render(<SettingsView />);
    gotoTab('Account');

    await screen.findByText('alice');
    // Simulate the IPC broadcast that fires after AuthService stores credentials
    // for the new account — the dropdown must reflect the new account without a restart.
    onAccountSwitched!();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /select account/i }).textContent).toContain('newuser');
    });
  });

  it('shows a static chip + Add account button when only one account exists', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);

    render(<SettingsView />);
    gotoTab('Account');

    // The old <Select> dropdown implied multi-account switching that doesn't
    // exist for a single login; the new UI is a static chip + Add account
    // affordance instead. Audit pass 4 (minor) findings.
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
      expect(screen.getByRole('button', { name: /\+ add account/i })).toBeTruthy();
    });
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('lists followed marketplaces', async () => {
    (api.marketplace.listGenesisRegistries as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'github:ianphil/genesis-minds',
        label: 'Public Genesis Minds',
        url: 'https://github.com/ianphil/genesis-minds',
        owner: 'ianphil',
        repo: 'genesis-minds',
        ref: 'master',
        plugin: 'genesis-minds',
        enabled: true,
        isDefault: true,
      },
    ]);

    render(<SettingsView />);
    gotoTab('Sources & security');

    expect(await screen.findByText('Public Genesis Minds')).toBeTruthy();
    expect(screen.queryByText('https://github.com/ianphil/genesis-minds')).toBeNull();
  });

  it('adds a marketplace from settings and refreshes the list', async () => {
    (api.marketplace.listGenesisRegistries as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'github:agency-microsoft/genesis-minds',
          label: 'agency-microsoft/genesis-minds',
          url: 'https://github.com/agency-microsoft/genesis-minds',
          owner: 'agency-microsoft',
          repo: 'genesis-minds',
          ref: 'main',
          plugin: 'genesis-minds',
          enabled: true,
          isDefault: false,
        },
      ]);

    render(<SettingsView />);
    gotoTab('Sources & security');

    fireEvent.change(await screen.findByLabelText('Marketplace repository URL'), {
      target: { value: 'https://github.com/agency-microsoft/genesis-minds' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(api.marketplace.addGenesisRegistry).toHaveBeenCalledWith('https://github.com/agency-microsoft/genesis-minds');
    });
    expect(await screen.findByText('agency-microsoft/genesis-minds')).toBeTruthy();
  });

  it('disables, refreshes, and removes marketplaces from settings', async () => {
    const agencyMarketplace = {
      id: 'github:agency-microsoft/genesis-minds',
      label: 'agency-microsoft/genesis-minds',
      url: 'https://github.com/agency-microsoft/genesis-minds',
      owner: 'agency-microsoft',
      repo: 'genesis-minds',
      ref: 'main',
      plugin: 'genesis-minds',
      enabled: true,
      isDefault: false,
    };
    (api.marketplace.listGenesisRegistries as ReturnType<typeof vi.fn>).mockResolvedValue([agencyMarketplace]);

    render(<SettingsView />);
    gotoTab('Sources & security');

    await screen.findByText('agency-microsoft/genesis-minds');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(api.marketplace.setGenesisRegistryEnabled).toHaveBeenCalledWith('github:agency-microsoft/genesis-minds', false);
      expect(api.marketplace.refreshGenesisRegistry).toHaveBeenCalledWith('github:agency-microsoft/genesis-minds');
      expect(api.marketplace.removeGenesisRegistry).toHaveBeenCalledWith('github:agency-microsoft/genesis-minds');
    });
  });

  it('cross-links enrolled sources to the curated Extensions directory', async () => {
    (api.marketplace.listGenesisRegistries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(
      <AppStateProvider testInitialState={{ activeView: 'settings' }}>
        <SettingsView />
        <StateProbe />
      </AppStateProvider>,
    );
    gotoTab('Sources & security');

    fireEvent.click(await screen.findByRole('button', { name: 'Browse source offerings' }));
    expect(screen.getByTestId('active-view').textContent).toBe('extensions');
    expect(screen.getByTestId('pending-extensions').textContent).toBe('skills');
  });

  it('shows a bounded marketplace load error without exposing raw details', async () => {
    (api.marketplace.listGenesisRegistries as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('C:\\operators\\private\\sources\\catalog.json returned a secret response'),
    );
    render(
      <AppStateProvider testInitialState={{ pendingSettingsIntent: { section: 'marketplaces' } }}>
        <SettingsView />
      </AppStateProvider>,
    );

    expect(await screen.findByText('Could not load enrolled sources. Try again.')).toBeTruthy();
    expect(screen.queryByText(/C:\\operators|secret response/)).toBeNull();
  });

  describe('Appearance section', () => {
    beforeEach(() => {
      localStorage.clear();
      document.documentElement.className = '';
      delete document.documentElement.dataset.theme;
      // The store is an app-lifetime singleton; re-sync it from the cleared
      // storage so each case starts from the default snapshot.
      appearanceStore.resetForTests();
    });

    it('renders theme, font size, and density controls', async () => {
      render(<SettingsView />);
      gotoTab('Appearance');

      expect(await screen.findByRole('heading', { name: 'Appearance' })).toBeTruthy();
      expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
      expect(screen.getByRole('radiogroup', { name: 'Font size' })).toBeTruthy();
      expect(screen.getByRole('radiogroup', { name: 'Density' })).toBeTruthy();
      // Dark is the default preference, so its radio reads as checked.
      expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    });

    it('applies and persists a theme change live', async () => {
      render(<SettingsView />);
      gotoTab('Appearance');

      fireEvent.click(await screen.findByRole('radio', { name: 'Light' }));

      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.theme)).toBe('light');
    });

    it('applies and persists a font-size change live', async () => {
      render(<SettingsView />);
      gotoTab('Appearance');

      fireEvent.click(await screen.findByRole('radio', { name: 'Large' }));

      expect(document.documentElement.classList.contains('font-scale-large')).toBe(true);
      expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.fontScale)).toBe('large');
    });

    it('applies and persists a density change live', async () => {
      render(<SettingsView />);
      gotoTab('Appearance');

      fireEvent.click(await screen.findByRole('radio', { name: 'Compact' }));

      expect(document.documentElement.classList.contains('density-compact')).toBe(true);
      expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.density)).toBe('compact');
    });

    it('moves theme selection with arrow keys', async () => {
      render(<SettingsView />);
      gotoTab('Appearance');

      const group = await screen.findByRole('radiogroup', { name: 'Theme' });
      // Dark is selected by default; ArrowRight advances to System.
      fireEvent.keyDown(group, { key: 'ArrowRight' });

      expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
      expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.theme)).toBe('system');
    });
  });
});
