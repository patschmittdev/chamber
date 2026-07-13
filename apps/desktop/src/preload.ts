import { contextBridge, ipcRenderer } from 'electron';
import { createIpcListener, IPC } from '@chamber/shared';
import type { A2AIncomingPayload } from '@chamber/shared/types';
import type { SkillSaveRequest } from '@chamber/shared/skill-types';
import type { PromptSaveRequest } from '@chamber/shared/prompt-types';
import type { AppearanceBridge, ElectronAPI } from '@chamber/shared/electron-types';
import type { AppearanceSnapshot } from '@chamber/shared/appearance-types';
import type { Message, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@chamber/shared/a2a-types';

const initialAppearanceSnapshot = ipcRenderer.sendSync(IPC.APPEARANCE.GET_INITIAL_SNAPSHOT) as AppearanceSnapshot;

const electronAPI: ElectronAPI = {
  chat: {
    send: (mindId, message, messageId, model, attachments) =>
      ipcRenderer.invoke(IPC.CHAT.SEND, mindId, message, messageId, model, attachments),
    stop: (mindId, messageId) =>
      ipcRenderer.invoke(IPC.CHAT.STOP, mindId, messageId),
    newConversation: (mindId) =>
      ipcRenderer.invoke(IPC.CHAT.NEW_CONVERSATION, mindId),
    listModels: (mindId?) => ipcRenderer.invoke(IPC.CHAT.LIST_MODELS, mindId),
    getEventSequence: () => ipcRenderer.invoke(IPC.CHAT.GET_EVENT_SEQUENCE),
    replayEvents: (afterSequence) => ipcRenderer.invoke(IPC.CHAT.REPLAY_EVENTS, afterSequence),
    onEvent: (callback) => createIpcListener(ipcRenderer, IPC.CHAT.EVENT, callback),
    deleteMessage: (mindId, eventId) =>
      ipcRenderer.invoke(IPC.CHAT.DELETE_MESSAGE, mindId, eventId),
    editMessage: (mindId, eventId, prompt, messageId, model) =>
      ipcRenderer.invoke(IPC.CHAT.EDIT_MESSAGE, mindId, eventId, prompt, messageId, model),
    regenerate: (mindId, messageId, model) =>
      ipcRenderer.invoke(IPC.CHAT.REGENERATE, mindId, messageId, model),
    getConversationEvents: (mindId) =>
      ipcRenderer.invoke(IPC.CHAT.GET_CONVERSATION_EVENTS, mindId),
    getConversationVariants: (mindId) =>
      ipcRenderer.invoke(IPC.CHAT.GET_CONVERSATION_VARIANTS, mindId),
    switchActiveVariant: (mindId, anchorEventId, variantId) =>
      ipcRenderer.invoke(IPC.CHAT.SWITCH_ACTIVE_VARIANT, mindId, anchorEventId, variantId),
    forkConversation: (mindId, sourceSessionId, sourceEventId) =>
      ipcRenderer.invoke(IPC.CHAT.FORK_CONVERSATION, mindId, sourceSessionId, sourceEventId),
  },
  conversationHistory: {
    list: (mindId) => ipcRenderer.invoke(IPC.CONVERSATION_HISTORY.LIST, mindId),
    resume: (mindId, sessionId) => ipcRenderer.invoke(IPC.CONVERSATION_HISTORY.RESUME, mindId, sessionId),
    rename: (mindId, sessionId, title) => ipcRenderer.invoke(IPC.CONVERSATION_HISTORY.RENAME, mindId, sessionId, title),
    setPinned: (mindId, sessionId, pinned) => ipcRenderer.invoke(IPC.CONVERSATION_HISTORY.SET_PINNED, mindId, sessionId, pinned),
    setArchived: (mindId, sessionId, archived) => ipcRenderer.invoke(IPC.CONVERSATION_HISTORY.SET_ARCHIVED, mindId, sessionId, archived),
    delete: (mindId, sessionId) => ipcRenderer.invoke(IPC.CONVERSATION_HISTORY.DELETE, mindId, sessionId),
    messages: (mindId, sessionId) => ipcRenderer.invoke(IPC.CONVERSATION_HISTORY.MESSAGES, mindId, sessionId),
    export: (mindId, sessionId, format) => ipcRenderer.invoke(IPC.CONVERSATION_HISTORY.EXPORT, mindId, sessionId, format),
  },
  mind: {
    add: (mindPath) => ipcRenderer.invoke(IPC.MIND.ADD, mindPath),
    remove: (mindId) => ipcRenderer.invoke(IPC.MIND.REMOVE, mindId),
    list: () => ipcRenderer.invoke(IPC.MIND.LIST),
    setActive: (mindId) => ipcRenderer.invoke(IPC.MIND.SET_ACTIVE, mindId),
    setModel: (mindId, model) => ipcRenderer.invoke(IPC.MIND.SET_MODEL, mindId, model),
    setGlobalCustomInstructionsEnabled: (mindId, enabled) =>
      ipcRenderer.invoke(IPC.MIND.SET_GLOBAL_CUSTOM_INSTRUCTIONS_ENABLED, mindId, enabled),
    getInstructionPrecedence: (mindId) =>
      ipcRenderer.invoke(IPC.MIND.GET_INSTRUCTION_PRECEDENCE, mindId),
    selectDirectory: () => ipcRenderer.invoke(IPC.MIND.SELECT_DIRECTORY),
    openWindow: (mindId) => ipcRenderer.invoke(IPC.MIND.OPEN_WINDOW, mindId),
    onMindChanged: (callback) => createIpcListener(ipcRenderer, IPC.MIND.CHANGED, callback),
  },
  mindProfile: {
    get: (mindId) => ipcRenderer.invoke('mindProfile:get', mindId),
    saveFile: (request) => ipcRenderer.invoke('mindProfile:saveFile', request),
    pickAvatarImage: () => ipcRenderer.invoke('mindProfile:pickAvatarImage'),
    saveAvatar: (request) => ipcRenderer.invoke('mindProfile:saveAvatar', request),
    removeAvatar: (mindId) => ipcRenderer.invoke('mindProfile:removeAvatar', mindId),
    restart: (mindId) => ipcRenderer.invoke('mindProfile:restart', mindId),
  },
  mindMemory: {
    read: (mindId) => ipcRenderer.invoke('mindMemory:read', mindId),
  },
  lens: {
    getViews: (mindId?) => ipcRenderer.invoke(IPC.LENS.GET_VIEWS, mindId),
    getViewData: (viewId, mindId?) => ipcRenderer.invoke(IPC.LENS.GET_VIEW_DATA, viewId, mindId),
    refreshView: (viewId, mindId?) => ipcRenderer.invoke(IPC.LENS.REFRESH_VIEW, viewId, mindId),
    sendAction: (viewId, action, mindId?) => ipcRenderer.invoke(IPC.LENS.SEND_ACTION, viewId, action, mindId),
    getCanvasUrl: (viewId, mindId?) => ipcRenderer.invoke(IPC.LENS.GET_CANVAS_URL, viewId, mindId),
    getDisabledViewIds: (mindId?) => ipcRenderer.invoke(IPC.LENS.GET_DISABLED_VIEW_IDS, mindId),
    setViewEnabled: (viewId, enabled, mindId?) => ipcRenderer.invoke(IPC.LENS.SET_VIEW_ENABLED, viewId, enabled, mindId),
    onViewsChanged: (callback) => createIpcListener(ipcRenderer, IPC.LENS.VIEWS_CHANGED, callback),
    onVisibilityChanged: (callback) => createIpcListener(ipcRenderer, IPC.LENS.VISIBILITY_CHANGED, callback),
  },
  auth: {
    getStatus: () => ipcRenderer.invoke(IPC.AUTH.GET_STATUS),
    listAccounts: () => ipcRenderer.invoke(IPC.AUTH.LIST_ACCOUNTS),
    startLogin: () => ipcRenderer.invoke(IPC.AUTH.START_LOGIN),
    cancelLogin: () => ipcRenderer.invoke(IPC.AUTH.CANCEL_LOGIN),
    switchAccount: (login) => ipcRenderer.invoke(IPC.AUTH.SWITCH_ACCOUNT, login),
    logout: () => ipcRenderer.invoke(IPC.AUTH.LOGOUT),
    onProgress: (callback) => createIpcListener(ipcRenderer, IPC.AUTH.PROGRESS, callback),
    onAccountSwitchStarted: (callback) => createIpcListener(ipcRenderer, IPC.AUTH.ACCOUNT_SWITCH_STARTED, callback),
    onAccountSwitched: (callback) => createIpcListener(ipcRenderer, IPC.AUTH.ACCOUNT_SWITCHED, callback),
    onLoggedOut: (callback) => createIpcListener(ipcRenderer, IPC.AUTH.LOGGED_OUT, callback),
  },
  byoLlm: {
    get: () => ipcRenderer.invoke(IPC.BYO_LLM.GET),
    save: (config) => ipcRenderer.invoke(IPC.BYO_LLM.SAVE, config),
    disable: () => ipcRenderer.invoke(IPC.BYO_LLM.DISABLE),
    probe: (config) => ipcRenderer.invoke(IPC.BYO_LLM.PROBE, config),
    restartAgents: () => ipcRenderer.invoke(IPC.BYO_LLM.RESTART_AGENTS),
    onChanged: (callback) => createIpcListener(ipcRenderer, IPC.BYO_LLM.CHANGED, callback),
  },
  voice: {
    getConfig: () => ipcRenderer.invoke(IPC.VOICE.GET_CONFIG),
    saveConfig: (config) => ipcRenderer.invoke(IPC.VOICE.SAVE_CONFIG, config),
    onConfigChanged: (callback) => createIpcListener(ipcRenderer, IPC.VOICE.CHANGED, callback),
    getPermissionState: () => ipcRenderer.invoke(IPC.VOICE.GET_PERMISSION_STATE),
    openMicPreferences: () => ipcRenderer.invoke(IPC.VOICE.OPEN_MIC_PREFERENCES),
    getModelStatus: (modelId) => ipcRenderer.invoke(IPC.VOICE.GET_MODEL_STATUS, modelId),
    downloadModel: (modelId, options) => ipcRenderer.invoke(
      IPC.VOICE.DOWNLOAD_MODEL,
      options ? { modelId, ...options } : modelId,
    ),
    cancelDownload: (modelId) => ipcRenderer.invoke(IPC.VOICE.CANCEL_DOWNLOAD, modelId),
    startSession: (payload) => ipcRenderer.invoke(IPC.VOICE.START_SESSION, payload),
    appendAudio: (payload) => ipcRenderer.invoke(IPC.VOICE.APPEND_AUDIO, payload),
    endSession: (payload) => ipcRenderer.invoke(IPC.VOICE.END_SESSION, payload),
    onModelProgress: (callback) => createIpcListener(ipcRenderer, IPC.VOICE.MODEL_PROGRESS, callback),
    onTranscript: (callback) => createIpcListener(ipcRenderer, IPC.VOICE.TRANSCRIPT, callback),
    testMic: () => ipcRenderer.invoke(IPC.VOICE.TEST_MIC),
  },
  genesis: {
    getDefaultPath: () => ipcRenderer.invoke(IPC.GENESIS.GET_DEFAULT_PATH),
    pickPath: () => ipcRenderer.invoke(IPC.GENESIS.PICK_PATH),
    listTemplates: () => ipcRenderer.invoke(IPC.GENESIS.LIST_TEMPLATES),
    create: (config) => ipcRenderer.invoke(IPC.GENESIS.CREATE, config),
    createFromTemplate: (request) => ipcRenderer.invoke(IPC.GENESIS.CREATE_FROM_TEMPLATE, request),
    onProgress: (callback) => createIpcListener(ipcRenderer, IPC.GENESIS.PROGRESS, callback),
  },
  marketplace: {
    listGenesisRegistries: () => ipcRenderer.invoke(IPC.MARKETPLACE.LIST_GENESIS_REGISTRIES),
    addGenesisRegistry: (url) => ipcRenderer.invoke(IPC.MARKETPLACE.ADD_GENESIS_REGISTRY, url),
    refreshGenesisRegistry: (id) => ipcRenderer.invoke(IPC.MARKETPLACE.REFRESH_GENESIS_REGISTRY, id),
    setGenesisRegistryEnabled: (id, enabled) => ipcRenderer.invoke(IPC.MARKETPLACE.SET_GENESIS_REGISTRY_ENABLED, id, enabled),
    removeGenesisRegistry: (id) => ipcRenderer.invoke(IPC.MARKETPLACE.REMOVE_GENESIS_REGISTRY, id),
  },
  userProfile: {
    get: () => ipcRenderer.invoke(IPC.USER_PROFILE.GET),
    save: (request) => ipcRenderer.invoke(IPC.USER_PROFILE.SAVE, request),
    importFromMicrosoft: () => ipcRenderer.invoke(IPC.USER_PROFILE.IMPORT_FROM_MICROSOFT),
  },
  tools: {
    list: () => ipcRenderer.invoke(IPC.TOOLS.LIST),
    install: (toolId, marketplaceId) => ipcRenderer.invoke(IPC.TOOLS.INSTALL, toolId, marketplaceId),
    uninstall: (toolId) => ipcRenderer.invoke(IPC.TOOLS.UNINSTALL, toolId),
  },
  tasks: {
    list: (mindId) => ipcRenderer.invoke(IPC.TASKS.LIST, mindId),
    get: (mindId, ledgerId) => ipcRenderer.invoke(IPC.TASKS.GET, mindId, ledgerId),
    cancel: (mindId, ledgerId) => ipcRenderer.invoke(IPC.TASKS.CANCEL, mindId, ledgerId),
    audit: (mindId) => ipcRenderer.invoke(IPC.TASKS.AUDIT, mindId),
  },
  chatroom: {
    send: (message, model, roundId, options) =>
      ipcRenderer.invoke(IPC.CHATROOM.SEND, message, model, roundId, options),
    history: () => ipcRenderer.invoke(IPC.CHATROOM.HISTORY),
    taskLedger: () => ipcRenderer.invoke(IPC.CHATROOM.TASK_LEDGER),
    clear: () => ipcRenderer.invoke(IPC.CHATROOM.CLEAR),
    stop: () => ipcRenderer.invoke(IPC.CHATROOM.STOP),
    setOrchestration: (mode: string, config?: unknown) => ipcRenderer.invoke(IPC.CHATROOM.SET_ORCHESTRATION, mode, config),
    getOrchestration: () => ipcRenderer.invoke(IPC.CHATROOM.GET_ORCHESTRATION),
    onEvent: (callback) => createIpcListener(ipcRenderer, IPC.CHATROOM.EVENT, callback),
    setMindEnabled: (mindId: string, enabled: boolean) => ipcRenderer.invoke(IPC.CHATROOM.SET_MIND_ENABLED, mindId, enabled),
    getDisabledMindIds: () => ipcRenderer.invoke(IPC.CHATROOM.GET_DISABLED_MIND_IDS),
    onStateChanged: (callback) => createIpcListener(ipcRenderer, IPC.CHATROOM.STATE_CHANGED, callback),
  },
  operatorActivity: {
    getSnapshot: () => ipcRenderer.invoke(IPC.OPERATOR_ACTIVITY.GET_SNAPSHOT),
    onChanged: (callback) => createIpcListener(ipcRenderer, IPC.OPERATOR_ACTIVITY.CHANGED, callback),
  },
  updater: {
    getState: () => ipcRenderer.invoke(IPC.UPDATER.GET_STATE),
    check: () => ipcRenderer.invoke(IPC.UPDATER.CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATER.DOWNLOAD),
    installAndRestart: () => ipcRenderer.invoke(IPC.UPDATER.INSTALL_AND_RESTART),
    onStateChanged: (callback) => createIpcListener(ipcRenderer, IPC.UPDATER.STATE_CHANGED, callback),
  },
  a2a: {
    onIncoming: (callback: (payload: { targetMindId: string; message: Message; replyMessageId: string }) => void) => createIpcListener(ipcRenderer, IPC.A2A.INCOMING, callback),
    listAgents: () => ipcRenderer.invoke(IPC.A2A.LIST_AGENTS),
    onTaskStatusUpdate: (callback: (payload: TaskStatusUpdateEvent & { targetMindId: string }) => void) => createIpcListener(ipcRenderer, IPC.A2A.TASK_STATUS_UPDATE, callback),
    onTaskArtifactUpdate: (callback: (payload: TaskArtifactUpdateEvent & { targetMindId: string }) => void) => createIpcListener(ipcRenderer, IPC.A2A.TASK_ARTIFACT_UPDATE, callback),
    getTask: (taskId: string, historyLength?: number) => ipcRenderer.invoke(IPC.A2A.GET_TASK, taskId, historyLength),
    listTasks: (filter?: { contextId?: string; status?: string }) => ipcRenderer.invoke(IPC.A2A.LIST_TASKS, filter),
    cancelTask: (taskId: string) => ipcRenderer.invoke(IPC.A2A.CANCEL_TASK, taskId),
    relayStatus: () => ipcRenderer.invoke(IPC.A2A.RELAY_STATUS),
    relayConnect: (request) => ipcRenderer.invoke(IPC.A2A.RELAY_CONNECT, request),
    relayDisconnect: () => ipcRenderer.invoke(IPC.A2A.RELAY_DISCONNECT),
    onRelayStateChanged: (callback) => createIpcListener(ipcRenderer, IPC.A2A.RELAY_STATE_CHANGED, callback),
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW.MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW.MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW.CLOSE),
  },
  app: {
    getFeatureFlags: () => ipcRenderer.invoke(IPC.APP.GET_FEATURE_FLAGS),
    onStartupProgress: (callback) => createIpcListener(ipcRenderer, IPC.APP.STARTUP_PROGRESS, callback),
  },
  skills: {
    listForMind: (mindId: string) => ipcRenderer.invoke(IPC.SKILLS.LIST_FOR_MIND, mindId),
    listForMindDetails: (mindId: string) => ipcRenderer.invoke(IPC.SKILLS.LIST_FOR_MIND_DETAILS, mindId),
    browseMarketplace: () => ipcRenderer.invoke(IPC.SKILLS.BROWSE_MARKETPLACE),
    getSource: (mindId: string, id: string) => ipcRenderer.invoke(IPC.SKILLS.GET_SOURCE, mindId, id),
    save: (request: SkillSaveRequest) => ipcRenderer.invoke(IPC.SKILLS.SAVE, request),
  },
  mcp: {
    getServers: (mindId?) => ipcRenderer.invoke(IPC.MCP.GET_SERVERS, mindId),
    setServers: (servers, mindId?) => ipcRenderer.invoke(IPC.MCP.SET_SERVERS, servers, mindId),
  },
  prompts: {
    list: () => ipcRenderer.invoke(IPC.PROMPTS.LIST),
    save: (request: PromptSaveRequest) => ipcRenderer.invoke(IPC.PROMPTS.SAVE, request),
    delete: (id: string) => ipcRenderer.invoke(IPC.PROMPTS.DELETE, id),
  },
};

if (ipcRenderer.sendSync(IPC.E2E.IS_ENABLED) === true) {
  electronAPI.e2e = {
    emitA2AIncoming: async (payload: A2AIncomingPayload) => {
      await ipcRenderer.invoke(IPC.E2E.A2A_INCOMING, payload);
    },
    emitAuthProgress: async (payload: Record<string, unknown>) => {
      await ipcRenderer.invoke(IPC.E2E.AUTH_EMIT_PROGRESS, payload);
    },
    completeLoginStub: async (payload: { success?: boolean; login?: string }) => {
      await ipcRenderer.invoke(IPC.E2E.AUTH_COMPLETE_LOGIN, payload);
    },
    voice: {
      setFakeProvider: async () => {
        await ipcRenderer.invoke(IPC.E2E.VOICE_SET_FAKE_PROVIDER);
      },
      emitTranscript: async (payload) => {
        await ipcRenderer.invoke(IPC.E2E.VOICE_EMIT_TRANSCRIPT, payload);
      },
      setPermissionState: async (state) => {
        await ipcRenderer.invoke(IPC.E2E.VOICE_SET_PERMISSION_STATE, state);
      },
      setModelStatus: async (status) => {
        await ipcRenderer.invoke(IPC.E2E.VOICE_SET_MODEL_STATUS, status);
      },
      getSessionState: () => ipcRenderer.invoke(IPC.E2E.VOICE_GET_SESSION_STATE),
    },
  };
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

const chamberAppearance: AppearanceBridge = {
  getInitialSnapshot: () => initialAppearanceSnapshot,
  get: () => ipcRenderer.invoke(IPC.APPEARANCE.GET),
  set: (preferences) => ipcRenderer.invoke(IPC.APPEARANCE.SET, preferences),
  onChanged: (callback) => createIpcListener(ipcRenderer, IPC.APPEARANCE.CHANGED, callback),
};

contextBridge.exposeInMainWorld('chamberAppearance', chamberAppearance);

contextBridge.exposeInMainWorld('desktop', {
  pickFolder: () => ipcRenderer.invoke(IPC.MIND.SELECT_DIRECTORY),
  openMindWindow: (mindId: string) => ipcRenderer.invoke(IPC.MIND.OPEN_WINDOW, mindId),
  getAppBranding: () => ipcRenderer.invoke(IPC.DESKTOP.GET_BRANDING),
  confirm: (message: string) => ipcRenderer.invoke(IPC.DESKTOP.CONFIRM, message),
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke(IPC.DESKTOP.SET_THEME, theme),
  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW.MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW.MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW.CLOSE),
  },
});
