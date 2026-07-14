import type { AppState, AppAction } from '../state';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

// Cap the visible queue so a burst of enqueues cannot grow the stack without
// bound; the oldest toasts fall off first. Auto-dismiss still trims the queue
// over time, this is only the hard ceiling.
const MAX_NOTIFICATIONS = 4;

function enqueueNotification(
  state: AppState,
  action: Extract<AppAction, { type: 'ENQUEUE_NOTIFICATION' }>,
): Partial<AppState> {
  const next = [...state.notifications, action.payload];
  return {
    notifications: next.length > MAX_NOTIFICATIONS ? next.slice(next.length - MAX_NOTIFICATIONS) : next,
  };
}

function dismissNotification(
  state: AppState,
  action: Extract<AppAction, { type: 'DISMISS_NOTIFICATION' }>,
): Partial<AppState> | AppState {
  if (!state.notifications.some((notification) => notification.id === action.payload.id)) return state;
  return {
    notifications: state.notifications.filter((notification) => notification.id !== action.payload.id),
  };
}

export const notificationsHandlers: {
  ENQUEUE_NOTIFICATION: Handler<'ENQUEUE_NOTIFICATION'>;
  DISMISS_NOTIFICATION: Handler<'DISMISS_NOTIFICATION'>;
} = {
  ENQUEUE_NOTIFICATION: enqueueNotification,
  DISMISS_NOTIFICATION: dismissNotification,
};
