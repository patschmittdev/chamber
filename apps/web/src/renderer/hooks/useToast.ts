import { useCallback } from 'react';
import { useAppDispatch } from '../lib/store';
import { generateId } from '../lib/utils';
import type { ToastNotification } from '../lib/store/state';

export interface NotifyInput {
  title?: string;
  message: string;
  variant?: ToastNotification['variant'];
}

/**
 * App-wide toast API. Decoupled from any feature: callers enqueue a notification
 * with `notify(...)` and the Toaster host (mounted once in AppShell) renders it.
 * `notify` returns the generated id so callers can dismiss programmatically.
 */
export function useToast() {
  const dispatch = useAppDispatch();

  const notify = useCallback((input: NotifyInput): string => {
    const id = generateId();
    dispatch({
      type: 'ENQUEUE_NOTIFICATION',
      payload: { id, title: input.title, message: input.message, variant: input.variant ?? 'default' },
    });
    return id;
  }, [dispatch]);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: 'DISMISS_NOTIFICATION', payload: { id } });
  }, [dispatch]);

  return { notify, dismiss };
}
