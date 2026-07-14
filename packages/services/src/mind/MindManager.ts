// MindManager — aggregate root for multi-mind runtime.
// Owns Map<mindId, InternalMindContext>, lifecycle, persistence.

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PermissionHandler, ResumeSessionConfig, SessionConfig } from '@github/copilot-sdk';
import { parseModelSelectionKey } from '@chamber/shared/model-selection';
import { isStaleSessionError } from '@chamber/shared/sessionErrors';
import type { AppConfig, ChamberConversationRecord, ChatMessage, ConversationEventRef, ConversationForkRef, ConversationResumeResult, ConversationSummary, MessageVariant, MessageVariantGroup, MindContext, MindInstructionPrecedence, MindRecord, ModelProvider, ModelSelection } from '@chamber/shared/types';
import { Logger } from '../logger';
import type { InternalMindContext, CopilotClient, CopilotSession, Tool, UserInputHandler } from './types';
import { generateMindId } from './generateMindId';
import { loadMcpServersFromMindPath } from './mcpConfig';
import { loadChamberMindConfig } from './chamberMindConfig';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import { approveForSessionCompat } from '../sdk/approveForSessionCompat';
import type { IdentityLoader } from '../chat/IdentityLoader';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext } from '../chat/currentDateTimeContext';
import { mapSessionEventsToChatMessages } from '../chat/sessionTranscript';
import { ConversationForkSeedStore } from '../chat/ConversationForkSeedStore';
import { MessageVariantStore } from '../chat/MessageVariantStore';
import { buildConversationForkSeed, buildConversationForkSeedFromMessages, findConversationForkSourceMessage, type ConversationForkSeed } from '../chat/conversationForkContext';
import { deriveVariantTail } from '@chamber/shared/messageVariants';
import type { ChamberToolProvider } from '../chamberTools';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';
import { bootstrapMindCapabilities } from '../lens/MindBootstrap';
import type { SdkProviderConfig } from '../byo-llm/buildProviderConfig';
import { MindScaffold } from '../genesis/MindScaffold';
import type { ManagedSkillService } from '../skills/ManagedSkillService';
import type { IMindTrustService, MindSourceCategory } from '../mindTrust/types';

const log = Logger.create('MindManager');
const COPILOT_RUNTIME_CONFIG_DIR = 'copilot-runtime';
const ISOLATED_PROMPT_TIMEOUT_MS = 120_000;

type MindSessionKind = 'conversation' | 'task' | 'chatroom' | 'isolated-prompt';

interface MindSessionPolicy {
  persistsConversation: boolean;
  ownsActiveSession: boolean;
  disconnectsAfterUse: boolean;
  purpose: string;
}

interface CreateMindSessionRequest {
  kind: MindSessionKind;
  mindId: string;
  client: CopilotClient;
  mindPath: string;
  systemMessage: string;
  tools: Tool[];
  onUserInputRequest?: UserInputHandler;
  onPermissionRequest?: PermissionHandler;
  useSetApproveAllShortcut?: boolean;
  model?: string;
  modelProvider?: ModelProvider;
  sessionId?: string;
}

interface ConversationForkSeedStorePort {
  save(mindId: string, sessionId: string, seed: ConversationForkSeed): Promise<void>;
  read(mindId: string, sessionId: string): Promise<ConversationForkSeed | null>;
  delete(mindId: string, sessionId: string): Promise<void>;
}

interface MessageVariantStorePort {
  read(mindId: string, sessionId: string): Promise<MessageVariantGroup[]>;
  save(mindId: string, sessionId: string, groups: MessageVariantGroup[]): Promise<void>;
  delete(mindId: string, sessionId: string): Promise<void>;
}

const MIND_SESSION_POLICIES: Record<MindSessionKind, MindSessionPolicy> = {
  conversation: {
    persistsConversation: true,
    ownsActiveSession: true,
    disconnectsAfterUse: false,
    purpose: 'Interactive mind chat persisted in Chamber conversation history.',
  },
  task: {
    persistsConversation: false,
    ownsActiveSession: false,
    disconnectsAfterUse: false,
    purpose: 'Ephemeral task session for SDK task execution surfaces.',
  },
  chatroom: {
    persistsConversation: false,
    ownsActiveSession: false,
    disconnectsAfterUse: false,
    purpose: 'Ephemeral multi-agent chatroom participant session.',
  },
  'isolated-prompt': {
    persistsConversation: false,
    ownsActiveSession: false,
    disconnectsAfterUse: true,
    purpose: 'Ephemeral automation request/response session isolated from active chat.',
  },
};

/**
 * Returns a copy of the conversation with an optional boolean flag set to `true`,
 * or with the flag omitted entirely when `value` is false, so persisted records
 * stay clean (mirrors the omit-when-false idiom used across the config layer).
 */
function withConversationFlag(
  conversation: ChamberConversationRecord,
  key: 'isPinned' | 'isArchived',
  value: boolean,
): ChamberConversationRecord {
  if (value) return { ...conversation, [key]: true };
  const next = { ...conversation };
  delete next[key];
  return next;
}

/**
 * Returns a copy of the conversation with a per-conversation system prompt
 * override set, or with the field omitted entirely when `value` is empty, so an
 * empty override cleanly falls back to the mind default (mirrors the
 * omit-when-empty idiom used by `normalizeConversationRecord`). `value` is
 * expected to be pre-trimmed by the caller.
 */
function withConversationSystemMessage(
  conversation: ChamberConversationRecord,
  value: string,
): ChamberConversationRecord {
  if (value.length > 0) return { ...conversation, systemMessage: value };
  const next = { ...conversation };
  delete next.systemMessage;
  return next;
}

export class MindManager extends EventEmitter {
  private minds = new Map<string, InternalMindContext>();
  private pathToId = new Map<string, string>();
  private loading = new Map<string, Promise<MindContext>>();
  // Deduplicates concurrent read-only transcript loads for the same
  // `mindId:sessionId`, so history search fan-out and an export cannot resume
  // the same SDK session twice and race each other's teardown.
  private readonly inFlightConversationReads = new Map<string, Promise<ChatMessage[]>>();
  // Serializes per-mind session-lifecycle mutations (resume, delete, and
  // read-only transcript loads) so a background read can never resume or
  // disconnect an SDK session id while a resume/delete is concurrently
  // promoting that same id to the mind's active session. The SDK keys live
  // sessions by id and `disconnect()` destroys the shared runtime session, so
  // these operations must not interleave for a given mind.
  private readonly sessionLifecycleLocks = new Map<string, Promise<unknown>>();
  // Lowercased+NFC display names held by in-flight `loadMind({enforceUnique:true})`
  // calls. Two concurrent uniqueness-enforcing loads with colliding identity
  // names would otherwise both pass the `this.minds`-only check because neither
  // is in `this.minds` until much later in `doLoadMind`. The reservation closes
  // that race so exactly one of the concurrent loads succeeds.
  private pendingNames = new Set<string>();
  private knownMindRecords = new Map<string, MindRecord>();
  private activeMindId: string | null = null;
  private persistedActiveMindId: string | null = null;
  private restorePromise: Promise<void> | null = null;
  private reloading = false;
  private providers: ChamberToolProvider[] = [];
  private modelUpdates = new Map<string, Promise<void>>();
  private readonly forkSeedStore: ConversationForkSeedStorePort;
  private readonly variantStore: MessageVariantStorePort;
  /** In-memory one-shot fork seeds pending injection after a promote-on-continue, keyed by mindId. */
  private readonly pendingVariantSeeds = new Map<string, ConversationForkSeed>();

  constructor(
    private readonly clientFactory: CopilotClientFactory,
    private readonly identityLoader: IdentityLoader,
    private readonly configService: ConfigService,
    private readonly viewDiscovery: ViewDiscovery,
    /**
     * BYO LLM SDK provider config. Returns the config when BYO is enabled and
     * configured, or null when the bundled GitHub Copilot model catalog should
     * be used.
     *
     * This is the AUTHORITATIVE BYOK activation path for SDK-spawned CLI
     * processes — `provider` MUST be passed into `client.createSession({...})`
     * for the CLI to route inference to the BYO endpoint. The CLI's
     * `COPILOT_PROVIDER_*` env vars only affect standalone CLI invocations,
     * NOT the SDK's `createSession` server-mode path. See
     *   node_modules/@github/copilot-sdk/dist/types.d.ts (ProviderConfig)
     *   https://github.com/github/copilot-sdk/blob/main/nodejs/README.md#custom-providers
     * for the contract.
     */
    private readonly byoProviderConfigProvider: () => SdkProviderConfig | null = () => null,
    /**
     * Default model fallback for BYO LLM. Returns the saved BYO config's model
     * field, used when a mind has no per-mind selectedModel. Required because
     * the SDK rejects createSession({provider}) without a model argument.
     */
    private readonly byoDefaultModelProvider: () => string | undefined = () => undefined,
    private readonly managedSkillService?: Pick<ManagedSkillService, 'installIntoMind'>,
    forkSeedStore?: ConversationForkSeedStorePort,
    variantStore?: MessageVariantStorePort,
    private readonly trustService?: IMindTrustService,
  ) {
    super();
    this.forkSeedStore = forkSeedStore ?? new ConversationForkSeedStore({
      storageRoot: path.join(this.configService.getConfigDir(), 'conversation-fork-seeds'),
    });
    this.variantStore = variantStore ?? new MessageVariantStore({
      storageRoot: path.join(this.configService.getConfigDir(), 'message-variants'),
    });
  }

  setProviders(providers: ChamberToolProvider[]): void {
    this.providers = [...providers];
  }

  async loadMind(
    mindPath: string,
    mindId?: string,
    options?: { enforceUnique?: boolean },
  ): Promise<MindContext> {
    const resolvedMindPath = this.resolveMindPath(mindPath);
    const mindPathKey = this.mindPathKey(resolvedMindPath);

    // Deduplicate — return existing mind
    const existingId = this.pathToId.get(mindPathKey);
    if (existingId && this.minds.has(existingId)) {
      const existing = this.minds.get(existingId);
      if (!existing) throw new Error(`Mind ${existingId} not found`);
      return this.toExternalContext(existing);
    }

    // Concurrent guard — return in-flight promise
    const inflight = this.loading.get(mindPathKey);
    if (inflight) return inflight;

    const promise = this.doLoadMind(resolvedMindPath, mindId, options);
    this.loading.set(mindPathKey, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(mindPathKey);
    }
  }

  private async doLoadMind(
    mindPath: string,
    mindId?: string,
    options?: { enforceUnique?: boolean },
  ): Promise<MindContext> {
    const resolvedMindPath = this.resolveMindPath(mindPath);
    const mindPathKey = this.mindPathKey(resolvedMindPath);

    // Use provided ID or generate a new one
    const id = mindId ?? generateMindId(resolvedMindPath);

    // Load identity
    const identity = this.loadIdentityForMind(id, resolvedMindPath);
    if (!identity) {
      throw new Error(`Failed to load identity from ${resolvedMindPath}`);
    }

    // Issue #44 — display-name uniqueness check. Done after identity load
    // and BEFORE clientFactory.createClient so a rejected load does not
    // spawn an SDK subprocess that has to be torn down. Opt-in via
    // `options.enforceUnique` so app-startup replay of persisted records
    // (which may contain legitimate pre-existing duplicates) is unaffected.
    //
    // The `pendingNames` reservation closes the race where two concurrent
    // enforce-unique loads each see an empty `this.minds` for the colliding
    // name (the actual set+get into `this.minds` happens much later, after
    // client/session setup). Without the reservation both would succeed.
    let reservedName: string | undefined;
    if (options?.enforceUnique) {
      const collision = this.findByName(identity.name);
      if (collision && this.mindPathKey(collision.mindPath) !== mindPathKey) {
        throw new Error(
          `An agent named "${identity.name}" already exists. Choose a different name.`,
        );
      }
      const needle = MindManager.nameKey(identity.name);
      if (needle && this.pendingNames.has(needle)) {
        throw new Error(
          `An agent named "${identity.name}" already exists. Choose a different name.`,
        );
      }
      if (needle) {
        this.pendingNames.add(needle);
        reservedName = needle;
      }
    }

    try {
      return await this.doLoadMindInner(resolvedMindPath, mindPathKey, id, identity);
    } finally {
      if (reservedName) this.pendingNames.delete(reservedName);
    }
  }

  private async doLoadMindInner(
    resolvedMindPath: string,
    mindPathKey: string,
    id: string,
    identity: NonNullable<ReturnType<IdentityLoader['load']>>,
  ): Promise<MindContext> {

    try {
      MindScaffold.ensureChamberGitignore(resolvedMindPath);
    } catch (err) {
      log.warn('Mind .chamber gitignore migration failed (non-fatal):', err);
    }

    try {
      bootstrapMindCapabilities(resolvedMindPath);
    } catch (err) {
      log.warn('Mind capability bootstrap failed (non-fatal):', err);
    }

    if (this.managedSkillService) {
      try {
        await this.managedSkillService.installIntoMind(resolvedMindPath);
      } catch (err) {
        log.warn('Marketplace managed skill install failed (non-fatal):', err);
      }
    }

    // Register the mind with the trust service. Creates a pending record if
    // this is the first time the mind has been seen. Must run before any
    // SDK session creation so the trust check in createSessionForMind is
    // based on the registered state, not an absent record.
    const trustSource: MindSourceCategory = this.knownMindRecords.has(id) ? 'local' : 'imported';
    this.trustService?.registerMindLoad(id, resolvedMindPath, trustSource);

    // Create client (no env-var BYOK plumbing — provider is passed via SessionConfig.provider on createSession)
    const client = await this.clientFactory.createClient(resolvedMindPath);

    const sessionTools = this.getSessionTools(id, resolvedMindPath);

    const knownRecord = this.knownMindRecords.get(id);
    const { selectedModel, selectedModelProvider } = this.getRestorableModelSelection(id, knownRecord);
    const createdConversation = knownRecord?.activeSessionId ? null : this.createConversationRecord(id, identity.systemMessage);
    const activeSessionId = knownRecord?.activeSessionId ?? createdConversation?.sessionId;
    if (!activeSessionId) throw new Error(`Failed to create active conversation for mind ${id}`);
    const conversationRecord = createdConversation
      ?? this.ensureConversationRecord(id, activeSessionId, knownRecord?.conversations, identity.systemMessage);
    const conversationSystemMessage = this.getConversationSystemMessage(conversationRecord, identity.systemMessage);
    const activeConversationRecord = conversationRecord.systemMessage === conversationSystemMessage
      ? conversationRecord
      : { ...conversationRecord, systemMessage: conversationSystemMessage };
    const session = knownRecord?.activeSessionId
      ? await this.loadConversationSession(
        client,
        'conversation',
        resolvedMindPath,
        conversationSystemMessage,
        sessionTools,
        activeConversationRecord.sessionId,
        selectedModel,
        selectedModelProvider,
        conversationSystemMessage,
        id,
      )
      : await this.createSessionForMind({
        kind: 'conversation',
        mindId: id,
        client,
        mindPath: resolvedMindPath,
        systemMessage: identity.systemMessage,
        tools: sessionTools,
        model: selectedModel,
        modelProvider: selectedModelProvider,
        sessionId: activeSessionId,
      });

    const context: InternalMindContext = {
      mindId: id,
      mindPath: resolvedMindPath,
      identity,
      status: 'ready',
      selectedModel,
      selectedModelProvider,
      activeSessionId,
      activeSessionSystemMessage: conversationSystemMessage,
      client,
      session,
    };

    this.minds.set(id, context);
    this.pathToId.set(mindPathKey, id);

    // Capture pre-existing knownRecord so the rollback can restore it
    // rather than wiping a real record on a late failure.
    const previousKnownRecord = this.knownMindRecords.get(id);

    try {
      await Promise.all([
        this.activateProviders(id, resolvedMindPath),
        this.viewDiscovery.scan(resolvedMindPath),
      ]);
      this.viewDiscovery.startWatching(resolvedMindPath, () => {
        this.emit('lens:viewsChanged', this.viewDiscovery.getViews(resolvedMindPath), id);
      });

      this.knownMindRecords.set(id, {
        id,
        path: resolvedMindPath,
        ...(selectedModel ? { selectedModel } : {}),
        ...(selectedModelProvider ? { selectedModelProvider } : {}),
        ...this.getGlobalCustomInstructionsOverrideFields(knownRecord),
        activeSessionId,
        conversations: [
          activeConversationRecord,
          ...(knownRecord?.conversations ?? []).filter((conversation) => conversation.sessionId !== activeSessionId),
        ],
      });

      this.persistConfig();
    } catch (err) {
      this.minds.delete(id);
      this.pathToId.delete(mindPathKey);
      this.viewDiscovery.removeMind(resolvedMindPath);
      if (previousKnownRecord) {
        this.knownMindRecords.set(id, previousKnownRecord);
      } else {
        this.knownMindRecords.delete(id);
      }
      await this.releaseProviders(id).catch(() => { /* noop */ });
      await this.clientFactory.destroyClient(client);
      throw err;
    }

    this.emit('mind:loaded', this.toExternalContext(context));
    return this.toExternalContext(context);
  }

  async unloadMind(mindId: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context) {
      const removedKnownRecord = this.knownMindRecords.delete(mindId);
      if (!removedKnownRecord) return;
      if (this.persistedActiveMindId === mindId) {
        this.persistedActiveMindId = this.activeMindId;
      }
      this.persistConfig();
      this.emit('mind:unloaded', mindId);
      return;
    }

    await this.releaseProviders(mindId);

    // Destroy client
    await this.clientFactory.destroyClient(context.client);

    // Remove views/watchers
    this.viewDiscovery.removeMind(context.mindPath);

    // Remove from maps
    this.minds.delete(mindId);
    this.pathToId.delete(this.mindPathKey(context.mindPath));
    this.knownMindRecords.delete(mindId);

    // Update active mind if needed
    if (this.activeMindId === mindId) {
      const remaining = Array.from(this.minds.keys());
      this.activeMindId = remaining.length > 0 ? remaining[0] : null;
    }
    if (this.persistedActiveMindId === mindId) {
      this.persistedActiveMindId = this.activeMindId;
    }

    // Persist
    this.persistConfig();

    this.emit('mind:unloaded', mindId);
  }

  async reloadMind(mindId: string): Promise<MindContext> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const mindPath = context.mindPath;
    const knownRecord = this.knownMindRecords.get(mindId);
    const wasActive = this.activeMindId === mindId;

    await this.releaseProviders(mindId);
    await this.clientFactory.destroyClient(context.client);
    this.viewDiscovery.removeMind(context.mindPath);
    this.minds.delete(mindId);
    this.pathToId.delete(this.mindPathKey(context.mindPath));
    if (knownRecord) this.knownMindRecords.set(mindId, knownRecord);

    this.emit('mind:unloaded', mindId);
    const reloaded = await this.loadMind(mindPath, mindId);
    if (wasActive) this.setActiveMind(mindId);
    return reloaded;
  }

  listMinds(): MindContext[] {
    return Array.from(this.minds.values()).map(m => this.toExternalContext(m));
  }

  /**
   * Case-insensitive lookup of a loaded mind by its display name. Used by
   * IPC adapters to detect duplicate-name collisions during agent creation
   * (issue #44) before the user commits to a new mind directory. Returns
   * `undefined` if no loaded mind has a name matching `name`.
   *
   * Names are compared after NFC normalization, trim, and lowercase so that
   * cross-platform paste differences (macOS NFD vs Windows NFC for accented
   * names like "Café") don't slip a duplicate past the check.
   */
  findByName(name: string): MindContext | undefined {
    const needle = MindManager.nameKey(name);
    if (!needle) return undefined;
    for (const internal of this.minds.values()) {
      if (MindManager.nameKey(internal.identity.name) === needle) {
        return this.toExternalContext(internal);
      }
    }
    return undefined;
  }

  private static nameKey(name: string): string {
    return name.normalize('NFC').trim().toLowerCase();
  }

  getMind(mindId: string): Readonly<InternalMindContext> | undefined {
    return this.minds.get(mindId);
  }

  setActiveMind(mindId: string): void {
    if (this.minds.has(mindId)) {
      this.activeMindId = mindId;
      this.persistedActiveMindId = mindId;
    }
  }

  getActiveMindId(): string | null {
    return this.activeMindId;
  }

  async recreateSession(mindId: string): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const activeConversation = this.getActiveConversationRecord(mindId);
    const replaceSessionId = activeConversation?.hasMessages === false
      ? activeConversation.sessionId
      : undefined;

    return this.createNewConversationSession(mindId, context, replaceSessionId);
  }

  /**
   * Exercises the SDK session-creation path with the mind's current MCP
   * configuration without replacing the active conversation or unloading the
   * mind. A successful result only means the configuration was accepted by this
   * bounded path, not that a connector has completed a live tool call.
   */
  async verifyMcpConfiguration(mindId: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const session = await this.createSessionForMind({
      kind: 'task',
      mindId,
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: this.getSessionTools(mindId, context.mindPath),
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
    });
    // Explicit disposable-session boundary: disconnect() runs in finally on every
    // exit path from this point forward, including any verification work added here
    // in the future. An empty try body is intentional — session creation is the
    // full verification; the boundary exists to enforce the teardown contract for
    // future callers. If disconnect() rejects, the error propagates to
    // McpConnectorOperationsService which maps it to reload-failed and never to
    // configuration-applied.
    try {
      // No additional verification work in this pass; session creation succeeded.
    } finally {
      await session.disconnect();
    }
  }

  async recoverActiveConversationSession(mindId: string): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const activeConversation = this.getActiveConversationRecord(mindId);
    if (activeConversation?.hasMessages === false) {
      return this.recreateSession(mindId);
    }
    if (!context.activeSessionId) {
      return this.createNewConversationSession(mindId, context);
    }
    const activeSystemMessage = context.activeSessionSystemMessage
      ?? activeConversation?.systemMessage
      ?? context.identity.systemMessage;
    if (!activeConversation) {
      this.upsertConversationRecord(mindId, this.ensureConversationRecord(mindId, context.activeSessionId, undefined, activeSystemMessage));
    }

    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const recoveredSession = await this.loadConversationSession(
      context.client,
      'conversation',
      context.mindPath,
      activeSystemMessage,
      sessionTools,
      context.activeSessionId,
      context.selectedModel,
      context.selectedModelProvider,
      activeSystemMessage,
      mindId,
    );
    context.session = recoveredSession;
    context.activeSessionSystemMessage = activeSystemMessage;
    this.touchConversationRecord(mindId, context.activeSessionId, activeSystemMessage);
    this.persistConfig();
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });
    return recoveredSession;
  }

  async startNewConversation(mindId: string): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const refreshedIdentity = this.loadIdentityForMind(mindId, context.mindPath);
    const identityChanged = refreshedIdentity !== null
      && refreshedIdentity.systemMessage !== context.identity.systemMessage;
    if (identityChanged) {
      context.identity = refreshedIdentity;
    }
    const activeConversation = this.getActiveConversationRecord(mindId);
    const canReuseActiveEmptyConversation = activeConversation?.hasMessages === false && !activeConversation.forkOf;
    const draftMatchesCurrentIdentity = canReuseActiveEmptyConversation
      && context.activeSessionSystemMessage === context.identity.systemMessage
      && activeConversation?.systemMessage === context.identity.systemMessage;
    if (canReuseActiveEmptyConversation && context.session && !identityChanged && draftMatchesCurrentIdentity) {
      return context.session;
    }

    if (canReuseActiveEmptyConversation && context.session) {
      // Recreate the SDK session so the model picks up the refreshed system message
      // (e.g. newly installed marketplace tools advertised in ## Tools).
      return this.createNewConversationSession(mindId, context, activeConversation.sessionId);
    }

    return this.createNewConversationSession(mindId, context);
  }

  markActiveConversationHasMessages(mindId: string, prompt: string): void {
    const context = this.minds.get(mindId);
    if (!context?.activeSessionId) return;
    const record = this.knownMindRecords.get(mindId);
    if (!record?.conversations) return;
    const updatedAt = new Date().toISOString();
    const title = this.conversationTitleFromPrompt(prompt);
    this.knownMindRecords.set(mindId, {
      ...record,
      activeSessionId: context.activeSessionId,
      conversations: record.conversations.map((conversation) => {
        if (conversation.sessionId !== context.activeSessionId) return conversation;
        const shouldReplaceTitle = !conversation.title || conversation.title.startsWith('New chat · ');
        return {
          ...conversation,
          ...(shouldReplaceTitle ? { title } : {}),
          hasMessages: true,
          updatedAt,
        };
      }),
    });
    this.persistConfig();
  }

  private async createNewConversationSession(
    mindId: string,
    context: InternalMindContext,
    replaceSessionId?: string,
    conversationOverride?: ChamberConversationRecord,
    beforeActivate?: (sessionId: string) => Promise<void>,
  ): Promise<CopilotSession> {
    const refreshedIdentity = this.loadIdentityForMind(mindId, context.mindPath);
    if (refreshedIdentity) {
      context.identity = refreshedIdentity;
    }
    const conversation = conversationOverride ?? this.createConversationRecord(mindId, context.identity.systemMessage);
    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const nextSession = await this.createSessionForMind({
      kind: 'conversation',
      mindId,
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: sessionTools,
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
      sessionId: conversation.sessionId,
    });
    try {
      await beforeActivate?.(conversation.sessionId);
    } catch (error) {
      await nextSession.disconnect().catch(() => { /* session already disconnected */ });
      throw error;
    }
    context.session = nextSession;
    context.activeSessionId = conversation.sessionId;
    context.activeSessionSystemMessage = context.identity.systemMessage;
    this.upsertConversationRecord(mindId, conversation, replaceSessionId);
    this.persistConfig();
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });
    return context.session;
  }

  async forkConversation(mindId: string, sourceSessionId: string, sourceEventId: string): Promise<ConversationResumeResult> {
    return this.withMindSessionLock(mindId, () => this.forkConversationUnlocked(mindId, sourceSessionId, sourceEventId));
  }

  private async forkConversationUnlocked(
    mindId: string,
    sourceSessionId: string,
    sourceEventId: string,
  ): Promise<ConversationResumeResult> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const record = this.knownMindRecords.get(mindId);
    if (!record) throw new Error(`Mind ${mindId} not found`);
    const sourceConversation = record.conversations?.find((conversation) => conversation.sessionId === sourceSessionId);
    if (!sourceConversation) {
      throw new Error(`Conversation ${sourceSessionId} not found for mind ${mindId}`);
    }

    const sourceMessages = await this.getMessagesForConversationUnlocked(mindId, sourceSessionId, context);
    const sourceMessage = findConversationForkSourceMessage(sourceMessages, sourceEventId);
    const sourceTitle = sourceConversation.title ?? this.defaultConversationTitle(sourceConversation);
    const createdAt = new Date().toISOString();
    const forkOf: ConversationForkRef = {
      sourceSessionId,
      sourceEventId,
      sourceMessageId: sourceMessage.id,
      sourceTitle,
      createdAt,
    };
    const seed = buildConversationForkSeed(sourceMessages, sourceEventId, forkOf);
    const forkConversation = this.createConversationRecord(mindId, context.identity.systemMessage, {
      title: `Fork of ${sourceTitle}`,
      forkOf,
      now: createdAt,
    });
    const nextSession = await this.createNewConversationSession(
      mindId,
      context,
      undefined,
      forkConversation,
      (sessionId) => this.forkSeedStore.save(mindId, sessionId, seed),
    );

    return {
      sessionId: forkConversation.sessionId,
      messages: await this.getMessagesForConversation(mindId, forkConversation.sessionId, nextSession),
      conversations: this.listConversationHistory(mindId),
    };
  }

  async getActiveConversationForkSeed(mindId: string): Promise<ConversationForkSeed | null> {
    const context = this.minds.get(mindId);
    if (!context?.activeSessionId) return null;
    const conversation = this.getActiveConversationRecord(mindId);
    if (!conversation?.forkOf || conversation.hasMessages !== false) return null;
    return this.forkSeedStore.read(mindId, context.activeSessionId);
  }

  /**
   * Freezes the about-to-be-discarded conversation tail as a retained variant
   * before an edit or regenerate truncates it. The tail runs from the re-sent
   * user turn (`userEventId`) to the end of the active conversation; the group is
   * anchored at the turn immediately before it (null when it is the root turn).
   * A no-op when the turn is absent (already truncated) or the same tail was
   * already captured, so a stale-session retry cannot double-capture.
   */
  async captureActiveConversationVariant(mindId: string, userEventId: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context?.session || !context.activeSessionId) return;
    const sessionId = context.activeSessionId;
    const messages = await this.getMessagesForSession(context.session);
    const capture = deriveVariantTail(messages, userEventId);
    if (!capture) return;
    const groups = await this.variantStore.read(mindId, sessionId);
    const group = this.findOrCreateVariantGroup(groups, capture.anchorEventId);
    if (group.frozenVariants.some((variant) => variant.messages[0]?.eventId === capture.tail[0].eventId)) return;
    group.frozenVariants.push(this.freezeVariant(capture.tail));
    await this.variantStore.save(mindId, sessionId, groups);
  }

  /** Retained variant groups for the active conversation, for rendering the version pager. */
  async getConversationVariants(mindId: string): Promise<MessageVariantGroup[]> {
    const context = this.minds.get(mindId);
    if (!context?.activeSessionId) return [];
    return this.variantStore.read(mindId, context.activeSessionId);
  }

  /**
   * Promotes a retained variant to the live branch before the next send. The
   * current active tail is frozen as a sibling, the SDK session is truncated back
   * to the anchor, and the selected variant is staged as a one-shot fork seed so
   * the next send continues from it. Returns the post-truncate conversation.
   */
  async switchActiveConversationVariant(
    mindId: string,
    anchorEventId: string | null,
    variantId: string,
  ): Promise<ConversationResumeResult> {
    const context = this.minds.get(mindId);
    if (!context?.session || !context.activeSessionId) throw new Error(`Mind ${mindId} not found or has no session`);
    const sessionId = context.activeSessionId;
    const groups = await this.variantStore.read(mindId, sessionId);
    const group = groups.find((candidate) => candidate.anchorEventId === anchorEventId);
    if (!group) throw new Error(`Variant group for anchor ${anchorEventId ?? 'root'} not found`);
    const target = group.frozenVariants.find((variant) => variant.variantId === variantId);
    if (!target) throw new Error(`Variant ${variantId} not found`);

    const messages = await this.getMessagesForSession(context.session);
    const tailStart = anchorEventId === null ? 0 : messages.findIndex((message) => message.eventId === anchorEventId) + 1;
    if (anchorEventId !== null && tailStart === 0) {
      throw new Error(`Anchor ${anchorEventId} is no longer present in the active conversation`);
    }
    const activeTail = messages.slice(tailStart);
    if (activeTail.length > 0) {
      const firstTailEventId = activeTail[0].eventId;
      if (!group.frozenVariants.some((variant) => variant.messages[0]?.eventId === firstTailEventId)) {
        group.frozenVariants.push(this.freezeVariant(activeTail));
      }
      await this.variantStore.save(mindId, sessionId, groups);
      if (firstTailEventId) await this.truncateAndRefreshHasMessages(mindId, context.session, firstTailEventId);
    }

    const seedFork: ConversationForkRef = {
      sourceSessionId: sessionId,
      sourceEventId: anchorEventId ?? '',
      sourceMessageId: target.messages[0]?.id ?? '',
      sourceTitle: this.getActiveConversationRecord(mindId)?.title ?? 'Prior version',
      createdAt: new Date().toISOString(),
    };
    this.pendingVariantSeeds.set(mindId, buildConversationForkSeedFromMessages(target.messages, seedFork));

    return {
      sessionId,
      messages: await this.getMessagesForConversation(mindId, sessionId, context.session),
      conversations: this.listConversationHistory(mindId),
    };
  }

  /** Returns and clears the one-shot fork seed staged by a variant promotion, if any. */
  consumePendingVariantSeed(mindId: string): ConversationForkSeed | null {
    const seed = this.pendingVariantSeeds.get(mindId);
    this.pendingVariantSeeds.delete(mindId);
    return seed ?? null;
  }

  private findOrCreateVariantGroup(groups: MessageVariantGroup[], anchorEventId: string | null): MessageVariantGroup {
    const existing = groups.find((group) => group.anchorEventId === anchorEventId);
    if (existing) return existing;
    const created: MessageVariantGroup = { groupId: randomUUID(), anchorEventId, frozenVariants: [] };
    groups.push(created);
    return created;
  }

  private freezeVariant(messages: ChatMessage[]): MessageVariant {
    return { variantId: randomUUID(), createdAt: new Date().toISOString(), messages };
  }

  private async truncateAndRefreshHasMessages(mindId: string, session: CopilotSession, eventId: string): Promise<void> {
    await session.rpc.history.truncate({ eventId });
    try {
      const remaining = await this.getMessagesForSession(session);
      this.updateActiveConversationHasMessages(mindId, remaining.length > 0);
    } catch (error) {
      log.warn(`Switched variant for mind ${mindId} but could not refresh message state`, error);
    }
  }

  async resumeConversation(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    return this.withMindSessionLock(mindId, () => this.resumeConversationUnlocked(mindId, sessionId));
  }

  private async resumeConversationUnlocked(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const record = this.knownMindRecords.get(mindId);
    if (!record?.conversations?.some((conversation) => conversation.sessionId === sessionId)) {
      throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    }

    if (context.activeSessionId === sessionId && context.session) {
      this.touchConversationRecord(mindId, sessionId);
      this.persistConfig();
      return {
        sessionId,
        messages: await this.getMessagesForConversation(mindId, sessionId, context.session),
        conversations: this.listConversationHistory(mindId),
      };
    }

    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const conversation = record.conversations.find((candidate) => candidate.sessionId === sessionId);
    if (!conversation) throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    const conversationSystemMessage = this.getConversationSystemMessage(conversation, context.identity.systemMessage);
    const nextSession = await this.loadConversationSession(
      context.client,
      'conversation',
      context.mindPath,
      conversationSystemMessage,
      sessionTools,
      conversation.sessionId,
      context.selectedModel,
      context.selectedModelProvider,
      conversationSystemMessage,
      mindId,
    );
    context.session = nextSession;
    context.activeSessionId = sessionId;
    context.activeSessionSystemMessage = conversationSystemMessage;
    this.touchConversationRecord(mindId, sessionId, conversationSystemMessage);
    this.persistConfig();
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });

    return {
      sessionId,
      messages: await this.getMessagesForConversation(mindId, sessionId, nextSession),
      conversations: this.listConversationHistory(mindId),
    };
  }

  /**
   * Read a conversation's messages without changing the mind's active session.
   * The active conversation is read from its live session; any other
   * conversation is resumed into a throwaway session that is disconnected once
   * its transcript is read, so the user's current chat is never disturbed.
   * Used by history search (content lookup) and export.
   *
   * Safety against a background read tearing down a conversation the user just
   * opened rests on three properties:
   *   1. Concurrent reads of the same session are deduplicated via
   *      `inFlightConversationReads`, so only one throwaway session exists.
   *   2. The throwaway resume/read/disconnect runs under the per-mind
   *      `sessionLifecycleLocks`, so it cannot interleave with a `resume`/
   *      `delete` that promotes the same id to active. The read either runs
   *      fully before the promotion (and safely disconnects its own throwaway)
   *      or fully after it (and observes the id as active, reading the live
   *      session instead of resuming a rival).
   *   3. Inside the lock we re-check the active session before touching it, so
   *      a promotion that landed first is honored.
   */
  async getConversationMessages(mindId: string, sessionId: string): Promise<ChatMessage[]> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const record = this.knownMindRecords.get(mindId);
    if (!record?.conversations?.some((conversation) => conversation.sessionId === sessionId)) {
      throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    }

    if (context.activeSessionId === sessionId && context.session) {
      return this.getMessagesForConversation(mindId, sessionId, context.session);
    }

    const key = `${mindId}:${sessionId}`;
    const existing = this.inFlightConversationReads.get(key);
    if (existing) return existing;

    const load = this.withMindSessionLock(mindId, () => this.readConversationMessagesReadOnly(mindId, sessionId, context))
      .finally(() => this.inFlightConversationReads.delete(key));
    this.inFlightConversationReads.set(key, load);
    return load;
  }

  private async getMessagesForConversationUnlocked(
    mindId: string,
    sessionId: string,
    context: InternalMindContext,
  ): Promise<ChatMessage[]> {
    const current = this.minds.get(mindId);
    if (current?.activeSessionId === sessionId && current.session) {
      return this.getMessagesForConversation(mindId, sessionId, current.session);
    }
    return this.readConversationMessagesReadOnly(mindId, sessionId, context);
  }

  /**
   * Serialize a session-lifecycle operation for a single mind, mirroring the
   * per-mind queue used by `setMindModel`. Operations for different minds run
   * concurrently; operations for the same mind run one at a time in call order.
   */
  private async withMindSessionLock<T>(mindId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionLifecycleLocks.get(mindId) ?? Promise.resolve();
    let release: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current, () => current);
    this.sessionLifecycleLocks.set(mindId, queued);
    await previous.catch(() => { /* previous caller observes its own failure */ });

    try {
      return await operation();
    } finally {
      release!();
      if (this.sessionLifecycleLocks.get(mindId) === queued) {
        this.sessionLifecycleLocks.delete(mindId);
      }
    }
  }

  private async readConversationMessagesReadOnly(
    mindId: string,
    sessionId: string,
    context: InternalMindContext,
  ): Promise<ChatMessage[]> {
    // Under the per-mind lock, no resume/delete can run concurrently. Still
    // re-check: a resume/delete that ran just before us may have already
    // promoted this session to active, in which case read the live session
    // rather than resuming a rival throwaway for the same id.
    const beforeLoad = this.minds.get(mindId);
    if (beforeLoad?.activeSessionId === sessionId && beforeLoad.session) {
      return this.getMessagesForConversation(mindId, sessionId, beforeLoad.session);
    }

    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const record = this.knownMindRecords.get(mindId);
    const conversation = record?.conversations?.find((candidate) => candidate.sessionId === sessionId);
    const conversationSystemMessage = conversation
      ? this.getConversationSystemMessage(conversation, context.identity.systemMessage)
      : context.identity.systemMessage;
    const readOnlySession = await this.loadConversationSession(
      context.client,
      'conversation',
      context.mindPath,
      conversationSystemMessage,
      sessionTools,
      sessionId,
      context.selectedModel,
      context.selectedModelProvider,
      conversationSystemMessage,
      mindId,
    );
    try {
      return await this.getMessagesForConversation(mindId, sessionId, readOnlySession);
    } finally {
      // The lock guarantees no live session adopted this id while we read, so
      // disconnecting our throwaway cannot tear down an active conversation.
      // The active-session guard is defense in depth for the read-after-promote
      // ordering handled above.
      const current = this.minds.get(mindId);
      const promotedToActive = current?.activeSessionId === sessionId && Boolean(current.session);
      if (!promotedToActive) {
        await readOnlySession.disconnect().catch(() => { /* session already disconnected */ });
      }
    }
  }

  listConversationHistory(mindId: string): ConversationSummary[] {
    const context = this.minds.get(mindId);
    const record = this.knownMindRecords.get(mindId);
    const activeSessionId = context?.activeSessionId ?? record?.activeSessionId;
    return [...(record?.conversations ?? [])]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((conversation) => ({
        sessionId: conversation.sessionId,
        title: conversation.title ?? this.defaultConversationTitle(conversation),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        kind: conversation.kind,
        active: conversation.sessionId === activeSessionId,
        hasMessages: conversation.hasMessages,
        ...(conversation.forkOf ? { forkOf: conversation.forkOf } : {}),
        ...(conversation.isPinned ? { isPinned: true } : {}),
        ...(conversation.isArchived ? { isArchived: true } : {}),
        ...(conversation.systemMessage ? { systemMessage: conversation.systemMessage } : {}),
      }));
  }

  renameConversation(mindId: string, sessionId: string, title: string): ConversationSummary[] {
    const updatedAt = new Date().toISOString();
    return this.updateConversationRecord(mindId, sessionId,
      (conversation) => ({ ...conversation, title: title.trim(), updatedAt }));
  }

  /** Pins or unpins a conversation, persisting through the same path as rename. */
  setPinnedConversation(mindId: string, sessionId: string, pinned: boolean): ConversationSummary[] {
    return this.updateConversationRecord(mindId, sessionId, (conversation) =>
      withConversationFlag(conversation, 'isPinned', pinned));
  }

  /** Archives or unarchives a conversation, persisting through the same path as rename. */
  setArchivedConversation(mindId: string, sessionId: string, archived: boolean): ConversationSummary[] {
    return this.updateConversationRecord(mindId, sessionId, (conversation) =>
      withConversationFlag(conversation, 'isArchived', archived));
  }

  /**
   * Sets or clears a per-conversation system prompt override. When the target is
   * the live active conversation, its SDK session is rebound first so the change
   * applies immediately (mirroring how a model change rebinds the active session);
   * only after the rebind succeeds is the override persisted through the same
   * metadata path as pin/archive (recency preserved). Rebinding before persisting
   * keeps the operation atomic: a failed session load leaves disk, session, and
   * store untouched, matching the resume/recover lifecycle. An empty or whitespace
   * value clears the override so the conversation falls back to the mind default.
   */
  async setConversationSystemMessage(mindId: string, sessionId: string, systemMessage: string): Promise<ConversationSummary[]> {
    return this.withMindSessionLock(mindId, async () => {
      const trimmed = systemMessage.trim();
      await this.rebindActiveSessionSystemMessage(mindId, sessionId, trimmed);
      return this.updateConversationRecord(mindId, sessionId, (conversation) =>
        withConversationSystemMessage(conversation, trimmed));
    });
  }

  /**
   * Rebinds the mind's live active session with the effective system prompt
   * (`override || mind default`) when `sessionId` is the active conversation, so
   * a per-conversation override applies to the current chat without waiting for a
   * resume. No-op for non-active conversations, which pick up the persisted
   * override on their next resume. Mirrors the resume/disconnect lifecycle used
   * by `recoverActiveConversationSession`.
   */
  private async rebindActiveSessionSystemMessage(mindId: string, sessionId: string, override: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context || context.activeSessionId !== sessionId) return;
    const effective = override.length > 0 ? override : context.identity.systemMessage;
    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const reboundSession = await this.loadConversationSession(
      context.client,
      'conversation',
      context.mindPath,
      effective,
      sessionTools,
      sessionId,
      context.selectedModel,
      context.selectedModelProvider,
      effective,
      mindId,
    );
    context.session = reboundSession;
    context.activeSessionSystemMessage = effective;
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });
  }

  /**
   * Applies `update` to a single Chamber-owned conversation record and persists,
   * returning the refreshed history. The `update` callback decides which fields
   * change: rename passes a fresh `updatedAt`, while metadata-only edits (pin,
   * archive) deliberately preserve `updatedAt` so recency ordering is not
   * disturbed by organizing.
   */
  private updateConversationRecord(
    mindId: string,
    sessionId: string,
    update: (conversation: ChamberConversationRecord) => ChamberConversationRecord,
  ): ConversationSummary[] {
    const record = this.knownMindRecords.get(mindId);
    if (!record) throw new Error(`Mind ${mindId} not found`);
    const conversations = record.conversations ?? [];
    if (!conversations.some((conversation) => conversation.sessionId === sessionId)) {
      throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    }
    this.knownMindRecords.set(mindId, {
      ...record,
      conversations: conversations.map((conversation) =>
        conversation.sessionId === sessionId ? update(conversation) : conversation),
    });
    this.persistConfig();
    return this.listConversationHistory(mindId);
  }

  async deleteConversation(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    return this.withMindSessionLock(mindId, () => this.deleteConversationUnlocked(mindId, sessionId));
  }

  private async deleteConversationUnlocked(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const record = this.knownMindRecords.get(mindId);
    if (!record) throw new Error(`Mind ${mindId} not found`);
    const conversations = record.conversations ?? [];
    const deletingConversation = conversations.find((conversation) => conversation.sessionId === sessionId);
    if (!deletingConversation) {
      throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    }

    const remainingConversations = conversations.filter((conversation) => conversation.sessionId !== sessionId);
    if (context.activeSessionId !== sessionId) {
      this.knownMindRecords.set(mindId, {
        ...record,
        conversations: remainingConversations,
      });
      this.persistConfig();
      await this.deleteForkSeed(mindId, deletingConversation.sessionId);
      await this.deleteSdkSession(context, deletingConversation.sessionId);
      return {
        sessionId: context.activeSessionId ?? '',
        messages: context.session && context.activeSessionId
          ? await this.getMessagesForConversation(mindId, context.activeSessionId, context.session)
          : [],
        conversations: this.listConversationHistory(mindId),
      };
    }

    const { activeSessionId: _deletedActiveSessionId, ...recordWithoutActiveSession } = record;
    void _deletedActiveSessionId;
    this.knownMindRecords.set(mindId, {
      ...recordWithoutActiveSession,
      conversations: remainingConversations,
    });

    if (remainingConversations.length === 0) {
      await this.createNewConversationSession(mindId, context);
      await this.deleteForkSeed(mindId, deletingConversation.sessionId);
      await this.deleteSdkSession(context, deletingConversation.sessionId);
      return {
        sessionId: context.activeSessionId ?? '',
        messages: [],
        conversations: this.listConversationHistory(mindId),
      };
    }

    const nextConversation = [...remainingConversations]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const nextSystemMessage = this.getConversationSystemMessage(nextConversation, context.identity.systemMessage);
    const nextSession = await this.loadConversationSession(
      context.client,
      'conversation',
      context.mindPath,
      nextSystemMessage,
      sessionTools,
      nextConversation.sessionId,
      context.selectedModel,
      context.selectedModelProvider,
      nextSystemMessage,
      mindId,
    );
    context.session = nextSession;
    context.activeSessionId = nextConversation.sessionId;
    context.activeSessionSystemMessage = nextSystemMessage;
    this.touchConversationRecord(mindId, nextConversation.sessionId, nextSystemMessage);
    this.persistConfig();
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });
    await this.deleteForkSeed(mindId, deletingConversation.sessionId);
    await this.deleteSdkSession(context, deletingConversation.sessionId);

    return {
      sessionId: nextConversation.sessionId,
      messages: await this.getMessagesForConversation(mindId, nextConversation.sessionId, nextSession),
      conversations: this.listConversationHistory(mindId),
    };
  }

  /**
   * Persisted user/assistant turns for the mind's active conversation, mapped
   * to chat messages (text-only, carrying their backing SDK event ids). Used
   * to reconcile live messages with event ids and to resolve the most recent
   * user turn for regeneration.
   */
  async getActiveConversationMessages(mindId: string): Promise<ChatMessage[]> {
    const context = this.minds.get(mindId);
    if (!context?.session) return [];
    return this.getMessagesForSession(context.session);
  }

  /** Ordered references to persisted user/assistant turns for the active conversation. */
  async getConversationEventRefs(mindId: string): Promise<ConversationEventRef[]> {
    const messages = await this.getActiveConversationMessages(mindId);
    const refs: ConversationEventRef[] = [];
    for (const message of messages) {
      if (message.eventId) {
        refs.push({ eventId: message.eventId, messageId: message.id, role: message.role });
      }
    }
    return refs;
  }

  /**
   * Truncates the active conversation's persisted history to `eventId` — the
   * SDK removes that event and every later one — then refreshes the record's
   * hasMessages flag. Returns the updated conversation summaries.
   */
  async truncateActiveConversation(mindId: string, eventId: string): Promise<ConversationSummary[]> {
    const context = this.minds.get(mindId);
    if (!context?.session) throw new Error(`Mind ${mindId} not found or has no session`);
    await context.session.rpc.history.truncate({ eventId });
    // The truncate above is the commit point and is not idempotent (a second
    // truncate to the same, now-removed, event would drop further turns). If
    // reading back the remaining events fails — e.g. the session goes stale
    // immediately after — swallow it rather than rethrow: a thrown truncate
    // signals "not done yet" to callers, who would then retry and truncate
    // again. We only lose the hasMessages refresh, which the next settled turn
    // repairs.
    try {
      const remaining = await this.getMessagesForSession(context.session);
      this.updateActiveConversationHasMessages(mindId, remaining.length > 0);
    } catch (error) {
      log.warn(`Truncated conversation for mind ${mindId} but could not refresh message state`, error);
    }
    return this.listConversationHistory(mindId);
  }

  private updateActiveConversationHasMessages(mindId: string, hasMessages: boolean): void {
    const context = this.minds.get(mindId);
    const record = this.knownMindRecords.get(mindId);
    const activeSessionId = context?.activeSessionId ?? record?.activeSessionId;
    if (!record?.conversations || !activeSessionId) return;
    const updatedAt = new Date().toISOString();
    this.knownMindRecords.set(mindId, {
      ...record,
      conversations: record.conversations.map((conversation) =>
        conversation.sessionId === activeSessionId
          ? { ...conversation, hasMessages, updatedAt }
          : conversation,
      ),
    });
    this.persistConfig();
  }

  private async deleteForkSeed(mindId: string, sessionId: string): Promise<void> {
    try {
      await this.forkSeedStore.delete(mindId, sessionId);
    } catch (error) {
      log.warn(`Failed to delete fork seed for conversation ${sessionId}; conversation metadata was already updated.`, error);
    }
    try {
      await this.variantStore.delete(mindId, sessionId);
    } catch (error) {
      log.warn(`Failed to delete retained variants for conversation ${sessionId}; conversation metadata was already updated.`, error);
    }
  }

  async setMindModel(mindId: string, model: string | null): Promise<MindContext | null> {
    const previousUpdate = this.modelUpdates.get(mindId) ?? Promise.resolve();
    let releaseUpdate: () => void;
    const currentUpdate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    const queuedUpdate = previousUpdate.then(() => currentUpdate, () => currentUpdate);
    this.modelUpdates.set(mindId, queuedUpdate);
    await previousUpdate.catch(() => { /* previous caller observes its own failure */ });

    try {
      return await this.setMindModelUnlocked(mindId, model);
    } finally {
      releaseUpdate!();
      if (this.modelUpdates.get(mindId) === queuedUpdate) {
        this.modelUpdates.delete(mindId);
      }
    }
  }

  private async setMindModelUnlocked(mindId: string, model: string | null): Promise<MindContext | null> {
    const context = this.minds.get(mindId);
    const selection = this.normalizeModelSelection(model);
    const selectedModel = selection?.id;
    const selectedModelProvider = selection?.provider;

    if (selectedModelProvider === 'byo') {
      this.resolveProviderForSelection(selectedModelProvider);
    }

    if (!context) {
      const existingRecord = this.knownMindRecords.get(mindId);
      if (!existingRecord) return null;
      this.knownMindRecords.set(mindId, {
        id: existingRecord.id,
        path: existingRecord.path,
        ...(selectedModel ? { selectedModel } : {}),
        ...(selectedModelProvider ? { selectedModelProvider } : {}),
        ...this.getGlobalCustomInstructionsOverrideFields(existingRecord),
        ...(existingRecord.activeSessionId ? { activeSessionId: existingRecord.activeSessionId } : {}),
        ...(existingRecord.conversations ? { conversations: existingRecord.conversations } : {}),
      });
      this.persistConfig();
      return null;
    }

    if (context.selectedModel === selectedModel && context.selectedModelProvider === selectedModelProvider) {
      return this.toExternalContext(context);
    }

    const previousModel = context.selectedModel;
    const previousProvider = context.selectedModelProvider;

    // Persist intent before applying so stale-recovery on send uses the new model.
    context.selectedModel = selectedModel;
    context.selectedModelProvider = selectedModelProvider;
    this.upsertMindSelectionRecord(mindId, context);
    this.persistConfig();

    // SDK setModel can change model ids within the same provider, but it cannot
    // swap a session between GitHub/Copilot and a custom BYO provider.
    const providerChanged = previousProvider !== selectedModelProvider;
    try {
      if (context.session && selectedModel && !providerChanged) {
        await context.session.setModel(selectedModel);
      } else if (context.session) {
        const activeConversation = this.getActiveConversationRecord(mindId);
        if (activeConversation?.forkOf && activeConversation.hasMessages === false) {
          await this.createNewConversationSession(mindId, context, activeConversation.sessionId, activeConversation);
        } else {
          await this.createNewConversationSession(mindId, context);
        }
      }
    } catch (err) {
      // Stale-session errors trigger a recovery path that re-creates the
      // session with the *new* model, so keep the persisted selection.
      // For all other errors (e.g. unreachable BYO endpoint, bad config),
      // roll back so the recorded selection matches the live session —
      // otherwise the next send would use a model the SDK already rejected.
      if (!isStaleSessionError(err)) {
        context.selectedModel = previousModel;
        context.selectedModelProvider = previousProvider;
        this.upsertMindSelectionRecord(mindId, context);
        this.persistConfig();
      }
      throw err;
    }

    this.upsertMindSelectionRecord(mindId, context);
    this.persistConfig();

    const external = this.toExternalContext(context);
    this.emit('mind:loaded', external);
    return external;
  }

  async setMindGlobalCustomInstructionsEnabled(mindId: string, enabled: boolean): Promise<MindInstructionPrecedence> {
    await this.awaitRestore();
    const context = this.minds.get(mindId);
    const existingRecord = this.knownMindRecords.get(mindId);
    if (!context && !existingRecord) throw new Error(`Mind ${mindId} not found`);
    const mindPath = context?.mindPath ?? existingRecord?.path;
    if (!mindPath) throw new Error(`Mind ${mindId} not found`);

    const record: MindRecord = existingRecord ?? {
      id: mindId,
      path: mindPath,
      ...(context?.selectedModel ? { selectedModel: context.selectedModel } : {}),
      ...(context?.selectedModelProvider ? { selectedModelProvider: context.selectedModelProvider } : {}),
      ...(context?.activeSessionId ? { activeSessionId: context.activeSessionId } : {}),
    };
    this.knownMindRecords.set(mindId, this.withGlobalCustomInstructionsPreference(record, enabled));
    this.persistConfig();

    if (context) {
      const changed = await this.refreshLoadedMindIdentityContext(context);
      if (changed) this.emit('mind:loaded', this.toExternalContext(context));
    }

    return this.getMindInstructionPrecedence(mindId);
  }

  getMindInstructionPrecedence(mindId: string): MindInstructionPrecedence {
    const context = this.minds.get(mindId);
    const record = this.knownMindRecords.get(mindId);
    const mindPath = context?.mindPath ?? record?.path;
    if (!mindPath) throw new Error(`Mind ${mindId} not found`);

    const precedence = this.identityLoader.getInstructionPrecedence(mindPath, {
      includeGlobalCustomInstructions: this.isGlobalCustomInstructionsEnabledForMind(mindId),
    });
    if (!precedence) throw new Error(`Failed to load identity from ${mindPath}`);

    return {
      mindId,
      mindName: context?.identity.name ?? precedence.mindName,
      globalCustomInstructionsEnabled: precedence.globalCustomInstructionsEnabled,
      hasGlobalCustomInstructions: precedence.hasGlobalCustomInstructions,
      layers: precedence.layers,
    };
  }

  awaitRestore(): Promise<void> {
    return this.restorePromise ?? Promise.resolve();
  }

  async restoreFromConfig(): Promise<void> {
    this.restorePromise = this.doRestore();
    return this.restorePromise;
  }

  async reloadAllMinds(): Promise<void> {
    await this.awaitRestore();

    const existingConfig = this.configService.load();
    const configSnapshot: AppConfig = {
      ...existingConfig,
      version: 2,
      minds: this.getPersistedMindRecords(),
      activeMindId: this.getPersistedActiveMindId(),
    };

    this.reloading = true;
    try {
      const loadedMindIds = Array.from(this.minds.keys());
      for (const mindId of loadedMindIds) {
        await this.unloadMind(mindId);
      }
    } finally {
      this.reloading = false;
    }

    this.activeMindId = null;
    this.configService.save(configSnapshot);
    await this.restoreFromConfig();
  }

  /**
   * Re-read every loaded mind's identity (e.g. after the operator changes global
   * custom instructions) and refresh the cached system message so the next task,
   * chatroom, or new chat session picks up the change without a full mind reload.
   *
   * Empty active chat sessions are recreated in place so the current conversation
   * adopts the change immediately. Conversations that already have messages keep
   * their session and inherit the new instructions on the next new chat, matching
   * the safe recreation policy in `startNewConversation`.
   */
  async refreshLoadedMindIdentities(): Promise<{ refreshedCount: number }> {
    await this.awaitRestore();
    let refreshedCount = 0;
    for (const context of this.minds.values()) {
      if (await this.refreshLoadedMindIdentityContext(context)) refreshedCount += 1;
    }
    return { refreshedCount };
  }

  async refreshLoadedMindIdentity(mindId: string): Promise<boolean> {
    await this.awaitRestore();
    const context = this.minds.get(mindId);
    if (!context) return false;
    return this.refreshLoadedMindIdentityContext(context);
  }

  /**
   * Recreate only sessions that can be affected by a BYO provider change.
   * Enabling/updating BYO does not force cloud-selected minds onto the custom
   * endpoint; disabling BYO clears only BYO-selected minds before reload.
   */
  async restartAllMindsForByoChange(selectedModelOverride?: string | null): Promise<{ restartedCount: number }> {
    await this.awaitRestore();
    const mindIds = selectedModelOverride === null
      ? this.clearByoSelectedModels()
      : this.getLoadedByoMindIds();
    for (const mindId of mindIds) {
      if (this.minds.has(mindId)) {
        await this.reloadMind(mindId);
      }
    }
    return { restartedCount: mindIds.length };
  }

  private getLoadedByoMindIds(): string[] {
    return Array.from(this.minds.values())
      .filter((context) => context.selectedModelProvider === 'byo')
      .map((context) => context.mindId);
  }

  private clearByoSelectedModels(): string[] {
    const changedLoadedMindIds: string[] = [];
    for (const context of this.minds.values()) {
      if (context.selectedModelProvider !== 'byo') continue;
      context.selectedModel = undefined;
      context.selectedModelProvider = undefined;
      changedLoadedMindIds.push(context.mindId);
    }

    let changedRecord = false;
    for (const [mindId, record] of this.knownMindRecords.entries()) {
      if (record.selectedModelProvider !== 'byo') continue;
      const next: MindRecord = { ...record };
      delete next.selectedModel;
      delete next.selectedModelProvider;
      this.knownMindRecords.set(mindId, next);
      changedRecord = true;
    }

    if (changedLoadedMindIds.length > 0 || changedRecord) {
      this.persistConfig();
    }
    return changedLoadedMindIds;
  }

  private async doRestore(): Promise<void> {
    const config = this.configService.load();
    this.knownMindRecords = new Map(config.minds.map(record => [record.id, { ...record }]));
    this.persistedActiveMindId = config.activeMindId;
    for (const record of config.minds) {
      try {
        await this.loadMind(record.path, record.id);
      } catch (err) {
        log.error(`Failed to restore mind at ${record.path}:`, err);
      }
    }

    if (config.activeMindId && this.minds.has(config.activeMindId)) {
      this.activeMindId = config.activeMindId;
    } else if (this.minds.size > 0) {
      this.activeMindId = Array.from(this.minds.keys())[0];
    }
  }

  async shutdown(): Promise<void> {
    // Save config BEFORE destroying anything — preserve mind list for next launch
    this.persistConfig();

    // Clean up resources without persisting (don't call unloadMind which clears config)
    for (const [, context] of this.minds) {
      await this.releaseProviders(context.mindId);
      await this.clientFactory.destroyClient(context.client);
      this.viewDiscovery.removeMind(context.mindPath);
    }
    this.minds.clear();
    this.pathToId.clear();
  }

  // --- Private helpers ---

  private loadIdentityForMind(mindId: string, mindPath: string): NonNullable<ReturnType<IdentityLoader['load']>> | null {
    return this.identityLoader.load(mindPath, {
      includeGlobalCustomInstructions: this.isGlobalCustomInstructionsEnabledForMind(mindId),
    });
  }

  private async refreshLoadedMindIdentityContext(context: InternalMindContext): Promise<boolean> {
    const refreshed = this.loadIdentityForMind(context.mindId, context.mindPath);
    if (!refreshed || refreshed.systemMessage === context.identity.systemMessage) {
      return false;
    }
    await this.withMindSessionLock(context.mindId, async () => {
      const current = this.minds.get(context.mindId);
      if (!current) return;
      current.identity = refreshed;

      const activeConversation = this.getActiveConversationRecord(context.mindId);
      if (activeConversation?.hasMessages === false && current.session) {
        await this.createNewConversationSession(context.mindId, current, activeConversation.sessionId);
      }
    });
    return true;
  }

  private isGlobalCustomInstructionsEnabledForMind(mindId: string): boolean {
    return this.knownMindRecords.get(mindId)?.globalCustomInstructionsDisabled !== true;
  }

  private getGlobalCustomInstructionsOverrideFields(record: Pick<MindRecord, 'globalCustomInstructionsDisabled'> | undefined): Pick<MindRecord, 'globalCustomInstructionsDisabled'> {
    return record?.globalCustomInstructionsDisabled === true ? { globalCustomInstructionsDisabled: true } : {};
  }

  private getConversationSystemMessage(conversation: ChamberConversationRecord, currentSystemMessage: string): string {
    return conversation.hasMessages === false
      ? currentSystemMessage
      : conversation.systemMessage ?? currentSystemMessage;
  }

  private withGlobalCustomInstructionsPreference(record: MindRecord, enabled: boolean): MindRecord {
    if (!enabled) {
      return { ...record, globalCustomInstructionsDisabled: true };
    }
    const { globalCustomInstructionsDisabled: _globalCustomInstructionsDisabled, ...rest } = record;
    void _globalCustomInstructionsDisabled;
    return rest;
  }

  private resolveMindPath(mindPath: string): string {
    let current = mindPath;

    while (true) {
      if (this.isMindPath(current)) return current;

      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Invalid mind directory: ${mindPath} — must contain SOUL.md or .github/`);
      }

      current = parent;
    }
  }

  private isMindPath(mindPath: string): boolean {
    const hasSoul = fs.existsSync(path.join(mindPath, 'SOUL.md'));
    const hasGithub = fs.existsSync(path.join(mindPath, '.github'));
    return hasSoul || hasGithub;
  }

  private mindPathKey(mindPath: string): string {
    let resolved = path.resolve(mindPath);
    try {
      resolved = fs.realpathSync.native(resolved);
    } catch {
      // If the folder disappears mid-load, keep the resolved path so the caller
      // gets the real load error instead of masking it with canonicalization.
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private toExternalContext(ctx: InternalMindContext): MindContext {
    return {
      mindId: ctx.mindId,
      mindPath: ctx.mindPath,
      identity: ctx.identity,
      status: ctx.status,
      error: ctx.error,
      selectedModel: ctx.selectedModel,
      selectedModelProvider: ctx.selectedModelProvider,
      activeSessionId: ctx.activeSessionId,
      windowed: false,
    };
  }

  private getSessionTools(mindId: string, mindPath: string): Tool[] {
    return this.providers.flatMap((provider) => provider.getToolsForMind(mindId, mindPath));
  }

  private async activateProviders(mindId: string, mindPath: string): Promise<void> {
    await Promise.all(this.providers.map((provider) => provider.activateMind?.(mindId, mindPath)));
  }

  private async releaseProviders(mindId: string): Promise<void> {
    await Promise.all(this.providers.map((provider) => provider.releaseMind?.(mindId)));
  }

  async createTaskSession(
    mindId: string,
    taskId: string,
    onUserInputRequest?: UserInputHandler,
  ): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const sessionTools = this.getSessionTools(mindId, context.mindPath);

    return this.createSessionForMind({
      kind: 'task',
      mindId,
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: sessionTools,
      onUserInputRequest,
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
    });
  }

  async createChatroomSession(mindId: string, onPermissionRequest?: PermissionHandler): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const sessionTools = this.getSessionTools(mindId, context.mindPath);

    return this.createSessionForMind({
      kind: 'chatroom',
      mindId,
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: sessionTools,
      onPermissionRequest,
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
    });
  }

  async runIsolatedPrompt(mindId: string, prompt: string): Promise<string> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const refreshedIdentity = this.loadIdentityForMind(mindId, context.mindPath);
    if (refreshedIdentity) {
      context.identity = refreshedIdentity;
    }

    const session = await this.createSessionForMind({
      kind: 'isolated-prompt',
      mindId,
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: this.getSessionTools(mindId, context.mindPath),
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
    });

    try {
      const response = await session.sendAndWait(
        { prompt: injectCurrentDateTimeContext(prompt, getCurrentDateTimeContext()) },
        ISOLATED_PROMPT_TIMEOUT_MS,
      );
      const text = response?.data.content;
      if (typeof text !== 'string') {
        throw new Error('Isolated prompt did not produce an assistant response');
      }
      return text;
    } finally {
      await session.disconnect().catch((error: unknown) => {
        log.warn('Failed to disconnect isolated prompt session:', error);
      });
    }
  }

  /**
   * Run an isolated prompt with NO tools. Used for Canvas Lens actions where
   * the action request originates from untrusted Canvas HTML. The session
   * cannot invoke side-effect tools; only the model's built-in text generation
   * is available.
   */
  async runIsolatedPromptNoTools(mindId: string, prompt: string): Promise<string> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const refreshedIdentity = this.loadIdentityForMind(mindId, context.mindPath);
    if (refreshedIdentity) {
      context.identity = refreshedIdentity;
    }

    const session = await this.createSessionForMind({
      kind: 'isolated-prompt',
      mindId,
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: [], // Intentionally empty — Canvas actions must not have tool access.
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
    });

    try {
      const response = await session.sendAndWait(
        { prompt: injectCurrentDateTimeContext(prompt, getCurrentDateTimeContext()) },
        ISOLATED_PROMPT_TIMEOUT_MS,
      );
      const text = response?.data.content;
      if (typeof text !== 'string') {
        throw new Error('Isolated Canvas prompt did not produce an assistant response');
      }
      return text;
    } finally {
      await session.disconnect().catch((error: unknown) => {
        log.warn('Failed to disconnect isolated Canvas prompt session:', error);
      });
    }
  }

  async sendBackgroundPrompt(mindPath: string, prompt: string): Promise<void> {
    const requestedMindPathKey = this.mindPathKey(mindPath);
    const mind = this.listMinds().find(m => this.mindPathKey(m.mindPath) === requestedMindPathKey);
    if (!mind) return;
    const context = this.minds.get(mind.mindId);
    if (!context) return;

    await this.runIsolatedPrompt(mind.mindId, prompt);
  }

  /**
   * Run a background prompt originating from a Canvas Lens action with NO
   * tools enabled. The mindPath is resolved to the active mind the same way as
   * sendBackgroundPrompt.
   */
  async sendBackgroundPromptNoTools(mindPath: string, prompt: string): Promise<void> {
    const requestedMindPathKey = this.mindPathKey(mindPath);
    const mind = this.listMinds().find(m => this.mindPathKey(m.mindPath) === requestedMindPathKey);
    if (!mind) return;
    const context = this.minds.get(mind.mindId);
    if (!context) return;

    await this.runIsolatedPromptNoTools(mind.mindId, prompt);
  }

  private normalizeModelSelection(model: string | null | undefined): ModelSelection | null {
    return parseModelSelectionKey(model);
  }

  private getRestorableModelSelection(
    mindId: string,
    record: MindRecord | undefined,
  ): { selectedModel?: string; selectedModelProvider?: ModelProvider } {
    const selectedModel = record?.selectedModel;
    if (!selectedModel) return {};
    const selectedModelProvider = record.selectedModelProvider;
    if (selectedModelProvider !== 'byo') {
      return { selectedModel, selectedModelProvider };
    }
    if (this.byoProviderConfigProvider()) {
      return { selectedModel, selectedModelProvider };
    }

    log.warn(`Ignoring saved BYO LLM model selection for mind ${mindId} because BYO LLM is disabled or not configured.`);
    if (record) {
      const next = { ...record };
      delete next.selectedModel;
      delete next.selectedModelProvider;
      this.knownMindRecords.set(mindId, next);
    }
    return {};
  }

  private resolveProviderForSelection(modelProvider: ModelProvider | undefined): SdkProviderConfig | null {
    if (modelProvider !== 'byo') return null;
    const provider = this.byoProviderConfigProvider();
    if (!provider) {
      throw new Error('BYO LLM model selected, but BYO LLM is not enabled or configured.');
    }
    return provider;
  }

  private upsertMindSelectionRecord(mindId: string, context: InternalMindContext): void {
    const existingRecord = this.knownMindRecords.get(mindId);
    this.knownMindRecords.set(mindId, {
      id: mindId,
      path: context.mindPath,
      ...(context.selectedModel ? { selectedModel: context.selectedModel } : {}),
      ...(context.selectedModelProvider ? { selectedModelProvider: context.selectedModelProvider } : {}),
      ...this.getGlobalCustomInstructionsOverrideFields(existingRecord),
      ...(context.activeSessionId ? { activeSessionId: context.activeSessionId } : {}),
      ...(existingRecord?.conversations ? { conversations: existingRecord.conversations } : {}),
    });
  }

  /**
   * Resolve the effective model for the SDK call.
   *
   * When a BYO model is explicitly selected, the SDK requires `model` on
   * createSession/resumeSession and routes inference to the BYO endpoint via
   * the ProviderConfig set on the session.
   *
   * Source: https://github.com/github/copilot-sdk/blob/main/nodejs/README.md#custom-providers
   *   "When using a custom provider, the `model` parameter is **required**."
   */
  private resolveModelForSdk(model: string | undefined, provider: SdkProviderConfig | null): string | undefined {
    if (model && model.trim().length > 0) return model;
    if (!provider) return undefined;
    const fallback = this.byoDefaultModelProvider();
    if (fallback && fallback.trim().length > 0) return fallback;
    return undefined;
  }

  private async createSessionForMind(req: CreateMindSessionRequest): Promise<CopilotSession> {
    const {
      kind,
      mindId,
      client,
      mindPath,
      systemMessage,
      tools,
      onUserInputRequest,
      onPermissionRequest = approveForSessionCompat,
      useSetApproveAllShortcut = false,
      model,
      modelProvider,
      sessionId,
    } = req;
    this.assertCreateSessionPolicy(kind, sessionId);
    const rawMcpServers = loadMcpServersFromMindPath(mindPath);
    const mcpServers = this.trustService
      ? this.trustService.getApprovedMcpServers(mindId, mindPath, rawMcpServers)
      : rawMcpServers;
    const skillDirectories = this.getMindSkillDirectories(mindPath);
    const chamberMindConfig = loadChamberMindConfig(mindPath);
    const provider = this.resolveProviderForSelection(modelProvider);
    const effectiveModel = this.resolveModelForSdk(model, provider);
    const sessionConfig: SessionConfig = {
      workingDirectory: mindPath,
      configDirectory: this.getCopilotRuntimeConfigDir(),
      enableConfigDiscovery: false,
      tools,
      systemMessage: this.buildSystemMessageConfig(systemMessage),
      onPermissionRequest,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      ...(skillDirectories.length > 0 ? { skillDirectories } : {}),
      ...(chamberMindConfig.excludedTools && chamberMindConfig.excludedTools.length > 0
        ? { excludedTools: chamberMindConfig.excludedTools }
        : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(provider ? { provider } : {}),
      ...(onUserInputRequest ? { onUserInputRequest } : {}),
    };
    const session = await client.createSession(sessionConfig);

    // Issue #131 checklist 4: stop short-circuiting per-session approval
    // through `setApproveAll`. The handler-driven `approve-for-session`
    // path now owns the auto-approval decision, which lets B5 surface
    // requests in the chat UI without losing chamber's existing safe
    // defaults. The shortcut remains opt-in for legacy callers that
    // still want the server-side flag.
    if (useSetApproveAllShortcut) {
      await session.rpc.permissions.setApproveAll({ enabled: true });
    }

    return session;
  }

  private buildSystemMessageConfig(systemMessage: string): NonNullable<SessionConfig['systemMessage']> {
    return {
      mode: 'customize',
      sections: {
        identity: { action: 'replace', content: systemMessage },
        tone: { action: 'remove' },
      },
    };
  }

  private async resumeSessionForMind(
    client: CopilotClient,
    kind: MindSessionKind,
    sessionId: string,
    mindPath: string,
    systemMessage: string | undefined,
    tools: Tool[],
    onUserInputRequest?: UserInputHandler,
    onPermissionRequest: PermissionHandler = approveForSessionCompat,
    useSetApproveAllShortcut = false,
    model?: string,
    modelProvider?: ModelProvider,
    configDir: string | null = this.getCopilotRuntimeConfigDir(),
    mindId?: string,
  ): Promise<CopilotSession> {
    this.assertResumeSessionPolicy(kind);
    const rawMcpServers = loadMcpServersFromMindPath(mindPath);
    // Fail-closed: if trustService is present, always filter regardless of
    // whether mindId was threaded through. An absent mindId maps to an empty
    // record (no such mind registered), so getApprovedMcpServers returns {}.
    const mcpServers = this.trustService
      ? this.trustService.getApprovedMcpServers(mindId ?? '', mindPath, rawMcpServers)
      : rawMcpServers;
    const skillDirectories = this.getMindSkillDirectories(mindPath);
    const chamberMindConfig = loadChamberMindConfig(mindPath);
    const provider = this.resolveProviderForSelection(modelProvider);
    const effectiveModel = this.resolveModelForSdk(model, provider);
    const sessionConfig: ResumeSessionConfig = {
      workingDirectory: mindPath,
      enableConfigDiscovery: false,
      tools,
      onPermissionRequest,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      ...(skillDirectories.length > 0 ? { skillDirectories } : {}),
      ...(configDir ? { configDirectory: configDir } : {}),
      ...(chamberMindConfig.excludedTools && chamberMindConfig.excludedTools.length > 0
        ? { excludedTools: chamberMindConfig.excludedTools }
        : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(provider ? { provider } : {}),
      ...(onUserInputRequest ? { onUserInputRequest } : {}),
      ...(systemMessage ? { systemMessage: this.buildSystemMessageConfig(systemMessage) } : {}),
    };
    const session = await client.resumeSession(sessionId, sessionConfig);
    if (useSetApproveAllShortcut) {
      await session.rpc.permissions.setApproveAll({ enabled: true });
    }
    return session;
  }

  private getMindSkillDirectories(mindPath: string): string[] {
    const skillsDirectory = path.join(mindPath, '.github', 'skills');
    return fs.existsSync(skillsDirectory) ? [skillsDirectory] : [];
  }

  private assertCreateSessionPolicy(kind: MindSessionKind, sessionId: string | undefined): void {
    const policy = MIND_SESSION_POLICIES[kind];
    if (policy.ownsActiveSession && !sessionId) {
      throw new Error(`${kind} sessions must be created with a Chamber session id`);
    }
    if (!policy.ownsActiveSession && sessionId) {
      throw new Error(`${kind} sessions must not reuse Chamber conversation session ids`);
    }
  }

  private assertResumeSessionPolicy(kind: MindSessionKind): void {
    const policy = MIND_SESSION_POLICIES[kind];
    if (!policy.persistsConversation) {
      throw new Error(`${kind} sessions are ephemeral and cannot be resumed`);
    }
  }

  private getCopilotRuntimeConfigDir(): string {
    return path.join(this.configService.getConfigDir(), COPILOT_RUNTIME_CONFIG_DIR);
  }

  private async loadConversationSession(
    client: CopilotClient,
    kind: MindSessionKind,
    mindPath: string,
    systemMessage: string | undefined,
    tools: Tool[],
    conversationSessionId: string,
    model?: string,
    modelProvider?: ModelProvider,
    reattachSystemMessage = systemMessage,
    mindId?: string,
  ): Promise<CopilotSession> {
    try {
      return await this.resumeSessionForMind(
        client,
        kind,
        conversationSessionId,
        mindPath,
        systemMessage,
        tools,
        undefined,
        approveForSessionCompat,
        false,
        model,
        modelProvider,
        undefined,
        mindId,
      );
    } catch (error) {
      if (!isStaleSessionError(error)) throw error;
      log.warn(`SDK session ${conversationSessionId} was not found in Chamber runtime state; trying legacy default session-state.`);
      try {
        return await this.resumeSessionForMind(
          client,
          kind,
          conversationSessionId,
          mindPath,
          systemMessage,
          tools,
          undefined,
          approveForSessionCompat,
          false,
          model,
          modelProvider,
          null,
          mindId,
        );
      } catch (legacyError) {
        if (!isStaleSessionError(legacyError)) throw legacyError;
        if (!reattachSystemMessage) {
          throw new Error(`Cannot reattach SDK session ${conversationSessionId} without a system message snapshot.`, { cause: legacyError });
        }
      }
      log.warn(`SDK session ${conversationSessionId} was not found in either session-state root; reattaching by recreating the session under the same id.`);
      return this.createSessionForMind({
        kind,
        mindId: mindId ?? '',
        client,
        mindPath,
        systemMessage: reattachSystemMessage,
        tools,
        model,
        modelProvider,
        sessionId: conversationSessionId,
      });
    }
  }

  private async deleteSdkSession(context: InternalMindContext, sessionId: string): Promise<void> {
    try {
      await context.client.deleteSession(sessionId);
    } catch (error) {
      if (isStaleSessionError(error)) return;
      log.warn(`Failed to delete SDK session ${sessionId}; Chamber history was already updated.`, error);
    }
  }

  private async getMessagesForSession(session: CopilotSession): Promise<ChatMessage[]> {
    const events = await session.getEvents();
    return mapSessionEventsToChatMessages(events);
  }

  private async getMessagesForConversation(
    mindId: string,
    sessionId: string,
    session: CopilotSession,
  ): Promise<ChatMessage[]> {
    const [seed, messages] = await Promise.all([
      this.forkSeedStore.read(mindId, sessionId),
      this.getMessagesForSession(session),
    ]);
    if (!seed) return messages;
    return [
      ...seed.messages.map((message) => {
        const { eventId: _eventId, ...rest } = message;
        void _eventId;
        return { ...rest, forkSeed: true };
      }),
      ...messages,
    ];
  }

  private persistConfig(): void {
    if (this.reloading) return;
    const existingConfig = this.configService.load();
    const config: AppConfig = {
      ...existingConfig,
      version: 2,
      minds: this.getPersistedMindRecords(),
      activeMindId: this.getPersistedActiveMindId(),
    };
    this.configService.save(config);
  }

  private getPersistedMindRecords(): MindRecord[] {
    const records = new Map(this.knownMindRecords);
    for (const mind of this.minds.values()) {
      records.set(mind.mindId, {
        id: mind.mindId,
        path: mind.mindPath,
        ...(mind.selectedModel ? { selectedModel: mind.selectedModel } : {}),
        ...(mind.selectedModelProvider ? { selectedModelProvider: mind.selectedModelProvider } : {}),
        ...this.getGlobalCustomInstructionsOverrideFields(this.knownMindRecords.get(mind.mindId)),
        ...(mind.activeSessionId ? { activeSessionId: mind.activeSessionId } : {}),
        ...(this.knownMindRecords.get(mind.mindId)?.conversations ? { conversations: this.knownMindRecords.get(mind.mindId)?.conversations } : {}),
      });
    }
    return Array.from(records.values());
  }

  private createConversationRecord(
    mindId: string,
    systemMessage: string,
    options: { title?: string; forkOf?: ConversationForkRef; now?: string } = {},
  ): ChamberConversationRecord {
    const now = options.now ?? new Date().toISOString();
    return {
      sessionId: `chamber-${mindId}-${randomUUID()}`,
      title: options.title ?? `New chat · ${new Date(now).toLocaleString()}`,
      createdAt: now,
      updatedAt: now,
      kind: 'chat',
      hasMessages: false,
      systemMessage,
      ...(options.forkOf ? { forkOf: options.forkOf } : {}),
    };
  }

  private ensureConversationRecord(
    mindId: string,
    sessionId: string,
    conversations: ChamberConversationRecord[] = [],
    systemMessage?: string,
  ): ChamberConversationRecord {
    const existing = conversations.find((conversation) => conversation.sessionId === sessionId);
    if (existing) {
      return existing.systemMessage || !systemMessage ? existing : { ...existing, systemMessage };
    }
    return {
      sessionId,
      title: `New chat · ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      kind: 'chat',
      hasMessages: false,
      ...(systemMessage ? { systemMessage } : {}),
    };
  }

  private upsertConversationRecord(mindId: string, conversation: ChamberConversationRecord, replaceSessionId?: string): void {
    const record = this.knownMindRecords.get(mindId);
    if (!record) return;
    const conversations = record.conversations ?? [];
    this.knownMindRecords.set(mindId, {
      ...record,
      activeSessionId: conversation.sessionId,
      conversations: [
        conversation,
        ...conversations.filter((existing) => existing.sessionId !== conversation.sessionId && existing.sessionId !== replaceSessionId),
      ],
    });
  }

  private touchConversationRecord(mindId: string, sessionId: string, systemMessage?: string): void {
    const record = this.knownMindRecords.get(mindId);
    if (!record) return;
    this.knownMindRecords.set(mindId, {
      ...record,
      activeSessionId: sessionId,
      ...(record.conversations && systemMessage
        ? {
          conversations: record.conversations.map((conversation) =>
            conversation.sessionId === sessionId && !conversation.systemMessage
              ? { ...conversation, systemMessage }
              : conversation,
          ),
        }
        : {}),
    });
  }

  private defaultConversationTitle(conversation: ChamberConversationRecord): string {
    return `Chat · ${new Date(conversation.createdAt).toLocaleString()}`;
  }

  private getActiveConversationRecord(mindId: string): ChamberConversationRecord | undefined {
    const context = this.minds.get(mindId);
    const activeSessionId = context?.activeSessionId ?? this.knownMindRecords.get(mindId)?.activeSessionId;
    return this.knownMindRecords.get(mindId)?.conversations?.find((conversation) => conversation.sessionId === activeSessionId);
  }

  private conversationTitleFromPrompt(prompt: string): string {
    const firstLine = prompt.trim().split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? 'New chat';
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  }

  private getPersistedActiveMindId(): string | null {
    if (
      this.persistedActiveMindId &&
      (this.minds.has(this.persistedActiveMindId) || this.knownMindRecords.has(this.persistedActiveMindId))
    ) {
      return this.persistedActiveMindId;
    }
    return this.activeMindId;
  }
}
