/**
 * Renderer-safe mind trust types. These are the only trust-related types
 * exposed over IPC. They carry no raw MCP configuration, commands,
 * arguments, environment variables, paths, or credentials.
 */

export type MindTrustStatus = 'pending' | 'trusted' | 'revoked';

/** Renderer-safe projection of a mind's trust state. */
export interface MindTrustStatusResult {
  readonly mindId: string;
  readonly status: MindTrustStatus;
  readonly approvedCronCount: number;
  readonly approvedMcpCount: number;
}
