import type { McpConnectorCheckResult, McpConnectorStatusResult } from '@chamber/shared/mcp-types';

export interface McpConnectorStatusStore {
  listStatuses(mindPath: string): McpConnectorStatusResult;
}

export interface McpConfigurationVerifier {
  verifyMcpConfiguration(mindId: string): Promise<void>;
}

/**
 * Runs only Chamber's bounded SDK session-creation path for a configured
 * connector. MCP connection establishment remains SDK-owned, so this service
 * never claims that a remote endpoint or command is live.
 */
export class McpConnectorOperationsService {
  constructor(
    private readonly statusStore: McpConnectorStatusStore,
    private readonly verifier: McpConfigurationVerifier,
  ) {}

  list(mindPath: string): McpConnectorStatusResult {
    return this.statusStore.listStatuses(mindPath);
  }

  async check(mindId: string, mindPath: string, connectorName: string): Promise<McpConnectorCheckResult> {
    const connector = this.statusStore.listStatuses(mindPath).connectors
      .find((entry) => entry.name === connectorName);
    if (!connector) return { status: 'connector-not-found' };
    if (connector.configuration !== 'ready') return { status: 'configuration-required' };
    try {
      await this.verifier.verifyMcpConfiguration(mindId);
      return { status: 'configuration-applied' };
    } catch {
      return { status: 'reload-failed' };
    }
  }
}
