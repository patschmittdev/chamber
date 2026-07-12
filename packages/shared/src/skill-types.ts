/**
 * Self-declared metadata discovered from a skill directory on disk.
 *
 * Presence in this list does not establish marketplace provenance, content
 * hash verification, management status, update status, or trust. Managed-skill
 * integrity and lifecycle remain the responsibility of ManagedSkillService.
 * Values are untrusted local file content and must be rendered as text.
 */
export interface SkillManifest {
  /** Directory name under .github/skills and the stable on-disk identifier. */
  id: string;
  /** Display name from SKILL.md; falls back to id when absent or blank. */
  name: string;
  /** Self-declared version string from SKILL.md, if present. */
  version?: string;
  /** Self-declared description from SKILL.md, if present. */
  description?: string;
}

export interface SkillValidationError {
  message: string;
  path?: string;
}

export interface SkillFileReference {
  path: string;
  status: 'present' | 'missing' | 'invalid';
}

export interface SkillMarketplaceSourceDetails {
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  marketplaceId: string;
  marketplaceLabel: string;
  marketplaceUrl: string;
  isDefault?: boolean;
  root?: string;
}

export interface ManagedSkillDetails {
  version: string;
  capabilities: string[];
  metadataPath: string;
  files: SkillFileReference[];
  source?: SkillMarketplaceSourceDetails;
}

export interface SkillDetail extends SkillManifest {
  source: {
    type: 'local';
    directory: string;
    manifestPath: string;
    metadataPath?: string;
  };
  isCore: boolean;
  isManaged: boolean;
  requiredFiles: SkillFileReference[];
  capabilities: string[];
  managed?: ManagedSkillDetails;
  validationErrors: SkillValidationError[];
}

export type MarketplaceSourceStatusKind = 'ok' | 'disabled' | 'error';

export interface MarketplaceSkillSourceStatus {
  id: string;
  label: string;
  url: string;
  status: MarketplaceSourceStatusKind;
  skillCount: number;
  malformedCount: number;
  message?: string;
}

export interface MarketplaceSkillEntry {
  id: string;
  displayName: string;
  description: string;
  version?: string;
  root: string;
  requiredFiles: string[];
  capabilities: string[];
  reserved: boolean;
  source: SkillMarketplaceSourceDetails;
}

export interface MarketplaceSkillMalformedEntry {
  source: SkillMarketplaceSourceDetails;
  index: number;
  message: string;
  rawId?: string;
  rawDisplayName?: string;
}

export interface MarketplaceTemplateEntry {
  id: string;
  displayName: string;
  description: string;
  role: string;
  voice: string;
  templateVersion: string;
  agent: string;
  requiredFiles: string[];
  source: SkillMarketplaceSourceDetails & {
    manifestPath: string;
    rootPath: string;
  };
}

export interface MarketplaceTemplateSourceStatus {
  id: string;
  label: string;
  url: string;
  status: MarketplaceSourceStatusKind;
  templateCount: number;
  message?: string;
}

export interface SkillMarketplaceBrowseResult {
  skills: MarketplaceSkillEntry[];
  malformedSkills: MarketplaceSkillMalformedEntry[];
  skillSources: MarketplaceSkillSourceStatus[];
  templates: MarketplaceTemplateEntry[];
  templateSources: MarketplaceTemplateSourceStatus[];
}
