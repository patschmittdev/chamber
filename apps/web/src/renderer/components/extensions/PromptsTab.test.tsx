/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { PromptsTab } from './PromptsTab';

function renderTab(api: ReturnType<typeof mockElectronAPI>, state?: Partial<AppState>) {
  installElectronAPI(api);
  return render(
    <AppStateProvider testInitialState={{ ...state }}>
      <PromptsTab />
    </AppStateProvider>,
  );
}

describe('PromptsTab', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  it('renders an empty state when the library has no prompts', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([]);
    renderTab(api);
    await waitFor(() => expect(screen.getByText('No saved prompts')).toBeTruthy());
    expect(api.prompts.list).toHaveBeenCalled();
  });

  it('lists saved prompts with their description and body', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([
      prompt({ id: 'p1', title: 'Standup', description: 'Daily update', body: 'What did I ship today?' }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText('Standup')).toBeTruthy());
    expect(screen.getByText('Daily update')).toBeTruthy();
    expect(screen.getByText('What did I ship today?')).toBeTruthy();
  });

  it('shows a New prompt action', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([]);
    renderTab(api);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New prompt' })).toBeTruthy());
  });

  it('creates a prompt through the dialog and refreshes the list', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([]);
    vi.mocked(api.prompts.save).mockResolvedValue({
      success: true,
      prompts: [prompt({ id: 'p1', title: 'Greeting', body: 'Hello there' })],
    });
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'New prompt' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Greeting' } });
    fireEvent.change(screen.getByLabelText('Prompt body'), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));

    await waitFor(() => expect(api.prompts.save).toHaveBeenCalled());
    const request = vi.mocked(api.prompts.save).mock.calls[0][0];
    expect(request.id).toBeNull();
    expect(request.title).toBe('Greeting');
    expect(request.body).toBe('Hello there');
    await waitFor(() => expect(screen.getByText('Greeting')).toBeTruthy());
  });

  it('opens the create dialog from a pending create-prompt intent', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([]);
    renderTab(api, { pendingExtensionsIntent: { tab: 'prompts', action: 'create-prompt' } });

    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy());
    expect(screen.getByLabelText('Prompt body')).toBeTruthy();
  });

  it('disables submit until required fields are present and rejects an over-long title', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([]);
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'New prompt' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));

    expect((screen.getByRole('button', { name: 'Save prompt' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'a'.repeat(201) } });
    fireEvent.change(screen.getByLabelText('Prompt body'), { target: { value: 'Body only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));

    await waitFor(() => expect(screen.getByText('Title must be at most 200 characters.')).toBeTruthy());
    expect(api.prompts.save).not.toHaveBeenCalled();
  });

  it('surfaces a save failure and keeps the dialog open', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([]);
    vi.mocked(api.prompts.save).mockResolvedValue({ success: false, error: 'Prompt library is desktop-only in browser mode.' });
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'New prompt' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Greeting' } });
    fireEvent.change(screen.getByLabelText('Prompt body'), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));

    await waitFor(() => expect(screen.getByText('Prompt library is desktop-only in browser mode.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeTruthy();
  });

  it('edits an existing prompt and saves with its id', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([
      prompt({ id: 'p1', title: 'Greeting', body: 'Hello there' }),
    ]);
    vi.mocked(api.prompts.save).mockResolvedValue({
      success: true,
      prompts: [prompt({ id: 'p1', title: 'Greeting', body: 'Hello friend' })],
    });
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Greeting' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Greeting' }));

    const body = await screen.findByLabelText('Prompt body');
    expect((body as HTMLTextAreaElement).value).toBe('Hello there');
    fireEvent.change(body, { target: { value: 'Hello friend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));

    await waitFor(() => expect(api.prompts.save).toHaveBeenCalled());
    const request = vi.mocked(api.prompts.save).mock.calls[0][0];
    expect(request.id).toBe('p1');
    expect(request.body).toBe('Hello friend');
  });

  it('deletes a prompt after confirming and refreshes the list', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([
      prompt({ id: 'p1', title: 'Greeting', body: 'Hello there' }),
    ]);
    vi.mocked(api.prompts.delete).mockResolvedValue({ success: true, prompts: [] });
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Greeting' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete Greeting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete prompt' }));

    await waitFor(() => expect(api.prompts.delete).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByText('No saved prompts')).toBeTruthy());
  });

  it('renders untrusted prompt content as text without executing markup', async () => {
    const untrusted = '<script>alert(1)</script> **bold**';
    vi.mocked(api.prompts.list).mockResolvedValue([
      prompt({ id: 'p1', title: 'Greeting', body: untrusted }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText(untrusted)).toBeTruthy());
    expect(document.querySelector('script')).toBeNull();
  });
});

function prompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: overrides.id ?? 'p1',
    title: overrides.title ?? 'Greeting',
    body: overrides.body ?? 'Hello there',
    description: overrides.description,
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2024-01-01T00:00:00.000Z',
  };
}
