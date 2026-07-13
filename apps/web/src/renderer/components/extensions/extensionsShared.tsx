import type { ReactNode } from 'react';
import { Alert } from '../ui/alert';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';

/**
 * Shared empty / no-selection placeholder used across the Extensions tabs.
 * Thin adapter over the shared ui/EmptyState primitive so every tab renders one
 * dashed-card treatment instead of its own copy.
 */
export function TabEmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <EmptyState icon={icon} title={title} description={detail} />;
}

/**
 * Shared inline error banner used across the Extensions tabs. Delegates to the
 * shared ui/Alert primitive (destructive variant) so the banner stays legible
 * in both themes; the old hand-rolled markup used dark-only `text-red-200`.
 */
export function TabError({ message }: { message: string }) {
  return <Alert variant="destructive">{message}</Alert>;
}

/**
 * Shared loading placeholder used across the Extensions tabs. Standardizes on
 * the ui/Skeleton primitive so tabs no longer diverge between skeleton rows and
 * plain "Loading..." text.
 */
export function TabLoading({ label }: { label: string }) {
  return (
    <div aria-label={label} className="grid gap-3">
      <p className="text-sm text-muted-foreground">{label}...</p>
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}

