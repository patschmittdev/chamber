/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { installMenuDom } from '../../../test/helpers';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './context-menu';

installMenuDom();

function renderMenu(onSelect = vi.fn(), onRemove = vi.fn()) {
  render(
    <ContextMenu>
      <ContextMenuTrigger>
        <div>Row body</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onSelect()}>Rename</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onRemove()}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>,
  );
  return { onSelect, onRemove };
}

describe('ContextMenu', () => {
  afterEach(cleanup);

  it('stays closed until the trigger is right-clicked', () => {
    renderMenu();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
  });

  it('opens on contextmenu and exposes items as menuitems', () => {
    renderMenu();
    fireEvent.contextMenu(screen.getByText('Row body'));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('runs the item handler when an item is chosen', () => {
    const { onRemove } = renderMenu();
    fireEvent.contextMenu(screen.getByText('Row body'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
