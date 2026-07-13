import { describe, it, expect } from 'vitest';
import { CommandRegistry, findKeybindingConflicts, groupCommands } from './registry';
import type { Command } from './types';

function command(overrides: Partial<Command> & Pick<Command, 'id'>): Command {
  return {
    title: overrides.id,
    group: 'General',
    run: () => {},
    ...overrides,
  };
}

interface TestContext {
  prefix: string;
}

describe('CommandRegistry', () => {
  it('flattens providers in registration order', () => {
    const registry = new CommandRegistry<TestContext>();
    registry.register((ctx) => [command({ id: `${ctx.prefix}-a` })]);
    registry.register((ctx) => [command({ id: `${ctx.prefix}-b` }), command({ id: `${ctx.prefix}-c` })]);

    const ids = registry.build({ prefix: 'x' }).map((c) => c.id);

    expect(ids).toEqual(['x-a', 'x-b', 'x-c']);
  });

  it('rebuilds against the latest context each call', () => {
    const registry = new CommandRegistry<TestContext>();
    registry.register((ctx) => [command({ id: ctx.prefix })]);

    expect(registry.build({ prefix: 'first' }).map((c) => c.id)).toEqual(['first']);
    expect(registry.build({ prefix: 'second' }).map((c) => c.id)).toEqual(['second']);
  });

  it('throws when two commands claim the same chord', () => {
    const registry = new CommandRegistry<TestContext>();
    registry.register(() => [command({ id: 'palette', keybinding: { mod: true, key: 'k' } })]);
    registry.register(() => [command({ id: 'other', keybinding: { mod: true, key: 'k' } })]);

    expect(() => registry.build({ prefix: 'x' })).toThrowError(/mod\+k claimed by palette, other/);
  });

  it('allows distinct chords', () => {
    const registry = new CommandRegistry<TestContext>();
    registry.register(() => [command({ id: 'palette', keybinding: { mod: true, key: 'k' } })]);
    registry.register(() => [command({ id: 'help', keybinding: { key: '?' } })]);

    expect(() => registry.build({ prefix: 'x' })).not.toThrow();
  });
});

describe('findKeybindingConflicts', () => {
  it('ignores commands without a keybinding', () => {
    const conflicts = findKeybindingConflicts([command({ id: 'a' }), command({ id: 'b' })]);
    expect(conflicts).toEqual([]);
  });

  it('reports every command sharing a chord', () => {
    const conflicts = findKeybindingConflicts([
      command({ id: 'a', keybinding: { key: '?' } }),
      command({ id: 'b', keybinding: { key: '?' } }),
      command({ id: 'c', keybinding: { mod: true, key: 'k' } }),
    ]);

    expect(conflicts).toEqual([{ chordId: '?', commandIds: ['a', 'b'] }]);
  });

  it('treats a shift variant as conflicting with its base chord', () => {
    const conflicts = findKeybindingConflicts([
      command({ id: 'base', keybinding: { mod: true, key: 'k' } }),
      command({ id: 'shifted', keybinding: { mod: true, shift: true, key: 'k' } }),
    ]);

    expect(conflicts).toEqual([{ chordId: 'mod+k', commandIds: ['base', 'shifted'] }]);
  });
});

describe('groupCommands', () => {
  it('groups by group field preserving first-seen order', () => {
    const groups = groupCommands([
      command({ id: 'a', group: 'Views' }),
      command({ id: 'b', group: 'Agents' }),
      command({ id: 'c', group: 'Views' }),
    ]);

    expect(groups.map((g) => g.group)).toEqual(['Views', 'Agents']);
    expect(groups[0].items.map((c) => c.id)).toEqual(['a', 'c']);
    expect(groups[1].items.map((c) => c.id)).toEqual(['b']);
  });
});
