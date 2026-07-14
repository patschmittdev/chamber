// Read/write access to a mind's `.mcp.json` for the Extensions hub. This is the
// management counterpart to `mcpConfig.ts`: where `loadMcpServersFromMindPath`
// coerces entries into the SDK's `MCPServerConfig` shape for session creation,
// this module round-trips the raw file so users can add, edit, and remove
// servers without losing unrelated content.
//
// Safety invariants:
//   - Manageability is decided by the *runtime* MCP schema (`mcpServerSchema`).
//     An entry the runtime would reject is never surfaced as editable and is
//     preserved on disk verbatim — management must not normalize an inert,
//     invalid entry into a valid, executable stdio/http config (#S5-1).
//   - Non-managed per-server fields (`type`, `tools`, `timeout`, `cwd`) are
//     carried with the entry (see `preserved`) so a rename keeps them. Losing
//     `tools` would widen a server from its allowlist to all tools (#S5-2), and
//     losing `type` would rewrite an `sse` server as `http` (#S5-4).
//   - Unknown top-level keys in `.mcp.json` are preserved on write.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  McpHttpType,
  McpPreservedServerFields,
  McpServerEntry,
  McpStdioType,
} from '@chamber/shared/mcp-types';
import { Logger } from '../logger';
import { MCP_CONFIG_FILENAME, mcpServerSchema } from './mcpConfig';

const log = Logger.create('mcpServerStore');

type RawServer = Record<string, unknown>;

/**
 * Safe summary of a configured MCP server for capability inventory displays.
 * It intentionally excludes commands, URLs, headers, environment values, and
 * all preserved configuration fields.
 */
export interface McpServerSummary {
  readonly name: string;
  readonly transport: McpServerEntry['transport'];
}

/** Whether the on-disk file could be safely parsed and round-tripped. */
type RawConfigStatus = 'empty' | 'loaded' | 'unreadable';

interface RawConfig {
  /** `empty` = no file; `loaded` = valid JSON object; `unreadable` = present but unsafe to round-trip. */
  status: RawConfigStatus;
  /** Top-level keys other than `mcpServers`, preserved across writes. */
  top: Record<string, unknown>;
  /** The raw `mcpServers` map exactly as read from disk. */
  servers: Record<string, RawServer>;
}

/**
 * True when a raw entry validates against the runtime MCP schema — i.e. the
 * runtime would actually load it. Only manageable entries are surfaced to the
 * UI; everything else is preserved untouched.
 */
function isManageable(raw: unknown): boolean {
  return mcpServerSchema.safeParse(raw).success;
}

/**
 * Reads the manageable MCP servers configured for `mindPath`. Entries the
 * runtime schema rejects are intentionally omitted (they remain on disk,
 * untouched). Returns an empty array when the file is absent. Throws when the
 * file exists but cannot be parsed, so the caller surfaces an error and keeps
 * the file read-only rather than silently treating it as empty.
 */
export function readMcpServers(mindPath: string): McpServerEntry[] {
  const config = readRawConfig(path.join(mindPath, MCP_CONFIG_FILENAME));
  if (config.status === 'unreadable') {
    throw new Error(
      `Cannot read ${MCP_CONFIG_FILENAME}: it is not valid JSON. Fix or remove the file to manage MCP servers.`,
    );
  }

  const entries: McpServerEntry[] = [];
  for (const [name, raw] of Object.entries(config.servers)) {
    if (!isManageable(raw)) continue;
    entries.push(toEntry(name, raw));
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns only non-sensitive configured-server metadata for inventory reads. */
export function listMcpServerSummaries(mindPath: string): McpServerSummary[] {
  return readMcpServers(mindPath).map(({ name, transport }) => ({ name, transport }));
}

/**
 * Replaces the *manageable* MCP server set in `mindPath`'s `.mcp.json` and
 * returns the persisted, normalized list. Raw entries the runtime rejects are
 * preserved verbatim; managed entries are replaced/added by name and removed by
 * omission. Refuses to overwrite a file it could not parse, and throws on empty,
 * duplicate, or preserved-name-colliding entries.
 */
export function writeMcpServers(mindPath: string, entries: McpServerEntry[]): McpServerEntry[] {
  const filePath = path.join(mindPath, MCP_CONFIG_FILENAME);
  const existing = readRawConfig(filePath);
  if (existing.status === 'unreadable') {
    throw new Error(
      `Refusing to overwrite ${MCP_CONFIG_FILENAME}: the existing file is not valid JSON. Fix or remove it first.`,
    );
  }

  const nextServers: Record<string, RawServer> = {};

  // Preserve every entry the runtime schema rejects, exactly as written. These
  // are invalid/unsupported servers the UI never surfaced; management must not
  // rewrite them (blocker 1).
  for (const [name, raw] of Object.entries(existing.servers)) {
    if (!isManageable(raw)) nextServers[name] = raw;
  }
  const preservedNames = new Set(Object.keys(nextServers));

  // Serialize the managed entries, replacing/adding by name. Managed entries
  // omitted from `entries` are dropped (removal by name).
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = entry.name.trim();
    if (name.length === 0) {
      throw new Error('MCP server name must not be empty');
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate MCP server name: ${name}`);
    }
    // A managed name must not silently clobber a preserved (invalid) entry that
    // the UI never showed; keep the preserve-verbatim contract total.
    if (preservedNames.has(name)) {
      throw new Error(`MCP server name in use by an unmanaged entry: ${name}`);
    }
    seen.add(name);
    const serialized = serializeEntry(entry);
    // Defense in depth: the IPC layer validates input, but this is a public
    // service API. Never persist an entry that would fail the runtime schema
    // (and then vanish from the returned list), which would diverge disk from UI.
    if (!isManageable(serialized)) {
      throw new Error(`Invalid MCP server configuration for ${name}`);
    }
    nextServers[name] = serialized;
  }

  const document = { ...existing.top, mcpServers: nextServers };
  fs.mkdirSync(mindPath, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
  return readMcpServers(mindPath);
}

function readRawConfig(filePath: string): RawConfig {
  if (!fs.existsSync(filePath)) return { status: 'empty', top: {}, servers: {} };

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.warn(`Failed to read ${filePath}; refusing to manage it:`, err);
    return { status: 'unreadable', top: {}, servers: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    log.warn(`Invalid JSON in ${filePath}; refusing to manage it:`, err);
    return { status: 'unreadable', top: {}, servers: {} };
  }

  if (!isRecord(parsed)) {
    log.warn(`${filePath} is not a JSON object; refusing to manage it.`);
    return { status: 'unreadable', top: {}, servers: {} };
  }

  const { mcpServers, ...top } = parsed;
  // A present-but-malformed `mcpServers` means we don't understand the file's
  // shape; refuse rather than clobber it with our own map.
  if (mcpServers !== undefined && !isRecord(mcpServers)) {
    log.warn(`${filePath} has a non-object mcpServers; refusing to manage it.`);
    return { status: 'unreadable', top: {}, servers: {} };
  }

  const servers = isRecord(mcpServers) ? (mcpServers as Record<string, RawServer>) : {};
  return { status: 'loaded', top, servers };
}

/** Maps a schema-valid raw entry to the renderer model, capturing preserved fields. */
function toEntry(name: string, raw: RawServer): McpServerEntry {
  const preserved = readPreserved(raw);
  const preservedProp = preserved ? { preserved } : {};
  if (typeof raw.url === 'string') {
    return {
      name,
      transport: 'http',
      url: raw.url,
      headers: toStringRecord(raw.headers),
      ...preservedProp,
    };
  }
  return {
    name,
    transport: 'stdio',
    command: raw.command as string,
    args: toStringArray(raw.args),
    env: toStringRecord(raw.env),
    ...preservedProp,
  };
}

/** Extracts the non-UI-edited runtime fields to round-trip verbatim. */
function readPreserved(raw: RawServer): McpPreservedServerFields | undefined {
  const preserved: McpPreservedServerFields = {};
  if (typeof raw.type === 'string') preserved.type = raw.type as McpStdioType | McpHttpType;
  if (Array.isArray(raw.tools)) {
    preserved.tools = raw.tools.filter((item): item is string => typeof item === 'string');
  }
  if (typeof raw.timeout === 'number') preserved.timeout = raw.timeout;
  if (typeof raw.cwd === 'string') preserved.cwd = raw.cwd;
  return Object.keys(preserved).length > 0 ? preserved : undefined;
}

/**
 * Serializes an entry back to raw `.mcp.json` shape. The written `type` is
 * clamped to the arm's valid values so a stale `preserved.type` left over from
 * a transport change can never produce an invalid config (e.g. `sse` on a
 * stdio server). `tools` and `timeout` are carried across transports; `cwd` is
 * stdio-only.
 */
function serializeEntry(entry: McpServerEntry): RawServer {
  const preserved = entry.preserved ?? {};
  if (entry.transport === 'stdio') {
    const out: RawServer = {
      type: preserved.type === 'local' ? 'local' : 'stdio',
      command: entry.command,
      args: entry.args,
    };
    if (Object.keys(entry.env).length > 0) out.env = entry.env;
    if (typeof preserved.cwd === 'string') out.cwd = preserved.cwd;
    if (Array.isArray(preserved.tools)) out.tools = preserved.tools;
    if (typeof preserved.timeout === 'number') out.timeout = preserved.timeout;
    return out;
  }
  const out: RawServer = {
    type: preserved.type === 'sse' ? 'sse' : 'http',
    url: entry.url,
  };
  if (Object.keys(entry.headers).length > 0) out.headers = entry.headers;
  if (Array.isArray(preserved.tools)) out.tools = preserved.tools;
  if (typeof preserved.timeout === 'number') out.timeout = preserved.timeout;
  return out;
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
