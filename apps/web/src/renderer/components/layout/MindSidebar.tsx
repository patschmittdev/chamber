import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Plus, X, Bot, ExternalLink, UserCircle, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { RowActionOverflowMenu, RowContextMenu, ROW_ACTION_REVEAL, type RowActionItem } from '../ui/row-actions';
import { AgentAvatar } from '../profile/AgentAvatar';
import { useMindProfiles } from '../../hooks/useMindProfiles';
import { usePersistedCollapse } from '../../hooks/usePersistedCollapse';
import type { MindContext } from '@chamber/shared/types';

const MIN_WIDTH = 140;
const MAX_WIDTH = 400;
const STORAGE_KEY = 'chamber:sidebarWidth';
const AGENTS_COLLAPSED_STORAGE_KEY = 'chamber:agents-collapsed';

function statusColor(status: MindContext['status']): string {
  switch (status) {
    case 'ready': return 'bg-green-500';
    case 'loading': return 'bg-yellow-500 animate-pulse';
    case 'error': return 'bg-red-500';
    case 'unloading': return 'bg-muted-foreground';
    default: return 'bg-muted-foreground';
  }
}

export function MindSidebar({ autoCollapsed = false }: { autoCollapsed?: boolean }) {
  const { minds, activeMindId } = useAppState();
  const dispatch = useAppDispatch();
  const profileByMindId = useMindProfiles(minds);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(saved, 10))) : 192;
  });
  const [filter, setFilter] = useState('');
  const isResizing = useRef(false);
  const [manualCollapsed, setManualCollapsed] = usePersistedCollapse(AGENTS_COLLAPSED_STORAGE_KEY);
  const collapsed = autoCollapsed || manualCollapsed;

  const handleAddMind = async () => {
    dispatch({ type: 'SHOW_LANDING' });
  };

  const handleSwitchMind = (mind: MindContext) => {
    if (mind.windowed) {
      // Focus the popout window instead of switching in main
      window.electronAPI.mind.openWindow(mind.mindId);
    } else {
      window.electronAPI.mind.setActive(mind.mindId);
      dispatch({ type: 'SET_ACTIVE_MIND', payload: mind.mindId });
      dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
    }
  };

  const handlePopout = async (mindId: string) => {
    await window.electronAPI.mind.openWindow(mindId);
  };

  const handleProfile = (mind: MindContext) => {
    dispatch({ type: 'SET_PENDING_SETTINGS_INTENT', payload: { section: 'agents', mindId: mind.mindId } });
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'settings' });
  };

  const handleRemoveMind = async (mindId: string) => {
    await window.electronAPI.mind.remove(mindId);
    dispatch({ type: 'REMOVE_MIND', payload: mindId });
  };

  const buildActions = (mind: MindContext): RowActionItem[] => [
    { id: 'manage', label: 'Manage agent', icon: UserCircle, onSelect: () => handleProfile(mind) },
    { id: 'popout', label: 'Open in window', icon: ExternalLink, onSelect: () => handlePopout(mind.mindId) },
    { id: 'remove', label: 'Remove agent', icon: X, danger: true, separatorBefore: true, onSelect: () => handleRemoveMind(mind.mindId) },
  ];

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + ev.clientX - startX));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  if (minds.length === 0) return null;

  const normalizedFilter = filter.trim().toLowerCase();
  const visibleMinds = normalizedFilter
    ? minds.filter((mind) => {
        const displayName = profileByMindId[mind.mindId]?.displayName ?? mind.identity.name;
        return (
          mind.identity.name.toLowerCase().includes(normalizedFilter) ||
          displayName.toLowerCase().includes(normalizedFilter)
        );
      })
    : minds;

  if (collapsed) {
    return (
      <aside
        aria-label="Agents"
        className="shrink-0 w-10 bg-card border border-border rounded-xl overflow-hidden flex flex-col"
      >
        <button
          type="button"
          onClick={() => setManualCollapsed(false)}
          disabled={autoCollapsed}
          aria-label="Expand agents panel"
          className="m-1 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <ChevronRight size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Agents"
      className="relative bg-card border border-border rounded-xl overflow-hidden flex flex-col shrink-0"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/50 active:bg-accent z-10"
      />
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Agents</span>
        <button
          type="button"
          onClick={() => setManualCollapsed(true)}
          aria-label="Collapse agents panel"
          className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center"
        >
          <ChevronLeft size={15} />
        </button>
      </div>

      <div className="px-2 pb-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter agents"
            aria-label="Filter agents"
            className="focus-ring w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-7 text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label="Clear agent filter"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visibleMinds.map((mind) => {
          const displayName = profileByMindId[mind.mindId]?.displayName ?? mind.identity.name;
          const avatar = (
            <AgentAvatar
              name={displayName}
              avatarDataUrl={profileByMindId[mind.mindId]?.avatarDataUrl}
              className="h-[30px] w-[30px] shrink-0 rounded-md"
              fallback={<Bot size={24} className="shrink-0" aria-label={`${mind.identity.name} agent`} />}
            />
          );

          if (mind.windowed) {
            return (
              <div key={mind.mindId} className="group relative flex items-center">
                <button
                  type="button"
                  aria-label={`Focus ${mind.identity.name} window`}
                  onClick={() => handleSwitchMind(mind)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm transition-colors text-muted-foreground/60 italic hover:text-foreground hover:bg-accent/50"
                >
                  {avatar}
                  <div className={cn('w-2 h-2 rounded-full shrink-0', statusColor(mind.status))} />
                  <span className="truncate flex-1 text-left">{mind.identity.name}</span>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground/50">
                        <ExternalLink size={12} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right">In separate window</TooltipContent>
                  </Tooltip>
                </button>
              </div>
            );
          }

          const actions = buildActions(mind);
          return (
            <RowContextMenu key={mind.mindId} items={actions}>
              <div className="group relative flex items-center">
                <button
                  type="button"
                  aria-label={`Switch to ${mind.identity.name}`}
                  onClick={() => handleSwitchMind(mind)}
                  className={cn(
                    'w-full px-3 py-2 flex items-center gap-2 text-sm transition-colors',
                    mind.mindId === activeMindId
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  {avatar}
                  <div className={cn('w-2 h-2 rounded-full shrink-0', statusColor(mind.status))} />
                  <span className="truncate flex-1 text-left">{mind.identity.name}</span>
                </button>
                <div className="absolute inset-y-0 right-1 flex items-center">
                  <RowActionOverflowMenu
                    items={actions}
                    label={`More actions for ${mind.identity.name}`}
                    align="end"
                    triggerClassName={ROW_ACTION_REVEAL}
                  />
                </div>
              </div>
            </RowContextMenu>
          );
        })}
        {minds.length > 0 && visibleMinds.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No agents match your filter</p>
        ) : null}
      </div>

      <div className="border-t border-border p-2 space-y-1">
        <button
          onClick={handleAddMind}
          className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded flex items-center gap-2 transition-colors"
        >
          <Plus size={14} />
          Add Agent
        </button>
      </div>
    </aside>
  );
}
