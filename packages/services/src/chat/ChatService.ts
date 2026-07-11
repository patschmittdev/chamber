// ChatService — thin message streaming layer.
// Gets sessions from MindManager, streams SDK events via callback.

import type { MindManager } from '../mind';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { ChatAttachment, ChatAttachmentManifest, ChatDocumentAttachment, ChatEvent, ChatImageAttachment, ChatMessage, ContentBlock, ConversationEventRef, ConversationExport, ConversationExportFormat, ConversationResumeResult, ConversationSummary, MindInstructionPrecedence, ModelInfo } from '@chamber/shared/types';
import { modelSelectionKeyFromModel } from '@chamber/shared/model-selection';
import type { CopilotSession } from '../mind/types';
import { isStaleSessionError, SEND_TIMEOUT_MS, sendTimeoutError } from '@chamber/shared/sessionErrors';
import { Logger } from '../logger';
import {
  SdkChatEventContractError,
  getSdkSessionErrorMessage,
  mapSdkAssistantMessage,
  mapSdkAssistantMessageDelta,
  mapSdkAssistantReasoningDelta,
  mapSdkPermissionCompleted,
  mapSdkPermissionRequested,
  mapSdkToolExecutionComplete,
  mapSdkToolExecutionPartialResult,
  mapSdkToolExecutionProgress,
  mapSdkToolExecutionStart,
} from '../sdk/sdkChatEventMapper';
import { clearCopilotModelsCache } from '../sdk/modelCacheCompat';
import { mapSdkModelList } from '../sdk/sdkModelMapper';
import { TurnQueue } from './TurnQueue';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext, type DateTimeContextProvider } from './currentDateTimeContext';
import { buildConversationExport, conversationExportFilename } from './conversationExport';
import { TurnLifecycleTrace } from './turnLifecycleTrace';
import { appendAttachmentManifestContext } from './attachmentContext';
import { appendConversationForkContext } from './conversationForkContext';

const log = Logger.create('ChatService');

// INVARIANT: this is a post-root-turn_end debounce, not a turn deadline.
// It is never armed unless the SDK has already signalled the root turn ended.
const TURN_END_QUIESCENCE_MS = 1_000;

interface PreparedTurn {
  prompt: string;
  titlePrompt?: string;
  sdkAttachments?: ChatImageAttachment[];
}

interface DocumentAttachmentStore {
  saveDocument(mindId: string, sessionId: string, attachment: ChatDocumentAttachment): Promise<ChatAttachmentManifest>;
}

export class ChatService {
  private abortControllers = new Map<string, { messageId: string; controller: AbortController }>();
  private modelSwitchingMinds = new Set<string>();
  private conversationSwitchingMinds = new Set<string>();

  constructor(
    private readonly mindManager: MindManager,
    private readonly turnQueue: TurnQueue,
    private readonly dateTimeContextProvider: DateTimeContextProvider = getCurrentDateTimeContext,
    /**
     * Optional provider injected by main.ts that returns BYO LLM models when
     * BYO is enabled. Returning null/undefined falls back to the bundled SDK's
     * `client.listModels()`. This is required because the SDK's listModels API
     * always queries GitHub's official Copilot model catalog and does NOT honor
     * the COPILOT_PROVIDER_BASE_URL env var even when BYOK mode is active for
     * inference.
     */
    private readonly byoLlmModelsProvider?: () => Promise<ModelInfo[] | null>,
    private readonly attachmentStore?: DocumentAttachmentStore,
  ) {}

  async sendMessage(
    mindId: string,
    prompt: string,
    messageId: string,
    emit: (event: ChatEvent) => void,
    model?: string,
    attachments?: ChatAttachment[],
  ): Promise<void> {
    return this.runTurn(mindId, messageId, emit, async (session) => this.prepareSendTurn(mindId, prompt, attachments, session.sessionId), { model });
  }

  /**
   * Deletes a turn from the active conversation. Truncation removes the target
   * event and every later event, so this also drops any turns that followed it.
   * Serialized through the turn queue so it never races an in-flight stream.
   */
  async deleteMessage(mindId: string, eventId: string): Promise<ConversationSummary[]> {
    this.assertCanMutateConversation(mindId);
    return this.turnQueue.enqueue(mindId, () => this.mindManager.truncateActiveConversation(mindId, eventId));
  }

  /**
   * Replaces a user turn with an edited prompt: truncates history back to that
   * turn (removing it and the assistant reply that followed), then streams a
   * fresh response to the new prompt.
   */
  async editMessage(
    mindId: string,
    eventId: string,
    prompt: string,
    messageId: string,
    emit: (event: ChatEvent) => void,
    model?: string,
  ): Promise<void> {
    return this.runTurn(mindId, messageId, emit, async () => {
      await this.mindManager.truncateActiveConversation(mindId, eventId);
      return { prompt: await this.appendActiveForkSeedContext(mindId, prompt), titlePrompt: prompt };
    }, { model });
  }

  /**
   * Re-runs the most recent user turn to produce a fresh assistant response.
   * Resolves the last user turn from persisted history, truncates back to it,
   * and resends its original prompt.
   */
  async regenerate(
    mindId: string,
    messageId: string,
    emit: (event: ChatEvent) => void,
    model?: string,
  ): Promise<void> {
    return this.runTurn(mindId, messageId, emit, async () => {
      const messages = await this.mindManager.getActiveConversationMessages(mindId);
      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      if (!lastUser?.eventId) {
        emit({ type: 'error', message: 'There is no user message to regenerate.' });
        return null;
      }
      if (hasAttachmentContent(lastUser)) {
        emit({ type: 'error', message: 'Regenerating messages with attachments is not available yet.' });
        return null;
      }
      await this.mindManager.truncateActiveConversation(mindId, lastUser.eventId);
      const prompt = plainTextOf(lastUser);
      return { prompt: await this.appendActiveForkSeedContext(mindId, prompt), titlePrompt: prompt };
    }, { model });
  }

  /** Ordered references to persisted user/assistant turns, for reconciling live messages with event ids. */
  async getConversationEvents(mindId: string): Promise<ConversationEventRef[]> {
    return this.mindManager.getConversationEventRefs(mindId);
  }

  async setMindGlobalCustomInstructionsEnabled(mindId: string, enabled: boolean): Promise<MindInstructionPrecedence> {
    return this.turnQueue.enqueue(mindId, () => this.mindManager.setMindGlobalCustomInstructionsEnabled(mindId, enabled));
  }

  getMindInstructionPrecedence(mindId: string): MindInstructionPrecedence {
    return this.mindManager.getMindInstructionPrecedence(mindId);
  }

  async refreshLoadedMindIdentities(): Promise<{ refreshedCount: number }> {
    await this.mindManager.awaitRestore();
    let refreshedCount = 0;
    await Promise.all(this.mindManager.listMinds().map((mind) =>
      this.turnQueue.enqueue(mind.mindId, async () => {
        if (await this.mindManager.refreshLoadedMindIdentity(mind.mindId)) refreshedCount += 1;
      }),
    ));
    return { refreshedCount };
  }

  private async prepareSendTurn(
    mindId: string,
    prompt: string,
    attachments: readonly ChatAttachment[] | undefined,
    sessionId: string,
  ): Promise<PreparedTurn> {
    const images = attachments?.filter((attachment): attachment is ChatImageAttachment => attachment.kind === 'image') ?? [];
    const documents = attachments?.filter((attachment): attachment is ChatDocumentAttachment => attachment.kind === 'document') ?? [];
    if (documents.length === 0) {
      return {
        prompt: await this.appendActiveForkSeedContext(mindId, prompt),
        titlePrompt: prompt,
        sdkAttachments: images.length > 0 ? images : undefined,
      };
    }
    if (!this.attachmentStore) {
      throw new Error('Document attachments are unavailable because the attachment store is not configured.');
    }
    const attachmentStore = this.attachmentStore;

    const manifests = await Promise.all(documents.map((document) => attachmentStore.saveDocument(mindId, sessionId, {
      ...document,
      metadata: {
        ...(document.metadata ?? {}),
        source: 'chat-composer',
      },
    })));
    return {
      prompt: await this.appendActiveForkSeedContext(mindId, appendAttachmentManifestContext(prompt, manifests)),
      titlePrompt: prompt,
      sdkAttachments: images.length > 0 ? images : undefined,
    };
  }

  private async appendActiveForkSeedContext(mindId: string, prompt: string): Promise<string> {
    const seed = await this.mindManager.getActiveConversationForkSeed(mindId);
    return seed ? appendConversationForkContext(prompt, seed) : prompt;
  }

  /**
   * Shared turn driver for send/edit/regenerate. `resolveTurn` performs any
   * one-time history mutation or attachment persistence and returns the prompt
   * to send, or null to abort the turn. It is invoked at most once per action:
   * the resolved turn is cached so a stale-session retry re-sends the same
   * prompt and manifests without re-running side effects.
   */
  private async runTurn(
    mindId: string,
    messageId: string,
    emit: (event: ChatEvent) => void,
    resolveTurn: (session: CopilotSession) => Promise<PreparedTurn | null>,
    options: { model?: string } = {},
  ): Promise<void> {
    const initialBusyMessage = this.turnBusyMessage(mindId);
    if (initialBusyMessage) {
      emit({ type: 'error', message: initialBusyMessage });
      emit({ type: 'done' });
      return;
    }
    return this.turnQueue.enqueue(mindId, async () => {
      const busyMessage = this.turnBusyMessage(mindId);
      if (busyMessage) {
        emit({ type: 'error', message: busyMessage });
        emit({ type: 'done' });
        return;
      }
      const abortController = new AbortController();
      this.abortControllers.set(mindId, { messageId, controller: abortController });

      let prepared = false;
      let preparedTurn: PreparedTurn | null = null;
      const prepareOnce = async (session: CopilotSession): Promise<string | null> => {
        if (prepared) return preparedTurn?.prompt ?? null;
        preparedTurn = await resolveTurn(session);
        prepared = true;
        return preparedTurn?.prompt ?? null;
      };

      const streamOn = async (session: CopilotSession): Promise<void> => {
        const prompt = await prepareOnce(session);
        if (prompt === null || preparedTurn === null) {
          if (!abortController.signal.aborted) emit({ type: 'done' });
          return;
        }
        await this.streamTurn(session, prompt, abortController, emit, preparedTurn.sdkAttachments, () => {
          this.mindManager.markActiveConversationHasMessages(mindId, preparedTurn?.titlePrompt ?? prompt);
        });
      };

      try {
        const context = this.mindManager.getMind(mindId);
        if (!context?.session) {
          throw new Error(`Mind ${mindId} not found or has no session`);
        }

        try {
          const session = options.model ? await this.mindManager.setMindModel(mindId, options.model) : null;
          const currentSession = session ? this.mindManager.getMind(mindId)?.session : context.session;
          if (!currentSession) throw new Error(`Mind ${mindId} not found or has no session`);
          await streamOn(currentSession);
        } catch (err) {
          if (abortController.signal.aborted) return;
          if (!isStaleSessionError(err)) throw err;

          // SDK forgot the session — recover once by reattaching, then retry.
          // If reattach also fails stale, surface the error so the user can start a new chat.
          emit({ type: 'reconnecting' });
          const recoveredSession = await this.mindManager.recoverActiveConversationSession(mindId);
          if (abortController.signal.aborted) return;
          await streamOn(recoveredSession);
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        const rawMessage = getErrorMessage(err);
        emit({ type: 'error', message: mapByoLlmError(rawMessage) });
      } finally {
        const active = this.abortControllers.get(mindId);
        if (active?.controller === abortController) {
          this.abortControllers.delete(mindId);
        }
      }
    });
  }

  private async streamTurn(
    session: CopilotSession,
    prompt: string,
    abortController: AbortController,
    emit: (event: ChatEvent) => void,
    attachments?: ChatImageAttachment[],
    onSendAccepted?: () => void,
  ): Promise<void> {
    if (abortController.signal.aborted) return;

    const unsubs: (() => void)[] = [];
    const guard = (fn: () => void) => { if (!abortController.signal.aborted) fn(); };
    let sdkContractFailed = false;
    const failSdkContract = (error: unknown) => {
      if (abortController.signal.aborted || sdkContractFailed) return;
      sdkContractFailed = true;
      const message = error instanceof SdkChatEventContractError
        ? error.message
        : 'SDK contract mismatch while streaming chat';
      log.error(message, error);
      emit({ type: 'error', message });
      abortController.abort();
    };
    const emitMapped = (mapper: () => ChatEvent | null) => {
      try {
        const mapped = mapper();
        if (mapped) guard(() => emit(mapped));
      } catch (error) {
        failSdkContract(error);
      }
    };

    // Per-turn lifecycle trace (issue #299). The single-arg `session.on(handler)`
    // overload receives every SDK event for this turn; the trace records
    // metadata-only entries (no payload contents) so we can distinguish missing
    // `session.idle` from a Chamber typed-listener miss after the fact.
    //
    // Defensive completion path (#297): if the SDK emits root
    // `assistant.turn_end` but never follows with `session.idle`, complete
    // only after a post-turn quiescence window with no tools or sub-agent
    // turns still active. This is intentionally NOT a wall-clock turn
    // deadline: no root turn_end means no timer is armed.
    const trace = new TurnLifecycleTrace();
    // Default to 'threw' so that any pathway which escapes via an exception
    // before the idle / error / abort handlers fire (e.g. `session.send`
    // rejecting with a non-stale network error, attachment marshalling
    // throwing, etc.) is logged honestly. Only the success path flips this
    // to 'completed'. Without this default, the summary would lie about
    // turns that failed before reaching `await turnDone` — defeating the
    // forensic purpose of the trace.
    let terminalReason:
      | 'completed'
      | 'turn_end_quiescence'
      | 'aborted'
      | 'sdk_error'
      | 'sdk_contract'
      | 'threw' = 'threw';
    const logTraceSummary = () => {
      const summary = trace.summary(terminalReason);
      // Fingerprint of the #299 stuck-streaming bug: the SDK signalled the
      // root agent's turn ended but never emitted `session.idle`, so the turn
      // hung until the user pressed Stop. Use `sawRootTurnEnd` (not
      // `sawTurnEnd`) so sub-agent turn_end events — common in chatroom /
      // delegated work and NOT terminal for the root turn — do not trip the
      // info-level log on every aborted multi-agent turn.
      if (terminalReason === 'aborted' && summary.sawRootTurnEnd && !summary.sawIdle) {
        log.info('chat.turn.lifecycle', summary);
      } else {
        log.debug('chat.turn.lifecycle', summary);
      }
    };
    const outstandingToolIds = new Set<string>();
    const pendingPermissionIds = new Set<string>();
    const activeSubAgentIds = new Set<string>();
    let sawRootTurnEnd = false;
    let turnEndQuiescenceTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveTurnEndQuiescence: (() => void) | undefined;
    const clearTurnEndQuiescence = () => {
      if (turnEndQuiescenceTimer) {
        clearTimeout(turnEndQuiescenceTimer);
        turnEndQuiescenceTimer = undefined;
      }
    };
    const maybeArmTurnEndQuiescence = () => {
      if (
        abortController.signal.aborted ||
        !sawRootTurnEnd ||
        outstandingToolIds.size > 0 ||
        pendingPermissionIds.size > 0 ||
        activeSubAgentIds.size > 0
      ) {
        return;
      }
      clearTurnEndQuiescence();
      turnEndQuiescenceTimer = setTimeout(() => {
        turnEndQuiescenceTimer = undefined;
        terminalReason = 'turn_end_quiescence';
        resolveTurnEndQuiescence?.();
      }, TURN_END_QUIESCENCE_MS);
    };
    const getEventDataString = (
      event: Parameters<TurnLifecycleTrace['record']>[0],
      key: string,
    ): string | undefined => {
      if (typeof event.data !== 'object' || event.data === null || !(key in event.data)) return undefined;
      const value = event.data[key as keyof typeof event.data];
      return typeof value === 'string' ? value : undefined;
    };
    const trackTerminalCandidate = (event: Parameters<TurnLifecycleTrace['record']>[0]) => {
      clearTurnEndQuiescence();

      const toolCallId = getEventDataString(event, 'toolCallId');
      const requestId = getEventDataString(event, 'requestId');
      if (event.type === 'tool.execution_start' && toolCallId) {
        outstandingToolIds.add(toolCallId);
      }
      if (event.type === 'tool.execution_complete' && toolCallId) {
        outstandingToolIds.delete(toolCallId);
      }
      if (event.type === 'permission.requested' && requestId) {
        pendingPermissionIds.add(requestId);
      }
      if (event.type === 'permission.completed' && requestId) {
        pendingPermissionIds.delete(requestId);
      }
      if (event.type === 'assistant.turn_start') {
        if (typeof event.agentId === 'string') {
          activeSubAgentIds.add(event.agentId);
        } else {
          sawRootTurnEnd = false;
        }
      }
      if (event.type === 'assistant.turn_end') {
        if (typeof event.agentId === 'string') {
          activeSubAgentIds.delete(event.agentId);
        } else {
          sawRootTurnEnd = true;
        }
      }

      maybeArmTurnEndQuiescence();
    };
    try {
      const unsubTrace = session.on((event) => {
        const sdkEvent = event as Parameters<TurnLifecycleTrace['record']>[0];
        trace.record(sdkEvent);
        trackTerminalCandidate(sdkEvent);
      });
      unsubs.push(unsubTrace);

      // Text streaming
      unsubs.push(session.on('assistant.message_delta', (event) => {
        emitMapped(() => mapSdkAssistantMessageDelta(event));
      }));

      // Final assistant message
      unsubs.push(session.on('assistant.message', (event) => {
        emitMapped(() => mapSdkAssistantMessage(event));
      }));

      // Reasoning
      unsubs.push(session.on('assistant.reasoning_delta', (event) => {
        emitMapped(() => mapSdkAssistantReasoningDelta(event));
      }));

      // Tool execution
      unsubs.push(session.on('tool.execution_start', (event) => {
        emitMapped(() => mapSdkToolExecutionStart(event));
      }));

      unsubs.push(session.on('tool.execution_progress', (event) => {
        emitMapped(() => mapSdkToolExecutionProgress(event));
      }));

      unsubs.push(session.on('tool.execution_partial_result', (event) => {
        emitMapped(() => mapSdkToolExecutionPartialResult(event));
      }));

      unsubs.push(session.on('tool.execution_complete', (event) => {
        emitMapped(() => mapSdkToolExecutionComplete(event));
      }));

      // Permission events (issue #131 checklist 5). The SDK emits
      // `permission.requested` when a tool/url/etc. asks for approval and
      // `permission.completed` once the handler returns. We surface both
      // as chat events so the UI can render an inline permission entry
      // that updates from "pending" to its final outcome (approved /
      // denied-*). Approval logic itself still lives in the
      // onPermissionRequest handler wired by MindManager.
      unsubs.push(session.on('permission.requested', (event) => {
        emitMapped(() => mapSdkPermissionRequested(event));
      }));

      unsubs.push(session.on('permission.completed', (event) => {
        emitMapped(() => mapSdkPermissionCompleted(event));
      }));

      // Set up idle/error listeners BEFORE send to avoid missing events
      // that fire synchronously inside session.send (regression-test guarded).
      //
      // INVARIANT: no fallback wall-clock deadline on the turn (#222).
      // Long-running agent work - deep research, multi-step tool chains,
      // big-codebase analysis - is a first-class Chamber use case. The
      // user owns "this has gone on long enough" via the Stop button,
      // which calls cancelMessage -> abortController.abort() -> session.abort().
      // We rely on the SDK to eventually emit `session.idle`, `session.error`,
      // or for the user to cancel. SEND_TIMEOUT_MS below still bounds the
      // separate failure mode of `session.send()` itself wedging.
      const turnDone = new Promise<void>((resolve, reject) => {
        const unsubIdle = session.on('session.idle', () => {
          unsubIdle();
          clearTurnEndQuiescence();
          terminalReason = 'completed';
          resolve();
        });
        unsubs.push(unsubIdle);

        const unsubError = session.on('session.error', (event) => {
          unsubError();
          clearTurnEndQuiescence();
          try {
            terminalReason = 'sdk_error';
            reject(new Error(getSdkSessionErrorMessage(event)));
          } catch (error) {
            // failSdkContract aborts; the abort listener below will then
            // observe `sdkContractFailed` and reclassify terminalReason to
            // 'sdk_contract'. Keep that reclassification logic in mind if
            // you change the abort dispatch model (today AbortSignal fires
            // synchronously, which preserves last-write-wins ordering).
            failSdkContract(error);
            resolve();
          }
        });
        unsubs.push(unsubError);

        abortController.signal.addEventListener('abort', () => {
          clearTurnEndQuiescence();
          // failSdkContract aborts after setting sdkContractFailed; preserve
          // that classification rather than overwriting with 'aborted'.
          terminalReason = sdkContractFailed ? 'sdk_contract' : 'aborted';
          resolve();
        }, { once: true });
        resolveTurnEndQuiescence = resolve;
      });
      // Defensive no-op catch: if `session.send` throws and we never reach
      // `await turnDone` below, this guarantees a later SDK error rejection is
      // observed instead of surfacing as an unhandled rejection.
      turnDone.catch(() => { /* observed in await below or intentionally discarded */ });

      // Send with a timeout guard: if session.send() itself hangs (dead
      // WebSocket, killed CLI), surface as a stale-session error so the
      // outer catch can recreate the session and retry.
      let sendTimerId: ReturnType<typeof setTimeout> | undefined;
      const sendTimeout = new Promise<never>((_, reject) => {
        sendTimerId = setTimeout(() => reject(sendTimeoutError()), SEND_TIMEOUT_MS);
      });
      try {
        const sdkAttachments = attachments?.map((a) => ({
          type: 'blob' as const,
          data: a.data,
          mimeType: a.mimeType,
          displayName: a.displayName,
        }));
        const promptWithDateTime = injectCurrentDateTimeContext(prompt, this.dateTimeContextProvider());
        await Promise.race([session.send(sdkAttachments ? { prompt: promptWithDateTime, attachments: sdkAttachments } : { prompt: promptWithDateTime }), sendTimeout]);
        guard(() => onSendAccepted?.());
      } finally {
        if (sendTimerId) clearTimeout(sendTimerId);
      }

      // Wait for idle (listeners already active from before send).
      await turnDone;

      if (abortController.signal.aborted) return;
      emit({ type: 'done' });
    } finally {
      clearTurnEndQuiescence();
      for (const unsub of unsubs) unsub();
      logTraceSummary();
    }
  }

  async cancelMessage(mindId: string, messageId: string): Promise<boolean> {
    const active = this.abortControllers.get(mindId);
    if (!active || active.messageId !== messageId) return false;
    active.controller.abort();
    this.abortControllers.delete(mindId);
    const context = this.mindManager.getMind(mindId);
    if (context?.session) {
      await context.session.abort().catch(() => { /* noop */ });
    }
    return true;
  }

  async setMindModel(mindId: string, model: string | null): Promise<Awaited<ReturnType<MindManager['setMindModel']>>> {
    if (this.conversationSwitchingMinds.has(mindId)) {
      throw new Error('Cannot switch models while changing conversations.');
    }
    this.modelSwitchingMinds.add(mindId);
    try {
      return await this.turnQueue.enqueue(mindId, () => this.mindManager.setMindModel(mindId, model));
    } finally {
      this.modelSwitchingMinds.delete(mindId);
    }
  }

  async newConversation(mindId: string): Promise<ConversationResumeResult> {
    return this.runConversationSwitch(mindId, async () => {
      await this.mindManager.startNewConversation(mindId);
      return {
        sessionId: this.mindManager.getMind(mindId)?.activeSessionId ?? '',
        messages: [],
        conversations: this.mindManager.listConversationHistory(mindId),
      };
    });
  }

  listConversationHistory(mindId: string): ConversationSummary[] {
    return this.mindManager.listConversationHistory(mindId);
  }

  async resumeConversation(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    return this.runConversationSwitch(mindId, () => this.mindManager.resumeConversation(mindId, sessionId));
  }

  async forkConversation(mindId: string, sourceSessionId: string, sourceEventId: string): Promise<ConversationResumeResult> {
    return this.runConversationSwitch(mindId, () => this.mindManager.forkConversation(mindId, sourceSessionId, sourceEventId));
  }

  async deleteConversation(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    return this.runConversationSwitch(mindId, () => this.mindManager.deleteConversation(mindId, sessionId));
  }

  renameConversation(mindId: string, sessionId: string, title: string): ConversationSummary[] {
    return this.mindManager.renameConversation(mindId, sessionId, title);
  }

  getConversationMessages(mindId: string, sessionId: string): Promise<ChatMessage[]> {
    return this.mindManager.getConversationMessages(mindId, sessionId);
  }

  /**
   * Resolve the suggested export file name without reading the transcript, so
   * the save dialog can be shown before any expensive read/serialize work.
   */
  getConversationExportFilename(mindId: string, sessionId: string, format: ConversationExportFormat): string {
    return conversationExportFilename(this.requireConversationSummary(mindId, sessionId), format);
  }

  async exportConversation(
    mindId: string,
    sessionId: string,
    format: ConversationExportFormat,
  ): Promise<ConversationExport> {
    const conversation = this.requireConversationSummary(mindId, sessionId);
    const messages = await this.mindManager.getConversationMessages(mindId, sessionId);
    return buildConversationExport(conversation, messages, format);
  }

  private requireConversationSummary(mindId: string, sessionId: string): ConversationSummary {
    const conversation = this.mindManager
      .listConversationHistory(mindId)
      .find((candidate) => candidate.sessionId === sessionId);
    if (!conversation) {
      throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    }
    return conversation;
  }

  async listModels(mindId: string): Promise<ModelInfo[]> {
    const context = this.mindManager.getMind(mindId);
    let sdkModels: ModelInfo[] = [];
    let sdkError: unknown = null;
    if (context?.client) {
      // Defensive: clear any SDK-level cache. As of @github/copilot-sdk@0.3.0
      // this is a no-op (see modelCacheCompat). The cache that actually
      // controls model freshness lives in the CLI server process with a
      // 30-min TTL — only a CLI subprocess restart can bust it.
      // See docs/model-cache-investigation.md (issue #90).
      clearCopilotModelsCache(context.client);
      try {
        const raw = await context.client.listModels();
        sdkModels = mapSdkModelList(raw);
      } catch (err) {
        sdkError = err;
      }
    }

    let byoModels: ModelInfo[] = [];
    if (this.byoLlmModelsProvider) {
      try {
        byoModels = (await this.byoLlmModelsProvider()) ?? [];
      } catch (err) {
        log.error('byoLlmModelsProvider failed (skipping BYO models):', err);
      }
    }

    // If SDK errored AND we have no BYO fallback, propagate (preserves existing
    // behavior so tests/UI can surface the SDK failure). If BYO is providing
    // models, suppress the SDK error and return BYO-only — the user explicitly
    // chose a custom endpoint and shouldn't be blocked by Copilot SDK issues.
    if (sdkError && byoModels.length === 0) {
      throw sdkError;
    }

    if (byoModels.length === 0) return sdkModels;

    // Merge: append BYO models after SDK models. Keep same-id cloud/BYO entries
    // distinct by provider-aware key so the renderer can route them differently.
    const seen = new Set(sdkModels.map((m) => modelSelectionKeyFromModel(m)));
    const merged = [...sdkModels];
    for (const m of byoModels) {
      const key = modelSelectionKeyFromModel(m);
      if (!seen.has(key)) {
        merged.push(m);
        seen.add(key);
      }
    }
    log.debug(`listModels: ${sdkModels.length} SDK + ${byoModels.length} BYO -> ${merged.length} merged`);
    return merged;
  }

  private assertCanSwitchConversation(mindId: string): void {
    if (this.abortControllers.has(mindId)) {
      throw new Error('Cannot switch conversations while a message is still streaming.');
    }
    if (this.modelSwitchingMinds.has(mindId)) {
      throw new Error('Cannot switch conversations while a model switch is in progress.');
    }
    if (this.conversationSwitchingMinds.has(mindId)) {
      throw new Error('Cannot switch conversations while another conversation switch is in progress.');
    }
  }

  private assertCanMutateConversation(mindId: string): void {
    if (this.modelSwitchingMinds.has(mindId)) {
      throw new Error('Cannot change messages while changing models.');
    }
    if (this.conversationSwitchingMinds.has(mindId)) {
      throw new Error('Cannot change messages while changing conversations.');
    }
  }

  private turnBusyMessage(mindId: string): string | null {
    if (this.modelSwitchingMinds.has(mindId)) {
      return 'Cannot send messages while changing models.';
    }
    if (this.conversationSwitchingMinds.has(mindId)) {
      return 'Cannot send messages while changing conversations.';
    }
    return null;
  }

  private async runConversationSwitch<T>(mindId: string, operation: () => Promise<T>): Promise<T> {
    this.assertCanSwitchConversation(mindId);
    this.conversationSwitchingMinds.add(mindId);
    try {
      return await operation();
    } finally {
      this.conversationSwitchingMinds.delete(mindId);
    }
  }
}


/**
 * Concatenates a chat message's text blocks. Used to recover the original
 * prompt of a persisted user turn when regenerating its response.
 */
function plainTextOf(message: ChatMessage): string {
  return message.blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.content)
    .join('');
}

function hasAttachmentContent(message: ChatMessage): boolean {
  return message.blocks.some((block) => block.type === 'image' || block.type === 'attachment');
}

/**
 * Friendly mapper for upstream LLM errors that originate from BYO LLM endpoints.
 * Detects llama.cpp / LM Studio context-too-small responses and rewrites them
 * into actionable guidance.
 */
export function mapByoLlmError(rawMessage: string): string {
  if (/n_keep:\s*\d+\s*>=\s*n_ctx:\s*\d+/.test(rawMessage)) {
    return `The local model's context window is too small for Chamber's system prompt. Either pick a larger-context model (e.g. qwen3.5-9b for 32K, gemma-4-26b for 128K) or increase the context length when loading the model in LM Studio. Original error: ${rawMessage}`;
  }
  if (/context.*(?:length|window)/i.test(rawMessage) && /(too|exceed|maximum)/i.test(rawMessage)) {
    return `Model context window exceeded. Try a larger model or reduce the conversation history. Original: ${rawMessage}`;
  }
  return rawMessage;
}
