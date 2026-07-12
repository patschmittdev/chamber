import type { InstalledTool, MindInstructionLayer } from '@chamber/shared/types';
import { buildToolsSection } from '../tools/toolsSystemMessage';
import { buildChamberSection } from './chamberSystemMessage';
import { buildCustomInstructionsSection } from './customInstructionsSystemMessage';

export interface ComposeMindSystemPromptRequest {
  identityParts: string[];
  workingMemoryParts: string[];
  installedTools: InstalledTool[];
  customInstructions: string;
  includeGlobalCustomInstructions?: boolean;
}

export interface MindSystemPromptComposition {
  systemMessage: string;
  layers: MindInstructionLayer[];
  hasGlobalCustomInstructions: boolean;
  globalCustomInstructionsEnabled: boolean;
}

export function composeMindSystemPrompt(request: ComposeMindSystemPromptRequest): MindSystemPromptComposition {
  const globalCustomInstructionsEnabled = request.includeGlobalCustomInstructions !== false;
  const identityParts = request.identityParts.map(trimPart).filter(hasContent);
  const workingMemoryParts = request.workingMemoryParts.map(trimPart).filter(hasContent);
  const customInstructionsSection = buildCustomInstructionsSection(request.customInstructions);
  const chamberSection = buildChamberSection();
  const toolsSection = buildToolsSection(request.installedTools);
  const hasGlobalCustomInstructions = customInstructionsSection !== null;

  const sections = [
    ...identityParts,
    ...workingMemoryParts,
    ...(globalCustomInstructionsEnabled && customInstructionsSection ? [customInstructionsSection] : []),
    chamberSection,
    ...(toolsSection ? [toolsSection] : []),
  ];

  return {
    systemMessage: sections.join('\n\n---\n\n'),
    layers: [
      {
        id: 'mind-identity',
        label: 'Mind identity',
        source: 'SOUL.md and .github/agents/*.agent.md',
        description: 'Defines the mind role, personality, and agent-specific instructions.',
        included: identityParts.length > 0,
        present: identityParts.length > 0,
        enabled: true,
        contentExposed: false,
      },
      {
        id: 'working-memory',
        label: 'Working memory',
        source: '.working-memory/memory.md, rules.md, and log.md',
        description: 'Private mind memory is included when present. Its contents are not shown here.',
        included: workingMemoryParts.length > 0,
        present: workingMemoryParts.length > 0,
        enabled: true,
        contentExposed: false,
      },
      {
        id: 'global-custom-instructions',
        label: 'Global custom instructions',
        source: 'Settings > Custom instructions',
        description: 'Operator preferences shared across minds when this mind inherits them.',
        included: globalCustomInstructionsEnabled && hasGlobalCustomInstructions,
        present: hasGlobalCustomInstructions,
        enabled: globalCustomInstructionsEnabled,
        contentExposed: false,
      },
      {
        id: 'chamber-guidance',
        label: 'Chamber safety guidance',
        source: 'Chamber runtime',
        description: 'Host operating and safety guidance remains authoritative for every mind.',
        included: true,
        present: true,
        enabled: true,
        contentExposed: false,
      },
      {
        id: 'tools',
        label: 'Installed tool guidance',
        source: 'Installed Chamber tools',
        description: 'Tool capability hints are included when tools are installed and do not override Chamber safety guidance.',
        included: Boolean(toolsSection),
        present: request.installedTools.length > 0,
        enabled: true,
        contentExposed: false,
      },
    ],
    hasGlobalCustomInstructions,
    globalCustomInstructionsEnabled,
  };
}

function trimPart(value: string): string {
  return value.trim();
}

function hasContent(value: string): boolean {
  return value.length > 0;
}
