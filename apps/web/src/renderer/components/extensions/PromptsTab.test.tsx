/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider, useAppState } from '../../lib/store';
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

function StateProbe() {
  const { activeView, activeMindId, composeDraftByMind } = useAppState();
  return (
    <>
      <div data-testid="active-view">{activeView}</div>
      <div data-testid="compose-draft">{activeMindId ? (composeDraftByMind[activeMindId] ?? '') : ''}</div>
    </>
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

  it('lists saved prompts without disclosing their body outside the editor', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([
      prompt({ id: 'p1', title: 'Standup', description: 'Daily update', body: 'What did I ship today?' }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText('Standup')).toBeTruthy());
    expect(screen.getByText('Daily update')).toBeTruthy();
    expect(screen.queryByText('What did I ship today?')).toBeNull();
  });

  it('shows a New prompt action', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([]);
    renderTab(api);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New prompt' })).toBeTruthy());
  });

  it('creates a prompt through the focused editor and refreshes the list', async () => {
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

  it('opens the focused editor from a pending create-prompt intent', async () => {
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
    fireEvent.blur(screen.getByLabelText('Title'));

    await waitFor(() => expect(screen.getByText('Title must be at most 200 characters.')).toBeTruthy());
    expect(api.prompts.save).not.toHaveBeenCalled();
  });

  it('surfaces a save failure and keeps the editor open', async () => {
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

    await waitFor(() => expect(screen.getByRole('option', { name: /Greeting/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: /Greeting/ }));

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

    await waitFor(() => expect(screen.getByRole('option', { name: /Greeting/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: /Greeting/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete prompt' }));

    await waitFor(() => expect(api.prompts.delete).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByText('No saved prompts')).toBeTruthy());
  });

  it('renders untrusted prompt content as text in the authorized editor without executing markup', async () => {
    const untrusted = '<script>alert(1)</script> **bold**';
    vi.mocked(api.prompts.list).mockResolvedValue([
      prompt({ id: 'p1', title: 'Greeting', body: untrusted }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('option', { name: /Greeting/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: /Greeting/ }));
    await waitFor(() => expect(screen.getByText(untrusted)).toBeTruthy());
    expect(document.querySelector('script')).toBeNull();
  });

  it('requires an explicit discard before switching away from unsaved edits', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([
      prompt({ id: 'p1', title: 'Greeting', body: 'Hello there' }),
      prompt({ id: 'p2', title: 'Standup', body: 'Yesterday' }),
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByRole('option', { name: /Greeting/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: /Greeting/ }));
    fireEvent.change(await screen.findByLabelText('Prompt body'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('option', { name: /Standup/ }));

    expect(screen.getByText('You have unsaved edits. Discard them and continue?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits' }));
    expect((await screen.findByLabelText('Prompt body') as HTMLTextAreaElement).value).toBe('Yesterday');
  });

  it('links manual prompt authoring to agentic authoring in chat', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([]);
    render(
      <AppStateProvider testInitialState={{ activeMindId: 'mind-1', activeView: 'extensions' }}>
        <PromptsTab />
        <StateProbe />
      </AppStateProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Draft with active mind' }));
    expect(screen.getByTestId('active-view').textContent).toBe('chat');
    expect(screen.getByTestId('compose-draft').textContent).toContain('Create a reusable prompt');
  });

  it('requires an explicit discard before handing unsaved prompt edits to the active mind', async () => {
    vi.mocked(api.prompts.list).mockResolvedValue([
      prompt({ id: 'p1', title: 'Greeting', body: 'Hello there' }),
    ]);
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{ activeMindId: 'mind-1', activeView: 'extensions' }}>
        <PromptsTab />
        <StateProbe />
      </AppStateProvider>,
    );

    await waitFor(() => expect(screen.getByRole('option', { name: /Greeting/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: /Greeting/ }));
    fireEvent.change(await screen.findByLabelText('Prompt body'), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft with active mind' }));

    expect(screen.getByText('You have unsaved edits. Discard them and continue?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits' }));
    expect(screen.getByTestId('active-view').textContent).toBe('chat');
    expect(screen.getByTestId('compose-draft').textContent).toContain('Create a reusable prompt');
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
