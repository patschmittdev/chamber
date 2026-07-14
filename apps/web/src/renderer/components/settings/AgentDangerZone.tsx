import { useState } from 'react';
import type { MindContext } from '@chamber/shared/types';
import { useAppDispatch } from '../../lib/store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

interface AgentDangerZoneProps {
  mind: MindContext;
  displayName: string;
}

const cancelButtonClass = 'rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50';
const removeButtonClass = 'rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50';

/**
 * Destructive per-mind actions for Settings > Agents. Removing an agent detaches
 * it from Chamber (its folder on disk is untouched) and is gated behind an
 * explicit confirmation so it cannot fire from a stray click.
 */
export function AgentDangerZone({ mind, displayName }: AgentDangerZoneProps) {
  const dispatch = useAppDispatch();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeConfirm = () => {
    setConfirmOpen(false);
    setError(null);
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await window.electronAPI.mind.remove(mind.mindId);
      dispatch({ type: 'REMOVE_MIND', payload: mind.mindId });
      setConfirmOpen(false);
    } catch {
      setError('Could not remove this agent. Try again.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <h4 className="text-sm font-semibold text-destructive">Danger zone</h4>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-xs text-muted-foreground">
          Remove this agent from Chamber. Its folder on disk is left untouched, so you can add it back later.
        </p>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="shrink-0 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
        >
          Remove agent
        </button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => (open ? setConfirmOpen(true) : closeConfirm())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {displayName}?</DialogTitle>
            <DialogDescription>
              This removes the agent from Chamber. Its folder on disk is not deleted, so you can add it again later.
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <button type="button" onClick={closeConfirm} disabled={removing} className={cancelButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleRemove();
              }}
              disabled={removing}
              className={removeButtonClass}
            >
              {removing ? 'Removing...' : 'Remove agent'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
