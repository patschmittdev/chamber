/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindContext } from '@chamber/shared/types';
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

  it('lists skills discovered for the active mind', async () => {
    vi.mocked(api.skills.listForMind).mockResolvedValue([
      { id: 'lens', name: 'Lens', version: '1.2.0', description: 'Build views' },
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText('Lens')).toBeTruthy());
    expect(api.skills.listForMind).toHaveBeenCalledWith('mind-1');
    expect(screen.getByText('v1.2.0')).toBeTruthy();
    expect(screen.getByText('Build views')).toBeTruthy();
  });

  it('renders an empty state when the mind has no skills', async () => {
    vi.mocked(api.skills.listForMind).mockResolvedValue([]);
    renderTab(api);
    await waitFor(() => expect(screen.getByText('No skills found')).toBeTruthy());
  });
});
