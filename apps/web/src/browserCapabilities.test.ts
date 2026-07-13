/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserCapabilityEntries, getBrowserCapability } from './browserCapabilities';

const addMind = vi.fn();
const sendChat = vi.fn();
const cancelChat = vi.fn();
const listMinds = vi.fn();
const listModels = vi.fn();
const startNewConversation = vi.fn();

vi.mock('@chamber/client', () => ({
  ChamberClient: vi.fn(function ChamberClient() {
    return {
      addMind,
      sendChat,
      cancelChat,
      listMinds,
      listModels,
      startNewConversation,
    };
  }),
}));

class MockWebSocket extends EventTarget {
  static readonly OPEN = 1;
  readyState = MockWebSocket.OPEN;

  constructor(url: URL) {
    super();
    void url;
  }

  send(): void {}
}

/**
 * `e2e` is optional, dev-only test scaffolding that the browser host does not
 * implement, so the manifest excludes it and the runtime scan skips it too.
 */
const EXCLUDED_NAMESPACES = new Set(['e2e']);

type MethodBag = Record<string, (...args: unknown[]) => unknown>;
type RuntimeApi = Record<string, MethodBag>;

function runtimeApi(): RuntimeApi {
  return window.electronAPI as unknown as RuntimeApi;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Calls a capability and reports whether it signalled unavailability, tolerating
 * both synchronous throws (window controls) and rejected promises (async methods).
 */
async function callResult(fn: () => unknown): Promise<{ rejected: boolean; message: string }> {
  try {
    const result = fn();
    if (result instanceof Promise) {
      try {
        await result;
        return { rejected: false, message: '' };
      } catch (error) {
        return { rejected: true, message: errorMessage(error) };
      }
    }
    return { rejected: false, message: '' };
  } catch (error) {
    return { rejected: true, message: errorMessage(error) };
  }
}

describe('browser capability manifest parity', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    listMinds.mockResolvedValue([]);
    listModels.mockResolvedValue([]);
    vi.stubGlobal('WebSocket', MockWebSocket);
    Reflect.deleteProperty(window, 'electronAPI');
    const { installBrowserApi } = await import('./browserApi');
    installBrowserApi();
  });

  it('declares a manifest entry for every method the browser host exposes', () => {
    const undeclared: string[] = [];
    for (const [namespace, methods] of Object.entries(runtimeApi())) {
      if (EXCLUDED_NAMESPACES.has(namespace)) continue;
      for (const [method, value] of Object.entries(methods)) {
        if (typeof value !== 'function') continue;
        if (!getBrowserCapability(namespace, method)) {
          undeclared.push(`${namespace}.${method}`);
        }
      }
    }
    expect(undeclared, `undeclared browser methods: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('exposes a runtime function for every manifest entry', () => {
    const missing: string[] = [];
    for (const { namespace, method } of browserCapabilityEntries()) {
      if (typeof runtimeApi()[namespace]?.[method] !== 'function') {
        missing.push(`${namespace}.${method}`);
      }
    }
    expect(missing, `manifest entries with no runtime function: ${missing.join(', ')}`).toEqual([]);
  });

  it('rejects from the single dispatcher for every method declared rejects: true', async () => {
    const rejecting = browserCapabilityEntries().filter((entry) => entry.capability.rejects === true);
    expect(rejecting.length).toBeGreaterThan(0);

    for (const { namespace, method } of rejecting) {
      const { rejected, message } = await callResult(() => runtimeApi()[namespace][method]());
      expect(rejected, `${namespace}.${method} is declared rejects: true but did not reject`).toBe(true);
      expect(message, `${namespace}.${method} rejected with an unexpected message`).toContain(
        `Not available in browser mode: ${namespace}.${method}`,
      );
    }
  });
});
