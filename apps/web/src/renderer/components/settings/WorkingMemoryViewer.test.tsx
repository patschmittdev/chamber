/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      { name: 'memory.md', label: 'Memory', present: true, content: '# Roadmap note', truncated: false, mtimeMs: 1_700_000_000_000 },
      { name: 'rules.md', label: 'Rules', present: false, content: '', truncated: false, mtimeMs: null },
      { name: 'log.md', label: 'Log', present: true, content: 'entry one', truncated: true, mtimeMs: 1_700_000_001_000 },
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

  it('shows a refresh button', () => {
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    expect(screen.getByRole('button', { name: /refresh working memory/i })).toBeTruthy();
  });

  it('re-reads when the refresh button is clicked', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue(memory());
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    await screen.findByText('Roadmap note');
    expect(api.mindMemory.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /refresh working memory/i }));
    await waitFor(() => {
      expect(api.mindMemory.read).toHaveBeenCalledTimes(2);
    });
  });

  it('shows a last-updated timestamp after a successful fetch', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue(memory());
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    expect(await screen.findByText(/updated/i)).toBeTruthy();
  });

  it('shows animated loading skeletons while fetching', () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText(/loading memory/i)).toBeNull();
  });

  it('shows an Alert on read failure, not a plain paragraph', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Mind ada-1 not found'));
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Mind ada-1 not found');
  });

  it('shows EmptyState when the .working-memory directory is absent', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue({
      mindId: 'ada-1',
      present: false,
      files: [],
    });
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    expect(await screen.findByText(/no working memory yet/i)).toBeTruthy();
  });

  it('renders file contents, an absent note, and a truncation notice', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue(memory());
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);

    expect(await screen.findByText('Roadmap note')).toBeTruthy();
    expect(screen.getByText('No rules file yet.')).toBeTruthy();
    expect(screen.getByText(/file truncated/i)).toBeTruthy();
    expect(api.mindMemory.read).toHaveBeenCalledWith('ada-1');
  });

  it('shows per-file modified time when mtimeMs is present', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue(memory());
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    await screen.findByText('Roadmap note');
    const modifiedElements = document.querySelectorAll('[aria-label*="Last modified"]');
    expect(modifiedElements.length).toBeGreaterThan(0);
  });

  it('includes the full file path in the truncation notice as an open-full affordance', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue(memory());
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    await screen.findByText('Roadmap note');
    const truncationEl = screen.getByText(/file truncated/i).closest('div');
    expect(truncationEl?.textContent).toContain('log.md');
  });

  it('does not show raw filenames as prominent section labels', async () => {
    (api.mindMemory.read as ReturnType<typeof vi.fn>).mockResolvedValue(memory());
    render(<WorkingMemoryViewer mindId="ada-1" precedence={precedenceWithMemory('ada-1')} />);
    await screen.findByText('Roadmap note');
    const headings = Array.from(document.querySelectorAll('h5')).map((h) => h.textContent);
    expect(headings).toContain('Memory');
    expect(headings).toContain('Rules');
    expect(headings).toContain('Log');
    expect(headings.some((h) => h?.endsWith('.md'))).toBe(false);
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

  it('shows the fallback explainer when no precedence layer is available', () => {
    render(<WorkingMemoryViewer mindId="ada-1" precedence={undefined} />);
    expect(screen.getByText(/working memory files appear after the agent is fully loaded/i)).toBeTruthy();
  });
});
