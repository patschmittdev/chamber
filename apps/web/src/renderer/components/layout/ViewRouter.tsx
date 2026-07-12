import React, { useEffect, useMemo } from 'react';
import { useAppDispatch, useAppState } from '../../lib/store';
import { ChatPanel } from '../chat/ChatPanel';
import { ChatroomPanel } from '../chatroom/ChatroomPanel';
import { LensViewRenderer } from '../views/LensViewRenderer';
import { SettingsView } from '../settings/SettingsView';
import { A2ARelayView } from '../a2a/A2ARelayView';
import { ExtensionsView } from '../extensions/ExtensionsView';
import { getVisibleLensViews } from '../../lib/lensVisibility';
import { OperatorActivityView } from '../activity/OperatorActivityView';

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
    return <OperatorActivityView />;
  }

  if (activeView === 'settings') {
    return <SettingsView />;
  }

  if (activeView === 'extensions') {
    return <ExtensionsView />;
  }

  if (activeView === 'a2a-relay' && featureFlags.switchboardRelay) {
    return <A2ARelayView />;
  }

  const view = visibleViews.find(v => v.id === activeView);
  if (view) {
    return <LensViewRenderer key={`${view.id}:${view.view}`} view={view} />;
  }

  // Fallback to chat if view not found
  return <ChatPanel />;
}
