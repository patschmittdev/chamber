import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useAppState } from '@/renderer/lib/store';
import { useToast } from '@/renderer/hooks/useToast';
import type { ToastNotification } from '@/renderer/lib/store/state';
import { Alert, AlertDescription, AlertTitle } from './alert';

// How long a toast stays up before auto-dismiss. Overridable per host (and by
// tests via fake timers) but feature code never needs to think about it.
const DEFAULT_DURATION_MS = 6_000;

function ToastItem({
  toast,
  durationMs,
  onDismiss,
}: {
  toast: ToastNotification;
  durationMs: number;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, durationMs, onDismiss]);

  return (
    <Alert variant={toast.variant} className="pointer-events-auto flex items-start justify-between gap-3 shadow-lg">
      <div className="min-w-0">
        {toast.title ? <AlertTitle>{toast.title}</AlertTitle> : null}
        <AlertDescription>{toast.message}</AlertDescription>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </Alert>
  );
}

/**
 * App-wide notification host. Mounted exactly once (in AppShell) and decoupled
 * from any feature: it renders the store's toast queue as stacked ui/Alert
 * banners with manual and auto dismiss. The container renders even when empty so
 * there is a single, stable host element in the tree.
 */
export function Toaster({ durationMs = DEFAULT_DURATION_MS }: { durationMs?: number }) {
  const { notifications } = useAppState();
  const { dismiss } = useToast();

  return (
    <div
      data-testid="toaster"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {notifications.map((toast) => (
        <ToastItem key={toast.id} toast={toast} durationMs={durationMs} onDismiss={dismiss} />
      ))}
    </div>
  );
}
