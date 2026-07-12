import type { AppState, AppAction } from '../state';
import { lensViewVisibilityKey, isLensViewVisibilityKeyForMind } from '@chamber/shared';
import { isReservedViewId } from '../../reservedViewIds';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

function setActiveView(_state: AppState, action: Extract<AppAction, { type: 'SET_ACTIVE_VIEW' }>): Partial<AppState> {
  return { activeView: action.payload };
}

function setFeatureFlags(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_FEATURE_FLAGS' }>,
): Partial<AppState> {
  return { featureFlags: action.payload };
}

function setDiscoveredViews(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_DISCOVERED_VIEWS' }>,
): Partial<AppState> {
  // Drop any discovered view that collides with a built-in route id so it can
  // neither shadow nor be shadowed by Chamber's own views (e.g. extensions).
  return { discoveredViews: action.payload.filter((view) => !isReservedViewId(view.id)) };
}

function setDisabledLensViewIds(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_DISABLED_LENS_VIEW_IDS' }>,
): Partial<AppState> {
  const otherMindKeys = state.disabledLensViewKeys.filter((key) =>
    !isLensViewVisibilityKeyForMind(key, action.payload.mindId),
  );
  const mindKeys = action.payload.viewIds.map((viewId) =>
    lensViewVisibilityKey(action.payload.mindId, viewId),
  );
  return { disabledLensViewKeys: [...new Set([...otherMindKeys, ...mindKeys])].sort() };
}

function setLensViewEnabled(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_LENS_VIEW_ENABLED' }>,
): Partial<AppState> {
  const key = lensViewVisibilityKey(action.payload.mindId, action.payload.viewId);
  const keys = new Set(state.disabledLensViewKeys);
  if (action.payload.enabled) {
    keys.delete(key);
  } else {
    keys.add(key);
  }
  const fallbackToChat = !action.payload.enabled
    && state.activeMindId === action.payload.mindId
    && state.activeView === action.payload.viewId;
  return {
    disabledLensViewKeys: [...keys].sort(),
    ...(fallbackToChat ? { activeView: 'chat' } : {}),
  };
}

function showLanding(): Partial<AppState> {
  return { showLanding: true };
}

function hideLanding(): Partial<AppState> {
  return { showLanding: false };
}

function accountSwitchStarted(
  _state: AppState,
  action: Extract<AppAction, { type: 'ACCOUNT_SWITCH_STARTED' }>,
): Partial<AppState> {
  return {
    runtimePhase: 'switching-account',
    switchingAccountLogin: action.payload.login,
    showLanding: false,
  };
}

function accountSwitchCompleted(): Partial<AppState> {
  return {
    runtimePhase: 'ready',
    switchingAccountLogin: null,
  };
}

function loggedOut(): Partial<AppState> {
  return {
    runtimePhase: 'ready',
    switchingAccountLogin: null,
  };
}

export const lifecycleHandlers: {
  SET_ACTIVE_VIEW: Handler<'SET_ACTIVE_VIEW'>;
  SET_FEATURE_FLAGS: Handler<'SET_FEATURE_FLAGS'>;
  SET_DISCOVERED_VIEWS: Handler<'SET_DISCOVERED_VIEWS'>;
  SET_DISABLED_LENS_VIEW_IDS: Handler<'SET_DISABLED_LENS_VIEW_IDS'>;
  SET_LENS_VIEW_ENABLED: Handler<'SET_LENS_VIEW_ENABLED'>;
  SHOW_LANDING: Handler<'SHOW_LANDING'>;
  HIDE_LANDING: Handler<'HIDE_LANDING'>;
  ACCOUNT_SWITCH_STARTED: Handler<'ACCOUNT_SWITCH_STARTED'>;
  ACCOUNT_SWITCH_COMPLETED: Handler<'ACCOUNT_SWITCH_COMPLETED'>;
  LOGGED_OUT: Handler<'LOGGED_OUT'>;
} = {
  SET_ACTIVE_VIEW: setActiveView,
  SET_FEATURE_FLAGS: setFeatureFlags,
  SET_DISCOVERED_VIEWS: setDiscoveredViews,
  SET_DISABLED_LENS_VIEW_IDS: setDisabledLensViewIds,
  SET_LENS_VIEW_ENABLED: setLensViewEnabled,
  SHOW_LANDING: showLanding,
  HIDE_LANDING: hideLanding,
  ACCOUNT_SWITCH_STARTED: accountSwitchStarted,
  ACCOUNT_SWITCH_COMPLETED: accountSwitchCompleted,
  LOGGED_OUT: loggedOut,
};
