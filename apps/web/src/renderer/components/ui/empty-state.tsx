import * as React from "react"

import { cn } from "@/renderer/lib/utils"

// Shared empty / no-selection placeholder. Extracted from the Extensions tabs'
// local TabEmptyState so every surface uses one dashed-card treatment. Adds an
// optional `action` slot for the "nothing here yet, create one" pattern.
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center",
        className
      )}
      {...props}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="font-medium">{title}</div>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
