// Adapted from Memos (MIT) — https://github.com/usememos/memos
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { SIDEBAR_LEADING_SLOT_CLASSES, sidebarSurfaceVariants } from "./sidebar-layout";

export const SIDEBAR_ROW_BOX_CLASSES = `${sidebarSurfaceVariants({ role: "row" })} group transition-colors`;
export const SIDEBAR_ROW_FOCUS_CLASSES = FOCUS_VISIBLE_OUTLINE_CLASSES;
export const SIDEBAR_ROW_CLASSES = `${SIDEBAR_ROW_BOX_CLASSES} ${SIDEBAR_ROW_FOCUS_CLASSES}`;
export const SIDEBAR_ROW_ICON_CLASSES =
  "me-auto size-4 shrink-0 opacity-75 group-data-checked:text-primary group-data-checked:opacity-100";
const SIDEBAR_ROW_COUNT_CLASSES = "text-2xs tabular-nums text-muted-foreground/60 group-data-checked:text-primary";
export const SIDEBAR_ROW_SLOT_CLASSES = SIDEBAR_LEADING_SLOT_CLASSES;
export const SIDEBAR_ROW_COUNT_RAIL_CLASSES = `${SIDEBAR_ROW_COUNT_CLASSES} min-w-[3ch] shrink-0 text-end`;

export const SidebarRowIconSlot = ({ icon: Icon }: { icon: LucideIcon }) => (
  <span className={SIDEBAR_ROW_SLOT_CLASSES} aria-hidden="true">
    <Icon className={SIDEBAR_ROW_ICON_CLASSES} strokeWidth={1.8} />
  </span>
);

/**
 * One selected look per meaning: `current` is the place you are (the active note) and
 * fills the row; `checked` is a filter that is on. Disabled rows (unimplemented
 * sections) render dim and inert.
 */
export type SidebarRowState = "idle" | "current" | "checked";

const SIDEBAR_ROW_HOVER_CLASSES = "hover:bg-sidebar-accent/65 hover:text-foreground";

export const sidebarRowStateClasses = (state: SidebarRowState = "idle") => {
  if (state === "current") return "bg-sidebar-accent font-medium text-sidebar-accent-foreground";
  if (state === "checked") {
    return `relative font-medium text-foreground ${SIDEBAR_ROW_HOVER_CLASSES} before:absolute before:inset-y-1.5 before:-start-3 before:w-0.5 before:rounded-e-full before:bg-primary before:content-['']`;
  }
  return `text-muted-foreground ${SIDEBAR_ROW_HOVER_CLASSES}`;
};

interface Props {
  state?: SidebarRowState;
  icon?: LucideIcon;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
}

const SidebarRow = ({ state = "idle", icon: Icon, label, count, disabled, onClick, trailing }: Props) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={state !== "idle" || undefined}
    className={cn(
      SIDEBAR_ROW_CLASSES,
      sidebarRowStateClasses(state),
      disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
    )}
  >
    {Icon && <SidebarRowIconSlot icon={Icon} />}
    <span data-sidebar-label className="min-w-0 flex-1 truncate text-start">
      {label}
    </span>
    {count != null && count > 0 && <span className={SIDEBAR_ROW_COUNT_RAIL_CLASSES}>{count}</span>}
    {trailing}
  </button>
);

export default SidebarRow;
