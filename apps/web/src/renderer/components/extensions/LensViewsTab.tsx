import { useAppState } from '../../lib/store';
import { Layout } from 'lucide-react';
import { Badge } from '../ui/badge';
import { TabEmptyState } from './extensionsShared';

export function LensViewsTab() {
  const { discoveredViews } = useAppState();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Lens views</h2>
        <p className="text-sm text-muted-foreground">
          Custom views discovered from your minds&apos; <code className="rounded bg-muted px-1 py-0.5 text-xs">.github/lens</code>{' '}
          directories. Each appears as an icon in the sidebar. This list is read-only.
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
          {discoveredViews.map((view) => (
            <li key={view.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{view.name}</span>
                <Badge variant="outline">{view.view}</Badge>
                <span className="text-xs text-muted-foreground">{view.id}</span>
              </div>
              {view.description && <p className="mt-1 text-sm text-muted-foreground">{view.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
