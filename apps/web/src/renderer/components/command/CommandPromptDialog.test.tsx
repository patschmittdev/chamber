/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CommandPromptRequest } from './appCommands';
import { CommandPromptDialog } from './CommandPromptDialog';

afterEach(cleanup);

function makeRequest(overrides: Partial<CommandPromptRequest> = {}): CommandPromptRequest {
  return {
    title: 'Rename conversation',
    label: 'Conversation title',
    initialValue: 'Old title',
    submitLabel: 'Rename',
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe('CommandPromptDialog', () => {
  it('renders nothing when there is no request', () => {
    render(<CommandPromptDialog request={null} onClose={vi.fn()} />);
    expect(screen.queryByText('Conversation title')).toBeNull();
  });

  it('seeds the field with the request initial value', () => {
    render(<CommandPromptDialog request={makeRequest()} onClose={vi.fn()} />);
    expect((screen.getByLabelText('Conversation title') as HTMLInputElement).value).toBe('Old title');
  });

  it('submits the trimmed value and closes on confirm', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<CommandPromptDialog request={makeRequest({ onSubmit })} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Conversation title'), { target: { value: '  New title  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onSubmit).toHaveBeenCalledWith('New title');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits a single-line field on Enter', () => {
    const onSubmit = vi.fn();
    render(<CommandPromptDialog request={makeRequest({ onSubmit })} onClose={vi.fn()} />);

    const input = screen.getByLabelText('Conversation title');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('Renamed');
  });

  it('disables confirm while the trimmed value is empty', () => {
    render(<CommandPromptDialog request={makeRequest({ initialValue: '   ' })} onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes without submitting when Cancel is pressed', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<CommandPromptDialog request={makeRequest({ onSubmit })} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a textarea and keeps Enter for newlines when multiline', () => {
    const onSubmit = vi.fn();
    render(
      <CommandPromptDialog
        request={makeRequest({ multiline: true, label: 'System prompt', initialValue: 'Base', submitLabel: 'Save', onSubmit })}
        onClose={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText('System prompt');
    expect(textarea.tagName).toBe('TEXTAREA');

    fireEvent.change(textarea, { target: { value: 'Base' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith('Base');
  });
});
