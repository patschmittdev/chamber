// Read/write access to a mind's `.mcp.json` for the Extensions hub. This is the
// management counterpart to `mcpConfig.ts`: where `loadMcpServersFromMindPath`
// coerces entries into the SDK's `MCPServerConfig` shape for session creation,
// this module round-trips the raw file so users can add, edit, and remove
// servers without losing unrelated content.
//
// Round-trip guarantees:
//   - Unknown top-level keys in `.mcp.json` are preserved on write.
//   - Non-managed per-server fields (`tools`, `timeout`, and stdio `cwd`) are
//     preserved for a server that is kept on the same transport. This matters
//     for security: `tools` scopes which tools a server may expose, and a UI
//     edit must never silently widen that scope by dropping the field.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { McpServerEntry, McpServerTransport } from '@chamber/shared/mcp-types';
import { Logger } from '../logger';
import { MCP_CONFIG_FILENAME } from './mcpConfig';

const log = Logger.create('mcpServerStore');

type RawServer = Record<string, unknown>;

interface RawConfig {
  /** Top-level keys other than `mcpServers`, preserved across writes. */
  top: Record<string, unknown>;
  /** The raw `mcpServers` map exactly as read from disk. */
  servers: Record<string, RawServer>;
}

/**
 * Reads and normalizes the MCP servers configured for `mindPath`. Invalid or
 * ambiguous entries are skipped rather than throwing so a single bad entry
 * never hides the rest. Returns an empty array when the file is absent.
 */
export function readMcpServers(mindPath: string): McpServerEntry[] {
  const { servers } = readRawConfig(path.join(mindPath, MCP_CONFIG_FILENAME));
  return normalizeServers(servers);
}

/**
 * Replaces the MCP server set in `mindPath`'s `.mcp.json` and returns the
 * persisted, normalized list. Throws on empty or duplicate names so the IPC
 * layer can surface a clear error to the renderer.
 */
export function writeMcpServers(mindPath: string, entries: McpServerEntry[]): McpServerEntry[] {
  const filePath = path.join(mindPath, MCP_CONFIG_FILENAME);
  const existing = readRawConfig(filePath);

  const nextServers: Record<string, RawServer> = {};
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = entry.name.trim();
    if (name.length === 0) {
      throw new Error('MCP server name must not be empty');
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate MCP server name: ${name}`);
    }
    seen.add(name);
    nextServers[name] = serializeEntry(entry, existing.servers[name]);
  }

  const document = { ...existing.top, mcpServers: nextServers };
  fs.mkdirSync(mindPath, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
  return normalizeServers(nextServers);
}

function readRawConfig(filePath: string): RawConfig {
  if (!fs.existsSync(filePath)) return { top: {}, servers: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    log.warn(`Failed to read or parse ${filePath}; treating as empty:`, err);
    return { top: {}, servers: {} };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { top: {}, servers: {} };
  }

  const record = parsed as Record<string, unknown>;
  const { mcpServers, ...top } = record;
  const servers = isRecord(mcpServers) ? (mcpServers as Record<string, RawServer>) : {};
  return { top, servers };
}

function normalizeServers(servers: Record<string, RawServer>): McpServerEntry[] {
  const entries: McpServerEntry[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    const entry = normalizeEntry(name, raw);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeEntry(name: string, raw: unknown): McpServerEntry | null {
  if (!isRecord(raw)) return null;
  const hasCommand = typeof raw.command === 'string' && raw.command.length > 0;
  const hasUrl = typeof raw.url === 'string' && raw.url.length > 0;
  // Reject entries that mix stdio and http keys — the same guard the SDK
  // loader applies — so an ambiguous entry is dropped, not coerced.
  if (hasCommand === hasUrl) return null;

  if (hasCommand) {
    return {
      name,
      transport: 'stdio',
      command: raw.command as string,
      args: toStringArray(raw.args),
      env: toStringRecord(raw.env),
    };
  }
  return {
    name,
    transport: 'http',
    url: raw.url as string,
    headers: toStringRecord(raw.headers),
  };
}

function serializeEntry(entry: McpServerEntry, prior: RawServer | undefined): RawServer {
  const carried = preservedFields(prior, entry.transport);
  if (entry.transport === 'stdio') {
    return {
      type: 'stdio',
      command: entry.command,
      args: entry.args,
      ...(Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
      ...carried,
    };
  }
  return {
    type: 'http',
    url: entry.url,
    ...(Object.keys(entry.headers).length > 0 ? { headers: entry.headers } : {}),
    ...carried,
  };
}

/**
 * Copies forward the non-managed fields the UI never edits, but only when the
 * prior entry used the same transport — switching stdio <-> http must not carry
 * stale scoping across shapes.
 */
function preservedFields(prior: RawServer | undefined, transport: McpServerTransport): RawServer {
  if (!isRecord(prior)) return {};
  const priorTransport: McpServerTransport | null = typeof prior.url === 'string'
    ? 'http'
    : typeof prior.command === 'string'
      ? 'stdio'
      : null;
  if (priorTransport !== transport) return {};

  const carried: RawServer = {};
  if (Array.isArray(prior.tools)) carried.tools = prior.tools;
  if (typeof prior.timeout === 'number') carried.timeout = prior.timeout;
  if (transport === 'stdio' && typeof prior.cwd === 'string') carried.cwd = prior.cwd;
  return carried;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
