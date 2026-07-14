import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type {
  McpConnectorCheckResult,
  McpConnectorStatusResult,
  McpServerEntry,
} from '@chamber/shared/mcp-types';

/**
 * Resolves mind identity for MCP config access. The active mind is used when a
 * channel is called without an explicit `mindId`, mirroring the Lens adapter.
 */
export interface McpIpcMindProvider {
  getMindPath(mindId: string): string | undefined;
  getActiveMindId(): string | null;
}

/** File-backed store for a mind's `.mcp.json`; injected for testability. */
export interface McpServerStorePort {
  read(mindPath: string): McpServerEntry[];
  write(mindPath: string, servers: McpServerEntry[]): McpServerEntry[];
}

export interface McpConnectorOperationsPort {
  list(mindPath: string): McpConnectorStatusResult;
  check(mindId: string, mindPath: string, connectorName: string): Promise<McpConnectorCheckResult>;
}

const preservedSchema = z.object({
  type: z.enum(['stdio', 'local', 'http', 'sse']).optional(),
  tools: z.array(z.string()).optional(),
  timeout: z.number().optional(),
  cwd: z.string().optional(),
}).strict();

const stdioEntrySchema = z.object({
  name: z.string().trim().min(1, 'must be a non-empty string'),
  transport: z.literal('stdio'),
  command: z.string().trim().min(1, 'must be a non-empty string'),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  preserved: preservedSchema.optional(),
}).strict();

const httpEntrySchema = z.object({
  name: z.string().trim().min(1, 'must be a non-empty string'),
  transport: z.literal('http'),
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  preserved: preservedSchema.optional(),
}).strict();

const entriesSchema: z.ZodType<McpServerEntry[]> = z.array(
  z.discriminatedUnion('transport', [stdioEntrySchema, httpEntrySchema]),
);

const optionalMindIdSchema = z.string().min(1, 'must be a non-empty string').optional();

export function setupMcpIPC(
  mindProvider: McpIpcMindProvider,
  store: McpServerStorePort,
  operations: McpConnectorOperationsPort,
): void {
  const resolveMindPath = (mindId?: string): string | undefined => {
    const id = mindId ?? mindProvider.getActiveMindId() ?? undefined;
    return id ? mindProvider.getMindPath(id) : undefined;
  };

  ipcMain.handle(IPC.MCP.GET_SERVERS, async (_event, rawMindId: unknown) => {
    const mindId = parseIpcArgs(IPC.MCP.GET_SERVERS, optionalMindIdSchema, rawMindId);
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return [];
    return store.read(mindPath);
  });

  ipcMain.handle(IPC.MCP.SET_SERVERS, async (_event, rawServers: unknown, rawMindId: unknown) => {
    const servers = parseIpcArgs(IPC.MCP.SET_SERVERS, entriesSchema, rawServers);
    const mindId = parseIpcArgs(IPC.MCP.SET_SERVERS, optionalMindIdSchema, rawMindId);
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) {
      throw new Error('No mind selected to save MCP servers for');
    }
    return store.write(mindPath, servers);
  });

  ipcMain.handle(IPC.MCP.LIST_STATUS, async (_event, rawMindId: unknown) => {
    const mindId = parseIpcArgs(IPC.MCP.LIST_STATUS, optionalMindIdSchema, rawMindId);
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return { connectors: [], sourceStatus: 'ready' } satisfies McpConnectorStatusResult;
    return operations.list(mindPath);
  });

  ipcMain.handle(IPC.MCP.CHECK_CONNECTOR, async (_event, rawConnectorName: unknown, rawMindId: unknown) => {
    const connectorName = parseIpcArgs(
      IPC.MCP.CHECK_CONNECTOR,
      z.string().trim().min(1, 'must be a non-empty string').max(120),
      rawConnectorName,
    );
    const mindId = parseIpcArgs(IPC.MCP.CHECK_CONNECTOR, optionalMindIdSchema, rawMindId);
    const resolvedMindId = mindId ?? mindProvider.getActiveMindId();
    if (!resolvedMindId) return { status: 'connector-not-found' } satisfies McpConnectorCheckResult;
    const mindPath = resolveMindPath(resolvedMindId);
    if (!mindPath) return { status: 'connector-not-found' } satisfies McpConnectorCheckResult;
    return operations.check(resolvedMindId, mindPath, connectorName);
  });
}
