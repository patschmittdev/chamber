/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AgentModelControls } from './AgentModelControls';
import { AppStateProvider } from '../../lib/store';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { MindContext, ModelInfo } from '@chamber/shared/types';

const mind: MindContext = {
  mindId: 'ada-1',
  mindPath: 'C:\\agents\\ada',
  identity: { name: 'Ada', systemMessage: '' },
  status: 'ready',
  selectedModel: 'copilot:claude-sonnet',
};

const models: ModelInfo[] = [
  { id: 'claude-sonnet', name: 'Claude Sonnet' },
  { id: 'gpt-5', name: 'GPT-5' },
];

function renderControls() {
  render(
    <AppStateProvider testInitialState={{ minds: [mind], activeMindId: 'ada-1' }}>
      <AgentModelControls mind={mind} />
    </AppStateProvider>,
  );
}

describe('AgentModelControls', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
    (api.chat.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(models);
  });

  it('loads the agent models and marks the current selection', async () => {
    renderControls();
    await waitFor(() => {
      expect(api.chat.listModels).toHaveBeenCalledWith('ada-1');
    });
    const current = await screen.findByRole('radio', { name: /Claude Sonnet/ });
    expect(current.getAttribute('aria-checked')).toBe('true');
    const other = screen.getByRole('radio', { name: /GPT-5/ });
    expect(other.getAttribute('aria-checked')).toBe('false');
  });

  it('persists a new model selection through mind.setModel', async () => {
    renderControls();
    const other = await screen.findByRole('radio', { name: /GPT-5/ });
    fireEvent.click(other);
    await waitFor(() => {
      expect(api.mind.setModel).toHaveBeenCalledWith('ada-1', 'copilot:gpt-5');
    });
  });

  it('shows an empty state when no models are available', async () => {
    (api.chat.listModels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderControls();
    expect(await screen.findByText(/No models are available/i)).toBeTruthy();
  });
});
