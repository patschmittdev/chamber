/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageVariantPager } from './MessageVariantPager';

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('MessageVariantPager', () => {
  it('renders nothing when there is only one version', () => {
    const { container } = render(<MessageVariantPager index={0} count={1} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the one-based current and total counts', () => {
    render(<MessageVariantPager index={1} count={3} onSelect={vi.fn()} />);
    expect(screen.getByText('2/3')).toBeTruthy();
  });

  it('selects the previous and next branch within bounds', () => {
    const onSelect = vi.fn();
    render(<MessageVariantPager index={1} count={3} onSelect={onSelect} />);

    fireEvent.click(button('Previous version'));
    expect(onSelect).toHaveBeenCalledWith(0);

    fireEvent.click(button('Next version'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('disables previous on the first branch', () => {
    const onSelect = vi.fn();
    render(<MessageVariantPager index={0} count={2} onSelect={onSelect} />);

    const prev = button('Previous version');
    expect(prev.disabled).toBe(true);
    fireEvent.click(prev);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables next on the last branch', () => {
    const onSelect = vi.fn();
    render(<MessageVariantPager index={1} count={2} onSelect={onSelect} />);

    const next = button('Next version');
    expect(next.disabled).toBe(true);
    fireEvent.click(next);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
