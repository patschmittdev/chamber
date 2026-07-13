/**
 * Browser-host capability manifest.
 *
 * The renderer talks to the main process only through `window.electronAPI`, a
 * contract typed in `@chamber/shared/electron-types`. Two hosts implement that
 * contract: the Electron preload bridge and the browser HTTP/WS client
 * (`browserApi.ts`). This manifest is the single, typed source of truth for how
 * the browser host realizes every method of that contract.
 *
 * Single source of truth: `BrowserCapabilityManifest` is a mapped type derived
 * from the `ElectronAPI` contract, so the manifest object must declare an entry
 * for every namespace and method. Adding, renaming, or removing a contract
 * method breaks `tsc` until this file is updated. Method names live here in
 * exactly one place, bound to the contract by type.
 *
 * Status vs behavior are recorded separately:
 * - `status` is the capability intent for the browser host.
 * - `rejects` is the runtime behavior. When `true`, the browser has no usable
 *   fallback and calling the method rejects through the single `unavailable()`
 *   dispatcher in `browserApi.ts`. When omitted, a non-supported capability
 *   returns a documented degraded value that satisfies the contract shape (for
 *   example an empty list, `null`, a negative result, an echoed request, or a
 *   no-op unsubscribe) instead of throwing.
 */
import type { ElectronAPI } from '@chamber/shared/electron-types';

export type WebHostStatus =
  /** Real browser behavior: loopback-client-backed or browser-native. */
  | 'supported'
  /** Requires the desktop (Electron/OS) host; no server-backed equivalent. */
  | 'desktop-only'
  /** Intended to reach browser parity; not yet wired to a server route. */
  | 'planned';

export interface BrowserCapability {
  readonly status: WebHostStatus;
  /**
   * When true, the browser host has no usable fallback and the method rejects
   * through the single `unavailable()` dispatcher. When omitted, a non-supported
   * capability returns a documented degraded value instead of throwing.
   */
  readonly rejects?: boolean;
}

/**
 * The `e2e` namespace is optional, dev-only test scaffolding that the browser
 * host does not implement, so it is excluded from the parity surface.
 */
type ApiNamespaces = Omit<ElectronAPI, 'e2e'>;

export type BrowserCapabilityManifest = {
  readonly [Namespace in keyof ApiNamespaces]-?: {
    readonly [Method in keyof ApiNamespaces[Namespace]]-?: BrowserCapability;
  };
};

const supported: BrowserCapability = { status: 'supported' };

export const BROWSER_CAPABILITY_MANIFEST = {
  chat: {
    send: supported,
    stop: supported,
    newConversation: supported,
    listModels: supported,
    // No cross-process replay in the browser; 0 / [] are the correct answers.
    getEventSequence: supported,
    replayEvents: supported,
    onEvent: supported,
    // History mutation has no browser route yet.
    deleteMessage: { status: 'planned', rejects: true },
    editMessage: { status: 'planned', rejects: true },
    regenerate: { status: 'planned', rejects: true },
    // Reconcile reads the renderer relies on to never throw after a turn; they
    // return [] as placeholders until a browser history route is wired.
    getConversationEvents: { status: 'planned' },
    getConversationVariants: { status: 'planned' },
    switchActiveVariant: { status: 'planned', rejects: true },
    forkConversation: { status: 'planned', rejects: true },
  },
  conversationHistory: {
    list: { status: 'planned' },
    resume: { status: 'planned' },
    rename: { status: 'planned' },
    delete: { status: 'planned' },
    messages: { status: 'planned' },
    export: { status: 'planned' },
  },
  mind: {
    add: supported,
    remove: { status: 'planned', rejects: true },
    list: supported,
    setActive: { status: 'planned', rejects: true },
    setModel: { status: 'planned' },
    setGlobalCustomInstructionsEnabled: { status: 'planned' },
    getInstructionPrecedence: { status: 'planned' },
    // Browser prompt() stands in for the native folder picker.
    selectDirectory: supported,
    openWindow: supported,
    onMindChanged: { status: 'planned' },
  },
  mindProfile: {
    get: { status: 'desktop-only', rejects: true },
    saveFile: { status: 'desktop-only' },
    pickAvatarImage: { status: 'desktop-only' },
    saveAvatar: { status: 'desktop-only' },
    removeAvatar: { status: 'desktop-only' },
    restart: { status: 'desktop-only', rejects: true },
  },
  mindMemory: {
    read: { status: 'desktop-only', rejects: true },
  },
  lens: {
    getViews: { status: 'planned' },
    getViewData: { status: 'planned' },
    refreshView: { status: 'planned' },
    sendAction: { status: 'planned', rejects: true },
    getCanvasUrl: { status: 'planned' },
    getDisabledViewIds: { status: 'planned' },
    setViewEnabled: { status: 'planned' },
    onViewsChanged: { status: 'planned' },
    onVisibilityChanged: { status: 'planned' },
  },
  auth: {
    getStatus: supported,
    listAccounts: supported,
    startLogin: supported,
    cancelLogin: supported,
    switchAccount: supported,
    logout: supported,
    onProgress: supported,
    onAccountSwitchStarted: supported,
    onAccountSwitched: supported,
    onLoggedOut: supported,
  },
  genesis: {
    getDefaultPath: { status: 'desktop-only' },
    pickPath: { status: 'desktop-only' },
    listTemplates: { status: 'desktop-only' },
    create: { status: 'desktop-only' },
    createFromTemplate: { status: 'desktop-only' },
    onProgress: { status: 'desktop-only' },
  },
  marketplace: {
    listGenesisRegistries: { status: 'desktop-only' },
    addGenesisRegistry: { status: 'desktop-only' },
    refreshGenesisRegistry: { status: 'desktop-only' },
    setGenesisRegistryEnabled: { status: 'desktop-only' },
    removeGenesisRegistry: { status: 'desktop-only' },
  },
  userProfile: {
    get: { status: 'planned' },
    // Converted from a fabricated-success stub that silently dropped edits.
    save: { status: 'planned', rejects: true },
    importFromMicrosoft: { status: 'desktop-only' },
  },
  tools: {
    list: { status: 'planned' },
    install: { status: 'desktop-only' },
    uninstall: { status: 'desktop-only' },
  },
  tasks: {
    list: { status: 'planned' },
    get: { status: 'planned' },
    cancel: { status: 'planned' },
    audit: { status: 'planned' },
  },
  chatroom: {
    send: { status: 'planned', rejects: true },
    history: { status: 'planned' },
    taskLedger: { status: 'planned' },
    clear: { status: 'planned', rejects: true },
    stop: { status: 'planned', rejects: true },
    setOrchestration: { status: 'planned', rejects: true },
    getOrchestration: { status: 'planned' },
    onEvent: { status: 'planned' },
    setMindEnabled: { status: 'planned', rejects: true },
    getDisabledMindIds: { status: 'planned' },
    onStateChanged: { status: 'planned' },
  },
  operatorActivity: {
    getSnapshot: { status: 'planned' },
    onChanged: { status: 'planned' },
  },
  updater: {
    getState: { status: 'desktop-only' },
    check: { status: 'desktop-only' },
    download: { status: 'desktop-only' },
    installAndRestart: { status: 'desktop-only' },
    onStateChanged: { status: 'desktop-only' },
  },
  a2a: {
    onIncoming: { status: 'planned' },
    listAgents: { status: 'planned' },
    onTaskStatusUpdate: { status: 'planned' },
    onTaskArtifactUpdate: { status: 'planned' },
    getTask: { status: 'planned' },
    listTasks: { status: 'planned' },
    cancelTask: { status: 'planned' },
    relayStatus: { status: 'planned' },
    relayConnect: { status: 'planned' },
    relayDisconnect: { status: 'planned' },
    onRelayStateChanged: { status: 'planned' },
  },
  byoLlm: {
    get: { status: 'desktop-only' },
    save: { status: 'desktop-only' },
    disable: { status: 'desktop-only' },
    probe: { status: 'desktop-only' },
    restartAgents: { status: 'desktop-only' },
    onChanged: { status: 'desktop-only' },
  },
  voice: {
    getConfig: { status: 'desktop-only' },
    saveConfig: { status: 'desktop-only', rejects: true },
    onConfigChanged: { status: 'desktop-only' },
    getPermissionState: { status: 'desktop-only' },
    openMicPreferences: { status: 'desktop-only', rejects: true },
    getModelStatus: { status: 'desktop-only' },
    downloadModel: { status: 'desktop-only', rejects: true },
    cancelDownload: { status: 'desktop-only', rejects: true },
    startSession: { status: 'desktop-only', rejects: true },
    appendAudio: { status: 'desktop-only', rejects: true },
    endSession: { status: 'desktop-only', rejects: true },
    testMic: { status: 'desktop-only' },
    onModelProgress: { status: 'desktop-only' },
    onTranscript: { status: 'desktop-only' },
  },
  window: {
    minimize: { status: 'desktop-only', rejects: true },
    maximize: { status: 'desktop-only', rejects: true },
    close: supported,
  },
  app: {
    getFeatureFlags: supported,
    onStartupProgress: supported,
  },
  skills: {
    listForMind: { status: 'planned' },
    listForMindDetails: { status: 'planned' },
    browseMarketplace: { status: 'planned' },
    // Authoring is desktop-backed. No server route is wired yet, so reads reject
    // and writes return an honest failure result (never a fabricated success).
    getSource: { status: 'planned', rejects: true },
    save: { status: 'planned' },
  },
  mcp: {
    getServers: { status: 'planned' },
    // Converted from an echo stub that silently dropped edits.
    setServers: { status: 'planned', rejects: true },
  },
} satisfies BrowserCapabilityManifest;

type ManifestRecord = Record<string, Record<string, BrowserCapability>>;

/** Looks up the declared browser-host capability for a namespace and method. */
export function getBrowserCapability(
  namespace: string,
  method: string,
): BrowserCapability | undefined {
  return (BROWSER_CAPABILITY_MANIFEST as ManifestRecord)[namespace]?.[method];
}

export interface BrowserCapabilityEntry {
  readonly namespace: string;
  readonly method: string;
  readonly capability: BrowserCapability;
}

/** Flattens the manifest into iterable `{ namespace, method, capability }` rows. */
export function browserCapabilityEntries(): BrowserCapabilityEntry[] {
  const entries: BrowserCapabilityEntry[] = [];
  for (const [namespace, methods] of Object.entries(BROWSER_CAPABILITY_MANIFEST as ManifestRecord)) {
    for (const [method, capability] of Object.entries(methods)) {
      entries.push({ namespace, method, capability });
    }
  }
  return entries;
}
