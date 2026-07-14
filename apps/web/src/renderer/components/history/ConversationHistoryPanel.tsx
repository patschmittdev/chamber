import { Archive, ArchiveRestore, ChevronDown, ChevronLeft, ChevronRight, Download, FileJson, Pencil, Pin, Plus, Search, Trash2, X } from 'lucide-react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationExportFormat, ConversationSummary } from '@chamber/shared/types';
import { useAppDispatch, useAppState } from '../../lib/store';
import { useNewConversation } from '../../hooks/useNewConversation';
import { usePersistedCollapse } from '../../hooks/usePersistedCollapse';
import { useResizableRail } from '../../hooks/useResizableRail';
import { useWindowedList } from '../../hooks/useWindowedList';
import { usePrefetchNeighborHistory } from '../../hooks/usePrefetchNeighborHistory';
import { Logger } from '../../lib/logger';
import { cn } from '../../lib/utils';
import {
  conversationSearchText,
  filterConversations,
  getConversationSearchFeedback,
  normalizeSearchQuery,
} from './conversationSearch';
import {
  conversationDateGroupLabel,
  groupConversationsByDate,
  partitionConversations,
  resolveConversationDateGroup,
  summarizeConversationSections,
} from './conversationOrganize';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { RowActionOverflowMenu, RowContextMenu, ROW_ACTION_REVEAL, type RowActionItem } from '../ui/row-actions';
import { TooltipFor } from '../ui/tooltip';

const log = Logger.create('ConversationHistoryPanel');
const HISTORY_COLLAPSED_STORAGE_KEY = 'chamber:conversation-history-collapsed';
const HISTORY_WIDTH_STORAGE_KEY = 'chamber:conversation-history-width';
const ARCHIVED_EXPANDED_STORAGE_KEY = 'chamber:conversation-archived-expanded';
const MIN_WIDTH = 140;
const MAX_WIDTH = 400;
const SEARCH_DEBOUNCE_MS = 180;
const CONTENT_SEARCH_MIN_QUERY_LENGTH = 2;
const MAX_CONTENT_LOADS_PER_PASS = 8;

// rail-H8: the regular conversation list is the only unbounded bucket, so it
// windows past this row count. Pinned and archived stay fully rendered.
const HISTORY_WINDOW_THRESHOLD = 50;
// Approximate height of a conversation row; refined per-row by measurement.
const HISTORY_ROW_ESTIMATE_PX = 72;

interface CachedTranscriptText {
  updatedAt: string;
  text: string;
}

export function ConversationHistoryPanel({ autoCollapsed = false }: { autoCollapsed?: boolean }) {
  const { activeMindId, conversationHistoryByMind, activeConversationByMind, conversationViewByMind, streamingByMind } = useAppState();
  const dispatch = useAppDispatch();
  const newConversation = useNewConversation();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [organizingId, setOrganizingId] = useState<string | null>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<ConversationSummary | null>(null);
  const [loadingMindId, setLoadingMindId] = useState<string | null>(null);
  const [manualCollapsed, setManualCollapsed] = usePersistedCollapse(HISTORY_COLLAPSED_STORAGE_KEY);
  const [archivedExpandedPref, setArchivedExpandedPref] = usePersistedCollapse(ARCHIVED_EXPANDED_STORAGE_KEY);
  const { isResizing, resizeHandleProps, width } = useResizableRail({
    defaultWidth: 320,
    label: 'Resize history panel',
    maxWidth: MAX_WIDTH,
    minWidth: MIN_WIDTH,
    side: 'right',
    storageKey: HISTORY_WIDTH_STORAGE_KEY,
  });
  const collapsed = autoCollapsed || manualCollapsed;
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [contentIndexVersion, setContentIndexVersion] = useState(0);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const creatingConversationRef = useRef(false);
  const contentIndexByMind = useRef<Map<string, Map<string, CachedTranscriptText>>>(new Map());
  const contentLoadsInFlight = useRef<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const regularListRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const conversations = useMemo<ConversationSummary[] | undefined>(() => {
    if (!activeMindId) return undefined;
    return conversationHistoryByMind[activeMindId];
  }, [activeMindId, conversationHistoryByMind]);
  const visibleConversations = conversations ?? [];
  const freshSearchIndex = useMemo(() => {
    // contentIndexVersion forces recompute when best-effort content loads resolve.
    void contentIndexVersion;
    const mindIndex = activeMindId ? contentIndexByMind.current.get(activeMindId) : undefined;
    return mindIndex
      ? new Map(
          visibleConversations
            .filter((conversation) => mindIndex.get(conversation.sessionId)?.updatedAt === conversation.updatedAt)
            .map((conversation) => [conversation.sessionId, mindIndex.get(conversation.sessionId)!.text] as const),
        )
      : undefined;
  }, [visibleConversations, activeMindId, contentIndexVersion]);
  const filteredConversations = useMemo(
    () => filterConversations(visibleConversations, debouncedQuery, freshSearchIndex),
    [visibleConversations, debouncedQuery, freshSearchIndex],
  );
  const searchFeedback = useMemo(
    () => getConversationSearchFeedback(visibleConversations, debouncedQuery, freshSearchIndex),
    [visibleConversations, debouncedQuery, freshSearchIndex],
  );
  const { pinned: pinnedConversations, regular: regularConversations, archived: archivedConversations } = useMemo(
    () => partitionConversations(filteredConversations),
    [filteredConversations],
  );
  const sectionSummaries = useMemo(
    () => summarizeConversationSections({ pinned: pinnedConversations, regular: regularConversations, archived: archivedConversations }),
    [pinnedConversations, regularConversations, archivedConversations],
  );
  const pinnedSummary = sectionSummaries[0];
  const regularSummary = sectionSummaries[1];
  const archivedSummary = sectionSummaries[2];
  const pinnedGroups = useMemo(() => groupConversationsByDate(pinnedConversations), [pinnedConversations]);
  const archivedGroups = useMemo(() => groupConversationsByDate(archivedConversations), [archivedConversations]);

  usePrefetchNeighborHistory();

  const getHistoryScroller = useCallback(() => scrollContainerRef.current, []);
  const getRegularListElement = useCallback(() => regularListRef.current, []);
  const getRegularKey = useCallback(
    (index: number) => regularConversations[index]?.sessionId ?? String(index),
    [regularConversations],
  );
  const {
    startIndex: regularStart,
    endIndex: regularEnd,
    paddingTop: regularPaddingTop,
    paddingBottom: regularPaddingBottom,
    measureElement: measureRegularRow,
  } = useWindowedList({
    itemCount: regularConversations.length,
    getScrollElement: getHistoryScroller,
    getContentElement: getRegularListElement,
    getKey: getRegularKey,
    estimateSize: HISTORY_ROW_ESTIMATE_PX,
    enabled: regularConversations.length > HISTORY_WINDOW_THRESHOLD,
  });
  const isSearching = normalizeSearchQuery(debouncedQuery).length > 0;
  const archivedExpanded = archivedExpandedPref || isSearching;
  const selectedConversationId = activeMindId ? activeConversationByMind[activeMindId] : undefined;
  const activeConversationView = activeMindId ? conversationViewByMind[activeMindId] : undefined;
  const isActiveMindStreaming = activeMindId
    ? Boolean(streamingByMind[activeMindId] || activeConversationView?.streaming)
    : false;
  const isActiveMindBusy = isActiveMindStreaming || Boolean(activeConversationView?.modelSwitching);
  const isHistoryLoading = Boolean(activeMindId && loadingMindId === activeMindId && conversations === undefined);
  const selectedConversationError = selectedConversationId && activeConversationView?.sessionId === selectedConversationId
    ? activeConversationView.error
    : undefined;

  const applyResumeResult = useCallback((mindId: string, result: Awaited<ReturnType<typeof window.electronAPI.conversationHistory.resume>>) => {
    dispatch({
      type: 'RESUME_CONVERSATION',
      payload: {
        mindId,
        sessionId: result.sessionId,
        messages: result.messages,
        conversations: result.conversations,
      },
    });
  }, [dispatch]);

  const hydrateConversation = useCallback(async (mindId: string, sessionId: string) => {
    dispatch({ type: 'CONVERSATION_HYDRATING', payload: { mindId, sessionId } });
    try {
      const result = await window.electronAPI.conversationHistory.resume(mindId, sessionId);
      applyResumeResult(mindId, result);
      return result;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      dispatch({ type: 'CONVERSATION_HYDRATE_FAILED', payload: { mindId, sessionId, error: message } });
      log.warn('Failed to hydrate conversation:', error);
      throw error;
    }
  }, [applyResumeResult, dispatch]);

  useEffect(() => {
    if (!activeMindId) return;
    let cancelled = false;
    if (conversationHistoryByMind[activeMindId] === undefined) {
      setLoadingMindId(activeMindId);
    }
    window.electronAPI.conversationHistory.list(activeMindId).then((history) => {
      if (cancelled) return;
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMindId, conversations: history } });
      setLoadingMindId((current) => current === activeMindId ? null : current);
    }).catch((error: unknown) => {
      log.warn('Failed to load conversation history:', error);
      if (!cancelled) {
        setLoadingMindId((current) => current === activeMindId ? null : current);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeMindId, dispatch]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    setSearchQuery('');
    setDebouncedQuery('');
  }, [activeMindId]);

  // Best-effort content index for search: lazily load each conversation's
  // transcript (read-only, cached by sessionId + updatedAt) while a query is
  // active, so search can match message bodies without disturbing the active
  // chat. Loads are bounded per pass and re-run until every conversation is
  // cached. Title matching still works if a transcript fails to load.
  useEffect(() => {
    if (!activeMindId) return;
    const normalized = normalizeSearchQuery(debouncedQuery);
    if (normalized.length < CONTENT_SEARCH_MIN_QUERY_LENGTH) return;

    const mindId = activeMindId;
    let mindIndex = contentIndexByMind.current.get(mindId);
    if (!mindIndex) {
      mindIndex = new Map<string, CachedTranscriptText>();
      contentIndexByMind.current.set(mindId, mindIndex);
    }
    const index = mindIndex;

    const pending = visibleConversations.filter((conversation) => {
      if (conversation.hasMessages === false) return false;
      const cached = index.get(conversation.sessionId);
      if (cached && cached.updatedAt === conversation.updatedAt) return false;
      return !contentLoadsInFlight.current.has(`${mindId}:${conversation.sessionId}`);
    }).slice(0, MAX_CONTENT_LOADS_PER_PASS);
    if (pending.length === 0) return;

    void Promise.all(pending.map(async (conversation) => {
      const key = `${mindId}:${conversation.sessionId}`;
      contentLoadsInFlight.current.add(key);
      try {
        const messages = await window.electronAPI.conversationHistory.messages(mindId, conversation.sessionId);
        index.set(conversation.sessionId, { updatedAt: conversation.updatedAt, text: conversationSearchText(messages) });
      } catch (error) {
        index.set(conversation.sessionId, { updatedAt: conversation.updatedAt, text: '' });
        log.warn('Failed to load conversation content for search:', error);
      } finally {
        contentLoadsInFlight.current.delete(key);
      }
    })).then(() => {
      // Gate on mounted, not a per-run cleanup flag: a dep change (e.g. the next
      // keystroke) re-runs this effect, but the batch still finished and
      // populated the cache, so it must still trigger a recompute.
      if (isMountedRef.current) setContentIndexVersion((version) => version + 1);
    });
  }, [activeMindId, debouncedQuery, visibleConversations, contentIndexVersion]);

  useEffect(() => {
    if (!activeMindId || !selectedConversationId || isActiveMindBusy || creatingConversationRef.current) return;
    if (activeConversationView?.status === 'hydrating' && activeConversationView.pendingSessionId === selectedConversationId) return;
    if (activeConversationView?.status === 'ready' && activeConversationView.sessionId === selectedConversationId) return;
    if (
      activeConversationView?.status === 'idle'
      && activeConversationView.sessionId === selectedConversationId
      && activeConversationView.error
    ) return;

    void hydrateConversation(activeMindId, selectedConversationId).catch(() => {
      // The reducer records the failure; the warning above preserves diagnostics.
    });
  }, [
    activeConversationView?.error,
    activeConversationView?.pendingSessionId,
    activeConversationView?.sessionId,
    activeConversationView?.status,
    activeMindId,
    hydrateConversation,
    isActiveMindBusy,
    selectedConversationId,
  ]);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [renamingId]);

  const startRename = (conversation: ConversationSummary) => {
    setRenamingId(conversation.sessionId);
    setRenameValue(conversation.title);
  };

  const completeRename = async (sessionId: string, title: string | null) => {
    if (title && activeMindId) {
      const history = await window.electronAPI.conversationHistory.rename(activeMindId, sessionId, title);
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMindId, conversations: history } });
    }

    setRenamingId(null);
  };

  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (event.key === 'Enter') {
      void completeRename(id, renameValue.trim() || null);
    } else if (event.key === 'Escape') {
      setRenamingId(null);
    }
  };

  const resumeConversation = async (sessionId: string) => {
    if (!activeMindId || isActiveMindBusy) return;
    if (
      sessionId === selectedConversationId
      && activeConversationView?.status === 'ready'
      && activeConversationView.sessionId === sessionId
    ) return;
    try {
      await hydrateConversation(activeMindId, sessionId);
    } catch {
      return;
    }
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  };

  const startNewConversation = async () => {
    if (!activeMindId || isActiveMindBusy || isCreatingConversation) return;
    creatingConversationRef.current = true;
    setIsCreatingConversation(true);
    try {
      await newConversation(activeMindId);
    } catch (error) {
      log.error('Failed to start new conversation:', error);
    } finally {
      creatingConversationRef.current = false;
      setIsCreatingConversation(false);
    }
  };

  const performDeleteConversation = async (conversation: ConversationSummary) => {
    if (!activeMindId || isActiveMindBusy || deletingId) return;

    setDeletingId(conversation.sessionId);
    setRenamingId(null);
    try {
      const result = await window.electronAPI.conversationHistory.delete(activeMindId, conversation.sessionId);
      if (conversation.active) {
        applyResumeResult(activeMindId, result);
        dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
      } else {
        // Inactive delete: don't replace the active conversation's messages — the SDK→ChatMessage
        // mapping is text-only and would drop tool-calls/reasoning/images from the live chat UI.
        dispatch({
          type: 'SET_CONVERSATION_HISTORY',
          payload: { mindId: activeMindId, conversations: result.conversations },
        });
      }
    } catch (error) {
      log.error('Failed to delete conversation:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const deleteConversation = async (conversation: ConversationSummary) => {
    if (!activeMindId || isActiveMindBusy || deletingId) return;
    if (conversation.hasMessages) {
      setPendingDeleteConversation(conversation);
      return;
    }

    await performDeleteConversation(conversation);
  };

  const confirmDeleteConversation = () => {
    const conversation = pendingDeleteConversation;
    if (!conversation) return;
    setPendingDeleteConversation(null);
    void performDeleteConversation(conversation);
  };

  const exportConversation = async (conversation: ConversationSummary, format: ConversationExportFormat) => {
    if (!activeMindId || exportingId) return;
    setExportingId(conversation.sessionId);
    try {
      await window.electronAPI.conversationHistory.export(activeMindId, conversation.sessionId, format);
    } catch (error) {
      log.error('Failed to export conversation:', error);
    } finally {
      setExportingId(null);
    }
  };

  const togglePin = async (conversation: ConversationSummary) => {
    if (!activeMindId || organizingId) return;
    setOrganizingId(conversation.sessionId);
    try {
      const history = await window.electronAPI.conversationHistory.setPinned(
        activeMindId,
        conversation.sessionId,
        !conversation.isPinned,
      );
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMindId, conversations: history } });
    } catch (error) {
      log.error('Failed to update conversation pin state:', error);
    } finally {
      setOrganizingId(null);
    }
  };

  const toggleArchive = async (conversation: ConversationSummary) => {
    if (!activeMindId || organizingId) return;
    setOrganizingId(conversation.sessionId);
    try {
      const history = await window.electronAPI.conversationHistory.setArchived(
        activeMindId,
        conversation.sessionId,
        !conversation.isArchived,
      );
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMindId, conversations: history } });
    } catch (error) {
      log.error('Failed to update conversation archive state:', error);
    } finally {
      setOrganizingId(null);
    }
  };

  const renderConversationRow = (conversation: ConversationSummary) => {
    const isSelected = conversation.sessionId === selectedConversationId || conversation.active;
    const pinItem: RowActionItem = {
      id: 'pin',
      label: conversation.isPinned ? 'Unpin' : 'Pin',
      icon: Pin,
      disabled: organizingId !== null,
      onSelect: () => { void togglePin(conversation); },
    };
    const secondaryActions: RowActionItem[] = [
      {
        id: 'archive',
        label: conversation.isArchived ? 'Unarchive' : 'Archive',
        icon: conversation.isArchived ? ArchiveRestore : Archive,
        disabled: organizingId !== null,
        onSelect: () => { void toggleArchive(conversation); },
      },
      {
        id: 'export-markdown',
        label: 'Export as Markdown',
        icon: Download,
        disabled: exportingId !== null,
        onSelect: () => { void exportConversation(conversation, 'markdown'); },
      },
      {
        id: 'export-json',
        label: 'Export as JSON',
        icon: FileJson,
        disabled: exportingId !== null,
        onSelect: () => { void exportConversation(conversation, 'json'); },
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: Pencil,
        disabled: isActiveMindBusy || deletingId === conversation.sessionId,
        onSelect: () => startRename(conversation),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: Trash2,
        danger: true,
        separatorBefore: true,
        disabled: isActiveMindBusy || deletingId !== null,
        onSelect: () => { void deleteConversation(conversation); },
      },
    ];
    const contextActions: RowActionItem[] = [pinItem, ...secondaryActions];

    return (
      <RowContextMenu
        key={conversation.sessionId}
        items={contextActions}
        disabled={renamingId === conversation.sessionId}
      >
        <div
          className={cn(
            'group flex items-center gap-2 rounded-lg border-l-2 px-2 py-2 transition-colors',
            isSelected
              ? 'border-l-primary bg-accent text-foreground'
              : 'border-l-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
        >
          <button
            type="button"
            aria-label={`Resume ${conversation.title}`}
            disabled={isActiveMindBusy}
            onClick={() => { void resumeConversation(conversation.sessionId); }}
            className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
          >
            {renamingId === conversation.sessionId ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => handleRenameKeyDown(event, conversation.sessionId)}
                onBlur={() => { void completeRename(conversation.sessionId, renameValue.trim() || null); }}
                className="w-full rounded border border-primary bg-background px-1.5 py-0.5 text-sm text-foreground outline-none"
              />
            ) : (
              <>
                <TooltipFor label={conversation.title}>
                  <div className="truncate text-sm font-medium" title={conversation.title}>{conversation.title}</div>
                </TooltipFor>
                {conversation.forkOf && conversation.title !== `Fork of ${conversation.forkOf.sourceTitle}` && (
                  <div className="truncate text-xs text-muted-foreground">
                    Fork of {conversation.forkOf.sourceTitle}
                  </div>
                )}
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatRelativeTime(conversation.updatedAt)}
                  {conversation.active ? ' · Active' : ''}
                </div>
              </>
            )}
          </button>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => { void togglePin(conversation); }}
              disabled={organizingId !== null}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40',
                conversation.isPinned
                  ? 'text-primary opacity-100'
                  : 'text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
              )}
              aria-label={conversation.isPinned ? `Unpin ${conversation.title}` : `Pin ${conversation.title}`}
            >
              <Pin size={13} />
            </button>
            <RowActionOverflowMenu
              items={secondaryActions}
              label={`More actions for ${conversation.title}`}
              align="end"
              triggerClassName={ROW_ACTION_REVEAL}
            />
          </div>
        </div>
      </RowContextMenu>
    );
  };

  return (
    <aside
      aria-label="Conversation history"
      className={cn(
        'relative shrink-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col',
        isResizing ? 'transition-none' : 'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-10' : 'w-80',
      )}
      style={collapsed ? undefined : { width }}
    >
      {!collapsed ? (
        <div
          {...resizeHandleProps}
          className="absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent/50 focus-visible:w-1.5 focus-visible:bg-accent focus-visible:outline-none active:bg-accent"
        />
      ) : null}
      {collapsed ? (
        <button
          type="button"
          onClick={() => setManualCollapsed(false)}
          disabled={autoCollapsed}
          className="m-1 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          aria-label="Expand history panel"
        >
          <ChevronLeft size={15} />
        </button>
      ) : (
        <>
          <div className="h-10 border-b border-border px-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setManualCollapsed(true)}
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center"
                aria-label="Collapse history panel"
              >
                <ChevronRight size={15} />
              </button>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                History
              </span>
            </div>
            <button
              type="button"
              disabled={!activeMindId || isActiveMindBusy || isCreatingConversation}
              onClick={() => { void startNewConversation(); }}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              aria-label="New conversation"
            >
              <Plus size={15} />
            </button>
          </div>

          {activeMindId ? (
            <div className="border-b border-border px-2 py-2">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search conversations"
                  aria-label="Search conversations"
                  className="focus-ring w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-7 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-2">
            {!activeMindId ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Select an agent to see history</p>
            ) : isHistoryLoading ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Loading history...</p>
            ) : visibleConversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet</p>
            ) : filteredConversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No conversations match your search</p>
            ) : null}
            {isSearching && searchFeedback.resultCount > 0 ? (
              <div className="px-2 pb-2 text-xs text-muted-foreground">
                <p>
                  {searchFeedback.resultCount === 1 ? '1 result' : `${searchFeedback.resultCount} results`}.{' '}
                  {searchFeedback.titleMatchCount === 1 ? '1 title match' : `${searchFeedback.titleMatchCount} title matches`}.
                  {searchFeedback.contentOnlyMatchCount > 0
                    ? ` ${searchFeedback.contentOnlyMatchCount === 1 ? '1 content-only match' : `${searchFeedback.contentOnlyMatchCount} content-only matches`}.`
                    : ''}
                </p>
                {normalizeSearchQuery(debouncedQuery).length >= CONTENT_SEARCH_MIN_QUERY_LENGTH && searchFeedback.isIndexing ? (
                  <p>Indexing content {searchFeedback.indexedConversationCount}/{searchFeedback.indexableConversationCount}</p>
                ) : null}
              </div>
            ) : null}
            {selectedConversationError ? (
              <p role="alert" className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-2 text-xs text-destructive">
                {selectedConversationError}
              </p>
            ) : null}
            {pinnedSummary.count > 0 ? (
              <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pinned ({pinnedSummary.count})
              </div>
            ) : null}
            {pinnedGroups.map((group) => (
              <div key={`pinned-${group.id}`}>
                <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/90">{group.label}</div>
                {group.conversations.map(renderConversationRow)}
              </div>
            ))}
            {regularSummary.count > 0 ? (
              <div className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recent ({regularSummary.count})
              </div>
            ) : null}
            <div ref={regularListRef}>
              {regularPaddingTop > 0 ? (
                <div data-window-spacer="top" aria-hidden="true" style={{ height: regularPaddingTop }} />
              ) : null}
              {regularConversations.slice(regularStart, regularEnd).map((conversation, index) => {
                const absoluteIndex = regularStart + index;
                const groupId = resolveConversationDateGroup(conversation.updatedAt);
                const previousGroupId = absoluteIndex > 0
                  ? resolveConversationDateGroup(regularConversations[absoluteIndex - 1].updatedAt)
                  : null;
                const showGroupLabel = absoluteIndex === 0 || groupId !== previousGroupId;
                return (
                  <div key={conversation.sessionId} data-window-key={conversation.sessionId} ref={measureRegularRow}>
                    {showGroupLabel ? (
                      <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/90">
                        {conversationDateGroupLabel(groupId)}
                      </div>
                    ) : null}
                    {renderConversationRow(conversation)}
                  </div>
                );
              })}
              {regularPaddingBottom > 0 ? (
                <div data-window-spacer="bottom" aria-hidden="true" style={{ height: regularPaddingBottom }} />
              ) : null}
            </div>
            {archivedSummary.count > 0 ? (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => setArchivedExpandedPref(!archivedExpanded)}
                  aria-expanded={archivedExpanded}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-accent/50"
                >
                  <ChevronDown size={13} className={cn('transition-transform', archivedExpanded ? '' : '-rotate-90')} />
                  Archived ({archivedSummary.count})
                </button>
                {archivedExpanded
                  ? archivedGroups.map((group) => (
                    <div key={`archived-${group.id}`}>
                      <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/90">{group.label}</div>
                      {group.conversations.map(renderConversationRow)}
                    </div>
                  ))
                  : null}
              </div>
            ) : null}
          </div>
        </>
      )}
      <Dialog open={pendingDeleteConversation !== null} onOpenChange={(open) => {
        if (!open && !deletingId) setPendingDeleteConversation(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{pendingDeleteConversation?.title}"?</DialogTitle>
            <DialogDescription>
              This conversation cannot be restored after it is deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingDeleteConversation(null)}
              disabled={deletingId !== null}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteConversation}
              disabled={deletingId !== null}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              Delete conversation
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
