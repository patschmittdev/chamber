/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CapabilityInventoryItem, CapabilityInventoryResult } from '@chamber/shared';
import { CuratedDirectory } from './CuratedDirectory';

function renderDirectory(result: CapabilityInventoryResult = directoryResult()) {
  const reload = vi.fn();
  const onManageTools = vi.fn();
  render(
    <CuratedDirectory
      inventory={{ status: 'ready', result, reload }}
      onManageTools={onManageTools}
    />,
  );
  return { reload, onManageTools };
}

describe('CuratedDirectory', () => {
  it('searches and filters safe curated entries without mixing in installed inventory', () => {
    renderDirectory();

    expect(screen.getByText('Release Helper')).toBeTruthy();
    expect(screen.getByText('Repository Lens')).toBeTruthy();
    expect(screen.queryByText('Installed Writer')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search curated extensions' }), {
      target: { value: 'release' },
    });
    expect(screen.getByText('Release Helper')).toBeTruthy();
    expect(screen.queryByText('Repository Lens')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search curated extensions' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Skills 1' }));
    expect(screen.getByText('Repository Lens')).toBeTruthy();
    expect(screen.queryByText('Release Helper')).toBeNull();
  });

  it('renders a bounded, redacted detail surface with declared capabilities and use cases', () => {
    renderDirectory(directoryResult([
      availableTool({
        description: String.raw`C:\secrets\tool --token hidden https://mcp.example.test/private`,
        provenance: { kind: 'marketplace', label: 'mcp --header X-Key: value' },
        declaredCapabilities: [{ id: 'deploy', label: 'Authorization header' }],
      }),
    ]));

    fireEvent.click(screen.getByRole('button', { name: 'View details for Release Helper' }));

    expect(screen.getAllByRole('heading', { name: 'Release Helper' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('A curated source-defined tool for the global workspace.').length).toBeGreaterThan(0);
    expect(screen.getByText('Enrolled source')).toBeTruthy();
    expect(screen.getByText('Illustrative use cases')).toBeTruthy();
    expect(screen.getByText('deploy')).toBeTruthy();
    expect(screen.queryByText(/C:\\secrets|https:\/\/example|Authorization header|hidden|mcp --header|X-Key/)).toBeNull();
  });

  it('shows target scope and declared configuration results before routing to the source-specific tool flow', () => {
    const { onManageTools } = renderDirectory();

    fireEvent.click(screen.getByRole('button', { name: 'View details for Release Helper' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review install preflight' }));

    expect(screen.getByText('Target scope')).toBeTruthy();
    expect(screen.getByText('Global workspace')).toBeTruthy();
    expect(screen.getByText('Declared result')).toBeTruthy();
    expect(screen.getByText('Registers this tool as installed in the global workspace.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open tools management' }));
    expect(onManageTools).toHaveBeenCalledOnce();
  });

  it('honestly marks sources without an established install path as unavailable', () => {
    renderDirectory(directoryResult([availableSkill()]));

    fireEvent.click(screen.getByRole('button', { name: 'View details for Repository Lens' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review install preflight' }));

    expect(screen.getByText('Installation unavailable from this directory.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open tools management' })).toBeNull();
  });

  it('provides accessible loading, error, and empty feedback', () => {
    const reload = vi.fn();
    const onManageTools = vi.fn();
    const { rerender } = render(
      <CuratedDirectory
        inventory={{ status: 'loading', result: { items: [], sources: [] }, reload }}
        onManageTools={onManageTools}
      />,
    );

    expect(screen.getByText('Loading curated extensions...')).toBeTruthy();

    rerender(
      <CuratedDirectory
        inventory={{ status: 'error', result: { items: [], sources: [] }, reload }}
        onManageTools={onManageTools}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Could not discover curated extensions');
    fireEvent.click(screen.getByRole('button', { name: 'Retry discovery' }));
    expect(reload).toHaveBeenCalledOnce();

    rerender(
      <CuratedDirectory
        inventory={{ status: 'ready', result: { items: [], sources: [] }, reload }}
        onManageTools={onManageTools}
      />,
    );
    expect(screen.getByText('No curated extensions available')).toBeTruthy();
  });
});

function directoryResult(items: CapabilityInventoryItem[] = [availableTool(), availableSkill(), installedSkill()]): CapabilityInventoryResult {
  return { items, sources: [{ id: 'catalog', label: 'Enrolled catalog', status: 'healthy' }] };
}

function availableTool(overrides: Partial<CapabilityInventoryItem> = {}): CapabilityInventoryItem {
  return {
    ref: { kind: 'cli-tool', id: 'catalog:release-helper', scope: { kind: 'global' } },
    displayName: 'Release Helper',
    description: 'Prepares release notes.',
    provenance: { kind: 'marketplace', label: 'Enrolled catalog' },
    lifecycle: { installation: 'available', activation: 'disabled', availability: 'available' },
    requirements: [{ label: 'Node runtime', status: 'met' }],
    compatibility: { status: 'compatible' },
    declaredCapabilities: [{ id: 'release-notes', label: 'Release notes' }],
    health: { status: 'healthy' },
    ...overrides,
  };
}

function availableSkill(): CapabilityInventoryItem {
  return {
    ref: { kind: 'skill', id: 'repository-lens', scope: { kind: 'mind', mindId: 'mind-1' } },
    displayName: 'Repository Lens',
    description: 'Summarizes repository structure.',
    provenance: { kind: 'marketplace', label: 'Enrolled catalog' },
    lifecycle: { installation: 'available', activation: 'disabled', availability: 'available' },
    requirements: [{ label: 'Required skill files', status: 'unknown' }],
    compatibility: { status: 'unknown' },
    declaredCapabilities: [{ id: 'repository-summary', label: 'Repository summary' }],
    health: { status: 'unknown' },
  };
}

function installedSkill(): CapabilityInventoryItem {
  return {
    ...availableSkill(),
    displayName: 'Installed Writer',
    lifecycle: { installation: 'installed', activation: 'enabled', availability: 'available' },
  };
}
