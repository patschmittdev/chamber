import type { MarketplaceToolEntry } from '@chamber/shared/types';

/**
 * Catalog source — accepts either the strict {@link MarketplaceRegistry} shape
 * or the loose Genesis registry shape (where id/label/url may be undefined).
 * The catalog falls back to deriving id/label/url from owner/repo when missing.
 */
export interface ToolMarketplaceSource {
  id?: string;
  label?: string;
  url?: string;
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  enabled?: boolean;
}

/**
 * Canonical representation of the executable artifact fields that must be
 * approved before a tool can be installed. Any change to these fields
 * invalidates a prior approval and requires explicit operator re-approval.
 */
export interface MarketplaceArtifactDescriptor {
  type: 'npm-global' | 'github-release-asset';
  bin: string;
  // npm-global fields
  package?: string;
  version?: string;
  // github-release-asset fields
  owner?: string;
  repo?: string;
  tag?: string;
  assetName?: string;
  sha256?: string;
  platform?: string;
  arch?: string;
  archive?: string;
  binPath?: string;
}

export type { MarketplaceToolEntry };
