import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { IdentityLoader } from './IdentityLoader';
import type { InstalledTool } from '@chamber/shared/types';

describe('IdentityLoader', () => {
  const loader = new IdentityLoader();
  beforeEach(() => vi.clearAllMocks());

  describe('load', () => {
    it('returns null when mindPath is null', () => {
      expect(loader.load(null)).toBeNull();
    });

    it('returns MindIdentity with name and systemMessage', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const result = loader.load('/tmp/test');
      expect(result).toEqual({
        name: 'Q',
        systemMessage: expect.stringContaining('# Q\nI am an agent.'),
      });
      expect(result?.systemMessage).toContain('## Chamber');
      expect(result?.systemMessage).toContain('operating inside Chamber as a Chamber agent');
      expect(result?.systemMessage).toContain('https://github.com/ianphil/chamber');
    });

    it('extracts name from first H1 heading', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# My Agent Name\nSome content\n# Another heading');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      expect(loader.load('/tmp/test')?.name).toBe('My Agent Name');
    });

    it('falls back to folder name when no H1 exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('No heading here, just content.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      expect(loader.load('/tmp/agents/fox')?.name).toBe('fox');
    });

    it('strips "— Soul" suffix from name', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# The Dude — Soul\nContent');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      expect(loader.load('/tmp/agents/dude')?.name).toBe('The Dude');
    });

    it('includes agent file content in systemMessage', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce('# Soul')
        .mockReturnValueOnce('---\nname: test\n---\nInstructions');
      (vi.mocked(fs.readdirSync) as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(['main.agent.md']);
      const result = loader.load('/tmp/test');
      expect(result?.systemMessage).toContain('Instructions');
      expect(result?.systemMessage).not.toContain('name: test');
    });

    it('includes working-memory files in systemMessage', () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return [
          '/tmp/test/SOUL.md',
          '/tmp/test/.working-memory',
        ].includes(normalized);
      });
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('SOUL.md')) return '# Soul';
        if (normalized.endsWith('memory.md')) return 'Curated memory';
        if (normalized.endsWith('rules.md')) return 'Operational rule';
        if (normalized.endsWith('log.md')) return 'Chronological note';
        return '';
      });
      vi.mocked(fs.readdirSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('/.working-memory')) {
          return ['memory.md', 'rules.md', 'log.md'] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      const result = loader.load('/tmp/test');

      expect(result?.systemMessage).toContain('Curated memory');
      expect(result?.systemMessage).toContain('Operational rule');
      expect(result?.systemMessage).toContain('Chronological note');
    });

    it('does not extract the mind name from working-memory headings', () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return [
          '/tmp/agents/fox/SOUL.md',
          '/tmp/agents/fox/.working-memory',
        ].includes(normalized);
      });
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('SOUL.md')) return 'No heading here.';
        if (normalized.endsWith('memory.md')) return '# Memory\nCurated memory';
        return '';
      });
      vi.mocked(fs.readdirSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('/.working-memory')) {
          return ['memory.md'] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      const result = loader.load('/tmp/agents/fox');

      expect(result?.name).toBe('fox');
      expect(result?.systemMessage).toContain('# Memory');
    });

    it('returns null when nothing exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(loader.load('/tmp/test')).toBeNull();
    });

    it('appends a Tools section when installed tools are provided', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const tools: InstalledTool[] = [{
        id: 'workiq',
        package: '@microsoft/workiq',
        version: 'latest',
        bin: 'workiq',
        displayName: 'Microsoft Work IQ',
        description: 'Query M365 data.',
        help: 'workiq ask --help',
        agentInstructions: 'Use `workiq ask "<question>"`.',
        source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
        installedAt: '2026-05-07T21:00:00.000Z',
      }];
      const withTools = new IdentityLoader(() => tools);
      const result = withTools.load('/tmp/test');
      expect(result?.systemMessage).toContain('## Tools');
      expect(result?.systemMessage).toContain('### workiq — Microsoft Work IQ');
      expect(result?.systemMessage).toContain('workiq ask --help');
    });

    it('does not append a Tools section when no tools are installed', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const result = new IdentityLoader(() => []).load('/tmp/test');
      expect(result?.systemMessage).not.toContain('## Tools');
      expect(result?.systemMessage).toContain('## Chamber');
    });

    it('appends Chamber guidance before installed tool guidance', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const tools: InstalledTool[] = [{
        id: 'workiq',
        package: '@microsoft/workiq',
        version: 'latest',
        bin: 'workiq',
        displayName: 'Microsoft Work IQ',
        description: 'Query M365 data.',
        source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
        installedAt: '2026-05-07T21:00:00.000Z',
      }];

      const result = new IdentityLoader(() => tools).load('/tmp/test');
      const systemMessage = result?.systemMessage ?? '';

      expect(systemMessage.indexOf('## Chamber')).toBeGreaterThan(systemMessage.indexOf('# Q'));
      expect(systemMessage.indexOf('## Tools')).toBeGreaterThan(systemMessage.indexOf('## Chamber'));
    });

    it('injects global custom instructions when the operator has set them', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const withInstructions = new IdentityLoader(() => [], () => 'Always answer concisely.');
      const result = withInstructions.load('/tmp/test');
      expect(result?.systemMessage).toContain('## Custom Instructions');
      expect(result?.systemMessage).toContain('Always answer concisely.');
    });

    it('skips global custom instructions when the mind opts out', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const withInstructions = new IdentityLoader(() => [], () => 'Always answer concisely.');
      const result = withInstructions.load('/tmp/test', { includeGlobalCustomInstructions: false });
      expect(result?.systemMessage).not.toContain('## Custom Instructions');
      expect(result?.systemMessage).not.toContain('Always answer concisely.');
      expect(result?.systemMessage).toContain('## Chamber');
    });

    it('does not inject a custom instructions section when instructions are empty', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const result = new IdentityLoader(() => [], () => '   ').load('/tmp/test');
      expect(result?.systemMessage).not.toContain('## Custom Instructions');
    });

    it('injects custom instructions before the Chamber safety section so safety keeps precedence', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const result = new IdentityLoader(() => [], () => 'Be concise.').load('/tmp/test');
      const systemMessage = result?.systemMessage ?? '';
      const customIndex = systemMessage.indexOf('## Custom Instructions');
      const chamberIndex = systemMessage.indexOf('## Chamber');
      expect(customIndex).toBeGreaterThan(systemMessage.indexOf('# Q'));
      expect(customIndex).toBeLessThan(chamberIndex);
    });

    it('places custom instructions before both the Chamber and Tools sections', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const tools: InstalledTool[] = [{
        id: 'workiq',
        package: '@microsoft/workiq',
        version: 'latest',
        bin: 'workiq',
        displayName: 'Microsoft Work IQ',
        description: 'Query M365 data.',
        source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
        installedAt: '2026-05-07T21:00:00.000Z',
      }];
      const result = new IdentityLoader(() => tools, () => 'Be concise.').load('/tmp/test');
      const systemMessage = result?.systemMessage ?? '';
      const customIndex = systemMessage.indexOf('## Custom Instructions');
      expect(customIndex).toBeLessThan(systemMessage.indexOf('## Chamber'));
      expect(customIndex).toBeLessThan(systemMessage.indexOf('## Tools'));
    });

    it('returns sanitized instruction precedence metadata without prompt content', () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return [
          '/tmp/test/SOUL.md',
          '/tmp/test/.working-memory',
        ].includes(normalized);
      });
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('SOUL.md')) return '# Q\nPrivate soul text';
        if (normalized.endsWith('memory.md')) return 'Private memory text';
        return '';
      });
      vi.mocked(fs.readdirSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('/.working-memory')) {
          return ['memory.md'] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });
      const loaderWithInstructions = new IdentityLoader(() => [], () => 'Private global instruction');

      const precedence = loaderWithInstructions.getInstructionPrecedence('/tmp/test');

      expect(precedence?.mindName).toBe('Q');
      expect(precedence?.layers.map((layer) => layer.id)).toEqual([
        'mind-identity',
        'working-memory',
        'global-custom-instructions',
        'chamber-guidance',
        'tools',
      ]);
      expect(precedence?.hasGlobalCustomInstructions).toBe(true);
      expect(precedence?.globalCustomInstructionsEnabled).toBe(true);
      const serialized = JSON.stringify(precedence);
      expect(serialized).not.toContain('Private soul text');
      expect(serialized).not.toContain('Private memory text');
      expect(serialized).not.toContain('Private global instruction');
    });

    it('marks global custom instructions disabled in precedence metadata when the mind opts out', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const withInstructions = new IdentityLoader(() => [], () => 'Always answer concisely.');

      const precedence = withInstructions.getInstructionPrecedence('/tmp/test', { includeGlobalCustomInstructions: false });
      const globalLayer = precedence?.layers.find((layer) => layer.id === 'global-custom-instructions');

      expect(precedence?.hasGlobalCustomInstructions).toBe(true);
      expect(precedence?.globalCustomInstructionsEnabled).toBe(false);
      expect(globalLayer).toMatchObject({
        present: true,
        enabled: false,
        included: false,
      });
    });

    it('marks empty global custom instructions as not present in precedence metadata', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Q\nI am an agent.');
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const precedence = new IdentityLoader(() => [], () => '   ').getInstructionPrecedence('/tmp/test');
      const globalLayer = precedence?.layers.find((layer) => layer.id === 'global-custom-instructions');

      expect(precedence?.hasGlobalCustomInstructions).toBe(false);
      expect(globalLayer).toMatchObject({
        present: false,
        enabled: true,
        included: false,
      });
    });
  });
});
