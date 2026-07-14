/**
 * Renderer-safe capability inventory contracts.
 *
 * These types are a read model only. Configuration, source bodies, credentials,
 * and execution remain owned by their source-specific services.
 */
export type CapabilityKind =
  | 'skill'
  | 'mcp-connector'
  | 'cli-tool'
  | 'prompt'
  | 'lens-view';

export type CapabilityScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'mind'; readonly mindId: string };

export interface CapabilityRef {
  readonly kind: CapabilityKind;
  readonly id: string;
  readonly scope: CapabilityScope;
}

export type CapabilityProvenanceKind = 'built-in' | 'local' | 'marketplace' | 'user';

export interface CapabilityProvenance {
  readonly kind: CapabilityProvenanceKind;
  readonly label: string;
  readonly marketplace?: {
    readonly id: string;
    readonly label: string;
    readonly url: string;
  };
}

export type CapabilityInstallationState = 'installed' | 'available' | 'not-applicable';
export type CapabilityActivationState = 'enabled' | 'disabled' | 'not-applicable';
export type CapabilityAvailabilityState = 'available' | 'unavailable' | 'error';

export interface CapabilityLifecycle {
  readonly installation: CapabilityInstallationState;
  readonly activation: CapabilityActivationState;
  readonly availability: CapabilityAvailabilityState;
}

export interface CapabilityRequirement {
  readonly label: string;
  readonly status: 'met' | 'unmet' | 'unknown';
}

export interface CapabilityCompatibility {
  readonly status: 'compatible' | 'incompatible' | 'unknown';
  readonly code?: string;
}

export interface CapabilityDeclaration {
  readonly id: string;
  readonly label?: string;
}

export interface CapabilityHealth {
  readonly status: 'healthy' | 'degraded' | 'unknown' | 'error';
  readonly code?: string;
}

export interface CapabilityInventoryItem {
  readonly ref: CapabilityRef;
  readonly displayName: string;
  readonly description?: string;
  readonly version?: string;
  readonly provenance: CapabilityProvenance;
  readonly lifecycle: CapabilityLifecycle;
  readonly requirements: readonly CapabilityRequirement[];
  readonly compatibility: CapabilityCompatibility;
  readonly declaredCapabilities: readonly CapabilityDeclaration[];
  readonly health: CapabilityHealth;
}

export interface CapabilityInventorySourceStatus {
  readonly id: string;
  readonly label: string;
  readonly status: 'healthy' | 'disabled' | 'error' | 'unknown';
  readonly capabilityCount?: number;
}

export interface CapabilityInventoryQuery {
  readonly mindId?: string;
  readonly availability?: 'installed' | 'available' | 'all';
}

export interface CapabilityInventoryResult {
  readonly items: readonly CapabilityInventoryItem[];
  readonly sources: readonly CapabilityInventorySourceStatus[];
}
