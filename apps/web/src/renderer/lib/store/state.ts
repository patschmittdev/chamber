import type { AttachmentBlock, ChatMessage, ChatEvent, ConversationEventRef, ConversationSummary, MessageVariantGroup, ModelInfo, LensViewManifest, LensViewVisibility, MindContext, ImageBlock } from '@chamber/shared/types';
import type { VariantSelectionByGroup } from '@chamber/shared/messageVariants';
import type { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '@chamber/shared/a2a-types';
import type { ChatroomMessage, ChatroomStreamEvent, OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig, TaskLedgerItem } from '@chamber/shared/chatroom-types';
import { DEFAULT_APP_FEATURE_FLAGS, type AppFeatureFlags } from '@chamber/shared/feature-flags';

export type LensView = 'chat' | string;

/** Tabs available in the Extensions view; used by the one-shot deep-link intent. */
export type ExtensionsTab = 'mcp' | 'tools' | 'skills' | 'lens' | 'prompts';

export interface AgentProfileSummary {
  mindId: string;
  displayName: string;
  avatarDataUrl: string | null;
  accentColor?: string | null;
}

/**
 * User-facing failure state for a mind's most recent turn. Set when a turn ends
 * in an error/timeout or completes with no assistant content, and cleared when a
 * new turn starts or a turn completes with content. Drives the inline chat error
 * banner + Retry surface (single source of truth in the reducer).
 */
export interface ChatError {
  message: string;
  failedMessageId: string;
}

/**
 * A single queued toast for the app-wide notification host. Feature-agnostic on
 * purpose: any surface can enqueue one through useToast, and the Toaster renders
 * the queue as stacked ui/Alert banners.
 */
export interface ToastNotification {
  id: string;
  title?: string;
  message: string;
  variant: 'default' | 'destructive';
}

// Per-mind conversation view state machine:
// idle -> hydrating -> ready. Streaming and model switching are orthogonal
// flags scoped to the same mind/session so history selection and chat content
// cannot drift apart.
export interface ConversationViewState {
  status: 'idle' | 'hydrating' | 'ready';
  sessionId?: string;
  pendingSessionId?: string;
  streaming: boolean;
  modelSwitching: boolean;
  error?: string;
}

export interface AppState {
  minds: MindContext[];
  agentProfileByMindId: Record<string, AgentProfileSummary>;
  activeMindId: string | null;
  runtimePhase: 'ready' | 'switching-account';
  switchingAccountLogin: string | null;
  messagesByMind: Record<string, ChatMessage[]>;
  /**
   * Per-mind failure state for the most recent turn. Absent when the mind's
   * last turn succeeded or is in flight. Rendered as the inline chat error
   * banner for the active mind.
   */
  errorByMind: Record<string, ChatError>;
  /**
   * Authoritative retained edit/regenerate variant groups per mind, mirrored
   * from the service store after each turn/resume/switch. Drives the version
   * pager together with `variantSelectionByMind`.
   */
  variantGroupsByMind: Record<string, MessageVariantGroup[]>;
  /**
   * Display-only selected branch index per group, per mind (groupId -> index).
   * Absent groups default to the active (newest) branch. Toggling is local until
   * the user continues the conversation, which promotes the selected branch.
   */
  variantSelectionByMind: Record<string, VariantSelectionByGroup>;
  conversationHistoryByMind: Record<string, ConversationSummary[]>;
  activeConversationByMind: Record<string, string | undefined>;
  conversationViewByMind: Record<string, ConversationViewState>;
  isStreaming: boolean;
  streamingByMind: Record<string, boolean>;
  a2aStreamingByMind: Record<string, boolean>;
  /**
   * Per-mind unsent compose draft text. Switching agents preserves and
   * restores each mind's in-progress message so users can stage thoughts
   * across agents without sending or losing them (#221). Cleared for the
   * active mind when ADD_USER_MESSAGE fires.
   */
  composeDraftByMind: Record<string, string>;
  availableModels: ModelInfo[];
  selectedModel: string | null;
  activeView: LensView;
  /**
   * One-shot deep-link target for the Settings view. Callers (e.g. the agent
   * sidebar "Manage" action) set this to open a specific settings section,
   * optionally preselecting an agent. SettingsLayout applies it, then clears it.
   */
  pendingSettingsIntent: { section: string; mindId?: string } | null;
  /**
   * One-shot deep-link target for the Extensions view. Commands (e.g. the
   * "New skill" command) set this to open a specific tab and optionally request
   * an action such as creating a skill. ExtensionsView applies the tab and
   * SkillsTab applies the action, then each clears the intent.
   */
  pendingExtensionsIntent: { tab: ExtensionsTab; action?: 'create-skill' | 'create-prompt' } | null;
  featureFlags: AppFeatureFlags;
  discoveredViews: LensViewManifest[];
  disabledLensViewKeys: string[];
  showLanding: boolean;
  mindsChecked: boolean;
  tasksByMind: Record<string, Task[]>;
  chatroomMessages: ChatroomMessage[];
  chatroomStreamingByMind: Record<string, boolean>;
  chatroomOrchestration: OrchestrationMode;
  chatroomGroupChatConfig: GroupChatConfig | null;
  chatroomHandoffConfig: HandoffConfig | null;
  chatroomMagenticConfig: MagenticConfig | null;
  /** Who is currently speaking / being selected — shown as typing indicator */
  chatroomActiveSpeaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' } | null;
  /** Live task ledger from Magentic orchestration */
  chatroomTaskLedger: TaskLedgerItem[];
  /** Orchestration completion metrics */
  chatroomMetrics: { elapsedMs: number; totalTasks: number; completedTasks: number; failedTasks: number; agentsUsed: number; orchestrationMode: string } | null;
  /** Mind IDs the user has disabled in the chatroom; excluded from broadcasts. */
  chatroomDisabledMindIds: string[];
  /**
   * App-wide toast queue. Decoupled from any feature: the Toaster host mounted
   * once in AppShell renders these as stacked ui/Alert banners with auto and
   * manual dismiss.
   */
  notifications: ToastNotification[];
}

export type AppAction =
  | { type: 'ADD_USER_MESSAGE'; payload: { id: string; content: string; timestamp: number; images?: ImageBlock[]; documents?: AttachmentBlock[] } }
  | { type: 'ADD_ASSISTANT_MESSAGE'; payload: { id: string; timestamp: number } }
  | { type: 'CHAT_EVENT'; payload: { mindId: string; messageId: string; event: ChatEvent } }
  | { type: 'TRUNCATE_AFTER'; payload: { mindId: string; messageId: string } }
  | { type: 'CAPTURE_MESSAGE_VARIANT'; payload: { mindId: string; userEventId: string } }
  | { type: 'SET_MESSAGE_VARIANTS'; payload: { mindId: string; groups: MessageVariantGroup[] } }
  | { type: 'SELECT_MESSAGE_VARIANT'; payload: { mindId: string; groupId: string; index: number } }
  | { type: 'RECONCILE_EVENT_IDS'; payload: { mindId: string; events: ConversationEventRef[] } }
  | { type: 'HYDRATE_CHAT_STATE'; payload: { messagesByMind: Record<string, ChatMessage[]>; streamingByMind: Record<string, boolean>; conversationViewByMind?: Record<string, ConversationViewState> } }
  | { type: 'SET_CONVERSATION_HISTORY'; payload: { mindId: string; conversations: ConversationSummary[] } }
  | { type: 'CONVERSATION_HYDRATING'; payload: { mindId: string; sessionId: string } }
  | { type: 'CONVERSATION_HYDRATE_FAILED'; payload: { mindId: string; sessionId: string; error: string } }
  | { type: 'RESUME_CONVERSATION'; payload: { mindId: string; sessionId: string; messages: ChatMessage[]; conversations: ConversationSummary[] } }
  | { type: 'SET_MODEL_SWITCHING'; payload: { mindId: string; switching: boolean } }
  | { type: 'SET_MINDS'; payload: MindContext[] }
  | { type: 'SET_AGENT_PROFILE_SUMMARY'; payload: AgentProfileSummary }
  | { type: 'SET_ACTIVE_MIND'; payload: string | null }
  | { type: 'ADD_MIND'; payload: MindContext }
  | { type: 'REMOVE_MIND'; payload: string }
  | { type: 'SET_AVAILABLE_MODELS'; payload: ModelInfo[] }
  | { type: 'SET_SELECTED_MODEL'; payload: string | null }
  | { type: 'SET_ACTIVE_VIEW'; payload: LensView }
  | { type: 'SET_PENDING_SETTINGS_INTENT'; payload: { section: string; mindId?: string } | null }
  | { type: 'SET_PENDING_EXTENSIONS_INTENT'; payload: { tab: ExtensionsTab; action?: 'create-skill' | 'create-prompt' } | null }
  | { type: 'SET_FEATURE_FLAGS'; payload: AppFeatureFlags }
  | { type: 'SET_DISCOVERED_VIEWS'; payload: LensViewManifest[] }
  | { type: 'SET_DISABLED_LENS_VIEW_IDS'; payload: { mindId: string; viewIds: string[] } }
  | { type: 'SET_LENS_VIEW_ENABLED'; payload: LensViewVisibility }
  | { type: 'SHOW_LANDING' }
  | { type: 'HIDE_LANDING' }
  | { type: 'ACCOUNT_SWITCH_STARTED'; payload: { login: string } }
  | { type: 'ACCOUNT_SWITCH_COMPLETED' }
  | { type: 'LOGGED_OUT' }
  | { type: 'MINDS_CHECKED' }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'NEW_CONVERSATION'; payload?: { mindId: string } }
  | { type: 'SET_COMPOSE_DRAFT'; payload: { mindId: string; draft: string } }
  | { type: 'A2A_INCOMING'; payload: { targetMindId: string; message: Message; replyMessageId: string } }
  | { type: 'TASK_STATUS_UPDATE'; payload: TaskStatusUpdateEvent & { targetMindId: string } }
  | { type: 'TASK_ARTIFACT_UPDATE'; payload: TaskArtifactUpdateEvent & { targetMindId: string } }
  | { type: 'SET_CHATROOM_HISTORY'; payload: ChatroomMessage[] }
  | { type: 'CHATROOM_USER_MESSAGE'; payload: ChatroomMessage }
  | { type: 'CHATROOM_AGENT_MESSAGE'; payload: { messageId: string; mindId: string; mindName: string; roundId: string; timestamp: number } }
  | { type: 'CHATROOM_EVENT'; payload: ChatroomStreamEvent }
  | { type: 'CHATROOM_CLEAR' }
  | { type: 'SET_CHATROOM_TASK_LEDGER'; payload: TaskLedgerItem[] }
  | { type: 'SET_ORCHESTRATION'; payload: OrchestrationMode }
  | { type: 'SET_GROUP_CHAT_CONFIG'; payload: GroupChatConfig | null }
  | { type: 'SET_HANDOFF_CONFIG'; payload: HandoffConfig | null }
  | { type: 'SET_MAGENTIC_CONFIG'; payload: MagenticConfig | null }
  | { type: 'CHATROOM_ACTIVE_SPEAKER'; payload: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' } | null }
  | { type: 'SET_CHATROOM_DISABLED_MIND_IDS'; payload: string[] }
  | { type: 'ENQUEUE_NOTIFICATION'; payload: ToastNotification }
  | { type: 'DISMISS_NOTIFICATION'; payload: { id: string } };

export const initialState: AppState = {
  minds: [],
  agentProfileByMindId: {},
  activeMindId: null,
  runtimePhase: 'ready',
  switchingAccountLogin: null,
  messagesByMind: {},
  errorByMind: {},
  variantGroupsByMind: {},
  variantSelectionByMind: {},
  conversationHistoryByMind: {},
  activeConversationByMind: {},
  conversationViewByMind: {},
  isStreaming: false,
  streamingByMind: {},
  a2aStreamingByMind: {},
  composeDraftByMind: {},
  availableModels: [],
  selectedModel: null,
  activeView: 'chat',
  pendingSettingsIntent: null,
  pendingExtensionsIntent: null,
  featureFlags: DEFAULT_APP_FEATURE_FLAGS,
  discoveredViews: [],
  disabledLensViewKeys: [],
  showLanding: false,
  mindsChecked: false,
  tasksByMind: {},
  chatroomMessages: [],
  chatroomStreamingByMind: {},
  chatroomOrchestration: 'concurrent',
  chatroomGroupChatConfig: null,
  chatroomHandoffConfig: null,
  chatroomMagenticConfig: null,
  chatroomActiveSpeaker: null,
  chatroomTaskLedger: [],
  chatroomMetrics: null,
  chatroomDisabledMindIds: [],
  notifications: [],
};
