import { cva } from "class-variance-authority"

// Shared styling tokens for the popover-style menu primitives (dropdown-menu +
// context-menu). Both Radix primitives expose the same visual surface, so the
// class strings live here once instead of drifting between two files. Mirrors
// the popover/select surface (bg-popover, ring, shadow) already used in ui/.
export const menuContentClassName =
  "z-50 min-w-[9rem] overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 " +
  "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"

// Item vocabulary shared by both menus. `destructive` mirrors the row-action
// danger treatment used elsewhere (delete/remove) so the two menus stay honest.
export const menuItemVariants = cva(
  "relative flex w-full cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        neutral: "text-foreground focus:bg-accent focus:text-accent-foreground",
        destructive: "text-destructive focus:bg-destructive/10 focus:text-destructive",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
)

export const menuSeparatorClassName = "-mx-1 my-1 h-px bg-border"

export const menuLabelClassName = "px-2 py-1.5 text-xs font-medium text-muted-foreground"
