import type {
  MarketplaceSkillEntry as SharedMarketplaceSkillEntry,
  MarketplaceSkillMalformedEntry as SharedMarketplaceSkillMalformedEntry,
  MarketplaceSkillSourceStatus as SharedMarketplaceSkillSourceStatus,
} from '@chamber/shared/skill-types';

export interface SkillMarketplaceSource {
  id?: string;
  label?: string;
  url?: string;
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  enabled?: boolean;
  isDefault?: boolean;
}

export type MarketplaceSkillEntry = SharedMarketplaceSkillEntry;
export type MarketplaceSkillMalformedEntry = SharedMarketplaceSkillMalformedEntry;
export type MarketplaceSkillSourceStatus = SharedMarketplaceSkillSourceStatus;

export interface ManagedSkillManifest {
  name: string;
  version: string;
  capabilities: string[];
}

export interface ManagedSkillAssetFile {
  path: string;
  content: Buffer;
  sha256: string;
}

export interface ManagedSkillMarketplaceSource {
  type: 'marketplace';
  marketplaceId: string;
  marketplaceLabel: string;
  marketplaceUrl: string;
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  root: string;
}

export interface ManagedSkillAsset {
  manifest: ManagedSkillManifest;
  files: ManagedSkillAssetFile[];
  source?: ManagedSkillMarketplaceSource;
}
