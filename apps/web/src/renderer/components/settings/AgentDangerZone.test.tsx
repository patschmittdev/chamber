/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AgentDangerZone } from './AgentDangerZone';
import { AppStateProvider } from '../../lib/store';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { MindContext } from '@chamber/shared/types';

const mind: MindContext = {
  mindId: 'ada-1',
  mindPath: 'C:\\agents\\ada',
  identity: { name: 'Ada', systemMessage: '' },
  status: 'ready',
};

function renderDangerZone() {
  render(
    <AppStateProvider testInitialState={{ minds: [mind], activeMindId: 'ada-1' }}>
      <AgentDangerZone mind={mind} displayName="Ada" />
    </AppStateProvider>,
  );
}

describe('AgentDangerZone', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('removes the agent only after the confirmation is accepted', async () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole('button', { name: 'Remove agent' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove Ada?')).toBeTruthy();
    expect(api.mind.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove agent' }));
    await waitFor(() => {
      expect(api.mind.remove).toHaveBeenCalledWith('ada-1');
    });
  });

  it('does not remove the agent when the confirmation is cancelled', async () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole('button', { name: 'Remove agent' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.mind.remove).not.toHaveBeenCalled();
  });
});
