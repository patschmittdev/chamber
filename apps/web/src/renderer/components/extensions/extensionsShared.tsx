import type { ReactNode } from 'react';

/** Shared empty / no-selection placeholder used across the Extensions tabs. */
export function TabEmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <div className="font-medium">{title}</div>
      <p className="max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

/** Shared inline error banner used across the Extensions tabs. */
export function TabError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-red-200">
      {message}
    </div>
  );
}
