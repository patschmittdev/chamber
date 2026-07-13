import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight, FileText, Sparkles } from 'lucide-react';
import { MessageActions, type RowAction, type RegenerateAction } from './MessageActions';
import { MessageVariantPager } from './MessageVariantPager';
import { useAppState, useAppDispatch, getPlainContent } from '../../lib/store';
import { useChatStreaming } from '../../hooks/useChatStreaming';
import { useConversationActions } from '../../hooks/useConversationActions';
import { useWindowedList } from '../../hooks/useWindowedList';
import { StreamingMessage } from './StreamingMessage';
import { hasAttachmentBlocks } from './messageContent';
import { cn, formatTime, parseSkillContextInjection } from '../../lib/utils';
import type { ChatMessage, MindContext, ModelInfo } from '@chamber/shared/types';
import { buildMessageVariantView, resolvePendingPromotion } from '@chamber/shared/messageVariants';
import { formatAttachmentSize } from '@chamber/shared';
import type { AgentProfileSummary } from '../../lib/store/state';
import { AgentAvatar } from '../profile/AgentAvatar';
import { useMindProfiles } from '../../hooks/useMindProfiles';
import { useUserProfile } from '../../hooks/useUserProfile';
import { agentColor, readableTextColor } from './agentColors';

const EDIT_ATTACHMENT_REASON = "Editing isn't available for messages with attachments yet";
const REGENERATE_ATTACHMENT_REASON = "Regenerating isn't available for turns with attachments yet";

// Below this row count the transcript renders in full: content-visibility alone
// already holds 60fps, so windowing only earns its keep once the DOM node and
// heap growth of a long transcript would otherwise be unbounded.
const TRANSCRIPT_WINDOW_THRESHOLD = 60;

function displayName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function profileName(profile: AgentProfileSummary | undefined, fallback: string): string {
  return displayName(profile?.displayName ?? fallback, fallback);
}

function messagePresenter(
  message: ChatMessage,
  agentName: string,
  minds: MindContext[],
  profileByMindId: Record<string, AgentProfileSummary>,
) {
  if (message.role === 'assistant') {
    const name = displayName(agentName, 'Agent');
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      color: undefined,
      isAgentSender: false,
      avatarDataUrl: undefined,
    };
  }

  if (message.sender && message.sender.mindId !== 'user') {
    const profile = profileByMindId[message.sender.mindId];
    const name = profileName(profile, displayName(message.sender.name, 'Unknown Agent'));
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      color: agentColor(minds, message.sender.mindId, profileByMindId),
      isAgentSender: true,
      avatarDataUrl: profile?.avatarDataUrl,
    };
  }

  return {
    name: 'You',
    initial: 'Y',
    color: undefined,
    isAgentSender: false,
    avatarDataUrl: undefined,
  };
}

export function MessageList() {
  const { messagesByMind, activeMindId, minds, variantGroupsByMind, variantSelectionByMind, availableModels, selectedModel } = useAppState();
  const dispatch = useAppDispatch();
  const profileByMindId = useMindProfiles(minds);
  const userProfile = useUserProfile();
  const messages = activeMindId ? (messagesByMind[activeMindId] ?? []) : [];
  const variantGroups = activeMindId ? (variantGroupsByMind[activeMindId] ?? []) : [];
  const variantSelection = activeMindId ? (variantSelectionByMind[activeMindId] ?? {}) : {};
  const { regenerate, editAndResubmit, isBusy } = useChatStreaming();
  const { deleteMessage, forkMessage } = useConversationActions();

  // Fold the retained variant groups over the live transcript: `view.messages`
  // is what to render (a selected frozen version swaps in its snapshot), and
  // `pagerByMessageId` says which message carries the version pager.
  const view = useMemo(
    () => buildMessageVariantView(messages, variantGroups, variantSelection),
    [messages, variantGroups, variantSelection],
  );
  const displayMessages = view.messages;

  // While a non-active version is selected the visible tail is a frozen snapshot
  // whose event ids no longer exist in the live session, so mutating actions
  // (edit/regenerate/delete/fork) are suppressed. Continuing the conversation
  // promotes the selected version first (handled in useChatStreaming.sendMessage).
  const viewingFrozenVersion = useMemo(
    () => resolvePendingPromotion(messages, variantGroups, variantSelection) !== null,
    [messages, variantGroups, variantSelection],
  );

  const selectVariant = useCallback((groupId: string, index: number) => {
    if (!activeMindId) return;
    dispatch({ type: 'SELECT_MESSAGE_VARIANT', payload: { mindId: activeMindId, groupId, index } });
  }, [dispatch, activeMindId]);

  // Regenerate re-runs the most recent user turn, so its availability depends on
  // that turn: it must be persisted and must not contain attachments, which
  // cannot be replayed yet.
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  const regenerateSupported = Boolean(lastUserMessage?.eventId) && !viewingFrozenVersion;
  const regenerateDisabledReason = lastUserMessage && hasAttachmentBlocks(lastUserMessage)
    ? REGENERATE_ATTACHMENT_REASON
    : undefined;
  const activeMind = minds.find(m => m.mindId === activeMindId);
  const activeProfile = activeMind ? profileByMindId[activeMind.mindId] : undefined;
  const agentName = activeMind ? profileName(activeProfile, activeMind.identity.name) : 'Agent';
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const lastMessageCountRef = useRef(messages.length);

  // perf-D3: window the transcript so only the rows near the viewport mount.
  // This layers on top of the per-row memoization and content-visibility hints;
  // it does not replace them.
  const getScroller = useCallback(() => scrollRef.current, []);
  const getWindowKey = useCallback(
    (index: number) => displayMessages[index]?.id ?? String(index),
    [displayMessages],
  );
  const { startIndex, endIndex, paddingTop, paddingBottom, measureElement, measureVersion } = useWindowedList({
    itemCount: displayMessages.length,
    getScrollElement: getScroller,
    getKey: getWindowKey,
    enabled: displayMessages.length > TRANSCRIPT_WINDOW_THRESHOLD,
  });

  const scrollToBottom = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    isAutoScrolling.current = true;
    setHasNewBelow(false);
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;

    // User-just-sent: when the newest message is a user message and the id has
    // changed since last render, override auto-scroll and snap to bottom. User
    // intent is unambiguous on Send -- they want to see what they wrote land.
    const latest = displayMessages[displayMessages.length - 1];
    const isNewUserMessage = latest?.role === 'user' && latest.id !== lastMessageIdRef.current;
    const grewByOne = displayMessages.length > lastMessageCountRef.current;

    if (isNewUserMessage) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      isAutoScrolling.current = true;
      setHasNewBelow(false);
    } else if (isAutoScrolling.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setHasNewBelow(false);
    } else if (grewByOne) {
      // New assistant message arrived while the user was scrolled up. Surface
      // the floating "New messages" pill instead of silently appending.
      setHasNewBelow(true);
    }

    lastMessageIdRef.current = latest?.id ?? null;
    lastMessageCountRef.current = displayMessages.length;
  }, [displayMessages]);

  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    if (!isAutoScrolling.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setHasNewBelow(false);
  }, [measureVersion]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Auto-scroll if within 100px of bottom
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    isAutoScrolling.current = nearBottom;
    if (nearBottom && hasNewBelow) setHasNewBelow(false);
  };

  return (
    <div className="chamber-fade-in relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="max-w-3xl mx-auto">
          {paddingTop > 0 && (
            <div data-window-spacer="top" aria-hidden="true" style={{ height: paddingTop }} />
          )}
          <div className="space-y-6">
            {displayMessages.slice(startIndex, endIndex).map((message, offset) => {
              const index = startIndex + offset;
              const presenter = messagePresenter(message, agentName, minds, profileByMindId);
              const avatarDataUrl = message.role === 'assistant'
                ? activeProfile?.avatarDataUrl
                : presenter.isAgentSender
                  ? presenter.avatarDataUrl
                  : userProfile?.avatarDataUrl;
              const isLastMessage = index === displayMessages.length - 1;
              const pager = view.pagerByMessageId.get(message.id);

              return (
                <div key={message.id} data-window-key={message.id} ref={measureElement}>
                  <MessageRow
                    message={message}
                    presenter={presenter}
                    avatarDataUrl={avatarDataUrl}
                    animate={isLastMessage}
                    launch={isLastMessage && message.role === 'user'}
                    isBusy={isBusy}
                    mutationsDisabled={viewingFrozenVersion}
                    onRegenerate={regenerate}
                    onDelete={deleteMessage}
                    onFork={forkMessage}
                    onEditSubmit={editAndResubmit}
                    regenerateSupported={isLastMessage && message.role === 'assistant' && regenerateSupported}
                    regenerateDisabledReason={regenerateDisabledReason}
                    availableModels={availableModels}
                    currentModel={selectedModel}
                    followingTurnCount={displayMessages.length - 1 - index}
                    pagerGroupId={pager?.groupId}
                    pagerIndex={pager?.index}
                    pagerCount={pager?.count}
                    onSelectVariant={selectVariant}
                  />
                </div>
              );
            })}
          </div>
          {paddingBottom > 0 && (
            <div data-window-spacer="bottom" aria-hidden="true" style={{ height: paddingBottom }} />
          )}
        </div>
      </div>
      {hasNewBelow && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Jump to latest message"
          className="absolute bottom-3 right-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowDown size={13} aria-hidden />
          New messages
        </button>
      )}
    </div>
  );
}

interface MessagePresenter {
  name: string;
  initial: string;
  color: string | undefined;
  isAgentSender: boolean;
  avatarDataUrl: string | null | undefined;
}

interface MessageRowProps {
  message: ChatMessage;
  presenter: MessagePresenter;
  avatarDataUrl: string | null | undefined;
  // Only the newest row plays the entry fade. Replaying it on every row when a
  // saved conversation loads reads as a laggy bulk fade.
  animate: boolean;
  // The newest row when it is the user's just-sent message: plays the launch
  // entrance instead of the generic fade.
  launch: boolean;
  // The active conversation is streaming, hydrating, or switching models.
  isBusy: boolean;
  onRegenerate: (model?: string) => void;
  onDelete: (message: ChatMessage) => void;
  onFork: (message: ChatMessage) => void;
  onEditSubmit: (message: ChatMessage, text: string) => void;
  // Whether this row may offer Regenerate (newest assistant turn whose target
  // user turn is persisted). Computed by the parent so the memoized row keeps
  // receiving primitives.
  regenerateSupported: boolean;
  regenerateDisabledReason: string | undefined;
  // Models offered by the one-shot regenerate submenu, and the mind's current
  // model to mark within it. Sourced from app state by the parent.
  availableModels: ModelInfo[];
  currentModel: string | null;
  // Number of turns after this one. Editing a user turn resubmits it and drops
  // everything after, so the editor warns when this is non-zero.
  followingTurnCount: number;
  // A non-active retained version is currently selected, so the visible tail is
  // a frozen snapshot. Mutating actions are suppressed until the user continues
  // the conversation, which promotes the selection to the live branch.
  mutationsDisabled: boolean;
  // Version pager metadata for this row, present only on the message that
  // carries the pager (assistant for regenerate, user for edit) when a group has
  // more than one branch. onSelectVariant is stable so the memoized row holds.
  pagerGroupId: string | undefined;
  pagerIndex: number | undefined;
  pagerCount: number | undefined;
  onSelectVariant: (groupId: string, index: number) => void;
}

// Memoized so an inbound message at the end of a long transcript doesn't force
// every prior message subtree (markdown + rehype-highlight + work-group cells)
// to re-render. content-visibility hint lets the browser skip layout/paint
// work for off-screen rows.
const MessageRow = memo(function MessageRow({
  message,
  presenter,
  avatarDataUrl,
  animate,
  launch,
  isBusy,
  onRegenerate,
  onDelete,
  onFork,
  onEditSubmit,
  regenerateSupported,
  regenerateDisabledReason,
  availableModels,
  currentModel,
  followingTurnCount,
  mutationsDisabled,
  pagerGroupId,
  pagerIndex,
  pagerCount,
  onSelectVariant,
}: MessageRowProps) {
  const [isEditing, setIsEditing] = useState(false);

  // A turn can be mutated only once it is persisted (has a backing event id).
  // Browser mode never reconciles ids, so these actions stay hidden there; on
  // desktop they appear a moment after the turn settles. While a frozen version
  // is shown the ids belong to a snapshot, so mutations are suppressed too.
  const canMutate = Boolean(message.eventId) && !mutationsDisabled;
  const handleDelete = useCallback(() => onDelete(message), [onDelete, message]);
  const handleFork = useCallback(() => onFork(message), [onFork, message]);
  const deleteAction = canMutate ? handleDelete : undefined;
  const fork = useMemo<RowAction | undefined>(
    () => canMutate ? { onRun: handleFork } : undefined,
    [canMutate, handleFork],
  );

  const regenerate = useMemo<RegenerateAction | undefined>(
    () => regenerateSupported
      ? { onRun: onRegenerate, disabledReason: regenerateDisabledReason, models: availableModels, currentModel }
      : undefined,
    [regenerateSupported, onRegenerate, regenerateDisabledReason, availableModels, currentModel],
  );

  const edit = useMemo<RowAction | undefined>(
    () => canMutate
      ? { onRun: () => setIsEditing(true), disabledReason: hasAttachmentBlocks(message) ? EDIT_ATTACHMENT_REASON : undefined }
      : undefined,
    [canMutate, message],
  );

  const handleSelectVariant = useCallback((index: number) => {
    if (pagerGroupId) onSelectVariant(pagerGroupId, index);
  }, [pagerGroupId, onSelectVariant]);

  const pager = pagerGroupId && typeof pagerCount === 'number' && pagerCount > 1
    ? (
      <MessageVariantPager
        index={pagerIndex ?? pagerCount - 1}
        count={pagerCount}
        onSelect={handleSelectVariant}
      />
    )
    : null;

  return (
    <div
      className={cn('group flex gap-3', launch ? 'chamber-launch' : animate && 'chamber-fade-in')}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 140px' } as React.CSSProperties}
    >
      <AgentAvatar
        name={presenter.name}
        avatarDataUrl={avatarDataUrl}
        className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-sm font-medium shrink-0"
        fallbackClassName={cn(
          message.role === 'assistant' ? 'bg-genesis text-primary-foreground' : 'bg-secondary text-secondary-foreground',
        )}
        style={presenter.isAgentSender ? { backgroundColor: presenter.color, color: readableTextColor(presenter.color) } : undefined}
        fallback={presenter.initial}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-sm font-medium"
            style={presenter.isAgentSender ? { color: presenter.color } : undefined}
          >
            {presenter.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTime(message.timestamp)}
          </span>
          {message.forkSeed && (
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-foreground/70">
              Prior context
            </span>
          )}
        </div>

        {message.role === 'assistant' ? (
          <>
            <StreamingMessage
              blocks={message.blocks}
              isStreaming={message.isStreaming}
              contextOnly={message.forkSeed}
            />
            {pager}
            {!message.isStreaming && getPlainContent(message).trim() && (
              <MessageActions
                message={message}
                isBusy={isBusy}
                regenerate={regenerate}
                fork={fork}
                onDelete={deleteAction}
              />
            )}
          </>
        ) : isEditing ? (
          <MessageEditor
            initialText={getPlainContent(message)}
            disabled={isBusy}
            followingTurnCount={followingTurnCount}
            onCancel={() => setIsEditing(false)}
            onSubmit={(text) => {
              setIsEditing(false);
              onEditSubmit(message, text);
            }}
          />
        ) : (
          <div className="space-y-2">
            {message.blocks
              .filter((b): b is Extract<typeof b, { type: 'image' }> => b.type === 'image')
              .map((img, idx) => (
                <img
                  key={`${img.name}-${idx}`}
                  src={img.dataUrl}
                  alt={img.name}
                  className="max-w-sm max-h-80 rounded-lg border border-border object-contain"
                />
              ))}
            {message.blocks
              .filter((b): b is Extract<typeof b, { type: 'attachment' }> => b.type === 'attachment')
              .map((attachment) => (
                <div
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                >
                  <FileText size={14} aria-hidden className="shrink-0" />
                  <span className="min-w-0 truncate font-medium text-foreground">{attachment.displayName}</span>
                  <span className="shrink-0">{attachment.mimeType || 'text/plain'}</span>
                  <span className="shrink-0">{formatAttachmentSize(attachment.size)}</span>
                </div>
              ))}
            {(() => {
              const plain = getPlainContent(message);
              if (!plain) return null;
              const skillContext = parseSkillContextInjection(plain);
              if (skillContext) {
                return <SkillContextChip name={skillContext.name} body={skillContext.body} />;
              }
              return (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {plain}
                </p>
              );
            })()}
            {pager}
            {!message.isStreaming && (
              <MessageActions
                message={message}
                isBusy={isBusy}
                edit={edit}
                fork={fork}
                onDelete={deleteAction}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Inline editor for a user turn. Submitting resends the edited prompt, which
 * replaces this turn and everything after it; Escape or Cancel discards. Cmd/Ctrl
 * plus Enter submits for keyboard users. When later turns exist, it warns that
 * they will be removed so the resubmit is never a silent multi-turn delete.
 */
function MessageEditor({
  initialText,
  disabled,
  followingTurnCount,
  onSubmit,
  onCancel,
}: {
  initialText: string;
  disabled: boolean;
  followingTurnCount: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const trimmed = text.trim();
  const rows = Math.min(10, Math.max(2, text.split('\n').length));

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && trimmed) {
            e.preventDefault();
            onSubmit(trimmed);
          }
        }}
        rows={rows}
        autoFocus
        aria-label="Edit message"
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {followingTurnCount > 0 && (
        <p className="text-[11px] text-muted-foreground" role="note">
          Resubmitting removes the {followingTurnCount === 1 ? 'turn' : `${followingTurnCount} turns`} after this one.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => trimmed && onSubmit(trimmed)}
          disabled={disabled || !trimmed}
          className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Save and submit
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Collapsed marker for a Copilot SDK skill-context injection. The SDK injects
 * a loaded skill (e.g. `lens`) into the conversation as a synthetic user turn;
 * rather than dumping the whole SKILL.md into the transcript, we show a compact
 * chip that expands on demand.
 */
function SkillContextChip({ name, body }: { name: string; body: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        {expanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        <Sparkles size={12} aria-hidden />
        <span>Loaded skill: {name}</span>
      </button>
      {expanded && (
        <pre className="max-h-80 overflow-auto border-t border-border px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {body}
        </pre>
      )}
    </div>
  );
}
