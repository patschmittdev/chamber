import * as fs from 'fs';
import * as path from 'path';
import type { InstalledTool, MindIdentity, MindInstructionPrecedence } from '@chamber/shared/types';
import { composeMindSystemPrompt } from './composeMindSystemPrompt';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const H1_RE = /^#\s+(.+)$/m;
const WORKING_MEMORY_FILES = ['memory.md', 'rules.md', 'log.md'];

export type InstalledToolsProvider = () => InstalledTool[];
export type CustomInstructionsProvider = () => string;
export type IdentityLoadOptions = {
  includeGlobalCustomInstructions?: boolean;
};
export type IdentityInstructionPrecedence = Omit<MindInstructionPrecedence, 'mindId'>;

export class IdentityLoader {
  constructor(
    private readonly getInstalledTools: InstalledToolsProvider = () => [],
    private readonly getCustomInstructions: CustomInstructionsProvider = () => '',
  ) {}

  load(mindPath: string | null, options: IdentityLoadOptions = {}): MindIdentity | null {
    const source = this.loadPromptSource(mindPath);
    if (!source) return null;

    const composition = composeMindSystemPrompt({
      identityParts: source.identityParts,
      workingMemoryParts: source.memoryParts,
      installedTools: this.getInstalledTools(),
      customInstructions: this.getCustomInstructions(),
      includeGlobalCustomInstructions: options.includeGlobalCustomInstructions,
    });
    const name = this.extractName(source.identityParts.join('\n\n---\n\n'), source.mindPath);

    return { name, systemMessage: composition.systemMessage };
  }

  getInstructionPrecedence(mindPath: string | null, options: IdentityLoadOptions = {}): IdentityInstructionPrecedence | null {
    const source = this.loadPromptSource(mindPath);
    if (!source) return null;

    const composition = composeMindSystemPrompt({
      identityParts: source.identityParts,
      workingMemoryParts: source.memoryParts,
      installedTools: this.getInstalledTools(),
      customInstructions: this.getCustomInstructions(),
      includeGlobalCustomInstructions: options.includeGlobalCustomInstructions,
    });
    const mindName = this.extractName(source.identityParts.join('\n\n---\n\n'), source.mindPath);

    return {
      mindName,
      globalCustomInstructionsEnabled: composition.globalCustomInstructionsEnabled,
      hasGlobalCustomInstructions: composition.hasGlobalCustomInstructions,
      layers: composition.layers,
    };
  }

  private loadPromptSource(mindPath: string | null): { mindPath: string; identityParts: string[]; memoryParts: string[] } | null {
    if (!mindPath) return null;
    const identityParts: string[] = [];
    const memoryParts: string[] = [];

    try {
      const soulPath = path.join(mindPath, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        identityParts.push(fs.readFileSync(soulPath, 'utf-8'));
      }
    } catch { /* missing */ }

    try {
      const agentsDir = path.join(mindPath, '.github', 'agents');
      if (fs.existsSync(agentsDir)) {
        const files = fs.readdirSync(agentsDir)
          .filter(f => String(f).endsWith('.agent.md'))
          .sort();
        for (const file of files) {
          const content = fs.readFileSync(path.join(agentsDir, String(file)), 'utf-8');
          identityParts.push(content.replace(FRONTMATTER_RE, '').trim());
        }
      }
    } catch { /* missing */ }

    try {
      const memoryDir = path.join(mindPath, '.working-memory');
      if (!fs.existsSync(memoryDir)) throw new Error('missing working-memory');
      const files = fs.readdirSync(memoryDir)
        .map((file) => String(file))
        .filter((file) => WORKING_MEMORY_FILES.includes(file))
        .sort((a, b) => WORKING_MEMORY_FILES.indexOf(a) - WORKING_MEMORY_FILES.indexOf(b));
      for (const file of files) {
        const filePath = path.join(memoryDir, file);
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content.length > 0) memoryParts.push(content);
      }
    } catch { /* missing */ }

    const parts = [...identityParts, ...memoryParts];
    if (parts.length === 0) return null;

    return { mindPath, identityParts, memoryParts };
  }

  private extractName(content: string, mindPath: string): string {
    const match = content.match(H1_RE);
    if (match) {
      // Strip common suffixes like "— Soul", "- Soul"
      return match[1].trim().replace(/\s*[—–-]\s*Soul$/i, '').trim();
    }
    return path.basename(mindPath);
  }
}
