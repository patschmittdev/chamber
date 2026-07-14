/**
 * Renderer-facing API surface that the desktop preload exposes via
 * `contextBridge.exposeInMainWorld('electronAPI', ...)`. This is the single
 * type contract between main and renderer; preload implements it, the
 * renderer consumes it via `window.electronAPI`.
 *
 * Channel name string literals come from `./ipc-channels`; payload types
 * live alongside the relevant feature ones (`./types`, `./chatroom-types`,
 * `./a2a-types`).
 */
import type {
  A2AIncomingPayload,
  A2ARelayConnectRequest,
  A2ARelayStatus,
  AgentCard,
  ListTasksResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from './a2a-types';
import type { ChatroomAPI } from './chatroom-types';
import type { AppFeatureFlags } from './feature-flags';
import type { CancelOutcome, LedgerRecord, LedgerStatus } from './ledger';
import type { OperatorActivityAPI } from './operator-activity-types';
import type { AppearancePreferences, AppearanceSnapshot } from './appearance-types';
import type {
  TranscriptionEvent,
  VoiceDictationConfig,
  VoiceDownloadModelOptions,
  VoiceMicTestResult,
  VoiceModelStatus,
  VoicePermissionState,
} from './voice-types';
import type {
  AgentProfile,
  AgentProfileActionResult,
  AgentProfileAvatarPickResult,
  AgentProfileAvatarSaveRequest,
  AgentProfileSaveRequest,
  AgentProfileSaveResult,
  ByoLlmConfig,
  ByoLlmProbeResult,
  ByoLlmSaveResult,
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  ChatReplayEvent,
  ConversationEventRef,
  ConversationExportFormat,
  ConversationExportResult,
  ConversationResumeResult,
  ConversationSummary,
  CanvasLensActionStatusEvent,
  DesktopUpdateActionResult,
  DesktopUpdateState,
  GenesisMindTemplate,
  LensViewManifest,
  MarketplaceRegistry,
  MarketplaceRegistryActionResult,
  LensViewVisibility,
  MessageVariantGroup,
  MindInstructionPrecedence,
  MindContext,
  MindWorkingMemory,
  ModelInfo,
  StartupProgressEvent,
  ToolOperationListResult,
  ToolOperationResult,
  UserProfile,
  UserProfileImportResult,
  UserProfileSaveRequest,
} from './types';
import type {
  SkillDetail,
  SkillManifest,
  SkillMarketplaceBrowseResult,
  SkillSaveRequest,
  SkillSaveResult,
  SkillSource,
} from './skill-types';
import type { McpConnectorCheckResult, McpConnectorStatusResult } from './mcp-types';
import type { Prompt, PromptMutationResult, PromptSaveRequest } from './prompt-types';
import type { CapabilityInventoryQuery, CapabilityInventoryResult } from './capability-types';

export interface ElectronAPI {
  chat: {
    send: (mindId: string, message: string, messageId: string, model?: string, attachments?: ChatAttachment[]) => Promise<void>;
    stop: (mindId: string, messageId: string) => Promise<void>;
    newConversation: (mindId: string) => Promise<ConversationResumeResult>;
    listModels: (mindId?: string) => Promise<ModelInfo[]>;
    getEventSequence: () => Promise<number>;
    replayEvents: (afterSequence: number) => Promise<ChatReplayEvent[]>;
    onEvent: (callback: (mindId: string, messageId: string, event: ChatEvent, sequence?: number) => void) => () => void;
    /** Deletes a turn (and everything after it) from persisted history. Returns the refreshed conversation list. */
    deleteMessage: (mindId: string, eventId: string) => Promise<ConversationSummary[]>;
    /** Replaces a user turn (and everything after it) with an edited prompt, streaming a fresh response under `messageId`. */
    editMessage: (mindId: string, eventId: string, prompt: string, messageId: string, model?: string) => Promise<void>;
    /** Re-runs the most recent user turn, streaming a fresh response under `messageId`. */
    regenerate: (mindId: string, messageId: string, model?: string) => Promise<void>;
    /** Ordered references to persisted user/assistant turns, for reconciling live messages with their event ids. */
    getConversationEvents: (mindId: string) => Promise<ConversationEventRef[]>;
    /** Retained edit/regenerate variant groups for the active conversation, for rendering the version pager. */
    getConversationVariants: (mindId: string) => Promise<MessageVariantGroup[]>;
    /** Promotes a retained variant to the live branch before the next send, returning the refreshed conversation. */
    switchActiveVariant: (mindId: string, anchorEventId: string | null, variantId: string) => Promise<ConversationResumeResult>;
    /** Forks a new active conversation from a persisted turn in another conversation. */
    forkConversation: (mindId: string, sourceSessionId: string, sourceEventId: string) => Promise<ConversationResumeResult>;
  };
  conversationHistory: {
    list: (mindId: string) => Promise<ConversationSummary[]>;
    resume: (mindId: string, sessionId: string) => Promise<ConversationResumeResult>;
    rename: (mindId: string, sessionId: string, title: string) => Promise<ConversationSummary[]>;
    delete: (mindId: string, sessionId: string) => Promise<ConversationResumeResult>;
    messages: (mindId: string, sessionId: string) => Promise<ChatMessage[]>;
    export: (mindId: string, sessionId: string, format: ConversationExportFormat) => Promise<ConversationExportResult>;
    /** Pins or unpins a conversation, returning the refreshed history (mirrors rename). */
    setPinned: (mindId: string, sessionId: string, pinned: boolean) => Promise<ConversationSummary[]>;
    /** Archives or unarchives a conversation, returning the refreshed history (mirrors rename). */
    setArchived: (mindId: string, sessionId: string, archived: boolean) => Promise<ConversationSummary[]>;
    /** Sets or clears a per-conversation system prompt override, returning the refreshed history (mirrors rename). An empty string clears the override so the conversation falls back to the mind default. */
    setSystemMessage: (mindId: string, sessionId: string, systemMessage: string) => Promise<ConversationSummary[]>;
  };
  mind: {
    add: (mindPath: string) => Promise<MindContext>;
    remove: (mindId: string) => Promise<void>;
    list: () => Promise<MindContext[]>;
    setActive: (mindId: string) => Promise<void>;
    setModel: (mindId: string, model: string | null) => Promise<MindContext | null>;
    setGlobalCustomInstructionsEnabled: (mindId: string, enabled: boolean) => Promise<MindInstructionPrecedence>;
    getInstructionPrecedence: (mindId: string) => Promise<MindInstructionPrecedence>;
    selectDirectory: () => Promise<string | null>;
    openWindow: (mindId: string) => Promise<void>;
    onMindChanged: (callback: (minds: MindContext[]) => void) => () => void;
  };
  mindProfile: {
    get: (mindId: string) => Promise<AgentProfile>;
    saveFile: (request: AgentProfileSaveRequest) => Promise<AgentProfileSaveResult>;
    pickAvatarImage: () => Promise<AgentProfileAvatarPickResult>;
    saveAvatar: (request: AgentProfileAvatarSaveRequest) => Promise<AgentProfileActionResult>;
    removeAvatar: (mindId: string) => Promise<AgentProfileActionResult>;
    restart: (mindId: string) => Promise<MindContext>;
  };
  mindMemory: {
    /**
     * Reads a mind's agent-managed working-memory files (`memory.md`,
     * `rules.md`, `log.md`) for read-only display. Path-confined to the mind's
     * `.working-memory/` directory; missing files come back absent, not as an
     * error. Never writes: working memory is owned by the agent.
     */
    read: (mindId: string) => Promise<MindWorkingMemory>;
  };
  lens: {
    getViews: (mindId?: string) => Promise<LensViewManifest[]>;
    getViewData: (viewId: string, mindId?: string) => Promise<Record<string, unknown> | null>;
    refreshView: (viewId: string, mindId?: string) => Promise<Record<string, unknown> | null>;
    sendAction: (viewId: string, action: string, mindId?: string) => Promise<Record<string, unknown> | null>;
    getCanvasUrl: (viewId: string, mindId?: string) => Promise<string | null>;
    getDisabledViewIds: (mindId?: string) => Promise<string[]>;
    setViewEnabled: (viewId: string, enabled: boolean, mindId?: string) => Promise<LensViewVisibility>;
    onViewsChanged: (callback: (views: LensViewManifest[], mindId?: string) => void) => () => void;
    onVisibilityChanged: (callback: (visibility: LensViewVisibility) => void) => () => void;
    onCanvasActionStatus: (callback: (status: CanvasLensActionStatusEvent) => void) => () => void;
  };
  auth: {
    getStatus: () => Promise<{ authenticated: boolean; login?: string }>;
    listAccounts: () => Promise<Array<{ login: string }>>;
    startLogin: () => Promise<{ success: boolean; login?: string; error?: string }>;
    cancelLogin?: () => Promise<void>;
    switchAccount: (login: string) => Promise<void>;
    logout: () => Promise<void>;
    onProgress: (callback: (progress: { step: string; userCode?: string; verificationUri?: string; login?: string; error?: string }) => void) => () => void;
    onAccountSwitchStarted: (callback: (data: { login: string }) => void) => () => void;
    onAccountSwitched: (callback: (data: { login: string }) => void) => () => void;
    onLoggedOut: (callback: () => void) => () => void;
  };
  genesis: {
    getDefaultPath: () => Promise<string>;
    pickPath: () => Promise<string | null>;
    listTemplates: () => Promise<GenesisMindTemplate[]>;
    create: (config: { name: string; role: string; voice: string; voiceDescription: string; basePath: string }) => Promise<{ success: boolean; mindId?: string; mindPath?: string; error?: string }>;
    createFromTemplate: (request: { templateId: string; marketplaceId?: string; basePath: string }) => Promise<{ success: boolean; mindId?: string; mindPath?: string; error?: string }>;
    onProgress: (callback: (progress: { step: string; detail: string }) => void) => () => void;
  };
  marketplace: {
    listGenesisRegistries: () => Promise<MarketplaceRegistry[]>;
    addGenesisRegistry: (url: string) => Promise<MarketplaceRegistryActionResult>;
    refreshGenesisRegistry: (id: string) => Promise<MarketplaceRegistryActionResult>;
    setGenesisRegistryEnabled: (id: string, enabled: boolean) => Promise<MarketplaceRegistryActionResult>;
    removeGenesisRegistry: (id: string) => Promise<MarketplaceRegistryActionResult>;
  };
  userProfile: {
    get: () => Promise<UserProfile>;
    save: (request: UserProfileSaveRequest) => Promise<UserProfile>;
    importFromMicrosoft: () => Promise<UserProfileImportResult>;
  };
  tools: {
    listOperations: () => Promise<ToolOperationListResult>;
    install: (toolId: string, marketplaceId: string) => Promise<ToolOperationResult>;
    update: (toolId: string, marketplaceId: string) => Promise<ToolOperationResult>;
    remove: (toolId: string, marketplaceId: string) => Promise<ToolOperationResult>;
  };
  tasks: {
    list: (mindId: string) => Promise<LedgerRecord[]>;
    get: (mindId: string, ledgerId: string) => Promise<LedgerRecord | { error: string }>;
    cancel: (mindId: string, ledgerId: string) => Promise<CancelOutcome>;
    audit: (mindId: string) => Promise<{
      counts: Record<LedgerStatus, number>;
      findings: Array<{ type: 'stale-running' | 'missing-cleanup' | 'delivery-failed'; ledgerId: string }>;
    }>;
  };
  chatroom: ChatroomAPI;
  operatorActivity: OperatorActivityAPI;
  updater: {
    getState: () => Promise<DesktopUpdateState>;
    check: () => Promise<DesktopUpdateActionResult>;
    download: () => Promise<DesktopUpdateActionResult>;
    installAndRestart: () => Promise<DesktopUpdateActionResult>;
    onStateChanged: (callback: (state: DesktopUpdateState) => void) => () => void;
  };
  a2a: {
    onIncoming:(callback: (payload: A2AIncomingPayload) => void) => () => void;
    listAgents: () => Promise<AgentCard[]>;
    onTaskStatusUpdate: (callback: (payload: TaskStatusUpdateEvent & { targetMindId: string }) => void) => () => void;
    onTaskArtifactUpdate: (callback: (payload: TaskArtifactUpdateEvent & { targetMindId: string }) => void) => () => void;
    getTask: (taskId: string, historyLength?: number) => Promise<Task | null>;
    listTasks: (filter?: { contextId?: string; status?: string }) => Promise<ListTasksResponse>;
    cancelTask: (taskId: string) => Promise<Task | { error: string }>;
    relayStatus: () => Promise<A2ARelayStatus>;
    relayConnect: (request: A2ARelayConnectRequest) => Promise<A2ARelayStatus>;
    relayDisconnect: () => Promise<A2ARelayStatus>;
    onRelayStateChanged: (callback: (status: A2ARelayStatus) => void) => () => void;
  };
  e2e?: {
    emitA2AIncoming: (payload: A2AIncomingPayload) => Promise<void>;
    emitAuthProgress: (payload: { step: string; userCode?: string; verificationUri?: string; login?: string; error?: string }) => Promise<void>;
    completeLoginStub: (payload: { success?: boolean; login?: string }) => Promise<void>;
    voice?: {
      setFakeProvider: () => Promise<void>;
      emitTranscript: (payload?: E2EVoiceTranscriptPayload) => Promise<void>;
      setPermissionState: (state: VoicePermissionState | null) => Promise<void>;
      setModelStatus: (status: VoiceModelStatus | null) => Promise<void>;
      getSessionState: () => Promise<E2EVoiceSessionState>;
    };
  };
  byoLlm: {
    get: () => Promise<ByoLlmConfig | null>;
    save: (config: ByoLlmConfig) => Promise<ByoLlmSaveResult>;
    disable: () => Promise<ByoLlmSaveResult>;
    probe: (config: ByoLlmConfig) => Promise<ByoLlmProbeResult>;
    restartAgents: () => Promise<{ success: boolean; restartedCount: number; error?: string }>;
    onChanged: (callback: (config: ByoLlmConfig | null) => void) => () => void;
  };
  voice: {
    getConfig: () => Promise<VoiceDictationConfig | null>;
    saveConfig: (config: VoiceDictationConfig) => Promise<void>;
    onConfigChanged: (callback: (config: VoiceDictationConfig | null) => void) => () => void;
    getPermissionState: () => Promise<VoicePermissionState>;
    openMicPreferences: () => Promise<void>;
    getModelStatus: (modelId: string) => Promise<VoiceModelStatus>;
    downloadModel: (modelId: string, options?: VoiceDownloadModelOptions) => Promise<void>;
    cancelDownload: (modelId: string) => Promise<void>;
    startSession: (payload: VoiceStartSessionPayload) => Promise<void>;
    appendAudio: (payload: VoiceAppendAudioPayload) => Promise<void>;
    endSession: (payload: VoiceEndSessionPayload) => Promise<void>;
    testMic: () => Promise<VoiceMicTestResult>;
    onModelProgress: (callback: (status: VoiceModelStatus) => void) => () => void;
    onTranscript: (callback: (event: TranscriptionEvent) => void) => () => void;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
  app: {
    getFeatureFlags: () => Promise<AppFeatureFlags>;
    /**
     * Subscribe to per-step app-startup progress events while the main
     * process restores minds from config. Drives the boot-screen activity
     * log (#56). Returns an unsubscribe function — call it on unmount.
     */
    onStartupProgress: (callback: (event: StartupProgressEvent) => void) => () => void;
  };
  skills: {
    /**
     * Lists self-declared metadata for skill directories currently on disk.
     * This does not attest managed provenance, integrity, or lifecycle state.
     */
    listForMind: (mindId: string) => Promise<SkillManifest[]>;
    /**
     * Lists bounded local detail metadata for skill directories currently on disk.
     */
    listForMindDetails: (mindId: string) => Promise<SkillDetail[]>;
    /**
     * Lists read-only skill and template marketplace metadata from enrolled registries.
     */
    browseMarketplace: () => Promise<SkillMarketplaceBrowseResult>;
    /**
     * Reads a skill's raw SKILL.md source for editing, with the on-disk mtime used
     * for optimistic concurrency. Desktop-backed; rejects in browser mode.
     */
    getSource: (mindId: string, id: string) => Promise<SkillSource>;
    /**
     * Creates or updates a skill's SKILL.md. Confines the write to the mind's
     * skills directory, rejects reserved and Chamber-managed skills, and validates
     * frontmatter before persisting.
     */
    save: (request: SkillSaveRequest) => Promise<SkillSaveResult>;
  };
  mcp: {
    /** Lists configuration and connection state without exposing connector configuration. */
    listStatus: (mindId?: string) => Promise<McpConnectorStatusResult>;
    /**
     * Uses Chamber's existing bounded SDK session path. It confirms only that
     * configuration applied, never live remote connection health.
     */
    checkConnector: (connectorName: string, mindId?: string) => Promise<McpConnectorCheckResult>;
  };
  prompts: {
    /**
     * Lists the user's saved prompt library. User-scoped and mind-independent.
     * Returns [] when the library is absent or unreadable (desktop). In browser
     * mode the library is desktop-only, so this rejects with an unavailable
     * signal (rejects: true); the composer and Prompts tab catch it and degrade.
     */
    list: () => Promise<Prompt[]>;
    /**
     * Creates a prompt when `id` is null or updates the prompt with that id.
     * Validates title, body, and description bounds and returns the refreshed
     * library on success. Desktop-backed; returns a failure result in browser mode.
     */
    save: (request: PromptSaveRequest) => Promise<PromptMutationResult>;
    /**
     * Deletes the prompt with the given id and returns the refreshed library on
     * success. Desktop-backed; returns a failure result in browser mode.
     */
    delete: (id: string) => Promise<PromptMutationResult>;
  };
  capabilities: {
    /** Lists a renderer-safe projection of installed and available capabilities. */
    list: (query?: CapabilityInventoryQuery) => Promise<CapabilityInventoryResult>;
  };
}

export interface AppearanceBridge {
  getInitialSnapshot: () => AppearanceSnapshot;
  get: () => Promise<AppearanceSnapshot>;
  set: (preferences: Partial<AppearancePreferences>) => Promise<AppearanceSnapshot>;
  onChanged: (callback: (snapshot: AppearanceSnapshot) => void) => () => void;
}

export interface VoiceStartSessionPayload {
  readonly sessionId: string;
  readonly deviceId?: string | null;
  readonly modelId?: string;
}

export interface VoiceAppendAudioPayload {
  readonly sessionId: string;
  readonly chunk: Uint8Array;
}

export interface VoiceEndSessionPayload {
  readonly sessionId: string;
}

export interface E2EVoiceTranscriptPayload {
  readonly type?: TranscriptionEvent['type'];
  readonly text?: string;
  readonly message?: string;
}

export interface E2EVoiceSessionState {
  readonly activeSessionId: string | null;
  readonly startedCount: number;
  readonly endedCount: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    chamberAppearance?: AppearanceBridge;
  }
}
