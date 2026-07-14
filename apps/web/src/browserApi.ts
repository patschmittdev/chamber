import { ChamberClient } from '@chamber/client';
import { DEFAULT_APP_FEATURE_FLAGS } from '@chamber/shared/feature-flags';
import type { LensViewManifest, MindContext, ModelInfo } from '@chamber/shared/types';
import type { ElectronAPI } from '@chamber/shared/electron-types';
import type { AgentCard, ListTasksResponse, Task } from '@chamber/shared/a2a-types';
import type { ChatroomAPI, ChatroomMessage, TaskLedgerItem } from '@chamber/shared/chatroom-types';
import type { OperatorActivitySnapshot } from '@chamber/shared/operator-activity-types';
import { getBrowserCapability } from './browserCapabilities';

const noopUnsubscribe = () => undefined;
const SUBSCRIPTION_TIMEOUT_MS = 10_000;

/**
 * Single dispatcher for methods the browser host cannot provide. `method` is a
 * qualified `namespace.method` name declared with `rejects: true` in the browser
 * capability manifest. The manifest is the source of truth for what the browser
 * cannot do; a method routed here without a `rejects: true` declaration is a
 * wiring mistake, so we still throw the standard user-facing message (never
 * internal wording) and append a developer hint so the mismatch is diagnosable.
 */
function unavailable(method: string): never {
  const [namespace, name] = method.split('.');
  const capability = getBrowserCapability(namespace, name);
  const developerHint = capability?.rejects
    ? ''
    : ` (declare "${method}" with rejects: true in browserCapabilities.ts)`;
  throw new Error(`Not available in browser mode: ${method}.${developerHint}`);
}

type AuthProgress = Parameters<ElectronAPI['auth']['onProgress']>[0] extends (progress: infer TProgress) => void
  ? TProgress
  : never;

function createClient(): ChamberClient {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  return new ChamberClient({ baseUrl: window.location.origin, token, origin: window.location.origin });
}

function createBrowserChatroomApi(): ChatroomAPI {
  return {
    send: async () => unavailable('chatroom.send'),
    history: async (): Promise<ChatroomMessage[]> => [],
    taskLedger: async (): Promise<TaskLedgerItem[]> => [],
    clear: async () => unavailable('chatroom.clear'),
    stop: async () => unavailable('chatroom.stop'),
    setOrchestration: async () => unavailable('chatroom.setOrchestration'),
    getOrchestration: async () => ({ mode: 'concurrent', config: null }),
    onEvent: () => noopUnsubscribe,
    setMindEnabled: async () => unavailable('chatroom.setMindEnabled'),
    getDisabledMindIds: async (): Promise<string[]> => [],
    onStateChanged: () => noopUnsubscribe,
  };
}

function createBrowserOperatorActivitySnapshot(): OperatorActivitySnapshot {
  const updatedAt = new Date(0).toISOString();
  return {
    version: 1,
    updatedAt,
    mindActivities: [],
    chatroom: { runId: null, state: 'idle', updatedAt },
    usageSamples: [],
    usageRollups: [],
    budgetWarnings: [],
  };
}

export function installBrowserApi(): void {
  if (window.electronAPI) return;

  const client = createClient();
  const authProgressHandlers = new Set<(progress: AuthProgress) => void>();
  const chatEventHandlers = new Set<Parameters<ElectronAPI['chat']['onEvent']>[0]>();
  const accountSwitchStartedHandlers = new Set<(data: { login: string }) => void>();
  const accountSwitchedHandlers = new Set<(data: { login: string }) => void>();
  const loggedOutHandlers = new Set<() => void>();
  const emitAuthProgress = (progress: AuthProgress) => {
    for (const handler of authProgressHandlers) {
      handler(progress);
    }
  };
  let eventSocket: WebSocket | null = null;
  let openSocketPromise: Promise<WebSocket> | null = null;
  const pendingSubscriptions = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const openEventSocket = (): Promise<WebSocket> => {
    if (eventSocket?.readyState === WebSocket.OPEN) return Promise.resolve(eventSocket);
    if (openSocketPromise) return openSocketPromise;

    const url = new URL('/events', window.location.origin);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', new URLSearchParams(window.location.search).get('token') ?? '');

    openSocketPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      eventSocket = ws;
      ws.addEventListener('open', () => resolve(ws), { once: true });
      ws.addEventListener('error', () => reject(new Error('Failed to open Chamber event socket.')), { once: true });
      ws.addEventListener('message', (message) => {
        const envelope = JSON.parse(String(message.data)) as { type?: string; payload?: unknown };
        if (envelope.type === 'subscription:ready') {
          const payload = envelope.payload as { sessionId?: string };
          if (payload.sessionId) {
            const pending = pendingSubscriptions.get(payload.sessionId);
            if (pending) {
              clearTimeout(pending.timer);
              pending.resolve();
            }
            pendingSubscriptions.delete(payload.sessionId);
          }
          return;
        }
        if (envelope.type === 'chat:event') {
          const payload = envelope.payload as {
            mindId: string;
            messageId: string;
            event: Parameters<Parameters<ElectronAPI['chat']['onEvent']>[0]>[2];
          };
          for (const handler of chatEventHandlers) {
            handler(payload.mindId, payload.messageId, payload.event);
          }
        }
      });
      ws.addEventListener('close', () => {
        if (eventSocket === ws) eventSocket = null;
        if (openSocketPromise) openSocketPromise = null;
        const error = new Error('Chamber event socket closed before subscription was ready.');
        for (const [sessionId, pending] of pendingSubscriptions) {
          clearTimeout(pending.timer);
          pending.reject(error);
          pendingSubscriptions.delete(sessionId);
        }
      });
    });
    return openSocketPromise;
  };
  const subscribeToChatEvents = async (messageId: string): Promise<void> => {
    const ws = await openEventSocket();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingSubscriptions.delete(messageId);
        reject(new Error('Timed out waiting for Chamber event subscription.'));
      }, SUBSCRIPTION_TIMEOUT_MS);
      pendingSubscriptions.set(messageId, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ type: 'subscribe', sessionId: messageId }));
      } catch (error) {
        clearTimeout(timer);
        pendingSubscriptions.delete(messageId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  const promptLibraryBrowserError = 'Prompt library is not available in browser mode yet.';
  const api: ElectronAPI = {
    chat: {
      send: async (mindId, message, messageId, model, attachments) => {
        await subscribeToChatEvents(messageId);
        await client.sendChat({ mindId, message, messageId, model, attachments });
      },
      stop: async (mindId, messageId) => {
        await client.cancelChat(mindId, messageId);
      },
      newConversation: async (mindId) => {
        await client.startNewConversation(mindId);
        return { sessionId: '', messages: [], conversations: [] };
      },
      listModels: (): Promise<ModelInfo[]> => client.listModels(),
      getEventSequence: async () => 0,
      replayEvents: async () => [],
      onEvent: (callback) => {
        chatEventHandlers.add(callback);
        void openEventSocket();
        return () => {
          chatEventHandlers.delete(callback);
        };
      },
      // Message actions (edit/delete/regenerate) are wired for the desktop
      // (Electron IPC) surface. Browser mode has no server route for history
      // mutation yet, so these stay unavailable; the reconcile read is a safe
      // no-op so it never throws after a turn completes.
      deleteMessage: async () => unavailable('chat.deleteMessage'),
      editMessage: async () => unavailable('chat.editMessage'),
      regenerate: async () => unavailable('chat.regenerate'),
      getConversationEvents: async () => [],
      getConversationVariants: async () => [],
      switchActiveVariant: async () => unavailable('chat.switchActiveVariant'),
      forkConversation: async () => unavailable('chat.forkConversation'),
    },
    conversationHistory: {
      list: async () => [],
      resume: async () => ({ sessionId: '', messages: [], conversations: [] }),
      rename: async () => [],
      delete: async () => ({ sessionId: '', messages: [], conversations: [] }),
      messages: async () => [],
      export: async () => ({ status: 'canceled' as const }),
      setPinned: async () => unavailable('conversationHistory.setPinned'),
      setArchived: async () => unavailable('conversationHistory.setArchived'),
      setSystemMessage: async () => unavailable('conversationHistory.setSystemMessage'),
    },
    mind: {
      add: (mindPath): Promise<MindContext> => client.addMind(mindPath) as Promise<MindContext>,
      remove: async () => unavailable('mind.remove'),
      list: () => client.listMinds() as Promise<MindContext[]>,
      setActive: async () => unavailable('mind.setActive'),
      setModel: async () => null,
      setGlobalCustomInstructionsEnabled: async (mindId, enabled) => ({
        mindId,
        mindName: '',
        globalCustomInstructionsEnabled: enabled,
        hasGlobalCustomInstructions: false,
        layers: [],
      }),
      getInstructionPrecedence: async (mindId) => ({
        mindId,
        mindName: '',
        globalCustomInstructionsEnabled: true,
        hasGlobalCustomInstructions: false,
        layers: [],
      }),
      selectDirectory: async () => window.prompt('Enter a local agent folder path on this computer:')?.trim() || null,
      openWindow: async (mindId) => {
        window.open(`/?mindId=${encodeURIComponent(mindId)}`, '_blank', 'noopener,noreferrer');
      },
      onMindChanged: () => noopUnsubscribe,
    },
    mindProfile: {
      get: async () => unavailable('mindProfile.get'),
      saveFile: async () => ({ success: false, error: 'Agent profiles are desktop-only in browser mode.' }),
      pickAvatarImage: async () => ({ success: false, error: 'Agent profiles are desktop-only in browser mode.' }),
      saveAvatar: async () => ({ success: false, error: 'Agent profiles are desktop-only in browser mode.' }),
      removeAvatar: async () => ({ success: false, error: 'Agent profiles are desktop-only in browser mode.' }),
      restart: async () => unavailable('mindProfile.restart'),
    },
    mindMemory: {
      read: async () => unavailable('mindMemory.read'),
    },
    lens: {
      getViews: async (): Promise<LensViewManifest[]> => [],
      getViewData: async () => null,
      refreshView: async () => null,
      sendAction: async () => unavailable('lens.sendAction'),
      getCanvasUrl: async () => null,
      getDisabledViewIds: async () => [],
      setViewEnabled: async (_viewId, enabled, mindId) => ({
        mindId: mindId ?? '',
        viewId: _viewId,
        enabled,
      }),
      onViewsChanged: () => noopUnsubscribe,
      onVisibilityChanged: () => noopUnsubscribe,
      onCanvasActionStatus: () => noopUnsubscribe,
    },
    auth: {
      getStatus: () => client.getAuthStatus(),
      listAccounts: () => client.listAuthAccounts(),
      startLogin: async () => {
        const result = await client.startAuthLogin((progress) => {
          emitAuthProgress(progress);
          if (progress.step === 'device_code' && progress.verificationUri) {
            window.open(progress.verificationUri, '_blank', 'noopener,noreferrer');
          }
        });
        if (result.success && result.login) {
          const data = { login: result.login };
          for (const handler of accountSwitchStartedHandlers) handler(data);
          for (const handler of accountSwitchedHandlers) handler(data);
        }
        return result;
      },
      switchAccount: async (login) => {
        await client.switchAuthAccount(login);
        const data = { login };
        for (const handler of accountSwitchStartedHandlers) handler(data);
        for (const handler of accountSwitchedHandlers) handler(data);
      },
      logout: async () => {
        await client.logoutAuth();
        for (const handler of loggedOutHandlers) handler();
      },
      onProgress: (callback) => {
        authProgressHandlers.add(callback);
        return () => {
          authProgressHandlers.delete(callback);
        };
      },
      onAccountSwitchStarted: (callback) => {
        accountSwitchStartedHandlers.add(callback);
        return () => {
          accountSwitchStartedHandlers.delete(callback);
        };
      },
      onAccountSwitched: (callback) => {
        accountSwitchedHandlers.add(callback);
        return () => {
          accountSwitchedHandlers.delete(callback);
        };
      },
      onLoggedOut: (callback) => {
        loggedOutHandlers.add(callback);
        return () => {
          loggedOutHandlers.delete(callback);
        };
      },
      cancelLogin: async () => undefined,
    },
    byoLlm: {
      get: async () => null,
      save: async () => ({ success: false, error: 'BYO LLM management is desktop-only in browser mode.' }),
      disable: async () => ({ success: false, error: 'BYO LLM management is desktop-only in browser mode.' }),
      probe: async () => ({ ok: false, error: 'BYO LLM probe is desktop-only in browser mode.' }),
      restartAgents: async () => ({ success: false, restartedCount: 0, error: 'Agent restart is desktop-only in browser mode.' }),
      onChanged: () => noopUnsubscribe,
    },
    voice: {
      getConfig: async () => null,
      saveConfig: async () => unavailable('voice.saveConfig'),
      onConfigChanged: () => noopUnsubscribe,
      getPermissionState: async () => 'unsupported',
      openMicPreferences: async () => unavailable('voice.openMicPreferences'),
      getModelStatus: async (modelId) => ({ id: modelId as 'nemotron-speech-streaming-en-0.6b', status: 'error', errorMessage: 'Voice dictation is desktop-only in browser mode.' }),
      downloadModel: async () => unavailable('voice.downloadModel'),
      cancelDownload: async () => unavailable('voice.cancelDownload'),
      startSession: async () => unavailable('voice.startSession'),
      appendAudio: async () => unavailable('voice.appendAudio'),
      endSession: async () => unavailable('voice.endSession'),
      testMic: async () => ({ success: false, error: 'Voice dictation is desktop-only in browser mode.' }),
      onModelProgress: () => noopUnsubscribe,
      onTranscript: () => noopUnsubscribe,
    },
    genesis: {
      getDefaultPath: async () => '',
      pickPath: async () => null,
      listTemplates: async () => [],
      create: async () => ({ success: false, error: 'Genesis setup is desktop-only in browser mode.' }),
      createFromTemplate: async () => ({ success: false, error: 'Genesis template install is desktop-only in browser mode.' }),
      onProgress: () => noopUnsubscribe,
    },
    marketplace: {
      listGenesisRegistries: async () => [],
      addGenesisRegistry: async () => ({ success: false, error: 'Marketplace management is desktop-only in browser mode.' }),
      refreshGenesisRegistry: async () => ({ success: false, error: 'Marketplace management is desktop-only in browser mode.' }),
      setGenesisRegistryEnabled: async () => ({ success: false, error: 'Marketplace management is desktop-only in browser mode.' }),
      removeGenesisRegistry: async () => ({ success: false, error: 'Marketplace management is desktop-only in browser mode.' }),
    },
    userProfile: {
      get: async () => ({
        displayName: '',
        work: '',
        location: '',
        about: '',
        avatarDataUrl: null,
        customInstructions: '',
        source: 'local',
        updatedAt: null,
      }),
      save: async () => unavailable('userProfile.save'),
      importFromMicrosoft: async () => ({
        success: false,
        error: 'Microsoft profile import is desktop-only in browser mode.',
      }),
    },
    tools: {
      list: async () => [],
      install: async () => ({ success: false, error: 'Tool install is desktop-only in browser mode.' }),
      uninstall: async () => ({ success: false, error: 'Tool uninstall is desktop-only in browser mode.' }),
    },
    tasks: {
      list: async () => [],
      get: async (_mindId, ledgerId) => ({ error: `Task ledger is desktop-only in browser mode: ${ledgerId}` }),
      cancel: async (_mindId, ledgerId) => ({
        found: false,
        cancelled: false,
        reason: `Task cancellation is desktop-only in browser mode: ${ledgerId}`,
      }),
      audit: async () => ({
        counts: { queued: 0, running: 0, succeeded: 0, failed: 0, 'timed-out': 0, cancelled: 0, lost: 0 },
        findings: [],
      }),
    },
    chatroom: createBrowserChatroomApi(),
    operatorActivity: {
      getSnapshot: async () => createBrowserOperatorActivitySnapshot(),
      onChanged: () => noopUnsubscribe,
    },
    updater: {
      getState: async () => ({
        enabled: false,
        status: 'disabled',
        currentVersion: 'browser',
        downloadPercent: null,
        message: 'Desktop updates are unavailable in browser mode.',
        canRetry: false,
      }),
      check: async () => ({ success: false, message: 'Desktop updates are unavailable in browser mode.' }),
      download: async () => ({ success: false, message: 'Desktop updates are unavailable in browser mode.' }),
      installAndRestart: async () => ({ success: false, message: 'Desktop updates are unavailable in browser mode.' }),
      onStateChanged: () => noopUnsubscribe,
    },
    a2a: {
      onIncoming: () => noopUnsubscribe,
      listAgents: async (): Promise<AgentCard[]> => [],
      onTaskStatusUpdate: () => noopUnsubscribe,
      onTaskArtifactUpdate: () => noopUnsubscribe,
      getTask: async (): Promise<Task | null> => null,
      listTasks: async (): Promise<ListTasksResponse> => ({ tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 }),
      cancelTask: async (taskId) => ({ error: `Task cancellation is unavailable in browser mode: ${taskId}` }),
      relayStatus: async () => ({
        state: 'disconnected',
        mode: 'local',
        relayBaseUrl: null,
        publishedBaseUrl: null,
        publishedAgentCount: 0,
        relayAgentCount: 0,
        lastError: 'A2A relay is unavailable in browser mode.',
        connectedAt: null,
      }),
      relayConnect: async () => ({
        state: 'error',
        mode: 'local',
        relayBaseUrl: null,
        publishedBaseUrl: null,
        publishedAgentCount: 0,
        relayAgentCount: 0,
        lastError: 'A2A relay is unavailable in browser mode.',
        connectedAt: null,
      }),
      relayDisconnect: async () => ({
        state: 'disconnected',
        mode: 'local',
        relayBaseUrl: null,
        publishedBaseUrl: null,
        publishedAgentCount: 0,
        relayAgentCount: 0,
        lastError: null,
        connectedAt: null,
      }),
      onRelayStateChanged: () => noopUnsubscribe,
    },
    window: {
      minimize: () => unavailable('window.minimize'),
      maximize: () => unavailable('window.maximize'),
      close: () => window.close(),
    },
    app: {
      getFeatureFlags: async () => DEFAULT_APP_FEATURE_FLAGS,
      // Web browser host has no app-startup phase to report; the renderer
      // only sees a loaded page. Return a noop unsubscribe so the subscriber
      // can install/uninstall freely.
      onStartupProgress: () => noopUnsubscribe,
    },
    skills: {
      // Web host has no on-disk mind directory to scan.
      listForMind: async () => [],
      listForMindDetails: async () => [],
      browseMarketplace: async () => ({
        skills: [],
        malformedSkills: [],
        skillSources: [],
        templates: [],
        templateSources: [],
      }),
      // Authoring is desktop-backed; there is no on-disk mind directory here.
      getSource: async () => unavailable('skills.getSource'),
      save: async () => ({
        success: false,
        error: 'Skill authoring is not available in browser mode yet.',
      }),
    },
    mcp: {
      // Web host has no on-disk mind directory to read or write .mcp.json.
      getServers: async () => [],
      setServers: async () => unavailable('mcp.setServers'),
    },
    prompts: {
      // User-scoped prompt library is desktop-backed; the browser host has no
      // config directory to read. list() throws one honest unavailable signal
      // (both the composer and the Prompts tab degrade from it) while writes
      // return an honest failure result rather than a fabricated success.
      list: async () => unavailable('prompts.list'),
      save: async () => ({ success: false, error: promptLibraryBrowserError }),
      delete: async () => ({ success: false, error: promptLibraryBrowserError }),
    },
    capabilities: {
      list: async () => unavailable('capabilities.list'),
    },
  };
  window.electronAPI = api;
  if (!window.desktop) {
    window.desktop = {
      pickFolder: api.mind.selectDirectory,
      openMindWindow: api.mind.openWindow,
    };
  }
}
