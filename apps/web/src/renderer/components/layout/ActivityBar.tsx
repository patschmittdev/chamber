import React from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';
import { isMac } from '../../lib/platform';
import { Activity, MessageSquare, Zap, Newspaper, Users, Clock, Settings, Layout, RadioTower, Blocks, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Separator } from '../ui/separator';
import type { LensViewManifest } from '@chamber/shared/types';
import { UpdateIndicator } from './UpdateIndicator';
import { getVisibleLensViews } from '../../lib/lensVisibility';

const iconMap: Record<string, LucideIcon> = {
  zap: Zap,
  newspaper: Newspaper,
  users: Users,
  clock: Clock,
  settings: Settings,
  layout: Layout,
  'message-square': MessageSquare,
};

function getIcon(iconName: string, size = 20): React.ReactNode {
  const Icon = iconMap[iconName] ?? Layout;
  return <Icon size={size} />;
}

export function ActivityBar() {
  const { activeMindId, activeView, discoveredViews, disabledLensViewKeys, featureFlags, chatroomStreamingByMind } = useAppState();
  const dispatch = useAppDispatch();
  const isChatroomRunning = Object.values(chatroomStreamingByMind).some(Boolean);
  const visibleViews = getVisibleLensViews(discoveredViews, disabledLensViewKeys, activeMindId);

  return (
    <div className="w-12 bg-card border border-border rounded-xl flex flex-col items-center py-2 shrink-0">
      {/* Clear the inset macOS traffic-light window controls (titleBarStyle: hiddenInset). */}
      {isMac && <div className="h-6 shrink-0" data-testid="activity-bar-mac-spacer" />}
      <div className="flex flex-col items-center gap-1 flex-1">
        {/* Chat — always present */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              aria-label="Chat"
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' })}
              className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                activeView === 'chat'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <MessageSquare size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>Chat</TooltipContent>
        </Tooltip>

        {/* Chatroom — always present */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              aria-label="Chatroom"
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chatroom' })}
              className={cn(
                'relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                activeView === 'chatroom'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <Users size={20} />
              {isChatroomRunning && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {isChatroomRunning ? 'Chatroom — agents running…' : 'Chatroom'}
          </TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              aria-label="Operator Activity"
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'activity' })}
              className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                activeView === 'activity'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <Activity size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>Operator Activity</TooltipContent>
        </Tooltip>

        {visibleViews.length > 0 && <Separator className="my-1 w-8" />}

        {/* Discovered views */}
        {visibleViews.map((view: LensViewManifest, index) => {
          const description = view.description?.trim();
          const descriptionId = description ? `activity-bar-lens-${index}-description` : undefined;

          return (
            <Tooltip key={view.id} delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  aria-label={view.name}
                  aria-describedby={descriptionId}
                  onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: view.id })}
                  className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                    activeView === view.id
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )}
                >
                  {getIcon(view.icon)}
                  {description && (
                    <span id={descriptionId} className="sr-only">
                      {description}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <div className="max-w-64">
                  <div className="font-medium">{view.name}</div>
                  {description && (
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">
                      {description}
                    </p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Bottom-pinned settings */}
      <div data-testid="activity-bar-footer" className="flex flex-col items-center gap-1">
        <UpdateIndicator />
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              aria-label="Extensions"
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'extensions' })}
              className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                activeView === 'extensions'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <Blocks size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>Extensions</TooltipContent>
        </Tooltip>
        {featureFlags.switchboardRelay && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                aria-label="A2A Relay"
                onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'a2a-relay' })}
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                  activeView === 'a2a-relay'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                <RadioTower size={20} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>A2A Relay</TooltipContent>
          </Tooltip>
        )}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              aria-label="Settings"
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'settings' })}
              className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                activeView === 'settings'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <Settings size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
