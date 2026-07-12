/**
 * Renderer-facing MCP server configuration model.
 *
 * These types describe the subset of a mind's `.mcp.json` that the Extensions
 * hub lets users manage: a name plus either a stdio launch command or an HTTP
 * endpoint. They are intentionally narrower than the SDK's `MCPServerConfig`
 * (see `mcpConfig.ts`) — the store (`mcpServerStore.ts`) normalizes on read and
 * preserves non-managed fields (`tools`, `timeout`, `cwd`) on write so editing a
 * server through the UI never silently drops its tool scoping.
 */

export type McpServerTransport = 'stdio' | 'http';

export interface McpStdioServerEntry {
  name: string;
  transport: 'stdio';
  /** Executable to launch, e.g. `npx`. */
  command: string;
  /** Arguments passed to the command. */
  args: string[];
  /** Environment variables for the spawned process. */
  env: Record<string, string>;
}

export interface McpHttpServerEntry {
  name: string;
  transport: 'http';
  /** Remote MCP endpoint URL. */
  url: string;
  /** Extra request headers (e.g. Authorization). */
  headers: Record<string, string>;
}

/**
 * A single configured MCP server as surfaced to the renderer. The `transport`
 * discriminant selects the stdio or http shape.
 */
export type McpServerEntry = McpStdioServerEntry | McpHttpServerEntry;
