/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pencil, Trash2 } from 'lucide-react';
import { installMenuDom } from '../../../test/helpers';
import { RowActionOverflowMenu, RowContextMenu, type RowActionItem } from './row-actions';

installMenuDom();

function items(overrides?: Partial<RowActionItem>[]): RowActionItem[] {
  return [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: vi.fn(), ...overrides?.[0] },
    { id: 'delete', label: 'Delete', icon: Trash2, onSelect: vi.fn(), danger: true, separatorBefore: true, ...overrides?.[1] },
  ];
}

describe('RowActionOverflowMenu', () => {
  afterEach(cleanup);

  it('exposes a labelled kebab trigger that is a real button', () => {
    render(<RowActionOverflowMenu items={items()} label="More actions for Monica" />);
    const trigger = screen.getByRole('button', { name: 'More actions for Monica' });
    expect(trigger.tagName).toBe('BUTTON');
  });

  it('groups the secondary actions behind the overflow trigger', () => {
    render(<RowActionOverflowMenu items={items()} label="More actions for Monica" />);
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();

    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for Monica' }), { key: 'Enter' });

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('runs the chosen action handler', () => {
    const rename = vi.fn();
    render(<RowActionOverflowMenu items={items([{ onSelect: rename }])} label="More actions" />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there are no actions', () => {
    const { container } = render(<RowActionOverflowMenu items={[]} label="More actions" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('RowContextMenu', () => {
  afterEach(cleanup);

  it('opens the same actions on right-click', () => {
    const del = vi.fn();
    render(
      <RowContextMenu items={items([{}, { onSelect: del }])}>
        <div>Monica row</div>
      </RowContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText('Monica row'));

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('leaves the row untouched when there are no actions', () => {
    render(
      <RowContextMenu items={[]}>
        <div>Plain row</div>
      </RowContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText('Plain row'));
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.getByText('Plain row')).toBeTruthy();
  });

  it('yields to the native menu when text is selected so Copy selection survives', () => {
    const original = window.getSelection;
    window.getSelection = (() => ({ toString: () => 'picked text' })) as typeof window.getSelection;
    try {
      render(
        <RowContextMenu items={items()}>
          <div>Monica row</div>
        </RowContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText('Monica row'));
      expect(screen.queryByRole('menuitem')).toBeNull();
    } finally {
      window.getSelection = original;
    }
  });
});
