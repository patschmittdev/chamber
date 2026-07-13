/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkingMemoryViewer } from './WorkingMemoryViewer';
import { installElectronAPI } from '../../../test/helpers';
import type { MindInstructionPrecedence, MindWorkingMemory } from '@chamber/shared/types';

function precedenceWithMemory(mindId: string): MindInstructionPrecedence {
  return {
    mindId,
    mindName: mindId,
    globalCustomInstructionsEnabled: true,
    hasGlobalCustomInstructions: true,
    layers: [
      {
        id: 'working-memory',
        label: 'Working memory',
        source: 'C:\\agents\\ada\\.working-memory',
        description: 'Notes the agent keeps across turns.',
        included: true,
        present: true,
        enabled: true,
        contentExposed: false,
      },
    ],
  };
}

function memory(overrides?: Partial<MindWorkingMemory>): MindWorkingMemory {
  return {
    mindId: 'ada-1',
    present: true,
    files: [
      { name: 'memory.md', label: 'Memory', present: true, content: '# Roadmap note', truncated: false, mtimeMs: 1 },
      { name: 'rules.md', label: 'Rules', present: false, content: '', truncated: false, mtimeMs: null },
      { name: 'log.md', label: 'Log', present: true, content: 'entry one', truncated: true, mtimeMs: 2 },
    ],
    ...overrides,
  };
}

describe('WorkingMemoryViewer', () => {
  let api: ReturnType<typeof installElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('shows the status badge and source path from the precedence layer', () => {
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    expect(screen.getByText('Working memory')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('C:\\agents\\ada\\.working-memory')).toBeTruthy();
  });

  it('renders file contents, an absent note, and a truncation note', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue(memory());
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);

    expect(await screen.findByText('Roadmap note')).toBeTruthy();
    expect(screen.getByText('No rules file yet.')).toBeTruthy();
    expect(screen.getByText('Showing the first part of a large file.')).toBeTruthy();
    expect(api.mindMemory.read).toHaveBeenCalledWith('ada-1');
  });

  it('shows an empty-file note when a present file has no content', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue(
      memory({
        files: [
          { name: 'memory.md', label: 'Memory', present: true, content: '   ', truncated: false, mtimeMs: 1 },
          { name: 'rules.md', label: 'Rules', present: false, content: '', truncated: false, mtimeMs: null },
          { name: 'log.md', label: 'Log', present: false, content: '', truncated: false, mtimeMs: null },
        ],
      }),
    );
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    expect(await screen.findByText('This file is empty.')).toBeTruthy();
  });

  it('surfaces a read failure as a status line', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Mind ada-1 not found'));
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    expect(await screen.findByText('Mind ada-1 not found')).toBeTruthy();
  });
});
