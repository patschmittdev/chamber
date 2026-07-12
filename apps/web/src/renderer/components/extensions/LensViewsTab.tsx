import { lensViewVisibilityKey } from '@chamber/shared';
import type { LensViewManifest } from '@chamber/shared/types';
import { Layout } from 'lucide-react';
import { useState } from 'react';
import { useAppDispatch, useAppState } from '../../lib/store';
import { isLensViewEnabled } from '../../lib/lensVisibility';
import { cn } from '../../lib/utils';
import { Logger } from '../../lib/logger';
import { Badge } from '../ui/badge';
import { TabEmptyState } from './extensionsShared';

const log = Logger.create('LensViewsTab');

export function LensViewsTab() {
  const { activeMindId, activeView, discoveredViews, disabledLensViewKeys } = useAppState();
  const dispatch = useAppDispatch();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const toggleView = async (view: LensViewManifest) => {
    if (!activeMindId) return;
    const enabled = !isLensViewEnabled(disabledLensViewKeys, activeMindId, view.id);
    const key = lensViewVisibilityKey(activeMindId, view.id);
    setPendingKey(key);
    try {
      const visibility = await window.electronAPI.lens.setViewEnabled(view.id, enabled, activeMindId);
      dispatch({ type: 'SET_LENS_VIEW_ENABLED', payload: visibility });
      if (!visibility.enabled && activeView === view.id) {
        dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
      }
    } catch (err) {
      log.error('Failed to update Lens view visibility:', err);
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Lens views</h2>
        <p className="text-sm text-muted-foreground">
          Custom views discovered from your minds&apos; <code className="rounded bg-muted px-1 py-0.5 text-xs">.github/lens</code>{' '}
          directories. Disable a view to hide it from navigation without deleting its files.
        </p>
      </div>

      {discoveredViews.length === 0 ? (
        <TabEmptyState
          icon={<Layout size={22} />}
          title="No Lens views discovered"
          detail="Minds can add view.json files under .github/lens to extend the UI."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {discoveredViews.map((view) => {
            const enabled = isLensViewEnabled(disabledLensViewKeys, activeMindId, view.id);
            const key = activeMindId ? lensViewVisibilityKey(activeMindId, view.id) : view.id;
            return (
              <li key={view.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{view.name}</span>
                      <Badge variant="outline">{view.view}</Badge>
                      <Badge variant={enabled ? 'secondary' : 'outline'}>
                        {enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{view.id}</span>
                    </div>
                    {view.description && <p className="mt-1 text-sm text-muted-foreground">{view.description}</p>}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? 'Disable' : 'Enable'} ${view.name}`}
                    disabled={!activeMindId || pendingKey === key}
                    onClick={() => { void toggleView(view); }}
                    className={cn(
                      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                      enabled ? 'bg-primary' : 'bg-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block size-5 rounded-full bg-background shadow transition-transform',
                        enabled ? 'translate-x-5' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
