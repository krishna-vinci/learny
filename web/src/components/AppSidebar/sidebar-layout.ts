// Adapted from Memos (MIT) — https://github.com/usememos/memos
import { cva } from "class-variance-authority";

/**
 * The sidebar is drawn on one shared rail: inset surfaces start 12px from the shell,
 * visible artwork starts at 20px, and first-level labels start at 44px. Rows reserve a
 * 20px artwork column.
 */
export const SIDEBAR_RAIL_CLASSES = "px-3";
export const SIDEBAR_LEADING_SLOT_CLASSES = "flex size-5 shrink-0 items-center justify-center";

/**
 * Brand controls hug their content, ordinary rows fill the inset rail. Heights stay
 * fixed so data cannot change a surface's padding or vertical position.
 */
export const sidebarSurfaceVariants = cva("min-w-0 items-center", {
  variants: {
    role: {
      row: "flex h-7 w-full gap-1 rounded-md px-2 text-ui",
      headerBrand: "flex h-9 max-w-full gap-2 rounded-md px-2",
      account: "flex h-9 w-full gap-1 rounded-none px-5",
    },
  },
  defaultVariants: {
    role: "row",
  },
});
