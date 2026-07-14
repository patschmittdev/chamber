import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { MindManager } from './MindManager';
import { approveForSessionCompat } from '../sdk/approveForSessionCompat';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { ChamberToolProvider } from '../chamberTools';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';
import type { AppConfig, LensViewManifest, MessageVariant, MessageVariantGroup } from '@chamber/shared/types';
import { MindScaffold } from '../genesis/MindScaffold';
import type { ManagedSkillSyncResult } from '../skills';
import type { ConversationForkSeed } from '../chat/conversationForkContext';
import { appendAttachmentManifestContext } from '../chat/attachmentContext';
import type { IMindTrustService } from '../mindTrust/types';

// --- Mocks ---

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  realpathSync: Object.assign(vi.fn((candidate: string) => candidate), {
    native: vi.fn((candidate: string) => candidate),
  }),
}));

vi.mock('../lens/MindBootstrap', () => ({
  bootstrapMindCapabilities: vi.fn(),
}));

import * as fs from 'fs';
import { bootstrapMindCapabilities } from '../lens/MindBootstrap';

const mockStart = vi.fn();
const mockStop = vi.fn();
let sessionCounter = 0;
function createSessionStub(sessionId = `sdk-session-${sessionCounter += 1}`) {
  return {
  sessionId,
  send: vi.fn(),
  sendAndWait: vi.fn(),
  getEvents: vi.fn(async (): Promise<unknown[]> => []),
  on: vi.fn(),
  off: vi.fn(),
  disconnect: vi.fn(async () => undefined),
  setModel: vi.fn(async () => undefined),
  rpc: {
    permissions: { setApproveAll: vi.fn(async () => ({ success: true })) },
    history: { truncate: vi.fn(async () => ({ eventsRemoved: 0 })) },
  },
  };
}

const mockCreateSession = vi.fn((config: Record<string, unknown>) => {
  return createSessionStub(typeof config.sessionId === 'string' ? config.sessionId : undefined);
});
const mockResumeSession = vi.fn((sessionId: string, config: Record<string, unknown>) => {
  void config;
  return createSessionStub(sessionId);
});
const mockDeleteSession = vi.fn(async (sessionId: string) => {
  void sessionId;
});

function makeMockClient() {
  return {
    start: mockStart,
    stop: mockStop,
    createSession: mockCreateSession,
    resumeSession: mockResumeSession,
    deleteSession: mockDeleteSession,
  };
}

const mockClientFactory = {
  createClient: vi.fn(async () => makeMockClient()),
  destroyClient: vi.fn(),
};

const defaultMindIdentity = (mindPath: string) => ({
  name: mindPath.split('/').pop() ?? 'unknown',
  systemMessage: `Identity for ${mindPath}`,
});

const defaultMindInstructionPrecedence = (mindPath: string, options?: { includeGlobalCustomInstructions?: boolean }) => ({
  mindName: mindPath.split('/').pop() ?? 'unknown',
  globalCustomInstructionsEnabled: options?.includeGlobalCustomInstructions !== false,
  hasGlobalCustomInstructions: true,
  layers: [{
    id: 'global-custom-instructions' as const,
    label: 'Global custom instructions',
    source: 'Settings > Custom instructions',
    description: 'Operator preferences shared across minds when this mind inherits them.',
    included: options?.includeGlobalCustomInstructions !== false,
    present: true,
    enabled: options?.includeGlobalCustomInstructions !== false,
    contentExposed: false as const,
  }],
});

const mockIdentityLoader = {
  load: vi.fn(defaultMindIdentity),
  getInstructionPrecedence: vi.fn(defaultMindInstructionPrecedence),
};

const mockProvider = {
  getToolsForMind: vi.fn<(_: string, __: string) => unknown[]>(() => []),
  activateMind: vi.fn(async (mindId: string, mindPath: string) => {
    void mindId;
    void mindPath;
  }),
  releaseMind: vi.fn(async (mindId: string) => {
    void mindId;
  }),
};

let currentConfig: AppConfig = {
  version: 2,
  minds: [],
  activeMindId: null,
  activeLogin: null,
  theme: 'dark',
};

const mockConfigService = {
  getConfigDir: vi.fn(() => 'C:\\tmp\\chamber-config'),
  load: vi.fn(() => currentConfig),
  save: vi.fn((config) => {
    currentConfig = config;
  }),
};

const mockViewDiscovery = {
  scan: vi.fn<(_: string) => Promise<LensViewManifest[]>>(async () => []),
  getViews: vi.fn<() => LensViewManifest[]>(() => []),
  startWatching: vi.fn<(_: string, __: () => void) => void>(),
  stopWatching: vi.fn(),
  removeMind: vi.fn(),
  setRefreshHandler: vi.fn(),
};

const COPILOT_RUNTIME_CONFIG_DIR = path.join('C:\\tmp\\chamber-config', 'copilot-runtime');

function lastSavedConfig(): AppConfig {
  const config = mockConfigService.save.mock.calls.at(-1)?.[0] as AppConfig | undefined;
  if (!config) throw new Error('Expected config to be saved');
  return config;
}

function savedMindIds(config: AppConfig): string[] {
  return config.minds.map(record => record.id).sort();
}

describe('MindManager', () => {
  let manager: MindManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.getToolsForMind.mockReset();
    mockProvider.activateMind.mockReset();
    mockProvider.releaseMind.mockReset();
    mockProvider.getToolsForMind.mockImplementation(() => []);
    mockProvider.activateMind.mockImplementation(async () => { /* noop */ });
    mockProvider.releaseMind.mockImplementation(async () => { /* noop */ });
    mockConfigService.load.mockReset();
    mockConfigService.save.mockReset();
    mockConfigService.getConfigDir.mockReset();
    mockIdentityLoader.load.mockReset();
    mockIdentityLoader.getInstructionPrecedence.mockReset();
    mockIdentityLoader.load.mockImplementation(defaultMindIdentity);
    mockIdentityLoader.getInstructionPrecedence.mockImplementation(defaultMindInstructionPrecedence);
    mockConfigService.getConfigDir.mockReturnValue('C:\\tmp\\chamber-config');
    mockConfigService.load.mockImplementation(() => currentConfig);
    mockConfigService.save.mockImplementation((config) => {
      currentConfig = config;
    });
    currentConfig = {
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: null,
      theme: 'dark',
    };
    mockCreateSession.mockImplementation((config: Record<string, unknown>) => {
      return createSessionStub(typeof config.sessionId === 'string' ? config.sessionId : undefined);
    });
    mockResumeSession.mockImplementation((sessionId: string, config: Record<string, unknown>) => {
      void config;
      return createSessionStub(sessionId);
    });
    mockDeleteSession.mockImplementation(async (sessionId: string) => {
      void sessionId;
    });
    vi.mocked(fs.existsSync).mockImplementation((candidate) => {
      // Default: every checked path exists EXCEPT `.mcp.json` and
      // `.chamber.json`. Tests that need MindManager to discover either
      // file opt in by overriding existsSync + readFileSync per test
      // (#199 / #131). Without the chamber.json exclusion, the default
      // readFileSync stub ('# TestAgent\nSome content') fails JSON.parse
      // and pollutes every test with a chamberMindConfig warn.
      const s = String(candidate);
      return !s.endsWith('.mcp.json') && !s.endsWith('.chamber.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue('# TestAgent\nSome content');
    vi.mocked(fs.realpathSync.native).mockImplementation((candidate) => String(candidate));
    manager = new MindManager(
      mockClientFactory as unknown as CopilotClientFactory,
      mockIdentityLoader as unknown as IdentityLoader,
      mockConfigService as unknown as ConfigService,
      mockViewDiscovery as unknown as ViewDiscovery,
    );
    manager.setProviders([mockProvider as unknown as ChamberToolProvider]);
  });

  describe('loadMind', () => {
    it('runs the .chamber gitignore migration for existing minds on load', async () => {
      const ensureChamberGitignore = vi
        .spyOn(MindScaffold, 'ensureChamberGitignore')
        .mockReturnValue(true);
      try {
        await manager.loadMind('/tmp/agents/q');

        expect(ensureChamberGitignore).toHaveBeenCalledWith('/tmp/agents/q');
      } finally {
        ensureChamberGitignore.mockRestore();
      }
    });

    it('loads a mind from a valid directory', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      expect(mind.mindPath).toBe('/tmp/agents/q');
      expect(mind.identity.name).toBe('q');
      expect(mind.status).toBe('ready');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      expect(mockProvider.getToolsForMind).toHaveBeenCalledWith(
        expect.stringMatching(/^q-/),
        '/tmp/agents/q',
      );
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('creates a named chamber session and persists conversation metadata', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionConfig = mockCreateSession.mock.calls[0][0] as { sessionId?: string };

      expect(sessionConfig.sessionId).toMatch(new RegExp(`^chamber-${mind.mindId}-`));
      expect(lastSavedConfig().minds[0]).toMatchObject({
        id: mind.mindId,
        activeSessionId: sessionConfig.sessionId,
        conversations: [expect.objectContaining({
          sessionId: sessionConfig.sessionId,
          kind: 'chat',
          hasMessages: false,
        })],
      });
    });

    it('isolates SDK runtime config and disables implicit discovery for mind sessions', async () => {
      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
        configDirectory: COPILOT_RUNTIME_CONFIG_DIR,
        enableConfigDiscovery: false,
      }));
    });

    it('resumes a persisted active conversation when restoring a mind', async () => {
      currentConfig = {
        version: 2,
        minds: [{
          id: 'q-a1b2',
          path: '/tmp/agents/q',
          activeSessionId: 'chamber-q-a1b2-existing',
          conversations: [{
            sessionId: 'chamber-q-a1b2-existing',
            title: 'Existing chat',
            createdAt: '2026-05-05T22:00:00.000Z',
            updatedAt: '2026-05-05T22:00:00.000Z',
            kind: 'chat',
          }],
        }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };

      await manager.restoreFromConfig();

      expect(mockResumeSession).toHaveBeenCalledWith(
        'chamber-q-a1b2-existing',
        expect.objectContaining({
          workingDirectory: '/tmp/agents/q',
          configDirectory: COPILOT_RUNTIME_CONFIG_DIR,
          enableConfigDiscovery: false,
        }),
      );
      expect(manager.listMinds()[0].activeSessionId).toBe('chamber-q-a1b2-existing');
    });

    it('runs background prompts in an isolated session with current datetime context', async () => {
      await manager.loadMind('/tmp/agents/q');
      const activeSession = mockCreateSession.mock.results.at(-1)?.value;
      const isolatedSession = createSessionStub();
      isolatedSession.sendAndWait.mockResolvedValue({
        type: 'assistant.message',
        data: { content: 'Background work completed', messageId: 'assistant-1' },
      });
      mockCreateSession.mockReturnValueOnce(isolatedSession);

      await manager.sendBackgroundPrompt('/tmp/agents/q', 'do background work');

      const sentPrompt = isolatedSession.sendAndWait.mock.calls[0]?.[0]?.prompt;
      expect(sentPrompt).toEqual(expect.stringContaining('<current_datetime>'));
      expect(sentPrompt).toEqual(expect.stringContaining('<timezone>'));
      expect(sentPrompt).toEqual(expect.stringContaining('do background work'));
      expect(activeSession.send).not.toHaveBeenCalled();
      expect(isolatedSession.disconnect).toHaveBeenCalled();
    });

    it('does not let another turn idle event complete a background prompt', async () => {
      vi.useFakeTimers();
      await manager.loadMind('/tmp/agents/q');
      const activeSession = mockCreateSession.mock.results.at(-1)?.value;
      const isolatedSession = createSessionStub();
      isolatedSession.sendAndWait.mockResolvedValue({
        type: 'assistant.message',
        data: { content: 'Background work completed', messageId: 'assistant-1' },
      });
      mockCreateSession.mockReturnValueOnce(isolatedSession);

      const completion = manager.sendBackgroundPrompt('/tmp/agents/q', 'do background work');
      try {
        await Promise.resolve();
        await Promise.resolve();

        expect(activeSession.on).not.toHaveBeenCalled();
        await completion;
      } finally {
        await vi.runAllTimersAsync();
        vi.useRealTimers();
      }
    });

    it('runs automation prompts in an isolated session without touching the active conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const activeSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      const activeSessionId = manager.getMind(mind.mindId)?.activeSessionId;
      mockConfigService.save.mockClear();

      const answer = 'isolated answer';
      mockCreateSession.mockImplementationOnce((config: Record<string, unknown>) => {
        const session = createSessionStub(typeof config.sessionId === 'string' ? config.sessionId : undefined);
        session.sendAndWait.mockResolvedValueOnce({
          type: 'assistant.message',
          data: { content: answer, messageId: 'assistant-1' },
        });
        return session;
      });

      const result = await manager.runIsolatedPrompt(mind.mindId, 'summarize current state');

      const isolatedSession = mockCreateSession.mock.results.at(-1)?.value;
      expect(result).toBe(answer);
      expect(isolatedSession).not.toBe(activeSession);
      expect(isolatedSession.sendAndWait).toHaveBeenCalledWith(
        { prompt: expect.stringContaining('summarize current state') },
        120_000,
      );
      expect(isolatedSession.sendAndWait.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining('<current_datetime>'));
      expect(isolatedSession.disconnect).toHaveBeenCalled();
      expect(activeSession.send).not.toHaveBeenCalled();
      expect(activeSession.sendAndWait).not.toHaveBeenCalled();
      expect(activeSession.disconnect).not.toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.session).toBe(activeSession);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(activeSessionId);
      expect(mockConfigService.save).not.toHaveBeenCalled();
    });

    it('uses a persisted per-mind model when creating the session', async () => {
      currentConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q', selectedModel: 'gpt-5.4' }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };

      await manager.restoreFromConfig();

      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.4' }));
      expect(manager.listMinds()[0].selectedModel).toBe('gpt-5.4');
    });

    it('persists a per-mind model and updates the live session in place via setModel', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing context');
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();
      const liveSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;

      const updated = await manager.setMindModel(mind.mindId, 'claude-opus');

      expect(updated?.selectedModel).toBe('claude-opus');
      expect(lastSavedConfig().minds[0].selectedModel).toBe('claude-opus');
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(liveSession.setModel).toHaveBeenCalledWith('claude-opus');
      expect(liveSession.disconnect).not.toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.session).toBe(liveSession);
      expect(manager.listConversationHistory(mind.mindId)).toHaveLength(1);
      expect(manager.listConversationHistory(mind.mindId)[0].title).toBe('Existing context');
    });

    it('persists a per-mind model on an empty draft via setModel without recreating the session', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();
      const liveSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;

      const updated = await manager.setMindModel(mind.mindId, 'claude-opus');

      expect(updated?.selectedModel).toBe('claude-opus');
      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(liveSession.setModel).toHaveBeenCalledWith('claude-opus');
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(mind.activeSessionId);
      expect(manager.listConversationHistory(mind.mindId)).toHaveLength(1);
    });

    it('persists the new selectedModel before invoking setModel so stale recovery uses the requested model', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing context');
      const liveSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      let observedDuringFailure: string | undefined;
      liveSession.setModel.mockImplementationOnce(async () => {
        observedDuringFailure = manager.getMind(mind.mindId)?.selectedModel;
        throw new Error('Session not found: stale-runtime');
      });

      await expect(manager.setMindModel(mind.mindId, 'claude-opus')).rejects.toThrow(/Session not found/);
      expect(observedDuringFailure).toBe('claude-opus');
      expect(manager.getMind(mind.mindId)?.selectedModel).toBe('claude-opus');
    });

    it('rolls back the persisted selection when the SDK rejects with a non-stale error', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing context');
      const before = manager.getMind(mind.mindId)?.selectedModel;
      const beforeProvider = manager.getMind(mind.mindId)?.selectedModelProvider;
      const liveSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      liveSession.setModel.mockImplementationOnce(async () => {
        throw new Error('BYO endpoint unreachable: connect ECONNREFUSED 127.0.0.1:11434');
      });

      await expect(manager.setMindModel(mind.mindId, 'claude-opus')).rejects.toThrow(/ECONNREFUSED/);
      expect(manager.getMind(mind.mindId)?.selectedModel).toBe(before);
      expect(manager.getMind(mind.mindId)?.selectedModelProvider).toBe(beforeProvider);
    });

    it('serializes concurrent per-mind model changes against the live session', async () => {
      const liveSession = manager.getMind((await manager.loadMind('/tmp/agents/q')).mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      const mind = manager.listMinds()[0];
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing context');
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();
      liveSession.setModel.mockClear();

      let resolveFirst: (() => void) | undefined;
      liveSession.setModel.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          resolveFirst = () => resolve();
        });
      });
      liveSession.setModel.mockResolvedValueOnce(undefined);

      const firstChange = manager.setMindModel(mind.mindId, 'model-a');
      const secondChange = manager.setMindModel(mind.mindId, 'model-b');
      await Promise.resolve();
      await Promise.resolve();

      expect(liveSession.setModel).toHaveBeenCalledTimes(1);
      expect(liveSession.setModel).toHaveBeenCalledWith('model-a');

      resolveFirst?.();
      await Promise.all([firstChange, secondChange]);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(liveSession.setModel).toHaveBeenCalledTimes(2);
      expect(liveSession.setModel).toHaveBeenLastCalledWith('model-b');
      expect(liveSession.disconnect).not.toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.selectedModel).toBe('model-b');
      expect(manager.getMind(mind.mindId)?.session).toBe(liveSession);
    });

    it('bootstraps managed mind capabilities before creating the SDK session', async () => {
      await manager.loadMind('/tmp/agents/q');

      expect(bootstrapMindCapabilities).toHaveBeenCalledWith('/tmp/agents/q');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      expect(vi.mocked(bootstrapMindCapabilities).mock.invocationCallOrder[0])
        .toBeLessThan(mockClientFactory.createClient.mock.invocationCallOrder[0]);
    });

    it('installs marketplace managed skills before creating the SDK session', async () => {
      const managedSkillService = {
        installIntoMind: vi.fn(async (): Promise<ManagedSkillSyncResult> => ({ status: 'ok', installed: [], errors: [] })),
      };
      manager = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => null,
        () => undefined,
        managedSkillService,
      );

      await manager.loadMind('/tmp/agents/q');

      expect(managedSkillService.installIntoMind).toHaveBeenCalledWith('/tmp/agents/q');
      expect(managedSkillService.installIntoMind.mock.invocationCallOrder[0])
        .toBeLessThan(mockClientFactory.createClient.mock.invocationCallOrder[0]);
    });

    it('continues loading when managed mind capability bootstrap fails', async () => {
      vi.mocked(bootstrapMindCapabilities).mockImplementationOnce(() => {
        throw new Error('skill asset missing');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());

      const mind = await manager.loadMind('/tmp/agents/q');

      expect(mind.status).toBe('ready');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      warnSpy.mockRestore();
    });

    it('starts Lens watching and emits view changes after watcher rescans', async () => {
      const listener = vi.fn();
      const views: LensViewManifest[] = [{
        id: 'smoke-view',
        name: 'Smoke View',
        icon: 'table',
        view: 'table',
        source: 'data.json',
      }];
      mockViewDiscovery.getViews.mockReturnValue(views);
      manager.on('lens:viewsChanged', listener);

      await manager.loadMind('/tmp/agents/q');
      const onChanged = mockViewDiscovery.startWatching.mock.calls[0]?.[1];
      onChanged?.();

      expect(mockViewDiscovery.startWatching).toHaveBeenCalledWith('/tmp/agents/q', expect.any(Function));
      expect(mockViewDiscovery.getViews).toHaveBeenCalledWith('/tmp/agents/q');
      expect(listener).toHaveBeenCalledWith(views, expect.stringMatching(/^q-/));
    });

    it('generates a stable mind ID from folder name', async () => {
      const mind = await manager.loadMind('/tmp/agents/fox');
      expect(mind.mindId).toMatch(/^fox-[a-f0-9]{4}$/);
    });

    it('throws on invalid directory (no SOUL.md or .github)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await expect(manager.loadMind('/tmp/invalid')).rejects.toThrow();
    });

    it('resolves nested directories to the nearest mind root', async () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return normalized === '/tmp/agents/q/SOUL.md' || normalized === '/tmp/agents/q/.github';
      });

      const mind = await manager.loadMind('/tmp/agents/q/domains');
      const createClientCalls = (mockClientFactory.createClient as unknown as { mock: { calls: Array<[string]> } }).mock.calls;
      const lastCreateClientPath = String(
        createClientCalls[createClientCalls.length - 1]?.[0] ?? '',
      );

      expect(mind.mindPath.replace(/\\/g, '/')).toBe('/tmp/agents/q');
      expect(lastCreateClientPath.replace(/\\/g, '/')).toBe('/tmp/agents/q');
    });

    it('deduplicates — same path loaded twice returns existing mind', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/q');
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });

    it('deduplicates equivalent path spellings before creating another client', async () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/').toLowerCase();
        return normalized === '/tmp/agents/q/soul.md' || normalized === '/tmp/agents/q/.github';
      });
      vi.mocked(fs.realpathSync.native).mockImplementation((candidate) =>
        String(candidate).replace(/\\/g, '/').toLowerCase(),
      );

      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/Q/');

      expect(mind2.mindId).toBe(mind1.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(mockProvider.activateMind).toHaveBeenCalledTimes(1);
    });

    it('deduplicates filesystem aliases by realpath before creating another client', async () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        return !String(candidate).endsWith('.mcp.json');
      });
      vi.mocked(fs.realpathSync.native).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('/tmp/aliases/q-link')) {
          return normalized.slice(0, -'/tmp/aliases/q-link'.length) + '/tmp/agents/q';
        }
        return normalized;
      });

      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/aliases/q-link');

      expect(mind2.mindId).toBe(mind1.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('emits mind:loaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:loaded', listener);
      await manager.loadMind('/tmp/agents/q');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mindPath: '/tmp/agents/q' }));
    });

    describe('display-name uniqueness (#44)', () => {
      // mockImplementation overrides on shared mocks persist across vi.clearAllMocks().
      // Re-install the basename-derived default each time so tests below us in the
      // file (and the rest of this describe) see consistent identity loader behavior.
      const defaultIdentityImpl = (mindPath: string) => ({
        name: mindPath.split('/').pop() ?? 'unknown',
        systemMessage: `Identity for ${mindPath}`,
      });
      beforeEach(() => {
        mockIdentityLoader.load.mockImplementation(defaultIdentityImpl);
      });
      afterEach(() => {
        mockIdentityLoader.load.mockImplementation(defaultIdentityImpl);
      });
      it('findByName returns the mind whose identity.name matches (case-insensitive)', async () => {
        await manager.loadMind('/tmp/agents/q');
        await manager.loadMind('/tmp/agents/fox');

        expect(manager.findByName('q')?.mindPath).toBe('/tmp/agents/q');
        expect(manager.findByName('Q')?.mindPath).toBe('/tmp/agents/q');
        expect(manager.findByName('  q  ')?.mindPath).toBe('/tmp/agents/q');
        expect(manager.findByName('fox')?.mindPath).toBe('/tmp/agents/fox');
        expect(manager.findByName('nonexistent')).toBeUndefined();
      });

      it('default loadMind (no options) does NOT enforce name uniqueness — preserves startup-replay behavior', async () => {
        // IdentityLoader mock returns identity.name = basename. Two distinct paths
        // with the same basename produce two minds with the same display name.
        // Pre-existing persisted configs may legitimately contain such pairs;
        // startup must not refuse to restore them.
        const a = await manager.loadMind('/tmp/agents/q');
        const b = await manager.loadMind('/tmp/other/q');

        expect(a.identity.name).toBe('q');
        expect(b.identity.name).toBe('q');
        expect(a.mindId).not.toBe(b.mindId);
      });

      it('loadMind with enforceUnique: true throws when name collides with an already-loaded mind at a different path', async () => {
        await manager.loadMind('/tmp/agents/q');

        await expect(
          manager.loadMind('/tmp/other/q', undefined, { enforceUnique: true }),
        ).rejects.toThrow(/already exists/i);
        // And the colliding mind must not have been registered or created any SDK state.
        expect(manager.listMinds()).toHaveLength(1);
      });

      it('loadMind with enforceUnique: true still deduplicates the same mind path (no collision against itself)', async () => {
        const first = await manager.loadMind('/tmp/agents/q');
        const second = await manager.loadMind('/tmp/agents/q', undefined, { enforceUnique: true });

        expect(second.mindId).toBe(first.mindId);
        expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
      });

      it('loadMind with enforceUnique: true compares names case-insensitively', async () => {
        await manager.loadMind('/tmp/agents/Alfred');

        await expect(
          manager.loadMind('/tmp/other/alfred', undefined, { enforceUnique: true }),
        ).rejects.toThrow(/already exists/i);
      });

      it('loadMind with enforceUnique: true rolls back identity load without creating an SDK client', async () => {
        await manager.loadMind('/tmp/agents/q');
        const clientsBefore = mockClientFactory.createClient.mock.calls.length;

        await expect(
          manager.loadMind('/tmp/other/q', undefined, { enforceUnique: true }),
        ).rejects.toThrow(/already exists/i);

        // The collision is detected before clientFactory.createClient runs,
        // so no extra SDK client is spawned for the rejected load.
        expect(mockClientFactory.createClient.mock.calls.length).toBe(clientsBefore);
      });

      it('serializes concurrent enforce-unique loads with colliding names so only one succeeds', async () => {
        // Two concurrent loads of different paths whose IdentityLoader returns
        // the same name. Without a reservation, both would pass the
        // this.minds-only check (this.minds.set happens much later in the
        // pipeline, after client/session setup) and both would load.
        mockIdentityLoader.load.mockImplementation(() => ({
          name: 'alfred',
          systemMessage: 'identity',
        }));

        const results = await Promise.allSettled([
          manager.loadMind('/tmp/agents/butler-a', undefined, { enforceUnique: true }),
          manager.loadMind('/tmp/agents/butler-b', undefined, { enforceUnique: true }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
          message: expect.stringMatching(/already exists/i),
        });
        expect(manager.listMinds()).toHaveLength(1);
      });

      it('findByName matches across Unicode normalization forms (NFC vs NFD)', async () => {
        // macOS clipboard often produces NFD ("Cafe\u0301"); Windows produces NFC ("Café").
        // Without normalization the duplicate check would let two visually-identical
        // names through. Loaded mind uses NFD; lookup uses NFC.
        const nfd = 'Cafe\u0301';
        const nfc = 'Café';
        expect(nfd).not.toBe(nfc);
        mockIdentityLoader.load.mockImplementation(() => ({
          name: nfd,
          systemMessage: 'identity',
        }));
        await manager.loadMind('/tmp/agents/cafe-nfd');

        expect(manager.findByName(nfc)?.mindPath).toBe('/tmp/agents/cafe-nfd');
        expect(manager.findByName(nfd)?.mindPath).toBe('/tmp/agents/cafe-nfd');
      });
    });

    it('wires approveForSessionCompat and does not short-circuit via setApproveAll (issue #131)', async () => {
      const created = createSessionStub();
      mockCreateSession.mockResolvedValueOnce(created);
      await manager.loadMind('/tmp/agents/q');
      const sessionConfig = mockCreateSession.mock.calls[0][0] as { onPermissionRequest?: unknown };
      expect(sessionConfig.onPermissionRequest).toBe(approveForSessionCompat);
      expect(created.rpc.permissions.setApproveAll).not.toHaveBeenCalled();
    });
  });

  describe('conversation history mutations', () => {
    const liveSessionFor = (mindId: string) =>
      manager.getMind(mindId)?.session as unknown as ReturnType<typeof createSessionStub>;

    it('maps persisted events to chat messages with their backing event ids', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      liveSessionFor(mind.mindId).getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Hi' } },
        { id: 'evt-2', type: 'assistant.message', timestamp: 2, data: { messageId: 'a1', content: 'Hello' } },
      ]);

      const messages = await manager.getActiveConversationMessages(mind.mindId);

      expect(messages).toEqual([
        { id: 'u1', role: 'user', blocks: [{ type: 'text', content: 'Hi' }], timestamp: 1, eventId: 'evt-1' },
        { id: 'a1', role: 'assistant', blocks: [{ type: 'text', sdkMessageId: 'a1', content: 'Hello' }], timestamp: 2, eventId: 'evt-2' },
      ]);
    });

    it('exposes ordered event references for reconciliation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      liveSessionFor(mind.mindId).getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Hi' } },
        { id: 'evt-2', type: 'assistant.message', timestamp: 2, data: { messageId: 'a1', content: 'Hello' } },
      ]);

      expect(await manager.getConversationEventRefs(mind.mindId)).toEqual([
        { eventId: 'evt-1', messageId: 'u1', role: 'user' },
        { eventId: 'evt-2', messageId: 'a1', role: 'assistant' },
      ]);
    });

    it('forks a distinct active session with metadata and bounded seed context without truncating the source', async () => {
      const seeds = new Map<string, ConversationForkSeed>();
      const forkSeedStore = {
        save: vi.fn(async (mindId: string, sessionId: string, seed: ConversationForkSeed) => {
          seeds.set(`${mindId}:${sessionId}`, seed);
        }),
        read: vi.fn(async (mindId: string, sessionId: string) => seeds.get(`${mindId}:${sessionId}`) ?? null),
        delete: vi.fn(async () => undefined),
      };
      manager = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => ({ type: 'openai' as const, baseUrl: 'https://x/v1' }),
        undefined,
        undefined,
        forkSeedStore,
      );
      manager.setProviders([mockProvider as unknown as ChamberToolProvider]);
      const mind = await manager.loadMind('/tmp/agents/q');
      const sourceSession = liveSessionFor(mind.mindId);
      const sourceSessionId = mind.activeSessionId;
      if (!sourceSessionId) throw new Error('Expected active session id');
      sourceSession.getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Plan the rollout' } },
        { id: 'evt-2', type: 'assistant.message', timestamp: 2, data: { messageId: 'a1', content: 'Drafted the plan' } },
      ]);
      manager.markActiveConversationHasMessages(mind.mindId, 'Plan the rollout');

      const result = await manager.forkConversation(mind.mindId, sourceSessionId, 'evt-2');

      expect(result.sessionId).not.toBe(sourceSessionId);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(result.sessionId);
      expect(sourceSession.rpc.history.truncate).not.toHaveBeenCalled();
      expect(forkSeedStore.save).toHaveBeenCalledWith(
        mind.mindId,
        result.sessionId,
        expect.objectContaining({
          fork: expect.objectContaining({
            sourceSessionId,
            sourceEventId: 'evt-2',
            sourceMessageId: 'a1',
            sourceTitle: 'Plan the rollout',
          }),
        }),
      );
      expect(result.messages).toEqual([
        expect.objectContaining({ id: `fork-seed:${sourceSessionId}:u1`, forkSeed: true }),
        expect.objectContaining({ id: `fork-seed:${sourceSessionId}:a1`, forkSeed: true }),
      ]);
      expect(result.messages.some((message) => message.eventId)).toBe(false);
      expect(result.conversations.find((conversation) => conversation.sessionId === result.sessionId)).toMatchObject({
        title: 'Fork of Plan the rollout',
        active: true,
        hasMessages: false,
        forkOf: expect.objectContaining({
          sourceSessionId,
          sourceEventId: 'evt-2',
          sourceMessageId: 'a1',
          sourceTitle: 'Plan the rollout',
        }),
      });
      expect(lastSavedConfig().minds[0].conversations).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: sourceSessionId, hasMessages: true }),
        expect.objectContaining({ sessionId: result.sessionId, forkOf: expect.objectContaining({ sourceSessionId }) }),
      ]));

      mockCreateSession.mockClear();
      await manager.setMindModel(mind.mindId, 'byo:gemma-4-e4b');

      expect((mockCreateSession.mock.calls.at(-1)?.[0] as Record<string, unknown>).sessionId).toBe(result.sessionId);
      expect(await manager.getActiveConversationForkSeed(mind.mindId)).toBe(seeds.get(`${mind.mindId}:${result.sessionId}`));
      expect(lastSavedConfig().minds[0].conversations?.find((conversation) => conversation.sessionId === result.sessionId)).toMatchObject({
        forkOf: expect.objectContaining({ sourceSessionId }),
        hasMessages: false,
      });
    });

    it('carries attachment manifests into fork seed context without attachment file contents', async () => {
      const seeds = new Map<string, ConversationForkSeed>();
      const forkSeedStore = {
        save: vi.fn(async (mindId: string, sessionId: string, seed: ConversationForkSeed) => {
          seeds.set(`${mindId}:${sessionId}`, seed);
        }),
        read: vi.fn(async (mindId: string, sessionId: string) => seeds.get(`${mindId}:${sessionId}`) ?? null),
        delete: vi.fn(async () => undefined),
      };
      manager = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        undefined,
        undefined,
        undefined,
        forkSeedStore,
      );
      manager.setProviders([mockProvider as unknown as ChamberToolProvider]);
      const mind = await manager.loadMind('/tmp/agents/q');
      const sourceSession = liveSessionFor(mind.mindId);
      const sourceSessionId = mind.activeSessionId;
      if (!sourceSessionId) throw new Error('Expected active session id');
      sourceSession.getEvents.mockResolvedValue([
        {
          id: 'evt-1',
          type: 'user.message',
          timestamp: 1,
          data: {
            messageId: 'u1',
            content: appendAttachmentManifestContext('Review this document', [{
              id: 'doc-1',
              kind: 'document',
              displayName: 'brief.txt',
              mimeType: 'text/plain',
              size: 512,
              metadata: { source: 'chat-composer' },
            }]),
          },
        },
      ]);
      manager.markActiveConversationHasMessages(mind.mindId, 'Review this document');

      const result = await manager.forkConversation(mind.mindId, sourceSessionId, 'evt-1');
      const seed = seeds.get(`${mind.mindId}:${result.sessionId}`);

      expect(seed?.messages[0].blocks).toEqual([
        expect.objectContaining({ type: 'attachment', id: 'doc-1', displayName: 'brief.txt' }),
        { type: 'text', content: 'Review this document' },
      ]);
      expect(JSON.stringify(seed)).not.toContain('<chamber_attachment_manifest>');
      expect(JSON.stringify(seed)).not.toContain('payload');
    });

    it('truncates SDK history and keeps hasMessages when turns remain', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const session = liveSessionFor(mind.mindId);
      session.getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Hi' } },
      ]);

      const conversations = await manager.truncateActiveConversation(mind.mindId, 'evt-9');

      expect(session.rpc.history.truncate).toHaveBeenCalledWith({ eventId: 'evt-9' });
      expect(conversations.find((conversation) => conversation.active)?.hasMessages).toBe(true);
    });

    it('clears hasMessages when truncation empties the conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      liveSessionFor(mind.mindId).getEvents.mockResolvedValue([]);

      const conversations = await manager.truncateActiveConversation(mind.mindId, 'evt-1');

      expect(conversations.find((conversation) => conversation.active)?.hasMessages).toBe(false);
    });

    it('treats truncation as committed even when the post-truncate readback fails', async () => {
      // The truncate RPC succeeded; a failing read-back (e.g. session went stale
      // right after) must not resurface as a truncate failure, or the caller
      // would retry and truncate again — removing further turns.
      const mind = await manager.loadMind('/tmp/agents/q');
      const session = liveSessionFor(mind.mindId);
      session.getEvents.mockRejectedValueOnce(new Error('Session not found: abc-123'));

      await expect(manager.truncateActiveConversation(mind.mindId, 'evt-9')).resolves.toBeDefined();
      expect(session.rpc.history.truncate).toHaveBeenCalledTimes(1);
      expect(session.rpc.history.truncate).toHaveBeenCalledWith({ eventId: 'evt-9' });
    });
  });

  describe('retained message variants', () => {
    const liveSessionFor = (mindId: string) =>
      manager.getMind(mindId)?.session as unknown as ReturnType<typeof createSessionStub>;

    function makeVariantStore() {
      const groupsByKey = new Map<string, MessageVariantGroup[]>();
      return {
        groupsByKey,
        read: vi.fn(async (mindId: string, sessionId: string): Promise<MessageVariantGroup[]> => {
          const stored = groupsByKey.get(`${mindId}:${sessionId}`);
          return stored ? structuredClone(stored) : [];
        }),
        save: vi.fn(async (mindId: string, sessionId: string, groups: MessageVariantGroup[]) => {
          groupsByKey.set(`${mindId}:${sessionId}`, structuredClone(groups));
        }),
        delete: vi.fn(async (mindId: string, sessionId: string) => {
          groupsByKey.delete(`${mindId}:${sessionId}`);
        }),
      };
    }

    function rebuildWithVariantStore(store: ReturnType<typeof makeVariantStore>) {
      const forkSeedStore = {
        save: vi.fn(async () => undefined),
        read: vi.fn(async () => null),
        delete: vi.fn(async () => undefined),
      };
      manager = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        undefined,
        undefined,
        undefined,
        forkSeedStore,
        store,
      );
      manager.setProviders([mockProvider as unknown as ChamberToolProvider]);
    }

    it('captures the discarded tail of a regenerate anchored at the conversation root', async () => {
      const store = makeVariantStore();
      rebuildWithVariantStore(store);
      const mind = await manager.loadMind('/tmp/agents/q');
      liveSessionFor(mind.mindId).getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Question' } },
        { id: 'evt-2', type: 'assistant.message', timestamp: 2, data: { messageId: 'a1', content: 'Answer one' } },
      ]);

      await manager.captureActiveConversationVariant(mind.mindId, 'evt-1');

      const groups = await manager.getConversationVariants(mind.mindId);
      expect(groups).toHaveLength(1);
      expect(groups[0].anchorEventId).toBeNull();
      expect(groups[0].frozenVariants).toHaveLength(1);
      expect(groups[0].frozenVariants[0].messages.map((message) => message.eventId)).toEqual(['evt-1', 'evt-2']);
    });

    it('anchors an edit variant at the parent turn before the edited user message', async () => {
      const store = makeVariantStore();
      rebuildWithVariantStore(store);
      const mind = await manager.loadMind('/tmp/agents/q');
      liveSessionFor(mind.mindId).getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'First' } },
        { id: 'evt-2', type: 'assistant.message', timestamp: 2, data: { messageId: 'a1', content: 'Reply one' } },
        { id: 'evt-3', type: 'user.message', timestamp: 3, data: { messageId: 'u2', content: 'Second' } },
        { id: 'evt-4', type: 'assistant.message', timestamp: 4, data: { messageId: 'a2', content: 'Reply two' } },
      ]);

      await manager.captureActiveConversationVariant(mind.mindId, 'evt-3');

      const groups = await manager.getConversationVariants(mind.mindId);
      expect(groups).toHaveLength(1);
      expect(groups[0].anchorEventId).toBe('evt-2');
      expect(groups[0].frozenVariants[0].messages.map((message) => message.eventId)).toEqual(['evt-3', 'evt-4']);
    });

    it('does not double-capture the same tail on a stale-session retry', async () => {
      const store = makeVariantStore();
      rebuildWithVariantStore(store);
      const mind = await manager.loadMind('/tmp/agents/q');
      liveSessionFor(mind.mindId).getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Question' } },
        { id: 'evt-2', type: 'assistant.message', timestamp: 2, data: { messageId: 'a1', content: 'Answer one' } },
      ]);

      await manager.captureActiveConversationVariant(mind.mindId, 'evt-1');
      await manager.captureActiveConversationVariant(mind.mindId, 'evt-1');

      const groups = await manager.getConversationVariants(mind.mindId);
      expect(groups[0].frozenVariants).toHaveLength(1);
    });

    it('is a no-op when the target user turn is already gone', async () => {
      const store = makeVariantStore();
      rebuildWithVariantStore(store);
      const mind = await manager.loadMind('/tmp/agents/q');
      liveSessionFor(mind.mindId).getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Question' } },
      ]);

      await manager.captureActiveConversationVariant(mind.mindId, 'evt-99');

      expect(store.save).not.toHaveBeenCalled();
      expect(await manager.getConversationVariants(mind.mindId)).toEqual([]);
    });

    it('returns persisted variant groups for the active conversation', async () => {
      const store = makeVariantStore();
      rebuildWithVariantStore(store);
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = mind.activeSessionId;
      if (!sessionId) throw new Error('Expected active session id');
      const seeded: MessageVariantGroup[] = [{
        groupId: 'g1',
        anchorEventId: null,
        frozenVariants: [{
          variantId: 'v1',
          createdAt: '2026-05-05T00:00:00.000Z',
          messages: [{ id: 'u1', role: 'user', blocks: [{ type: 'text', content: 'Prior' }], timestamp: 1, eventId: 'evt-1' }],
        }],
      }];
      store.groupsByKey.set(`${mind.mindId}:${sessionId}`, seeded);

      expect(await manager.getConversationVariants(mind.mindId)).toEqual(seeded);
    });

    it('promotes a variant by freezing the active tail, truncating to the anchor, and staging a seed', async () => {
      const store = makeVariantStore();
      rebuildWithVariantStore(store);
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = mind.activeSessionId;
      if (!sessionId) throw new Error('Expected active session id');
      const session = liveSessionFor(mind.mindId);
      session.getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Root' } },
        { id: 'evt-2', type: 'assistant.message', timestamp: 2, data: { messageId: 'a1', content: 'Root reply' } },
        { id: 'evt-3', type: 'user.message', timestamp: 3, data: { messageId: 'u2', content: 'Active question' } },
        { id: 'evt-4', type: 'assistant.message', timestamp: 4, data: { messageId: 'a2', content: 'Active answer' } },
      ]);
      const target: MessageVariant = {
        variantId: 'v-prior',
        createdAt: '2026-05-05T00:00:00.000Z',
        messages: [
          { id: 'u2a', role: 'user', blocks: [{ type: 'text', content: 'prior question' }], timestamp: 3, eventId: 'evt-3a' },
          { id: 'a2a', role: 'assistant', blocks: [{ type: 'text', content: 'prior answer' }], timestamp: 4, eventId: 'evt-4a' },
        ],
      };
      store.groupsByKey.set(`${mind.mindId}:${sessionId}`, [{ groupId: 'g1', anchorEventId: 'evt-2', frozenVariants: [target] }]);

      const result = await manager.switchActiveConversationVariant(mind.mindId, 'evt-2', 'v-prior');

      expect(session.rpc.history.truncate).toHaveBeenCalledWith({ eventId: 'evt-3' });
      const groupsAfter = await manager.getConversationVariants(mind.mindId);
      expect(groupsAfter[0].frozenVariants).toHaveLength(2);
      expect(groupsAfter[0].frozenVariants[1].messages.map((message) => message.eventId)).toEqual(['evt-3', 'evt-4']);
      const seed = manager.consumePendingVariantSeed(mind.mindId);
      expect(seed).not.toBeNull();
      expect(JSON.stringify(seed)).toContain('prior question');
      expect(result.sessionId).toBe(sessionId);
    });

    it('clears the staged variant seed after it is consumed once', async () => {
      const store = makeVariantStore();
      rebuildWithVariantStore(store);
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = mind.activeSessionId;
      if (!sessionId) throw new Error('Expected active session id');
      liveSessionFor(mind.mindId).getEvents.mockResolvedValue([
        { id: 'evt-1', type: 'user.message', timestamp: 1, data: { messageId: 'u1', content: 'Root' } },
        { id: 'evt-2', type: 'assistant.message', timestamp: 2, data: { messageId: 'a1', content: 'Root reply' } },
        { id: 'evt-3', type: 'user.message', timestamp: 3, data: { messageId: 'u2', content: 'Active question' } },
      ]);
      const target: MessageVariant = {
        variantId: 'v-prior',
        createdAt: '2026-05-05T00:00:00.000Z',
        messages: [{ id: 'u2a', role: 'user', blocks: [{ type: 'text', content: 'prior' }], timestamp: 3, eventId: 'evt-3a' }],
      };
      store.groupsByKey.set(`${mind.mindId}:${sessionId}`, [{ groupId: 'g1', anchorEventId: 'evt-2', frozenVariants: [target] }]);

      await manager.switchActiveConversationVariant(mind.mindId, 'evt-2', 'v-prior');

      expect(manager.consumePendingVariantSeed(mind.mindId)).not.toBeNull();
      expect(manager.consumePendingVariantSeed(mind.mindId)).toBeNull();
    });
  });

  describe('unloadMind', () => {
    it('releases providers, destroys client, and removes from map', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      await manager.unloadMind(mind.mindId);
      expect(mockProvider.releaseMind).toHaveBeenCalledWith(mind.mindId);
      expect(mockClientFactory.destroyClient).toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)).toBeUndefined();
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('emits mind:unloaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:unloaded', listener);
      const mind = await manager.loadMind('/tmp/agents/q');
      await manager.unloadMind(mind.mindId);
      expect(listener).toHaveBeenCalledWith(mind.mindId);
    });

    it('is a no-op for non-existent mindId', async () => {
      await expect(manager.unloadMind('nonexistent')).resolves.not.toThrow();
    });

    it('falls back activeMindId when active mind is unloaded', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/a');
      const mind2 = await manager.loadMind('/tmp/agents/b');
      manager.setActiveMind(mind1.mindId);
      await manager.unloadMind(mind1.mindId);
      // Should fall back to remaining mind or null
      const config = mockConfigService.save.mock.calls.at(-1)?.[0];
      expect(config?.activeMindId).toBe(mind2.mindId);
    });

    it('explicit unload still prunes the unloaded mind from persisted config', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/fox');

      await manager.unloadMind(mind1.mindId);

      expect(savedMindIds(lastSavedConfig())).toEqual([mind2.mindId]);
    });

    it('preserves marketplaceRegistries and installedTools across persist', async () => {
      currentConfig = {
        ...currentConfig,
        marketplaceRegistries: [{
          id: 'github:ianphil/genesis-minds',
          label: 'Public Genesis Minds',
          url: 'https://github.com/ianphil/genesis-minds',
          owner: 'ianphil',
          repo: 'genesis-minds',
          ref: 'master',
          plugin: 'genesis-minds',
          enabled: true,
          isDefault: true,
        }],
        installedTools: [{
          id: 'workiq',
          package: '@microsoft/workiq',
          version: 'latest',
          bin: 'workiq',
          displayName: 'Microsoft Work IQ',
          description: 'Query M365 data.',
          source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
          installedAt: '2026-05-08T00:00:00.000Z',
        }],
      };
      await manager.loadMind('/tmp/agents/q');
      const saved = lastSavedConfig();
      expect(saved.marketplaceRegistries).toHaveLength(1);
      expect(saved.installedTools).toHaveLength(1);
      expect(saved.installedTools?.[0].id).toBe('workiq');
    });
  });

  describe('listMinds', () => {
    it('returns MindContext array (no internal details)', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      const minds = manager.listMinds();
      expect(minds).toHaveLength(2);
      // Verify no internal properties leaked
      for (const m of minds) {
        expect(m).toHaveProperty('mindId');
        expect(m).toHaveProperty('mindPath');
        expect(m).toHaveProperty('identity');
        expect(m).toHaveProperty('status');
        expect(m).not.toHaveProperty('client');
        expect(m).not.toHaveProperty('session');
        expect(m).not.toHaveProperty('extensions');
      }
    });
  });

  describe('getMind', () => {
    it('returns internal context for valid ID', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const internal = manager.getMind(mind.mindId);
      if (!internal) throw new Error('expected internal mind context');
      expect(internal.client).toBeDefined();
      expect(internal.session).toBeDefined();
    });

    it('returns undefined for invalid ID', () => {
      expect(manager.getMind('nonexistent')).toBeUndefined();
    });
  });

  describe('recreateSession', () => {
    it('replaces an empty active draft when recreating the session', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = mind.activeSessionId;

      await manager.recreateSession(mind.mindId);

      const newCtx = manager.getMind(mind.mindId);
      if (!newCtx) throw new Error('expected mind context after recreate');
      const newSession = newCtx.session;
      expect(newSession).toBeDefined();
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(1);
      expect(history[0].active).toBe(true);
      expect(history[0].sessionId).not.toBe(originalSessionId);
    });

    it('keeps real conversation history when recreating after messages exist', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');

      await manager.recreateSession(mind.mindId);

      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(2);
      expect(history[0].active).toBe(true);
      expect(history[0].title).toMatch(/^New chat · /);
      expect(history[1].title).toBe('Hello Q');
    });

    it('recovers a real active conversation by resuming the same session id', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();

      await manager.recoverActiveConversationSession(mind.mindId);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockResumeSession).toHaveBeenCalledWith(
        mind.activeSessionId,
        expect.objectContaining({ workingDirectory: '/tmp/agents/q' }),
      );
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(mind.activeSessionId);
      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(1);
      expect(history[0].title).toBe('Hello Q');
      expect(history[0].active).toBe(true);
    });

    it('recovery resume re-attaches under the same Chamber session id when the SDK forgot the runtime', async () => {
      const reattachedSession = createSessionStub();
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');
      mockCreateSession.mockClear();
      mockResumeSession.mockRejectedValueOnce(new Error('failed to resume session: Session not found: stale-session'));
      mockResumeSession.mockRejectedValueOnce(new Error('failed to resume session: Session not found: stale-legacy-session'));
      mockCreateSession.mockResolvedValueOnce(reattachedSession);

      const recovered = await manager.recoverActiveConversationSession(mind.mindId);

      expect(recovered).toBe(reattachedSession);
      expect(mockResumeSession).toHaveBeenCalledWith(
        mind.activeSessionId,
        expect.objectContaining({ workingDirectory: '/tmp/agents/q' }),
      );
      expect(mockResumeSession).toHaveBeenCalledWith(
        mind.activeSessionId,
        expect.not.objectContaining({ configDirectory: expect.any(String) }),
      );
      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: mind.activeSessionId,
      }));
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(mind.activeSessionId);
      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        sessionId: mind.activeSessionId,
        title: 'Hello Q',
        active: true,
      });
    });

    it('recovery surfaces stale errors when reattach also fails', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');
      mockCreateSession.mockClear();
      mockResumeSession.mockRejectedValueOnce(new Error('Session not found: stale-1'));
      mockResumeSession.mockRejectedValueOnce(new Error('Session not found: stale-legacy'));
      mockCreateSession.mockRejectedValueOnce(new Error('Session not found: stale-2'));

      await expect(manager.recoverActiveConversationSession(mind.mindId)).rejects.toThrow(/Session not found/);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(mind.activeSessionId);
    });

    it('recovers an empty active draft by replacing it with a new session id', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = mind.activeSessionId;

      await manager.recoverActiveConversationSession(mind.mindId);

      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(1);
      expect(history[0].sessionId).not.toBe(originalSessionId);
      expect(history[0].title).toMatch(/^New chat · /);
      expect(history[0].active).toBe(true);
    });

    it('startNewConversation reuses the active empty conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const activeSessionId = mind.activeSessionId;

      await manager.startNewConversation(mind.mindId);

      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(activeSessionId);
      expect(manager.listConversationHistory(mind.mindId)).toHaveLength(1);
    });

    it('startNewConversation creates one new active conversation after the current conversation has messages', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');

      await manager.startNewConversation(mind.mindId);

      expect(mockCreateSession).toHaveBeenCalledTimes(2);
      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(2);
      expect(history[0].active).toBe(true);
      expect(history[0].title).toMatch(/^New chat · /);
      expect(history[1].title).toBe('Hello Q');
    });

    it('throws for non-existent mind', async () => {
      await expect(manager.recreateSession('nonexistent')).rejects.toThrow();
    });
  });

  describe('conversation history', () => {
    it('resumes a selected conversation and hydrates messages from the SDK session', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: { messageId: 'u1', content: 'hello Monica' },
        },
        {
          type: 'assistant.message',
          timestamp: '2026-05-05T22:00:01.000Z',
          data: { messageId: 'a1', content: 'hello human' },
        },
      ]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
      await manager.recreateSession(mind.mindId);
      const historyBeforeResume = manager.listConversationHistory(mind.mindId);
      const target = historyBeforeResume[1];

      const result = await manager.resumeConversation(mind.mindId, target.sessionId);

      expect(mockResumeSession).toHaveBeenCalledWith(
        target.sessionId,
        expect.objectContaining({ workingDirectory: '/tmp/agents/q' }),
      );
      expect(result.sessionId).toBe(target.sessionId);
      expect(result.messages).toEqual([
        {
          id: 'u1',
          role: 'user',
          blocks: [{ type: 'text', content: 'hello Monica' }],
          timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
        },
        {
          id: 'a1',
          role: 'assistant',
          blocks: [{ type: 'text', sdkMessageId: 'a1', content: 'hello human' }],
          timestamp: Date.parse('2026-05-05T22:00:01.000Z'),
        },
      ]);
      expect(result.conversations.find((conversation) => conversation.sessionId === target.sessionId)?.active).toBe(true);
      expect(result.conversations.map((conversation) => conversation.sessionId)).toEqual(
        historyBeforeResume.map((conversation) => conversation.sessionId),
      );
    });

    it('falls back to the legacy default session-state root when Chamber runtime state is missing', async () => {
      const legacySession = createSessionStub();
      legacySession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: { messageId: 'u1', content: 'legacy chat' },
        },
      ]);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
      await manager.startNewConversation(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];
      mockResumeSession.mockClear();
      mockResumeSession
        .mockRejectedValueOnce(new Error('failed to resume session: Session not found: missing-runtime'))
        .mockResolvedValueOnce(legacySession);

      const result = await manager.resumeConversation(mind.mindId, target.sessionId);

      expect(mockResumeSession).toHaveBeenCalledTimes(2);
      expect(mockResumeSession).toHaveBeenNthCalledWith(
        1,
        target.sessionId,
        expect.objectContaining({
          configDirectory: COPILOT_RUNTIME_CONFIG_DIR,
          enableConfigDiscovery: false,
        }),
      );
      expect(mockResumeSession).toHaveBeenNthCalledWith(
        2,
        target.sessionId,
        expect.not.objectContaining({ configDirectory: expect.any(String) }),
      );
      const legacyResumeConfig = mockResumeSession.mock.calls[1][1] as Record<string, unknown>;
      expect(legacyResumeConfig.enableConfigDiscovery).toBe(false);
      expect(result.sessionId).toBe(target.sessionId);
      expect(result.messages).toEqual([
        {
          id: 'u1',
          role: 'user',
          blocks: [{ type: 'text', content: 'legacy chat' }],
          timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
        },
      ]);
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });

    it('wires approveForSessionCompat on resumed sessions and does not short-circuit via setApproveAll (issue #131)', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Prior chat');
      await manager.recreateSession(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];

      await manager.resumeConversation(mind.mindId, target.sessionId);

      const resumeConfig = mockResumeSession.mock.calls[0][1] as { onPermissionRequest?: unknown };
      expect(resumeConfig.onPermissionRequest).toBe(approveForSessionCompat);
      expect(resumedSession.rpc.permissions.setApproveAll).not.toHaveBeenCalled();
    });

    it('hydrates the already-active conversation without resuming the SDK session again', async () => {
      const activeSession = createSessionStub();
      activeSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: { messageId: 'u1', content: 'already active' },
        },
      ]);
      mockCreateSession.mockResolvedValueOnce(activeSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      expect(mind.activeSessionId).toBeDefined();
      const activeSessionId = mind.activeSessionId!;
      manager.markActiveConversationHasMessages(mind.mindId, 'Already active');
      mockResumeSession.mockClear();

      const result = await manager.resumeConversation(mind.mindId, activeSessionId);

      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(activeSession.disconnect).not.toHaveBeenCalled();
      expect(result.sessionId).toBe(activeSessionId);
      expect(result.messages).toEqual([
        {
          id: 'u1',
          role: 'user',
          blocks: [{ type: 'text', content: 'already active' }],
          timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
        },
      ]);
      expect(result.conversations.find((conversation) => conversation.sessionId === activeSessionId)?.active).toBe(true);
    });

    it('deletes an inactive conversation without changing the active conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'First chat');
      await manager.startNewConversation(mind.mindId);
      const activeSessionId = manager.getMind(mind.mindId)?.activeSessionId;
      const inactive = manager.listConversationHistory(mind.mindId).find((conversation) => !conversation.active);
      expect(inactive).toBeDefined();

      const result = await manager.deleteConversation(mind.mindId, inactive!.sessionId);

      expect(result.sessionId).toBe(activeSessionId);
      expect(mockDeleteSession).toHaveBeenCalledWith(inactive!.sessionId);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(activeSessionId);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0]).toMatchObject({
        sessionId: activeSessionId,
        active: true,
      });
    });

    it('deletes the active conversation and hydrates the next most recent conversation', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: { messageId: 'u1', content: 'first chat' },
        },
      ]);
      const mind = await manager.loadMind('/tmp/agents/q');
      const firstSessionId = mind.activeSessionId;
      manager.markActiveConversationHasMessages(mind.mindId, 'First chat');
      await manager.startNewConversation(mind.mindId);
      const activeDraftId = manager.getMind(mind.mindId)?.activeSessionId;
      mockResumeSession.mockResolvedValueOnce(resumedSession);

      const result = await manager.deleteConversation(mind.mindId, activeDraftId!);

      expect(mockResumeSession).toHaveBeenCalledWith(firstSessionId, expect.objectContaining({ workingDirectory: '/tmp/agents/q' }));
      expect(mockDeleteSession).toHaveBeenCalledWith(activeDraftId);
      expect(result.sessionId).toBe(firstSessionId);
      expect(result.messages).toEqual([
        {
          id: 'u1',
          role: 'user',
          blocks: [{ type: 'text', content: 'first chat' }],
          timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
        },
      ]);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0]).toMatchObject({
        sessionId: firstSessionId,
        title: 'First chat',
        active: true,
      });
    });

    it('deletes the last conversation and creates exactly one empty draft', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = mind.activeSessionId;

      const result = await manager.deleteConversation(mind.mindId, originalSessionId!);

      expect(result.messages).toEqual([]);
      expect(mockDeleteSession).toHaveBeenCalledWith(originalSessionId);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].sessionId).not.toBe(originalSessionId);
      expect(result.conversations[0]).toMatchObject({
        active: true,
        hasMessages: false,
      });
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(result.conversations[0].sessionId);
    });

    it('strips Chamber-injected datetime context from hydrated user messages', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: {
            messageId: 'u1',
            content: '<current_datetime>\n2026-05-07T03:19:51.220Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nyou should add another comment to the gh issue 125',
          },
        },
      ]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
      await manager.startNewConversation(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];

      const result = await manager.resumeConversation(mind.mindId, target.sessionId);

      expect(result.messages[0]).toMatchObject({
        role: 'user',
        blocks: [{ type: 'text', content: 'you should add another comment to the gh issue 125' }],
      });
    });

    it('getConversationMessages reads the active conversation from its live session without resuming', async () => {
      const activeSession = createSessionStub();
      activeSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: { messageId: 'u1', content: 'active content' },
        },
      ]);
      mockCreateSession.mockResolvedValueOnce(activeSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      const activeSessionId = mind.activeSessionId!;
      manager.markActiveConversationHasMessages(mind.mindId, 'Active chat');
      mockResumeSession.mockClear();

      const messages = await manager.getConversationMessages(mind.mindId, activeSessionId);

      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(activeSession.disconnect).not.toHaveBeenCalled();
      expect(messages).toEqual([
        {
          id: 'u1',
          role: 'user',
          blocks: [{ type: 'text', content: 'active content' }],
          timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
        },
      ]);
    });

    it('getConversationMessages resumes an inactive conversation read-only and leaves the active session untouched', async () => {
      const readOnlySession = createSessionStub();
      readOnlySession.getEvents.mockResolvedValue([
        {
          type: 'assistant.message',
          timestamp: '2026-05-05T22:00:01.000Z',
          data: { messageId: 'a1', content: 'archived answer' },
        },
      ]);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
      await manager.startNewConversation(mind.mindId);
      const activeSessionBefore = manager.getMind(mind.mindId)?.session;
      const activeSessionIdBefore = manager.getMind(mind.mindId)?.activeSessionId;
      const inactive = manager.listConversationHistory(mind.mindId).find((conversation) => !conversation.active);
      expect(inactive).toBeDefined();
      mockResumeSession.mockClear();
      mockResumeSession.mockResolvedValueOnce(readOnlySession);

      const messages = await manager.getConversationMessages(mind.mindId, inactive!.sessionId);

      expect(mockResumeSession).toHaveBeenCalledWith(
        inactive!.sessionId,
        expect.objectContaining({ workingDirectory: '/tmp/agents/q' }),
      );
      expect(readOnlySession.disconnect).toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.session).toBe(activeSessionBefore);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(activeSessionIdBefore);
      expect(messages).toEqual([
        {
          id: 'a1',
          role: 'assistant',
          blocks: [{ type: 'text', sdkMessageId: 'a1', content: 'archived answer' }],
          timestamp: Date.parse('2026-05-05T22:00:01.000Z'),
        },
      ]);
    });

    it('getConversationMessages throws for an unknown conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      await expect(manager.getConversationMessages(mind.mindId, 'missing-session')).rejects.toThrow(
        'Conversation missing-session not found',
      );
    });

    it('serializes a background read against a concurrent resume so the opened conversation is never torn down', async () => {
      const readOnlySession = createSessionStub();
      let releaseGetEvents: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { releaseGetEvents = resolve; });
      readOnlySession.getEvents.mockImplementation(async () => {
        await gate;
        return [
          { type: 'assistant.message', timestamp: '2026-05-05T22:00:01.000Z', data: { messageId: 'a1', content: 'archived answer' } },
        ];
      });
      const activeSession = createSessionStub();
      activeSession.getEvents.mockResolvedValue([]);

      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
      await manager.startNewConversation(mind.mindId);
      const inactive = manager.listConversationHistory(mind.mindId).find((conversation) => !conversation.active);
      expect(inactive).toBeDefined();

      mockResumeSession.mockClear();
      mockResumeSession
        .mockResolvedValueOnce(readOnlySession)  // background read-only load (holds the lock)
        .mockResolvedValueOnce(activeSession);   // resume, once the read releases the lock

      // The read acquires the per-mind lock and parks on getEvents.
      const readPromise = manager.getConversationMessages(mind.mindId, inactive!.sessionId);
      await vi.waitFor(() => { expect(mockResumeSession).toHaveBeenCalledTimes(1); });

      // The resume must queue behind the read rather than promote mid-read.
      const resumePromise = manager.resumeConversation(mind.mindId, inactive!.sessionId);
      await Promise.resolve();
      expect(mockResumeSession).toHaveBeenCalledTimes(1);
      expect(manager.getMind(mind.mindId)?.activeSessionId).not.toBe(inactive!.sessionId);

      releaseGetEvents?.();
      const messages = await readPromise;
      await resumePromise;

      // The read read its transcript and disconnected only its own throwaway,
      // which happened before the resume created the live session.
      expect(messages).toEqual([
        { id: 'a1', role: 'assistant', blocks: [{ type: 'text', sdkMessageId: 'a1', content: 'archived answer' }], timestamp: Date.parse('2026-05-05T22:00:01.000Z') },
      ]);
      // The live session the user opened is intact and active.
      expect(activeSession.disconnect).not.toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.session).toBe(activeSession);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(inactive!.sessionId);
    });

    it('deduplicates concurrent read-only transcript loads for the same conversation', async () => {
      const readOnlySession = createSessionStub();
      readOnlySession.getEvents.mockResolvedValue([
        { type: 'assistant.message', timestamp: '2026-05-05T22:00:01.000Z', data: { messageId: 'a1', content: 'archived' } },
      ]);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
      await manager.startNewConversation(mind.mindId);
      const inactive = manager.listConversationHistory(mind.mindId).find((conversation) => !conversation.active);
      mockResumeSession.mockClear();
      mockResumeSession.mockResolvedValue(readOnlySession);

      const [first, second] = await Promise.all([
        manager.getConversationMessages(mind.mindId, inactive!.sessionId),
        manager.getConversationMessages(mind.mindId, inactive!.sessionId),
      ]);

      expect(mockResumeSession).toHaveBeenCalledTimes(1);
      expect(readOnlySession.disconnect).toHaveBeenCalledTimes(1);
      expect(first).toEqual(second);
    });

    it('renames only Chamber-owned conversation metadata', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = manager.listConversationHistory(mind.mindId)[0].sessionId;

      const history = manager.renameConversation(mind.mindId, sessionId, 'Better title');

      expect(history[0]).toMatchObject({ sessionId, title: 'Better title' });
      expect(lastSavedConfig().minds[0].conversations?.[0]).toMatchObject({
        sessionId,
        title: 'Better title',
      });
    });

    it('pins a conversation without disturbing its recency timestamp', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const before = manager.listConversationHistory(mind.mindId)[0];

      const history = manager.setPinnedConversation(mind.mindId, before.sessionId, true);

      expect(history[0]).toMatchObject({ sessionId: before.sessionId, isPinned: true });
      expect(history[0].updatedAt).toBe(before.updatedAt);
      expect(lastSavedConfig().minds[0].conversations?.[0]).toMatchObject({
        sessionId: before.sessionId,
        isPinned: true,
      });
      expect(lastSavedConfig().minds[0].conversations?.[0]?.updatedAt).toBe(before.updatedAt);
    });

    it('clears the pinned flag instead of persisting it as false', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = manager.listConversationHistory(mind.mindId)[0].sessionId;

      manager.setPinnedConversation(mind.mindId, sessionId, true);
      const history = manager.setPinnedConversation(mind.mindId, sessionId, false);

      expect(history[0].isPinned).toBeUndefined();
      expect(lastSavedConfig().minds[0].conversations?.[0]).not.toHaveProperty('isPinned');
    });

    it('archives only the targeted conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'First chat');
      await manager.startNewConversation(mind.mindId);
      const conversations = manager.listConversationHistory(mind.mindId);
      const target = conversations[0];
      const sibling = conversations[1];

      const history = manager.setArchivedConversation(mind.mindId, target.sessionId, true);

      expect(history.find((conversation) => conversation.sessionId === target.sessionId)).toMatchObject({
        isArchived: true,
      });
      expect(history.find((conversation) => conversation.sessionId === sibling.sessionId)?.isArchived).toBeUndefined();
    });

    it('throws when organizing a conversation that does not exist', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');

      expect(() => manager.setPinnedConversation(mind.mindId, 'missing-session', true)).toThrow(
        `Conversation missing-session not found for mind ${mind.mindId}`,
      );
      expect(() => manager.setArchivedConversation(mind.mindId, 'missing-session', true)).toThrow(
        `Conversation missing-session not found for mind ${mind.mindId}`,
      );
    });

    it('persists a per-conversation system prompt without disturbing recency', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const before = manager.listConversationHistory(mind.mindId)[0];

      const history = await manager.setConversationSystemMessage(mind.mindId, before.sessionId, 'Be terse.');

      expect(history[0]).toMatchObject({ sessionId: before.sessionId, systemMessage: 'Be terse.' });
      expect(history[0].updatedAt).toBe(before.updatedAt);
      expect(lastSavedConfig().minds[0].conversations?.[0]).toMatchObject({
        sessionId: before.sessionId,
        systemMessage: 'Be terse.',
      });
      expect(lastSavedConfig().minds[0].conversations?.[0]?.updatedAt).toBe(before.updatedAt);
    });

    it('clears the override instead of persisting an empty string', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = manager.listConversationHistory(mind.mindId)[0].sessionId;

      await manager.setConversationSystemMessage(mind.mindId, sessionId, 'Be terse.');
      const history = await manager.setConversationSystemMessage(mind.mindId, sessionId, '   ');

      expect(history[0].systemMessage).toBeUndefined();
      expect(lastSavedConfig().minds[0].conversations?.[0]).not.toHaveProperty('systemMessage');
    });

    it('rebinds the active conversation session with the override applied immediately', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = manager.listConversationHistory(mind.mindId)[0].sessionId;
      mockResumeSession.mockClear();
      mockCreateSession.mockClear();

      await manager.setConversationSystemMessage(mind.mindId, sessionId, 'Only speak in haiku.');

      const rebindConfig = mockResumeSession.mock.calls.at(-1)?.[1]
        ?? mockCreateSession.mock.calls.at(-1)?.[0];
      expect(rebindConfig).toMatchObject({
        systemMessage: expect.objectContaining({
          sections: expect.objectContaining({
            identity: { action: 'replace', content: 'Only speak in haiku.' },
          }),
        }),
      });
    });

    it('rebinds the active session back to the mind default when the override is cleared', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = manager.listConversationHistory(mind.mindId)[0].sessionId;
      await manager.setConversationSystemMessage(mind.mindId, sessionId, 'Only speak in haiku.');
      mockResumeSession.mockClear();
      mockCreateSession.mockClear();

      await manager.setConversationSystemMessage(mind.mindId, sessionId, '');

      const rebindConfig = mockResumeSession.mock.calls.at(-1)?.[1]
        ?? mockCreateSession.mock.calls.at(-1)?.[0];
      expect(rebindConfig).toMatchObject({
        systemMessage: expect.objectContaining({
          sections: expect.objectContaining({
            identity: { action: 'replace', content: 'Identity for /tmp/agents/q' },
          }),
        }),
      });
    });

    it('does not rebind a session for a non-active conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'First chat');
      await manager.startNewConversation(mind.mindId);
      const inactive = manager.listConversationHistory(mind.mindId).find((conversation) => !conversation.active);
      expect(inactive).toBeTruthy();
      mockResumeSession.mockClear();
      mockCreateSession.mockClear();

      const history = await manager.setConversationSystemMessage(mind.mindId, inactive!.sessionId, 'Inactive override.');

      expect(history.find((conversation) => conversation.sessionId === inactive!.sessionId)?.systemMessage)
        .toBe('Inactive override.');
      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('resumes a non-active conversation with the mind default after its override is cleared', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'First chat');
      await manager.startNewConversation(mind.mindId);
      const inactive = manager.listConversationHistory(mind.mindId).find((conversation) => !conversation.active);
      expect(inactive).toBeTruthy();
      await manager.setConversationSystemMessage(mind.mindId, inactive!.sessionId, 'Only speak in haiku.');
      await manager.setConversationSystemMessage(mind.mindId, inactive!.sessionId, '');
      mockResumeSession.mockClear();

      await manager.resumeConversation(mind.mindId, inactive!.sessionId);

      expect(mockResumeSession.mock.calls.at(-1)?.[1]).toMatchObject({
        systemMessage: expect.objectContaining({
          sections: expect.objectContaining({
            identity: { action: 'replace', content: 'Identity for /tmp/agents/q' },
          }),
        }),
      });
    });

    it('rejects when setting a system prompt on a conversation that does not exist', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');

      await expect(manager.setConversationSystemMessage(mind.mindId, 'missing-session', 'x')).rejects.toThrow(
        `Conversation missing-session not found for mind ${mind.mindId}`,
      );
    });

    it('does not persist the override when rebinding the active session fails', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = manager.listConversationHistory(mind.mindId)[0].sessionId;
      mockResumeSession.mockRejectedValueOnce(new Error('session load failed'));

      await expect(manager.setConversationSystemMessage(mind.mindId, sessionId, 'Should not persist.'))
        .rejects.toThrow('session load failed');

      expect(manager.listConversationHistory(mind.mindId)[0].systemMessage).not.toBe('Should not persist.');
      const persisted = lastSavedConfig().minds[0].conversations?.find((conversation) => conversation.sessionId === sessionId);
      expect(persisted?.systemMessage).not.toBe('Should not persist.');
    });
  });

  describe('restoreFromConfig', () => {
    it('loads all minds from config on startup', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'q-a1b2', path: '/tmp/agents/q' },
          { id: 'fox-c3d4', path: '/tmp/agents/fox' },
        ],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(2);
    });

    it('skips invalid paths without blocking others', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });

      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'good-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(1);
      expect(manager.listMinds()[0].identity.name).toBe('good');
      consoleSpy.mockRestore();
    });

    it('preserves failed restore records when shutdown persists config', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'good-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();
      await manager.shutdown();

      expect(savedMindIds(lastSavedConfig())).toEqual(['bad-c3d4', 'good-a1b2']);
      consoleSpy.mockRestore();
    });

    it('preserves activeMindId when the active mind fails to restore', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
          { id: 'good-a1b2', path: '/tmp/agents/good' },
        ],
        activeMindId: 'bad-c3d4',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      expect(manager.getActiveMindId()).toBe('good-a1b2');
      mockConfigService.save.mockClear();
      await manager.shutdown();

      expect(lastSavedConfig().activeMindId).toBe('bad-c3d4');
      consoleSpy.mockRestore();
    });

    it('preserves every configured mind when all restores fail', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'q-a1b2', path: '/tmp/agents/q' },
          { id: 'fox-c3d4', path: '/tmp/agents/fox' },
        ],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();
      await manager.shutdown();

      const config = lastSavedConfig();
      expect(savedMindIds(config)).toEqual(['fox-c3d4', 'q-a1b2']);
      expect(config.activeMindId).toBe('q-a1b2');
      consoleSpy.mockRestore();
    });

    it('handles empty config gracefully', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2, minds: [], activeMindId: null, activeLogin: null, theme: 'dark',
      });

      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(0);
    });
  });

  describe('shutdown', () => {
    it('unloads all minds', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      await manager.shutdown();
      expect(manager.listMinds()).toHaveLength(0);
      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(2);
    });

    it('is idempotent', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.shutdown();
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('event isolation', () => {
    it('creates separate sessions for different minds', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('awaitRestore', () => {
    it('resolves after restoreFromConfig completes', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      // Start restore (don't await it yet)
      const restorePromise = manager.restoreFromConfig();
      // awaitRestore should resolve once restore finishes
      await manager.awaitRestore();
      await restorePromise;
      expect(manager.listMinds()).toHaveLength(1);
    });

    it('resolves immediately when called before restoreFromConfig', async () => {
      // No restoreFromConfig called — should resolve without error
      await expect(manager.awaitRestore()).resolves.toBeUndefined();
    });

    it('can be called multiple times', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      await manager.awaitRestore();
      await manager.awaitRestore();
      expect(manager.listMinds()).toHaveLength(1);
    });
  });

  describe('restoreFromConfig ID preservation', () => {
    it('uses persisted IDs instead of generating new ones', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'my-stable-id', path: '/tmp/agents/q' }],
        activeMindId: 'my-stable-id',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      const minds = manager.listMinds();
      expect(minds).toHaveLength(1);
      expect(minds[0].mindId).toBe('my-stable-id');
    });
  });

  describe('createTaskSession', () => {
    it('returns a session object', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const session = await manager.createTaskSession(mind.mindId, 'task-1');
      expect(session).toBeDefined();
      expect(session).toHaveProperty('send');
    });

    it('uses same client as primary session (createSession called on same client)', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      await manager.createTaskSession(mind.mindId, 'task-1');
      // createSession is on the same mock client — called once more for the task session
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('throws for unknown mindId', async () => {
      await expect(manager.createTaskSession('nonexistent', 'task-1')).rejects.toThrow(
        'Mind nonexistent not found',
      );
    });

    it('calls createSession with correct identity (systemMessage matches)', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      await manager.createTaskSession(mind.mindId, 'task-1');
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: expect.objectContaining({
            mode: 'customize',
            sections: expect.objectContaining({
              identity: { action: 'replace', content: 'Identity for /tmp/agents/q' },
              tone: { action: 'remove' },
            }),
          }),
        }),
      );
    });

    it('includes provider tools in task sessions', async () => {
      const providerTool = {
        name: 'provider_tool',
        description: 'Provided tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('does not enable ask_user for task sessions without a user input handler', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1');

      const callArg = mockCreateSession.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect(callArg).not.toHaveProperty('onUserInputRequest');
    });

    it('accepts custom onUserInputRequest callback', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      // New SDK UserInputHandler signature: (request: UserInputRequest, invocation) => UserInputResponse
      const customCallback = vi.fn(async () => ({
        answer: 'custom',
        wasFreeform: false,
      }));
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1', customCallback);

      const callArg = mockCreateSession.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect((callArg as { onUserInputRequest: unknown }).onUserInputRequest).toBe(customCallback);
    });
  });

  describe('refreshLoadedMindIdentities', () => {
    const defaultIdentityImpl = (mindPath: string) => ({
      name: mindPath.split('/').pop() ?? 'unknown',
      systemMessage: `Identity for ${mindPath}`,
    });
    const withCustomInstructions = (mindPath: string) => ({
      name: mindPath.split('/').pop() ?? 'unknown',
      systemMessage: `Identity for ${mindPath}\n\n## Custom Instructions\nBe concise.`,
    });
    afterEach(() => {
      mockIdentityLoader.load.mockImplementation(defaultIdentityImpl);
    });

    const expectFreshTaskSystemMessage = () => {
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: expect.objectContaining({
            sections: expect.objectContaining({
              identity: { action: 'replace', content: expect.stringContaining('Be concise.') },
            }),
          }),
        }),
      );
    };

    it('refreshes the cached identity so the next task session uses fresh instructions', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockIdentityLoader.load.mockImplementation(withCustomInstructions);

      const result = await manager.refreshLoadedMindIdentities();
      expect(result.refreshedCount).toBe(1);

      mockCreateSession.mockClear();
      await manager.createTaskSession(mind.mindId, 'task-1');
      expectFreshTaskSystemMessage();
    });

    it('refreshes the cached identity so the next chatroom session uses fresh instructions', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockIdentityLoader.load.mockImplementation(withCustomInstructions);

      await manager.refreshLoadedMindIdentities();

      mockCreateSession.mockClear();
      await manager.createChatroomSession(mind.mindId);
      expectFreshTaskSystemMessage();
    });

    it('recreates an empty active chat session so it adopts fresh instructions', async () => {
      await manager.loadMind('/tmp/agents/q');
      mockIdentityLoader.load.mockImplementation(withCustomInstructions);
      mockCreateSession.mockClear();

      await manager.refreshLoadedMindIdentities();

      expectFreshTaskSystemMessage();
    });

    it('does not recreate an active chat session that already has messages', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'hello there');
      mockIdentityLoader.load.mockImplementation(withCustomInstructions);
      mockCreateSession.mockClear();

      const result = await manager.refreshLoadedMindIdentities();

      expect(result.refreshedCount).toBe(1);
      expect(mockCreateSession).not.toHaveBeenCalled();

      await manager.createTaskSession(mind.mindId, 'task-1');
      expectFreshTaskSystemMessage();
    });

    it('is a no-op when the identity is unchanged', async () => {
      await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      const result = await manager.refreshLoadedMindIdentities();

      expect(result.refreshedCount).toBe(0);
      expect(mockCreateSession).not.toHaveBeenCalled();
    });
  });

  describe('global custom instructions preference', () => {
    const identityWithPreference = (mindPath: string, options?: { includeGlobalCustomInstructions?: boolean }) => ({
      name: mindPath.split('/').pop() ?? 'unknown',
      systemMessage: options?.includeGlobalCustomInstructions === false
        ? `Identity for ${mindPath}`
        : `Identity for ${mindPath}\n\n## Custom Instructions\nBe concise.`,
    });

    it('persists only the disabled override and returns disabled precedence metadata', async () => {
      mockIdentityLoader.load.mockImplementation(identityWithPreference);
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      const precedence = await manager.setMindGlobalCustomInstructionsEnabled(mind.mindId, false);

      expect(lastSavedConfig().minds[0]).toMatchObject({
        id: mind.mindId,
        globalCustomInstructionsDisabled: true,
      });
      expect(mockIdentityLoader.load).toHaveBeenLastCalledWith('/tmp/agents/q', {
        includeGlobalCustomInstructions: false,
      });
      expect(mockIdentityLoader.getInstructionPrecedence).toHaveBeenLastCalledWith('/tmp/agents/q', {
        includeGlobalCustomInstructions: false,
      });
      expect(precedence.globalCustomInstructionsEnabled).toBe(false);
    });

    it('removes the disabled override when inheritance is re-enabled', async () => {
      mockIdentityLoader.load.mockImplementation(identityWithPreference);
      const mind = await manager.loadMind('/tmp/agents/q');

      await manager.setMindGlobalCustomInstructionsEnabled(mind.mindId, false);
      await manager.setMindGlobalCustomInstructionsEnabled(mind.mindId, true);

      expect(lastSavedConfig().minds[0].globalCustomInstructionsDisabled).toBeUndefined();
      expect(mockIdentityLoader.getInstructionPrecedence).toHaveBeenLastCalledWith('/tmp/agents/q', {
        includeGlobalCustomInstructions: true,
      });
    });

    it('recreates an empty active chat session after the loaded identity changes', async () => {
      mockIdentityLoader.load.mockImplementation(identityWithPreference);
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = manager.getMind(mind.mindId)?.activeSessionId;
      mockCreateSession.mockClear();

      await manager.setMindGlobalCustomInstructionsEnabled(mind.mindId, false);

      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(manager.getMind(mind.mindId)?.activeSessionId).not.toBe(originalSessionId);
      expect(lastSavedConfig().minds[0].conversations).toHaveLength(1);
    });

    it('does not recreate an active chat session that already has messages', async () => {
      mockIdentityLoader.load.mockImplementation(identityWithPreference);
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = manager.getMind(mind.mindId)?.activeSessionId;
      manager.markActiveConversationHasMessages(mind.mindId, 'hello there');
      mockCreateSession.mockClear();

      await manager.setMindGlobalCustomInstructionsEnabled(mind.mindId, false);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(originalSessionId);
      expect(lastSavedConfig().minds[0].globalCustomInstructionsDisabled).toBe(true);
    });

    it('recovers a messageful active conversation with its original system prompt after preference changes', async () => {
      mockIdentityLoader.load.mockImplementation(identityWithPreference);
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = manager.getMind(mind.mindId)?.activeSessionId;
      manager.markActiveConversationHasMessages(mind.mindId, 'hello there');

      await manager.setMindGlobalCustomInstructionsEnabled(mind.mindId, false);
      mockResumeSession.mockClear();

      await manager.recoverActiveConversationSession(mind.mindId);

      expect(mockResumeSession).toHaveBeenCalledWith(
        originalSessionId,
        expect.objectContaining({
          systemMessage: expect.objectContaining({
            sections: expect.objectContaining({
              identity: { action: 'replace', content: expect.stringContaining('Be concise.') },
            }),
          }),
        }),
      );
      expect(mockResumeSession.mock.calls[0]?.[1]).not.toEqual(expect.objectContaining({
        systemMessage: expect.objectContaining({
          sections: expect.objectContaining({
            identity: { action: 'replace', content: 'Identity for /tmp/agents/q' },
          }),
        }),
      }));
    });

    it('restores a messageful active conversation with its saved system prompt snapshot', async () => {
      const originalSystemMessage = 'Identity for /tmp/agents/q\n\n## Custom Instructions\nBe concise.';
      mockIdentityLoader.load.mockImplementation(identityWithPreference);
      currentConfig = {
        version: 2,
        minds: [{
          id: 'q-a1b2',
          path: '/tmp/agents/q',
          globalCustomInstructionsDisabled: true,
          activeSessionId: 'chamber-q-a1b2-existing',
          conversations: [{
            sessionId: 'chamber-q-a1b2-existing',
            title: 'Existing chat',
            createdAt: '2026-05-05T22:00:00.000Z',
            updatedAt: '2026-05-05T22:15:00.000Z',
            kind: 'chat',
            hasMessages: true,
            systemMessage: originalSystemMessage,
          }],
        }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };

      await manager.restoreFromConfig();

      expect(mockResumeSession).toHaveBeenCalledWith(
        'chamber-q-a1b2-existing',
        expect.objectContaining({
          systemMessage: expect.objectContaining({
            sections: expect.objectContaining({
              identity: { action: 'replace', content: originalSystemMessage },
            }),
          }),
        }),
      );
    });

    it('restores an empty active draft with the current system prompt', async () => {
      const staleDraftSystemMessage = 'Identity for /tmp/agents/q\n\n## Custom Instructions\nBe concise.';
      mockIdentityLoader.load.mockImplementation(identityWithPreference);
      currentConfig = {
        version: 2,
        minds: [{
          id: 'q-a1b2',
          path: '/tmp/agents/q',
          globalCustomInstructionsDisabled: true,
          activeSessionId: 'chamber-q-a1b2-draft',
          conversations: [{
            sessionId: 'chamber-q-a1b2-draft',
            title: 'Draft',
            createdAt: '2026-05-05T22:00:00.000Z',
            updatedAt: '2026-05-05T22:15:00.000Z',
            kind: 'chat',
            hasMessages: false,
            systemMessage: staleDraftSystemMessage,
          }],
        }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };

      await manager.restoreFromConfig();

      expect(mockResumeSession).toHaveBeenCalledWith(
        'chamber-q-a1b2-draft',
        expect.objectContaining({
          systemMessage: expect.objectContaining({
            sections: expect.objectContaining({
              identity: { action: 'replace', content: 'Identity for /tmp/agents/q' },
            }),
          }),
        }),
      );
      expect(lastSavedConfig().minds[0].conversations?.[0]?.systemMessage).toBe('Identity for /tmp/agents/q');
    });

    it('resumes an inactive conversation with its saved system prompt snapshot after preference changes', async () => {
      mockIdentityLoader.load.mockImplementation(identityWithPreference);
      const mind = await manager.loadMind('/tmp/agents/q');
      const firstSessionId = manager.getMind(mind.mindId)?.activeSessionId;
      const firstSystemMessage = lastSavedConfig().minds[0].conversations?.[0]?.systemMessage;
      expect(firstSessionId).toBeTruthy();
      expect(firstSystemMessage).toContain('Be concise.');
      manager.markActiveConversationHasMessages(mind.mindId, 'hello there');
      await manager.startNewConversation(mind.mindId);
      await manager.setMindGlobalCustomInstructionsEnabled(mind.mindId, false);
      mockResumeSession.mockClear();

      await manager.resumeConversation(mind.mindId, firstSessionId ?? '');

      expect(mockResumeSession).toHaveBeenCalledWith(
        firstSessionId,
        expect.objectContaining({
          systemMessage: expect.objectContaining({
            sections: expect.objectContaining({
              identity: { action: 'replace', content: firstSystemMessage },
            }),
          }),
        }),
      );
    });
  });

  describe('concurrent loadMind guard', () => {
    it('returns same promise for concurrent calls with same path', async () => {
      const promise1 = manager.loadMind('/tmp/agents/q');
      const promise2 = manager.loadMind('/tmp/agents/q');
      const [mind1, mind2] = await Promise.all([promise1, promise2]);
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('mcp.json discovery (#199)', () => {
    it('passes parsed mcpServers to createSession when .mcp.json is present', async () => {
      const mcpJson = JSON.stringify({
        mcpServers: {
          memory: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory'],
            env: { ROOT: '/tmp/mem' },
          },
        },
      });
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        return String(candidate).endsWith('.mcp.json')
          ? mcpJson
          : '# TestAgent\nSome content';
      });

      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: {
            memory: {
              type: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-memory'],
              env: { ROOT: '/tmp/mem' },
              tools: ['*'],
            },
          },
        }),
      );
    });

    it('omits mcpServers from session config when .mcp.json is absent', async () => {
      // Default beforeEach: existsSync returns false for `.mcp.json`.
      await manager.loadMind('/tmp/agents/q');

      const config = mockCreateSession.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(config).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(config, 'mcpServers')).toBe(false);
    });
  });

  describe('managed skill discovery', () => {
    it('passes the mind skill parent directory to createSession', async () => {
      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          skillDirectories: [path.join('/tmp/agents/q', '.github', 'skills')],
        }),
      );
    });

    it('passes the mind skill parent directory to resumeSession', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Prior chat');
      await manager.recreateSession(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];

      await manager.resumeConversation(mind.mindId, target.sessionId);

      expect(mockResumeSession).toHaveBeenCalledWith(
        target.sessionId,
        expect.objectContaining({
          skillDirectories: [path.join('/tmp/agents/q', '.github', 'skills')],
        }),
      );
    });
  });

  describe('chamber mind config (#131 — per-mind excludedTools)', () => {
    it('passes excludedTools through to createSession when .chamber.json declares them', async () => {
      const chamberJson = JSON.stringify({ excludedTools: ['shell', 'str_replace'] });
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        return String(candidate).endsWith('.chamber.json')
          ? chamberJson
          : '# TestAgent\nSome content';
      });

      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          excludedTools: ['shell', 'str_replace'],
        }),
      );
    });

    it('omits excludedTools from session config when .chamber.json is absent', async () => {
      await manager.loadMind('/tmp/agents/q');

      const config = mockCreateSession.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(config).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(config, 'excludedTools')).toBe(false);
    });

    it('omits excludedTools from session config when .chamber.json declares an empty array', async () => {
      const chamberJson = JSON.stringify({ excludedTools: [] });
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        return String(candidate).endsWith('.chamber.json')
          ? chamberJson
          : '# TestAgent\nSome content';
      });

      await manager.loadMind('/tmp/agents/q');

      const config = mockCreateSession.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(config).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(config, 'excludedTools')).toBe(false);
    });

    it('passes excludedTools through to resumeSession when resuming a prior conversation', async () => {
      const chamberJson = JSON.stringify({ excludedTools: ['shell'] });
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        return String(candidate).endsWith('.chamber.json')
          ? chamberJson
          : '# TestAgent\nSome content';
      });
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Prior chat');
      await manager.recreateSession(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];

      await manager.resumeConversation(mind.mindId, target.sessionId);

      const resumeConfig = mockResumeSession.mock.calls[0][1] as Record<string, unknown>;
      expect(resumeConfig.excludedTools).toEqual(['shell']);
    });
  });

  describe('MindManager — MCP trust gate', () => {
    const MCP_PATH = '/tmp/agents/mcp-mind';

    function makeTrustService(opts: {
      trusted: boolean;
      approvedServers?: Record<string, unknown>;
    }) {
      return {
        registerMindLoad: vi.fn(),
        isMindTrustedForExecution: vi.fn(() => opts.trusted),
        getApprovedMcpServers: vi.fn(
          (_mindId: string, _mindPath: string, servers: Record<string, unknown>) =>
            opts.approvedServers ?? (opts.trusted ? servers : {}),
        ),
        grantTrust: vi.fn(),
        revokeTrust: vi.fn(),
        getTrustStatus: vi.fn(),
        runMigration: vi.fn(),
      };
    }

    function makeMindManagerWithTrust(trust: ReturnType<typeof makeTrustService>) {
      const m = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        trust as unknown as IMindTrustService,
      );
      m.setProviders([mockProvider as unknown as ChamberToolProvider]);
      return m;
    }

    it('pending mind receives no MCP servers in SDK session config', async () => {
      const mcpJson = JSON.stringify({
        mcpServers: {
          'test-server': { command: 'npx', args: ['-y', 'some-mcp'] },
        },
      });
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('.mcp.json') || (!String(p).endsWith('.chamber.json')));
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).endsWith('.mcp.json')) return mcpJson;
        return '# TestAgent\nSome content';
      });

      const trust = makeTrustService({ trusted: false, approvedServers: {} });
      const m = makeMindManagerWithTrust(trust);

      await m.loadMind(MCP_PATH);

      const createConfig = mockCreateSession.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(createConfig?.mcpServers).toBeUndefined();
    });

    it('trusted mind with approved server passes server into SDK session config', async () => {
      const serverConfig = { command: 'npx', args: ['-y', 'some-mcp'] };
      const mcpJson = JSON.stringify({ mcpServers: { 'test-server': serverConfig } });
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('.mcp.json') || (!String(p).endsWith('.chamber.json')));
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).endsWith('.mcp.json')) return mcpJson;
        return '# TestAgent\nSome content';
      });

      const approvedServers = { 'test-server': serverConfig };
      const trust = makeTrustService({ trusted: true, approvedServers });
      const m = makeMindManagerWithTrust(trust);

      await m.loadMind(MCP_PATH);

      const createConfig = mockCreateSession.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(createConfig?.mcpServers).toEqual(approvedServers);
    });

    it('registers mind load with trust service on loadMind', async () => {
      const trust = makeTrustService({ trusted: true });
      const m = makeMindManagerWithTrust(trust);

      const mind = await m.loadMind(MCP_PATH);

      expect(trust.registerMindLoad).toHaveBeenCalledWith(
        mind.mindId,
        MCP_PATH,
        expect.any(String),
      );
    });

    it('server excluded when trust service filters it out', async () => {
      const mcpJson = JSON.stringify({
        mcpServers: {
          'server-a': { command: 'node', args: ['a.js'] },
          'server-b': { command: 'node', args: ['b.js'] },
        },
      });
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('.mcp.json') || (!String(p).endsWith('.chamber.json')));
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).endsWith('.mcp.json')) return mcpJson;
        return '# TestAgent\nSome content';
      });

      // Only server-a is approved (server-b was changed)
      const approvedServers = { 'server-a': { command: 'node', args: ['a.js'] } };
      const trust = makeTrustService({ trusted: true, approvedServers });
      const m = makeMindManagerWithTrust(trust);

      await m.loadMind(MCP_PATH);

      const createConfig = mockCreateSession.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(createConfig?.mcpServers).toEqual(approvedServers);
    });
  });

  describe('provider integration', () => {
    it('activates providers after creating a mind session', async () => {
      await manager.loadMind('/tmp/agents/q');
      expect(mockProvider.activateMind).toHaveBeenCalledWith(
        expect.stringMatching(/^q-/),
        '/tmp/agents/q',
      );
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('passes provider tools to createSessionForMind during load', async () => {
      const providerTool = {
        name: 'provider_tool',
        description: 'Provided tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);

      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('recreateSession() rebuilds tools from providers', async () => {
      const providerTool = {
        name: 'fresh_tool',
        description: 'Fresh tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.recreateSession(mind.mindId);

      expect(mockProvider.getToolsForMind).toHaveBeenCalledWith(mind.mindId, '/tmp/agents/q');
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('works without providers', async () => {
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
      );

      await mgr.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [],
        }),
      );
    });
  });

  describe('reloadAllMinds', () => {
    it('unloads every loaded mind and restores them from config', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');

      await manager.reloadAllMinds();

      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(2);
      expect(manager.listMinds()).toHaveLength(2);
    });

    it('preserves activeMindId', async () => {
      const firstMind = await manager.loadMind('/tmp/agents/q');
      const secondMind = await manager.loadMind('/tmp/agents/fox');
      manager.setActiveMind(secondMind.mindId);

      await manager.reloadAllMinds();

      expect(manager.getActiveMindId()).toBe(secondMind.mindId);
      expect(manager.getActiveMindId()).not.toBe(firstMind.mindId);
    });

    it('creates fresh client instances after reload', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalClient = manager.getMind(mind.mindId)?.client;

      await manager.reloadAllMinds();

      const reloadedClient = manager.getMind(mind.mindId)?.client;
      expect(reloadedClient).toBeDefined();
      expect(reloadedClient).not.toBe(originalClient);
    });

    it('preserves activeLogin in persisted config snapshots', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: 'alice',
        theme: 'dark',
      });
      await manager.loadMind('/tmp/agents/q');

      await manager.reloadAllMinds();

      expect(mockConfigService.save).toHaveBeenCalledWith(expect.objectContaining({
        activeLogin: 'alice',
      }));
    });

    it('suppresses per-mind config writes during reload — only the snapshot save is written', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      mockConfigService.save.mockClear();

      await manager.reloadAllMinds();

      // One snapshot save before restore, then one per re-loaded mind (from loadMind's persistConfig).
      // The two unloadMind calls should NOT produce saves thanks to the reloading guard.
      const saveCalls = mockConfigService.save.mock.calls;
      // First save is the snapshot (contains both minds)
      expect(saveCalls[0][0].minds).toHaveLength(2);
      // No save should have an empty minds array (which would be the mid-unload state)
      const emptyMindsSaves = saveCalls.filter((call: unknown[]) => (call[0] as { minds: unknown[] }).minds.length === 0);
      expect(emptyMindsSaves).toHaveLength(0);
    });

    it('does not drop failed restore records during reload', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'bad-c3d4',
        activeLogin: 'alice',
        theme: 'dark',
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();

      await manager.reloadAllMinds();

      for (const [config] of mockConfigService.save.mock.calls as Array<[AppConfig]>) {
        expect(savedMindIds(config)).toEqual(['bad-c3d4', 'good-a1b2']);
      }
      consoleSpy.mockRestore();
    });
  });

  describe('BYO LLM provider config integration (SDK-native)', () => {
    it('BVT-MM01: passes provider into createSession only when a BYO model is selected', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://example.com/v1', apiKey: 'lm-studio' };
      const byoProviderConfigProvider = vi.fn().mockReturnValue(provider);
      const byoDefaultModelProvider = vi.fn().mockReturnValue('gemma-4-e4b');
      currentConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q', selectedModel: 'gemma-4-e4b', selectedModelProvider: 'byo' }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        byoProviderConfigProvider,
        byoDefaultModelProvider,
      );

      await mgr.restoreFromConfig();

      expect(byoProviderConfigProvider).toHaveBeenCalled();
      // Client factory is called WITHOUT extraEnv now (provider is passed via session config)
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      // Verify provider + model were passed into createSession
      const createSessionCall = mockCreateSession.mock.calls[mockCreateSession.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
      expect(createSessionCall?.provider).toEqual(provider);
      expect(createSessionCall?.model).toBe('gemma-4-e4b');
    });

    it('restores BYO-selected minds with the default provider when BYO is disabled', async () => {
      currentConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q', selectedModel: 'gemma-4-e4b', selectedModelProvider: 'byo' }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => null,
      );

      await mgr.restoreFromConfig();

      const createSessionCall = mockCreateSession.mock.calls[mockCreateSession.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
      expect(createSessionCall?.provider).toBeUndefined();
      expect(createSessionCall?.model).toBeUndefined();
      expect(mgr.listMinds()[0].selectedModel).toBeUndefined();
      expect(mgr.listMinds()[0].selectedModelProvider).toBeUndefined();
    });

    it('BVT-MM02: omits provider from createSession when BYO is enabled but no BYO model is selected', async () => {
      const byoProviderConfigProvider = vi.fn().mockReturnValue({ type: 'openai' as const, baseUrl: 'https://example.com/v1' });
      const byoDefaultModelProvider = vi.fn().mockReturnValue(undefined);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        byoProviderConfigProvider,
        byoDefaultModelProvider,
      );

      await mgr.loadMind('/tmp/agents/q');

      const createSessionCall = mockCreateSession.mock.calls[mockCreateSession.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
      expect(createSessionCall?.provider).toBeUndefined();
      expect(createSessionCall?.model).toBeUndefined();
      expect(byoProviderConfigProvider).not.toHaveBeenCalled();
    });

    it('BVT-MM02b: rejects a BYO model selection when BYO provider config is unavailable', async () => {
      const byoProviderConfigProvider = vi.fn().mockReturnValue(null);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        byoProviderConfigProvider,
      );
      const q = await mgr.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await expect(mgr.setMindModel(q.mindId, 'byo:gemma-4-e4b')).rejects.toThrow(
        'BYO LLM model selected, but BYO LLM is not enabled or configured.',
      );

      expect(byoProviderConfigProvider).toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('BVT-MM03: restartAllMindsForByoChange refreshes only BYO-selected loaded minds', async () => {
      const byoProviderConfigProvider = vi.fn().mockReturnValue({ type: 'openai' as const, baseUrl: 'https://x/v1' });
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        byoProviderConfigProvider,
      );

      const q = await mgr.loadMind('/tmp/agents/q');
      await mgr.loadMind('/tmp/agents/fox');
      await mgr.setMindModel(q.mindId, 'byo:gemma-4-e4b');
      mockClientFactory.destroyClient.mockClear();

      const result = await mgr.restartAllMindsForByoChange();

      expect(result).toEqual({ restartedCount: 1 });
      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(1);
    });

    it('BVT-MM04: per-mind selectedModel takes precedence over BYO default', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );
      const resolved = (mgr as unknown as { resolveModelForSdk: (m: string | undefined, p: typeof provider) => string | undefined }).resolveModelForSdk('qwen3.5-9b', provider);
      expect(resolved).toBe('qwen3.5-9b');
    });

    it('BVT-MM05: BYO default model is used when per-mind selectedModel is undefined', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );
      const resolved = (mgr as unknown as { resolveModelForSdk: (m: string | undefined, p: typeof provider) => string | undefined }).resolveModelForSdk(undefined, provider);
      expect(resolved).toBe('gemma-4-e4b');
    });

    it('BVT-MM06: empty-string selectedModel falls back to BYO default', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );
      const resolved = (mgr as unknown as { resolveModelForSdk: (m: string | undefined, p: typeof provider) => string | undefined }).resolveModelForSdk('  ', provider);
      expect(resolved).toBe('gemma-4-e4b');
    });

    it('BVT-MM07: BYO default model is not used when provider is inactive', () => {
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => null,
        () => 'gemma-4-e4b',
      );
      const resolved = (mgr as unknown as { resolveModelForSdk: (m: string | undefined, p: null) => string | undefined }).resolveModelForSdk(undefined, null);
      expect(resolved).toBeUndefined();
    });

    it('BVT-MM08: cloud-to-BYO model switch recreates a provider-scoped session', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );

      const q = await mgr.loadMind('/tmp/agents/q');
      await mgr.setMindModel(q.mindId, 'claude-sonnet-4.6');
      const cloudSession = mgr.getMind(q.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();

      const updated = await mgr.setMindModel(q.mindId, 'byo:gemma-4-e4b');

      expect(updated?.selectedModel).toBe('gemma-4-e4b');
      expect(updated?.selectedModelProvider).toBe('byo');
      expect(cloudSession.setModel).toHaveBeenCalledWith('claude-sonnet-4.6');
      expect(cloudSession.disconnect).toHaveBeenCalled();
      expect(mockResumeSession).not.toHaveBeenCalled();
      const createSessionConfig = mockCreateSession.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(createSessionConfig?.provider).toBe(provider);
      expect(createSessionConfig?.model).toBe('gemma-4-e4b');
      expect(lastSavedConfig().minds[0]).toMatchObject({
        selectedModel: 'gemma-4-e4b',
        selectedModelProvider: 'byo',
      });
    });

    it('BVT-MM09: BYO-to-cloud model switch recreates a cloud session without provider', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );

      const q = await mgr.loadMind('/tmp/agents/q');
      await mgr.setMindModel(q.mindId, 'byo:gemma-4-e4b');
      const byoSession = mgr.getMind(q.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();

      const updated = await mgr.setMindModel(q.mindId, 'copilot:claude-sonnet-4.6');

      expect(updated?.selectedModel).toBe('claude-sonnet-4.6');
      expect(updated?.selectedModelProvider).toBeUndefined();
      expect(byoSession.setModel).not.toHaveBeenCalledWith('claude-sonnet-4.6');
      expect(byoSession.disconnect).toHaveBeenCalled();
      expect(mockResumeSession).not.toHaveBeenCalled();
      const createSessionConfig = mockCreateSession.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(createSessionConfig?.provider).toBeUndefined();
      expect(createSessionConfig?.model).toBe('claude-sonnet-4.6');
    });

    it('BVT-MM10: restartAllMindsForByoChange clears only BYO-selected models when BYO is disabled', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
      );

      const q = await mgr.loadMind('/tmp/agents/q');
      const fox = await mgr.loadMind('/tmp/agents/fox');
      await mgr.setMindModel(q.mindId, 'byo:google%2Fgemma-4-e4b');
      await mgr.setMindModel(fox.mindId, 'gpt-5.4');

      const result = await mgr.restartAllMindsForByoChange(null);

      expect(result).toEqual({ restartedCount: 1 });
      const qRecord = currentConfig.minds.find((mind) => mind.id === q.mindId);
      const foxRecord = currentConfig.minds.find((mind) => mind.id === fox.mindId);
      expect(qRecord?.selectedModel).toBeUndefined();
      expect(qRecord?.selectedModelProvider).toBeUndefined();
      expect(foxRecord?.selectedModel).toBe('gpt-5.4');
      expect(foxRecord?.selectedModelProvider).toBeUndefined();
    });
  });
});
