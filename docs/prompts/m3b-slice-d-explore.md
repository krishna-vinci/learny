# M3b Slice D, step 1: map the UI for a shadcn migration (READ-ONLY)

You are a READ-ONLY explorer in `/path/to/studium` (branch main). Do NOT modify, create or delete any file in the repo; do not install anything; do not run `npx shadcn`. Do not load orchestration skills or spawn agents.

Write your whole result to ONE file: `/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/m3b-d-uimap.md`.

## Why
We are moving `web/` to proper shadcn/ui components on Base UI (shadcn `base: "base"`, style `base-nova`), so the whole app looks consistent. A frontend agent will do the migration from your map, so it must be exact: file:line for everything.

## What to produce

1. **The current kit.** For each file in `web/src/components/ui/` (button, dialog, dropdown-menu, input, label, scroll-area, separator, switch, tooltip, focus.ts, popup.ts): its exports, its variants (cva), any Memos-specific extras, and how many files import it (count, plus the list if under 15).
2. **Hand-built UI patterns that should become shadcn components.** Grep `web/src` (excluding `components/ui`). For each pattern, give every occurrence with file:line and a one-line description:
   - **Card:** bordered/rounded container divs (e.g. `rounded-lg border`, `rounded-xl border bg-card`).
   - **Badge:** status/tier/count pills (e.g. `rounded-full px-2 text-xs`, the status chips "CHECKED", "RUNNING", "FAILED", tier badges A–D, counts).
   - **Tabs / ToggleGroup:** segmented controls (ReadingSettings, the card review filters, anything with an `aria-pressed` button row).
   - **Select:** native `<select>` or custom pickers.
   - **Textarea:** raw `<textarea>` (chat composer, note editor, forms).
   - **Checkbox / RadioGroup / Switch:** raw `<input type=checkbox|radio>`.
   - **Sheet / Drawer:** custom bottom sheets and full-screen overlays (`fixed inset-0`, `rounded-t-xl`, including NewChapterSheet, NewNoteDialog, NewSetDialog, AddSourceSheet, the activity sheet, ReadingSettings, the mobile chat dock, the mobile sidebar drawer, the note editor overlay, the history sheet).
   - **Alert:** warning/info/error callouts (e.g. conflict banners, `bg-warning/10`).
   - **Empty:** empty states ("No notes yet", "Nothing running", "No chats yet", …).
   - **Skeleton / Spinner:** loading text ("Loading…") and `animate-pulse`/`animate-spin`.
   - **Avatar:** user initials circles.
   - **Progress:** progress bars, if any.
   - **Separator:** `border-t`/`border-b` divider divs and `<hr>`.
   - **Toast:** every `react-hot-toast` import and call site, plus the `<Toaster>` mount.
   - **Table:** list/table layouts that would suit the shadcn Table (members, sessions, tokens, snapshots, jobs).
   - **Form layout:** label+input groups; note the repeated patterns (it becomes Field/FieldGroup).
   - **Raw `<button>`, `<input>`, `<select>`, `<textarea>`** that don't use the kit.
3. **Per page / component inventory.** A table: file → which of the patterns above it uses (counts) → estimated migration size (S/M/L). Cover everything under `web/src/pages/`, `web/src/components/` (Settings, Activity, Library, ChatDock, Reader, AppSidebar, NoteHistory, and the dialogs/sheets at the top level) and `web/src/layouts/`.
4. **Styling facts:**
   - `web/src/index.css` token names (the `:root` and `@theme inline` sections)
   - the font setup
   - the radius tokens
   - the path of the `cn()` helper
   - the tsconfig path alias for `@/`
   - the Tailwind version and how it's configured (Vite plugin? `@import "tailwindcss"`)
   - is there a `components.json`? (expected: no)
   - `web/package.json` UI deps and their versions
5. **Risks:**
   - components with non-trivial behaviour (drag, keyboard shortcuts, portals, focus traps, the `z-50`/portal rules for sheets opened from the phone drawer, the base-ui `onClick` vs `onSelect` rule)
   - tests that snapshot or query by class names
   - anything that would break if `dialog.tsx`/`dropdown-menu.tsx` were replaced with the shadcn versions

Note: another agent is changing `web/src/index.css`, `web/src/lib/reading-prefs.ts`, `web/index.html`, Settings/Appearance and the Reader highlight/mermaid code for themes right now in a different worktree. Map main as it is, and flag those files as "in flux".

End the file with a short **summary**: the top 10 migration items by visual impact, and the order you'd do them in.
