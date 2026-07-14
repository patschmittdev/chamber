import { describe, expect, it, vi } from 'vitest';
import { McpConnectorOperationsService } from './McpConnectorOperationsService';

describe('McpConnectorOperationsService', () => {
  it('reloads only a configured connector and never claims a live connection', async () => {
    const verifyMcpConfiguration = vi.fn().mockResolvedValue(undefined);
    const service = new McpConnectorOperationsService({
      listStatuses: () => ({
        connectors: [{
          name: 'files',
          transport: 'stdio',
          configuration: 'ready',
          connection: 'unknown',
        }],
        sourceStatus: 'ready',
      }),
    }, { verifyMcpConfiguration });

    await expect(service.check('mind-1', 'C:\\minds\\mind-1', 'files'))
      .resolves.toEqual({ status: 'configuration-applied' });
    expect(verifyMcpConfiguration).toHaveBeenCalledWith('mind-1');
  });

  it('does not reload connector configuration that needs attention', async () => {
    const verifyMcpConfiguration = vi.fn();
    const service = new McpConnectorOperationsService({
      listStatuses: () => ({
        connectors: [{
          name: 'files',
          transport: 'unknown',
          configuration: 'needs-attention',
          connection: 'unknown',
        }],
        sourceStatus: 'needs-attention',
      }),
    }, { verifyMcpConfiguration });

    await expect(service.check('mind-1', 'C:\\minds\\mind-1', 'files'))
      .resolves.toEqual({ status: 'configuration-required' });
    expect(verifyMcpConfiguration).not.toHaveBeenCalled();
  });

  it('redacts reload failures into a retryable status', async () => {
    const service = new McpConnectorOperationsService({
      listStatuses: () => ({
        connectors: [{
          name: 'files',
          transport: 'stdio',
          configuration: 'ready',
          connection: 'unknown',
        }],
        sourceStatus: 'ready',
      }),
    }, { verifyMcpConfiguration: vi.fn().mockRejectedValue(new Error('C:\\secret\\config token=top-secret')) });

    const result = await service.check('mind-1', 'C:\\minds\\mind-1', 'files');

    expect(result).toEqual({ status: 'reload-failed' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
