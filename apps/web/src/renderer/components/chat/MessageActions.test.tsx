/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChatMessage, ModelInfo } from '@chamber/shared/types';
import { MessageActions, useMessageActionItems } from './MessageActions';
import { RowContextMenu } from '../ui/row-actions';
import { installMenuDom } from '../../../test/helpers';

installMenuDom();

type MessageActionInput = Parameters<typeof useMessageActionItems>[0];

function ContextHarness(props: MessageActionInput) {
  const items = useMessageActionItems(props);
  return (
    <RowContextMenu items={items}>
      <div data-testid="message-body">Message body</div>
    </RowContextMenu>
  );
}

function assistantMsg(overrides?: Partial<ChatMessage>): ChatMessage {
  return { id: 'a1', role: 'assistant', blocks: [{ type: 'text', content: '# Title\n\nBody' }], timestamp: 2, eventId: 'evt-a1', ...overrides };
}

function model(id: string, name: string, provider?: ModelInfo['provider']): ModelInfo {
  return provider ? { id, name, provider } : { id, name };
}

function modelOption(name: string): HTMLElement {
  const items = Array.from(document.querySelectorAll('[data-slot="command-item"]')) as HTMLElement[];
  const match = items.find((el) => el.textContent?.includes(name));
  if (!match) throw new Error(`No model option matching ${name}`);
  return match;
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function queryButton(name: string): HTMLButtonElement | null {
  return screen.queryByRole('button', { name }) as HTMLButtonElement | null;
}

describe('MessageActions', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('copies plain text and raw markdown from distinct buttons', () => {
    render(<MessageActions message={assistantMsg()} isBusy={false} />);

    fireEvent.click(button('Copy message'));
    expect(writeText).toHaveBeenCalledWith('Title\n\nBody');

    fireEvent.click(button('Copy as markdown'));
    expect(writeText).toHaveBeenCalledWith('# Title\n\nBody');
  });

  it('hides mutating actions when the parent supplies none (e.g. browser mode)', () => {
    render(<MessageActions message={assistantMsg()} isBusy={false} />);

    expect(queryButton('Regenerate response')).toBeNull();
    expect(queryButton('Edit message')).toBeNull();
    expect(queryButton('Fork conversation from here')).toBeNull();
    expect(queryButton('Delete this message and all following messages')).toBeNull();
    expect(button('Copy message')).toBeTruthy();
  });

  it('runs Regenerate when enabled and disables it with a tooltip when a reason is given', () => {
    const onRun = vi.fn();
    const { rerender } = render(
      <MessageActions message={assistantMsg()} isBusy={false} regenerate={{ onRun }} />,
    );

    fireEvent.click(button('Regenerate response'));
    expect(onRun).toHaveBeenCalledTimes(1);

    rerender(
      <MessageActions message={assistantMsg()} isBusy={false} regenerate={{ onRun, disabledReason: 'no images yet' }} />,
    );
    const regen = button('Regenerate response');
    expect(regen.disabled).toBe(true);
    expect(regen.title).toBe('no images yet');
    fireEvent.click(regen);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('regenerates with the current model when the plain Regenerate button is clicked', () => {
    const onRun = vi.fn();
    render(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        regenerate={{ onRun, models: [model('model-1', 'Model 1')], currentModel: 'copilot:model-1' }}
      />,
    );

    fireEvent.click(button('Regenerate response'));
    expect(onRun).toHaveBeenCalledWith();
  });

  it('regenerates one-shot with a chosen model from the submenu', () => {
    const onRun = vi.fn();
    render(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        regenerate={{
          onRun,
          models: [model('model-1', 'Model 1'), model('model-2', 'Model 2')],
          currentModel: 'copilot:model-1',
        }}
      />,
    );

    fireEvent.click(button('Regenerate with a different model'));
    fireEvent.click(modelOption('Model 2'));
    expect(onRun).toHaveBeenCalledWith('copilot:model-2');
  });

  it('keeps the action row visible while the model menu is open', () => {
    render(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        regenerate={{
          onRun: vi.fn(),
          models: [model('model-1', 'Model 1'), model('model-2', 'Model 2')],
          currentModel: 'copilot:model-1',
        }}
      />,
    );

    const row = button('Regenerate response').closest('div') as HTMLElement;
    const tokens = () => row.className.split(/\s+/);
    expect(tokens()).toContain('opacity-0');

    fireEvent.click(button('Regenerate with a different model'));
    expect(tokens()).toContain('opacity-100');
    expect(tokens()).not.toContain('opacity-0');
  });

  it('exposes each model as a selectable option with an accessible name', () => {
    render(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        regenerate={{
          onRun: vi.fn(),
          models: [model('model-1', 'Model 1'), model('model-2', 'Model 2')],
          currentModel: 'copilot:model-1',
        }}
      />,
    );

    fireEvent.click(button('Regenerate with a different model'));
    expect(screen.getByLabelText('Search models to regenerate with')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Model 1/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Model 2/ })).toBeTruthy();
  });

  it('regenerates one-shot with a chosen model via keyboard selection', () => {
    const onRun = vi.fn();
    render(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        regenerate={{
          onRun,
          models: [model('model-1', 'Model 1'), model('model-2', 'Model 2')],
          currentModel: 'copilot:model-1',
        }}
      />,
    );

    fireEvent.click(button('Regenerate with a different model'));
    const search = screen.getByLabelText('Search models to regenerate with');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onRun).toHaveBeenCalledWith(expect.stringMatching(/^copilot:/));
  });

  it('omits the model submenu unless at least two models are available', () => {
    const { rerender } = render(
      <MessageActions message={assistantMsg()} isBusy={false} regenerate={{ onRun: vi.fn(), models: [] }} />,
    );
    expect(queryButton('Regenerate with a different model')).toBeNull();
    expect(button('Regenerate response')).toBeTruthy();

    rerender(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        regenerate={{ onRun: vi.fn(), models: [model('model-1', 'Model 1')], currentModel: 'copilot:model-1' }}
      />,
    );
    expect(queryButton('Regenerate with a different model')).toBeNull();
    expect(button('Regenerate response')).toBeTruthy();
  });

  it('disables the model submenu while busy and when a regenerate reason is given', () => {
    const models = [model('model-1', 'Model 1'), model('model-2', 'Model 2')];
    const { rerender } = render(
      <MessageActions message={assistantMsg()} isBusy regenerate={{ onRun: vi.fn(), models }} />,
    );
    expect(button('Regenerate with a different model').disabled).toBe(true);

    rerender(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        regenerate={{ onRun: vi.fn(), models, disabledReason: 'no images yet' }}
      />,
    );
    const caret = button('Regenerate with a different model');
    expect(caret.disabled).toBe(true);
    expect(caret.title).toBe('no images yet');
  });

  it('runs Edit when enabled and disables it with a tooltip when a reason is given', () => {
    const onRun = vi.fn();
    const { rerender } = render(
      <MessageActions message={assistantMsg()} isBusy={false} edit={{ onRun }} />,
    );

    fireEvent.click(button('Edit message'));
    expect(onRun).toHaveBeenCalledTimes(1);

    rerender(
      <MessageActions message={assistantMsg()} isBusy={false} edit={{ onRun, disabledReason: 'has images' }} />,
    );
    const edit = button('Edit message');
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe('has images');
  });

  it('runs Fork from here when enabled and disables it while streaming', () => {
    const onRun = vi.fn();
    const { rerender } = render(
      <MessageActions message={assistantMsg()} isBusy={false} fork={{ onRun }} />,
    );

    fireEvent.click(button('Fork conversation from here'));
    expect(onRun).toHaveBeenCalledTimes(1);

    rerender(
      <MessageActions message={assistantMsg()} isBusy fork={{ onRun }} />,
    );
    const fork = button('Fork conversation from here');
    expect(fork.disabled).toBe(true);
  });

  it('disables Fork from here with a tooltip when a reason is given', () => {
    const onRun = vi.fn();
    render(
      <MessageActions message={assistantMsg()} isBusy={false} fork={{ onRun, disabledReason: 'waiting for sync' }} />,
    );

    const fork = button('Fork conversation from here');
    expect(fork.disabled).toBe(true);
    expect(fork.title).toBe('waiting for sync');
  });

  it('requires a confirmation before deleting and clarifies the range', () => {
    const onDelete = vi.fn();
    render(<MessageActions message={assistantMsg()} isBusy={false} onDelete={onDelete} />);

    fireEvent.click(button('Delete this message and all following messages'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Remove this and all later turns?')).toBeTruthy();

    fireEvent.click(button('Confirm delete from here'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending delete without invoking the handler', () => {
    const onDelete = vi.fn();
    render(<MessageActions message={assistantMsg()} isBusy={false} onDelete={onDelete} />);

    fireEvent.click(button('Delete this message and all following messages'));
    fireEvent.click(button('Cancel delete'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(button('Delete this message and all following messages')).toBeTruthy();
  });

  it('supports a controlled pending-delete state so another surface can open the same confirm', () => {
    const onDelete = vi.fn();
    const onConfirmingDeleteChange = vi.fn();
    const { rerender } = render(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        onDelete={onDelete}
        confirmingDelete={false}
        onConfirmingDeleteChange={onConfirmingDeleteChange}
      />,
    );
    expect(queryButton('Confirm delete from here')).toBeNull();

    rerender(
      <MessageActions
        message={assistantMsg()}
        isBusy={false}
        onDelete={onDelete}
        confirmingDelete
        onConfirmingDeleteChange={onConfirmingDeleteChange}
      />,
    );
    expect(screen.getByText('Remove this and all later turns?')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    const row = button('Confirm delete from here').closest('div') as HTMLElement;
    expect(row.className.split(/\s+/)).toContain('opacity-100');

    fireEvent.click(button('Confirm delete from here'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onConfirmingDeleteChange).toHaveBeenLastCalledWith(false);
  });

  it('holds mutating actions while a turn is streaming but still allows copy', () => {
    render(
      <MessageActions
        message={assistantMsg()}
        isBusy
        regenerate={{ onRun: vi.fn() }}
        edit={{ onRun: vi.fn() }}
        fork={{ onRun: vi.fn() }}
        onDelete={vi.fn()}
      />,
    );

    expect(button('Regenerate response').disabled).toBe(true);
    expect(button('Edit message').disabled).toBe(true);
    expect(button('Fork conversation from here').disabled).toBe(true);
    expect(button('Delete this message and all following messages').disabled).toBe(true);
    expect(button('Copy message').disabled).toBe(false);
  });

  it('exposes the same actions through a right-click context menu (shell-F4/rail-H3)', () => {
    render(
      <ContextHarness
        message={assistantMsg()}
        isBusy={false}
        regenerate={{ onRun: vi.fn() }}
        fork={{ onRun: vi.fn() }}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole('menuitem', { name: 'Copy' })).toBeNull();
    fireEvent.contextMenu(screen.getByTestId('message-body'));

    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy as markdown' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Regenerate' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Fork from here' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete from here' })).toBeTruthy();
  });

  it('routes a context-menu selection to the same handler as the inline row', () => {
    const onRun = vi.fn();
    render(<ContextHarness message={assistantMsg()} isBusy={false} regenerate={{ onRun }} />);

    fireEvent.contextMenu(screen.getByTestId('message-body'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate' }));

    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('copies plain text through the context menu Copy item', () => {
    render(<ContextHarness message={assistantMsg()} isBusy={false} />);

    fireEvent.contextMenu(screen.getByTestId('message-body'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith('Title\n\nBody');
  });
});
