import { RotateCcw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';

/**
 * Inline, actionable failure surface for the active mind's most recent turn.
 * Reuses the ui/Alert destructive variant (already `role="alert"`) so the copy
 * and both-theme contrast stay consistent with the rest of the app, and offers
 * a single Retry affordance wired to the existing regenerate path.
 */
export function ChatErrorNotice({
  message,
  onRetry,
  retryDisabled,
}: {
  message: string;
  onRetry: () => void;
  retryDisabled?: boolean;
}) {
  return (
    <div className="px-4 pb-2">
      <Alert variant="destructive" className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <AlertTitle>Message failed</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retryDisabled}>
          <RotateCcw aria-hidden="true" />
          Retry
        </Button>
      </Alert>
    </div>
  );
}
