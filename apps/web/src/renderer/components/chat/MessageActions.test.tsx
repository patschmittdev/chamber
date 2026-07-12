/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChatMessage } from '@chamber/shared/types';
import { MessageActions } from './MessageActions';

function assistantMsg(overrides?: Partial<ChatMessage>): ChatMessage {
  return { id: 'a1', role: 'assistant', blocks: [{ type: 'text', content: '# Title\n\nBody' }], timestamp: 2, eventId: 'evt-a1', ...overrides };
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
    render(<MessageActions message={assistantMsg()} isStreaming={false} />);

    fireEvent.click(button('Copy message'));
    expect(writeText).toHaveBeenCalledWith('Title\n\nBody');

    fireEvent.click(button('Copy as markdown'));
    expect(writeText).toHaveBeenCalledWith('# Title\n\nBody');
  });

  it('hides mutating actions when the parent supplies none (e.g. browser mode)', () => {
    render(<MessageActions message={assistantMsg()} isStreaming={false} />);

    expect(queryButton('Regenerate response')).toBeNull();
    expect(queryButton('Edit message')).toBeNull();
    expect(queryButton('Delete this message and all following messages')).toBeNull();
    expect(button('Copy message')).toBeTruthy();
  });

  it('runs Regenerate when enabled and disables it with a tooltip when a reason is given', () => {
    const onRun = vi.fn();
    const { rerender } = render(
      <MessageActions message={assistantMsg()} isStreaming={false} regenerate={{ onRun }} />,
    );

    fireEvent.click(button('Regenerate response'));
    expect(onRun).toHaveBeenCalledTimes(1);

    rerender(
      <MessageActions message={assistantMsg()} isStreaming={false} regenerate={{ onRun, disabledReason: 'no images yet' }} />,
    );
    const regen = button('Regenerate response');
    expect(regen.disabled).toBe(true);
    expect(regen.title).toBe('no images yet');
    fireEvent.click(regen);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('runs Edit when enabled and disables it with a tooltip when a reason is given', () => {
    const onRun = vi.fn();
    const { rerender } = render(
      <MessageActions message={assistantMsg()} isStreaming={false} edit={{ onRun }} />,
    );

    fireEvent.click(button('Edit message'));
    expect(onRun).toHaveBeenCalledTimes(1);

    rerender(
      <MessageActions message={assistantMsg()} isStreaming={false} edit={{ onRun, disabledReason: 'has images' }} />,
    );
    const edit = button('Edit message');
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe('has images');
  });

  it('requires a confirmation before deleting and clarifies the range', () => {
    const onDelete = vi.fn();
    render(<MessageActions message={assistantMsg()} isStreaming={false} onDelete={onDelete} />);

    fireEvent.click(button('Delete this message and all following messages'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Remove this and all later turns?')).toBeTruthy();

    fireEvent.click(button('Confirm delete from here'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending delete without invoking the handler', () => {
    const onDelete = vi.fn();
    render(<MessageActions message={assistantMsg()} isStreaming={false} onDelete={onDelete} />);

    fireEvent.click(button('Delete this message and all following messages'));
    fireEvent.click(button('Cancel delete'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(button('Delete this message and all following messages')).toBeTruthy();
  });

  it('holds mutating actions while a turn is streaming but still allows copy', () => {
    render(
      <MessageActions
        message={assistantMsg()}
        isStreaming
        regenerate={{ onRun: vi.fn() }}
        edit={{ onRun: vi.fn() }}
        onDelete={vi.fn()}
      />,
    );

    expect(button('Regenerate response').disabled).toBe(true);
    expect(button('Edit message').disabled).toBe(true);
    expect(button('Delete this message and all following messages').disabled).toBe(true);
    expect(button('Copy message').disabled).toBe(false);
  });
});
