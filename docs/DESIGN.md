# Design system

How Studium's UI is built (M6 section 2). Read with `docs/UX.md` (rules and copy).

## Stack
- React 19, Tailwind 4, **shadcn/ui on Base UI** (`web/components.json`: style `base-nova`, `base: "base"`,
  lucide icons, aliases `@/components/ui`, `@/lib/utils`, `@/hooks`).
- Components live in `web/src/components/ui/`. Base UI primitives come from `@base-ui/react`.
- **Theme tokens are ours and are the single source of truth** (`web/src/index.css`: `:root` + the
  `data-theme` blocks for light, dark, sepia, black, system, and the 6 `data-accent` colours, plus the
  `@theme inline` mapping). Never let a generator overwrite them. Components use token classes only
  (`bg-card`, `text-muted-foreground`, `border-border`, `text-success`, …), never raw colours.

## Adding or updating a component
1. `cd web && npx shadcn@latest add <name> --dry-run` then `--diff` for files that already exist.
2. Smart-merge; keep our extras (below). If the CLI wants to write CSS variables, keep ours.
3. Replace hand-built markup with the component. Report any added package.

> The M6 environment could not reach `ui.shadcn.com` (network policy), so `badge`, `card`, `empty`,
> `skeleton` and `spinner` were written by hand to the base-nova structure. Run
> `npx shadcn@latest add badge card empty skeleton spinner --diff` locally and keep our token/variant
> additions when merging.

## Kept from our kit (do not overwrite)
- **Button:** variants `quiet`, sizes `icon-compact`, `icon-sm`, the `aria-pressed` accent and
  `data-popup-open:` state; `buttonVariants` stays exported (used for link-buttons).
- **Dialog:** built-in backdrop, `showClose`, bottom sheet on phones and centred from `sm:`.
- **Dropdown:** `modal={false}`; Base UI `Menu.Item` fires `onClick` (never `onSelect`).
- **Badge:** status variants below. **Skeleton/Spinner:** honour `prefers-reduced-motion`.
- Bespoke on purpose: `SidebarResizeHandle`, `ChatDock/ResizeHandle`, `Reader/Table`, `Reader/CodeBlock`,
  `NoteHistory/DiffView`.

## Type scale
`text-2xs` 11px (badges, meta) · `text-xs` 12px · `text-ui` 13px (quiet controls) · `text-sm` 14px (body in
lists) · `text-base` 16px (inputs on phones, card titles) · `text-lg` page titles. Reading text uses the
reader's own prefs. Inputs are 16px on phones (no iOS zoom), 14px from `md`.

## Spacing, radius, surfaces
- 4-px grid. Page padding `p-4` phone, `sm:p-6` from 640px. Content max width `max-w-4xl` (lists) and `max-w-3xl`
  (reading/forms). Gaps between sections `gap-6`; within a list `gap-2`.
- Radius from `--radius` (0.5rem): `rounded-md` controls, `rounded-lg` cards and list rows, `rounded-xl` sheets,
  `rounded-full` only for badges and avatars.
- Surfaces: page `bg-background`; raised `Card` (`bg-card` + `border-border/70`); popovers `bg-popover`;
  overlays `bg-overlay/50`. No shadows beyond `shadow-xs` on cards and `shadow-lg` on floating layers.
- Dividers: `Separator`, or `border-border/70` between list rows.
- z-ladder: header 20 · drawer 30 · chat button 40 · overlays 50 · dropdown 60 · tooltip 70.

## Status colours (Badge variants)
| Variant | Use | Tokens |
|---|---|---|
| `success` | done, approved, checked, source quality A | `bg-success/15 text-success` |
| `warning` | needs attention, stale, paused, quality C | `bg-warning/15 text-warning-foreground` |
| `destructive` | failed, rejected, blocker, overdue | `bg-destructive/15 text-destructive` |
| `tint` | active, running, exported, plan, counts, quality B | `bg-primary/15 text-primary` |
| `muted` | draft, queued, pending, archived, quality D | `bg-muted text-muted-foreground` |
| `accent` | "This device", chips on auth screens | `bg-accent text-accent-foreground` |
| `default`/`secondary`/`outline` | neutral emphasis | shadcn defaults |

`caps` adds uppercase + tracking for state words. Icons inside a badge are sized automatically.

## Component rules
- **Badge** for every pill. No hand-styled `rounded-full` spans.
- **Card** for raised content blocks (set cards, the Book card); lists of rows stay a bordered `ul`.
- **Empty** for every empty state: media icon, title (what this is), description (why it matters), one button
  (the next step). See `docs/UX.md` rule 7.
- **Skeleton** (`components/ListSkeleton.tsx`: `RowsSkeleton`, `PageSkeleton`, `ReaderSkeleton`) for lists and the
  reader while loading; sized like the content. **Spinner** only for an action in flight (a running job), never
  for page loads. No "Loading…" text.
- **Separator** instead of border divs where a standalone rule is needed.
- Icon-only buttons need `aria-label`; touch targets are 44 px on phones (`h-11 md:h-8`).
- Overlays opened from the phone drawer portal to `<body>`; phones get bottom sheets, desktop centred dialogs.

## Layout rhythm (mobile first)
Title row (`h1` + one primary action) → content sections separated by `gap-6` → sticky bottom action bar only
when a flow needs it (must clear the tab bar and chat button). One primary action per screen.

## Status of the migration
Done: `components.json`, Badge (all pills), Card/Empty/Skeleton/Spinner on Sets, Library, Library source, Cards,
To review, Activity (Jobs), Set home (Book card), sidebar and note loading. Left for later sections, only where
those screens are touched anyway: forms (Field/Textarea/Select/Checkbox), overlays (Sheet/AlertDialog replacing
the hand-rolled `createPortal`s and `window.confirm`), Tooltip API, Tabs, Table, Toast.
