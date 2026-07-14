/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { installMenuDom } from '../../../test/helpers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

installMenuDom();

function renderMenu(onSelect = vi.fn(), onRemove = vi.fn()) {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More actions">Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onSelect()}>Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onRemove()}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  return { onSelect, onRemove };
}

describe('DropdownMenu', () => {
  afterEach(cleanup);

  it('stays closed until the trigger is activated', () => {
    renderMenu();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
  });

  it('opens from the keyboard and exposes items as menuitems', () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('runs the item handler and closes when an item is chosen', async () => {
    const { onSelect } = renderMenu();
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    });
  });

  it('tags destructive items so danger styling and tests can target them', () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: 'Delete' }).getAttribute('data-variant')).toBe('destructive');
  });
});
