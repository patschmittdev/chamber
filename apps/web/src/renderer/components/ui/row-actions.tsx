import * as React from "react"
import { MoreHorizontal, type LucideIcon } from "lucide-react"

import { cn } from "@/renderer/lib/utils"
import { Button } from "./button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu"

/**
 * A single secondary action for a list row. One array of these drives both the
 * kebab overflow (RowActionOverflowMenu) and the right-click context menu
 * (RowContextMenu), so a surface declares its actions once and both discovery
 * paths stay in sync. `danger` selects the destructive item styling; wire
 * `onSelect` straight to the surface's existing per-row handler.
 */
export interface RowActionItem {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  /** Draw a divider above this item (skipped for the first item) to group actions. */
  separatorBefore?: boolean
}

function ItemContent({ item }: { item: RowActionItem }) {
  const Icon = item.icon
  return (
    <>
      <Icon aria-hidden />
      {item.label}
    </>
  )
}

function itemProps(item: RowActionItem) {
  return {
    disabled: item.disabled,
    variant: (item.danger ? "destructive" : "neutral") as "neutral" | "destructive",
    onSelect: () => item.onSelect(),
  }
}

const DEFAULT_TRIGGER_CLASSES =
  "size-7 shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"

/**
 * Canonical reveal classes for a row action trigger. Idle-hidden but surfaced on
 * hover, keyboard focus anywhere in the row, direct focus, and while its menu is
 * open. Shared across every row surface so the discoverability stance reads the
 * same in the rail, history, and message rows (shell-F4 / rail-H3).
 */
export const ROW_ACTION_REVEAL =
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"

/**
 * Persistent kebab overflow for a row's secondary actions. The trigger keeps an
 * accessible name (aria-label) and native tooltip (title); pass reveal classes
 * via `triggerClassName` so each surface controls its own hover/focus behaviour
 * while the open state always stays visible.
 */
export function RowActionOverflowMenu({
  items,
  label,
  align = "end",
  icon: Icon = MoreHorizontal,
  className,
  triggerClassName,
  onOpenChange,
}: {
  items: RowActionItem[]
  label: string
  align?: "start" | "center" | "end"
  icon?: LucideIcon
  className?: string
  triggerClassName?: string
  onOpenChange?: (open: boolean) => void
}) {
  if (items.length === 0) return null
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          title={label}
          className={cn(DEFAULT_TRIGGER_CLASSES, triggerClassName)}
        >
          <Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={className}>
        {items.map((item, index) => (
          <React.Fragment key={item.id}>
            {item.separatorBefore && index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem {...itemProps(item)}>
              <ItemContent item={item} />
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Wraps a row so right-clicking it opens the same action set as the kebab. When
 * there are no items (or `disabled`), it renders the row untouched so native
 * right-click behaviour is preserved for non-actionable rows.
 */
export function RowContextMenu({
  items,
  children,
  className,
  disabled,
}: {
  items: RowActionItem[]
  children: React.ReactElement
  className?: string
  disabled?: boolean
}) {
  if (disabled || items.length === 0) {
    return children
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={className}>
        {items.map((item, index) => (
          <React.Fragment key={item.id}>
            {item.separatorBefore && index > 0 ? <ContextMenuSeparator /> : null}
            <ContextMenuItem {...itemProps(item)}>
              <ItemContent item={item} />
            </ContextMenuItem>
          </React.Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
