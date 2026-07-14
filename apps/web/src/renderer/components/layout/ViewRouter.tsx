import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppState } from '../../lib/store';
import { ChatPanel } from '../chat/ChatPanel';
import { ChatroomPanel } from '../chatroom/ChatroomPanel';
import { LensViewRenderer } from '../views/LensViewRenderer';
import { getVisibleLensViews } from '../../lib/lensVisibility';

const OperatorActivityView = lazy(async () => {
  const mod = await import('../activity/OperatorActivityView');
  return { default: mod.OperatorActivityView };
});
const SettingsView = lazy(async () => {
  const mod = await import('../settings/SettingsView');
  return { default: mod.SettingsView };
});
const ExtensionsView = lazy(async () => {
  const mod = await import('../extensions/ExtensionsView');
  return { default: mod.ExtensionsView };
});
const A2ARelayView = lazy(async () => {
  const mod = await import('../a2a/A2ARelayView');
  return { default: mod.A2ARelayView };
});

function LazyViewFallback() {
  return (
    <div role="status" className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
      Loading view...
    </div>
  );
}

export function ViewRouter() {
  const { activeMindId, activeView, discoveredViews, disabledLensViewKeys, featureFlags } = useAppState();
  const dispatch = useAppDispatch();
  const visibleViews = useMemo(
    () => getVisibleLensViews(discoveredViews, disabledLensViewKeys, activeMindId),
    [activeMindId, disabledLensViewKeys, discoveredViews],
  );

  useEffect(() => {
    const isDisabledActiveLens = discoveredViews.some((view) => view.id === activeView)
      && !visibleViews.some((view) => view.id === activeView);
    if (isDisabledActiveLens) {
      dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
    }
  }, [activeView, discoveredViews, dispatch, visibleViews]);

  if (activeView === 'chat') {
    return <ChatPanel />;
  }

  if (activeView === 'chatroom') {
    return <ChatroomPanel />;
  }

  if (activeView === 'activity') {
    return (
      <Suspense fallback={<LazyViewFallback />}>
        <OperatorActivityView />
      </Suspense>
    );
  }

  if (activeView === 'settings') {
    return (
      <Suspense fallback={<LazyViewFallback />}>
        <SettingsView />
      </Suspense>
    );
  }

  if (activeView === 'extensions') {
    return (
      <Suspense fallback={<LazyViewFallback />}>
        <ExtensionsView />
      </Suspense>
    );
  }

  if (activeView === 'a2a-relay' && featureFlags.switchboardRelay) {
    return (
      <Suspense fallback={<LazyViewFallback />}>
        <A2ARelayView />
      </Suspense>
    );
  }

  const view = visibleViews.find(v => v.id === activeView);
  if (view) {
    return <LensViewRenderer key={`${view.id}:${view.view}`} view={view} />;
  }

  // Fallback to chat if view not found
  return <ChatPanel />;
}
