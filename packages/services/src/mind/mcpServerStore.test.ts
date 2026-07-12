import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { McpServerEntry } from '@chamber/shared/mcp-types';
import { readMcpServers, writeMcpServers } from './mcpServerStore';
import { MCP_CONFIG_FILENAME } from './mcpConfig';

describe('mcpServerStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mcp-store-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(value: unknown): void {
    fs.writeFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), JSON.stringify(value), 'utf-8');
  }

  function readFile(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), 'utf-8'));
  }

  describe('readMcpServers', () => {
    it('returns an empty array when the file is absent', () => {
      expect(readMcpServers(tmpDir)).toEqual([]);
    });

    it('normalizes stdio and http servers sorted by name', () => {
      writeFile({
        mcpServers: {
          zeta: { type: 'http', url: 'https://mcp.example.test/v1', headers: { Authorization: 'token' } },
          alpha: { command: 'npx', args: ['-y', 'server'], env: { ROOT: '/tmp' } },
        },
      });

      expect(readMcpServers(tmpDir)).toEqual([
        { name: 'alpha', transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: { ROOT: '/tmp' } },
        { name: 'zeta', transport: 'http', url: 'https://mcp.example.test/v1', headers: { Authorization: 'token' } },
      ]);
    });

    it('defaults missing args, env, and headers to empty collections', () => {
      writeFile({ mcpServers: { bare: { command: 'cli' } } });
      expect(readMcpServers(tmpDir)).toEqual([
        { name: 'bare', transport: 'stdio', command: 'cli', args: [], env: {} },
      ]);
    });

    it('skips ambiguous entries that mix command and url', () => {
      writeFile({ mcpServers: { confused: { command: 'x', url: 'https://y.test' } } });
      expect(readMcpServers(tmpDir)).toEqual([]);
    });

    it('returns an empty array for malformed JSON without throwing', () => {
      fs.writeFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), '{not json', 'utf-8');
      expect(readMcpServers(tmpDir)).toEqual([]);
    });
  });

  describe('writeMcpServers', () => {
    it('persists stdio and http entries with an explicit type', () => {
      const entries: McpServerEntry[] = [
        { name: 'files', transport: 'stdio', command: 'npx', args: ['-y', 'fs'], env: { ROOT: '/tmp' } },
        { name: 'remote', transport: 'http', url: 'https://mcp.example.test', headers: { Authorization: 'k' } },
      ];

      const result = writeMcpServers(tmpDir, entries);

      expect(result).toEqual([
        { name: 'files', transport: 'stdio', command: 'npx', args: ['-y', 'fs'], env: { ROOT: '/tmp' } },
        { name: 'remote', transport: 'http', url: 'https://mcp.example.test', headers: { Authorization: 'k' } },
      ]);
      expect(readFile()).toEqual({
        mcpServers: {
          files: { type: 'stdio', command: 'npx', args: ['-y', 'fs'], env: { ROOT: '/tmp' } },
          remote: { type: 'http', url: 'https://mcp.example.test', headers: { Authorization: 'k' } },
        },
      });
    });

    it('omits env and headers when they are empty', () => {
      writeMcpServers(tmpDir, [
        { name: 'files', transport: 'stdio', command: 'cli', args: [], env: {} },
      ]);
      const written = readFile().mcpServers as Record<string, Record<string, unknown>>;
      expect(Object.prototype.hasOwnProperty.call(written.files, 'env')).toBe(false);
    });

    it('preserves unknown top-level keys across a write', () => {
      writeFile({ $schema: 'https://schema.test', mcpServers: {} });
      writeMcpServers(tmpDir, [
        { name: 'files', transport: 'stdio', command: 'cli', args: [], env: {} },
      ]);
      expect(readFile().$schema).toBe('https://schema.test');
    });

    it('preserves tools and timeout when a server keeps the same transport', () => {
      writeFile({
        mcpServers: {
          files: { type: 'stdio', command: 'old', args: [], tools: ['read'], timeout: 5000, cwd: '/work' },
        },
      });

      writeMcpServers(tmpDir, [
        { name: 'files', transport: 'stdio', command: 'new', args: ['--flag'], env: {} },
      ]);

      const written = readFile().mcpServers as Record<string, Record<string, unknown>>;
      expect(written.files).toEqual({
        type: 'stdio',
        command: 'new',
        args: ['--flag'],
        tools: ['read'],
        timeout: 5000,
        cwd: '/work',
      });
    });

    it('drops non-managed fields when the transport changes', () => {
      writeFile({
        mcpServers: {
          svc: { type: 'stdio', command: 'old', tools: ['read'], cwd: '/work' },
        },
      });

      writeMcpServers(tmpDir, [
        { name: 'svc', transport: 'http', url: 'https://mcp.example.test', headers: {} },
      ]);

      const written = readFile().mcpServers as Record<string, Record<string, unknown>>;
      expect(written.svc).toEqual({ type: 'http', url: 'https://mcp.example.test' });
    });

    it('rejects empty names', () => {
      expect(() => writeMcpServers(tmpDir, [
        { name: '  ', transport: 'stdio', command: 'cli', args: [], env: {} },
      ])).toThrow(/name must not be empty/);
    });

    it('rejects duplicate names', () => {
      expect(() => writeMcpServers(tmpDir, [
        { name: 'dup', transport: 'stdio', command: 'a', args: [], env: {} },
        { name: 'dup', transport: 'http', url: 'https://b.test', headers: {} },
      ])).toThrow(/Duplicate MCP server name: dup/);
    });

    it('round-trips through readMcpServers', () => {
      const entries: McpServerEntry[] = [
        { name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: { A: '1' } },
      ];
      writeMcpServers(tmpDir, entries);
      expect(readMcpServers(tmpDir)).toEqual(entries);
    });
  });
});
