# M3b Slice D, step 1 — UI map for the shadcn migration

> **Refreshed 2026-10-01 (M6 section 2).** The map below is from before M4. Current state of `web/src`:
> - Pills: all migrated to `components/ui/badge.tsx` (0 hand-built `rounded-full px-…` chips left).
> - Empty states: `ui/empty.tsx` on Sets, Library, Cards, To review (Inbox), Activity (Jobs); the dashed boxes that
>   remain are `SSOSection`, `AccessTokenSection`, `AddSourceSheet`, `CardFilePage`, `SignIn`, `SetHomePage`
>   ("how it works"), `TodayPage`.
> - Loading: skeletons on lists, reader, sidebar notes; 13 "Loading…" texts remain in Settings sections.
> - Hand-rolled overlays (`createPortal`): `ActivityIndicator`, `PlanSetSheet`, `NewNoteDialog`, `ReadingSettings`,
>   `ReaderPassages`, `NewChapterSheet`, `NewSetDialog`, plus the `AddSourceSheet` (fixed-position) and mobile chat.
> - Native `<select>`: `BackupsSection`, `ModelsSection`. Native `confirm()`: `NoteHistory`, `Reader`, `InboxPage`.
> - New since the map: M4 screens (Today, Search, plan review, docs-site tab, book card) and M4-7b sheets.
> - Design rules live in `docs/DESIGN.md`.


Read-only survey of `/path/to/studium` at branch `main`, commit `c589e1f`
("docs: model routing …"). Date 2026-09-30. Everything below is `main` as it is; the
following files are being changed in a different worktree and must be re-read before the
migration lands (flagged **[IN FLUX]** throughout):

- `web/src/index.css` (themes)
- `web/src/lib/reading-prefs.ts` (theme/accent added to the prefs blob)
- `web/index.html` (theme flash guard)
- `web/src/components/Settings/*` Appearance section (new)
- `web/src/components/Reader/highlight.ts`, `web/src/components/Reader/MermaidBlock.tsx`,
  Reader highlight/mermaid theming

Target: shadcn/ui on Base UI (`base: "base"`, style `base-nova`). Today the app is
Memos-derived: hand-rolled wrappers over `@base-ui/react` in `web/src/components/ui/`
plus many raw Tailwind patterns in the pages. There is **no `components.json`** and no
`shadcn` dependency anywhere, so the migration includes bootstrapping shadcn itself.

---

## 1. The current kit — `web/src/components/ui/`

Every file carries an `// Adapted from Memos (MIT)` notice unless noted. All of them use
`cn()` from `@/lib/utils`. Import paths are `@/components/ui/<name>`.

### `button.tsx` (63 lines) — exports `Button`, `buttonVariants`, types `ButtonVariant`, `ButtonSize`
- Wraps `@base-ui/react/button` (`ButtonPrimitive`); `forwardRef<HTMLElement>`.
- `cva` base (`button.tsx:9-12`): `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 …` + `FOCUS_VISIBLE_OUTLINE_CLASSES`; `[&_svg]` sizing rules.
- **variants** (`:15-28`): `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`, and a Memos-specific **`quiet`** (13px muted ink; `aria-pressed`/`aria-[current]`/`data-popup-open` → accent fill). `quiet` is used as the app's primary "toolbar icon button".
- **sizes** (`:30-37`): `default` (h-8 px-3), `sm` (h-7), `lg` (h-9), `icon` (size-8), `icon-compact` (size-7), `icon-sm` (size-6). `icon-compact` is the sidebar/chat standard.
- **compoundVariants** (`:40`): `quiet`+`sm` → `gap-1.5`.
- Memos-specific extras: `quiet`, `icon-compact`, `data-slot="button"`; `aria-pressed:` styling.
- Importers: **44** (button) — full list:
  `components/Activity/ActivityIndicator.tsx`, `components/Activity/ActivityPanelContent.tsx`,
  `components/Activity/JobToasts.tsx`, `components/AppSidebar/AppSidebar.tsx`,
  `components/ChatDock/ChatPanel.tsx`, `components/ChatDock/ChatPicker.tsx`,
  `components/ChatDock/DesktopChatDock.tsx`, `components/ChatDock/MobileChatDock.tsx`,
  `components/ConfirmDialog.tsx`, `components/IdentityProviderButtons.tsx`,
  `components/Library/AddSourceSheet.tsx`, `components/NewChapterSheet.tsx`,
  `components/NewNoteDialog.tsx`, `components/NewSetDialog.tsx`,
  `components/NoteHistory/NoteHistory.tsx`, `components/PasswordSignInForm.tsx`,
  `components/Reader/ImmersiveExitButton.tsx`, `components/Reader/Reader.tsx`,
  `components/Reader/ReadingSettings.tsx`, `components/Settings/AccessTokenSection.tsx`,
  `components/Settings/BackupsSection.tsx`, `components/Settings/DataSection.tsx`
  (only `buttonVariants`), `components/Settings/GeneralSection.tsx`,
  `components/Settings/InstanceSection.tsx`, `components/Settings/LinkedIdentitySection.tsx`,
  `components/Settings/MembersSection.tsx`, `components/Settings/ModelsSection.tsx`,
  `components/Settings/MyAccountSection.tsx`, `components/Settings/NotificationsSection.tsx`,
  `components/Settings/SSOSection.tsx`, `components/Settings/ServicesSection.tsx`,
  `components/Settings/SessionsSection.tsx`, `layouts/RootLayout.tsx`, `pages/AuthCallback.tsx`,
  `pages/CardFilePage.tsx`, `pages/CardsPage.tsx`, `pages/InboxPage.tsx`, `pages/JobsPage.tsx`,
  `pages/LibraryPage.tsx`, `pages/LibrarySourcePage.tsx`, `pages/SetsPage.tsx`,
  `pages/SettingsPage.tsx`, `pages/Setup.tsx`, `router.tsx`.
  `buttonVariants` alone: `CardFilePage.tsx:432`, `ChatPicker.tsx:23`, `AppSidebar.tsx:86`,
  `DataSection.tsx:15,21`.

### `dialog.tsx` (104 lines) — exports `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogPortal`, `DialogTitle`, `DialogTrigger`
- Wraps `@base-ui/react/dialog`. `Dialog/DialogTrigger/DialogClose/DialogPortal` are the primitives re-exported.
- `DialogContent` (`:28-58`) is **responsive**: bottom sheet on phone (`fixed inset-x-4 bottom-4 rounded-xl`), centered modal from `sm:` (`sm:start-1/2 sm:top-1/2 sm:w-full sm:max-w-md`). Motion via base-ui `data-starting-style`/`data-ending-style` translate/opacity/scale. Includes its own backdrop (`DialogBackdrop`, `:16-25`, `bg-overlay/50`) rendered inside the portal, plus a built-in close X (`:47-55`) unless `showClose={false}`.
- No `DialogOverlay` export (unlike shadcn); the backdrop is internal to `DialogContent`.
- Importers: **6** — `ConfirmDialog.tsx`, `Settings/AccessTokenSection.tsx`,
  `Settings/BackupsSection.tsx`, `Settings/MembersSection.tsx`,
  `Settings/MyAccountSection.tsx`, `Settings/SSOSection.tsx`.

### `dropdown-menu.tsx` (291 lines) — 17 exports
`DropdownMenu`, `DropdownMenuPortal`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuItem`, `DropdownMenuLinkItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubContent`, `DropdownMenuSubTrigger`.
- Wraps `@base-ui/react/menu`; `DropdownMenu` hardcodes `modal={false}` (`:9`).
- Memos-specific: a **`size` context** (`"default" | "sm"`) threaded through Content/Item/Label/Separator/Shortcut (`:19-21`, `DropdownMenuContent` `size` prop). `DropdownMenuLinkItem` exists so real `<a>` items keep open-in-new-tab (`:105-122`).
- Uses `popupMotionClasses` from `./popup`; positioner is `isolate z-dropdown`, popup `z-dropdown`, `origin-(--transform-origin)`.
- Importers: **3** — `AppSidebar/AppSidebar.tsx`, `AppSidebar/SetSwitcher.tsx`, `ChatDock/ChatPicker.tsx`.

### `input.tsx` (19 lines) — exports `Input`
- Plain `<input>` (`data-slot="input"`, `h-8 rounded-md border bg-transparent px-3 text-base md:text-sm shadow-xs`). Not a base-ui input (base-ui has no Input primitive). Importers: **15**:
  `ConfirmDialog.tsx`, `CredentialFields.tsx`, `Library/AddSourceSheet.tsx`,
  `NewChapterSheet.tsx`, `NewNoteDialog.tsx`, `NewSetDialog.tsx`,
  `Settings/AccessTokenSection.tsx`, `Settings/BackupsSection.tsx`,
  `Settings/InstanceSection.tsx`, `Settings/MembersSection.tsx`,
  `Settings/MyAccountSection.tsx`, `Settings/NotificationsSection.tsx`,
  `Settings/SSOSection.tsx`, `pages/LibraryPage.tsx`, `pages/Setup.tsx`.

### `label.tsx` (19 lines) — exports `Label`
- Plain `<label>` (`flex items-center gap-2 text-sm leading-none font-medium select-none` + peer-disabled). Importers: **12**:
  `ConfirmDialog.tsx`, `CredentialFields.tsx`, `NewChapterSheet.tsx`, `NewNoteDialog.tsx`,
  `NewSetDialog.tsx`, `Settings/AccessTokenSection.tsx`, `Settings/BackupsSection.tsx`,
  `Settings/MembersSection.tsx`, `Settings/MyAccountSection.tsx`,
  `Settings/NotificationsSection.tsx`, `Settings/SSOSection.tsx`, `pages/Setup.tsx`.

### `scroll-area.tsx` (15 lines) — exports `ScrollArea`
- **Not** a base-ui primitive; a thin native `<div className="overflow-auto [scrollbar-width:thin]">` that relies on the themed scrollbar in `index.css`. `forwardRef<HTMLDivElement>`.
- Importers: **2** — `ChatDock/ChatPanel.tsx`, `NoteHistory/NoteHistory.tsx`.
- **Critical**: `ChatPanel` passes a `ref` and an `onScroll` handler to this component and reads
  `el.scrollHeight / scrollTop / clientHeight` (`ChatPanel.tsx:149-194,220`). A shadcn/base-ui
  ScrollArea renders Root + Viewport, so ref/onScroll land on the Root and the measurements break
  (see Risks §5).

### `separator.tsx` (19 lines) — exports `Separator`
- Wraps `@base-ui/react/separator`; horizontal/vertical via `data-[orientation]`. Importers: **2** —
  `Settings/SettingGroup.tsx:25`, `pages/SignIn.tsx:47,51`.

### `switch.tsx` (25 lines) — exports `Switch`
- Wraps `@base-ui/react/switch` (`SwitchPrimitive.Root` + `.Thumb`); `h-6 w-10`, `data-[checked]` colors, thumb `data-[checked]:translate-x-[18px]`. Importers: **5** —
  `Settings/BackupsSection.tsx`, `Settings/InstanceSection.tsx`, `Settings/MembersSection.tsx`,
  `Settings/NotificationsSection.tsx`, `Settings/SSOSection.tsx`.

### `tooltip.tsx` (58 lines) — exports `Tooltip`, `TooltipContent`, `TooltipProvider`, `TooltipTrigger`
- Wraps `@base-ui/react/tooltip`. `TooltipProvider` defaults `delay=600 timeout=400`. Content uses
  `popupMotionClasses`, `z-tooltip`, and renders a `TooltipPrimitive.Arrow` (shadcn's base-nova
  tooltip is Text/Tooltip/Trigger with a different API — a real break; see Risks §5).
- Importers: **8** — `AppSidebar/AppSidebar.tsx`, `ChatDock/ChatDock.tsx` (provider only),
  `ChatDock/ChatPanel.tsx`, `ChatDock/DesktopChatDock.tsx`, `Reader/Citation.tsx`,
  `Settings/SettingRow.tsx`, `layouts/RootLayout.tsx`, `pages/LibraryPage.tsx`.

### `focus.ts` (9 lines) — exports `FOCUS_VISIBLE_OUTLINE_CLASSES`
- One string: `focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring/60`. Not a component.
- Importers: **1** — `AppSidebar/SidebarRow.tsx:4`. (`button.tsx` and `switch.tsx` import it
  relatively as `./focus`.)

### `popup.ts` (12 lines) — exports `popupMotionClasses`
- Shared enter/exit motion (`transition-[opacity,scale,translate] duration-150 data-starting-style:* data-ending-style:*` with per-side translate). The comment documents a layout gotcha: while a popup is open, Base UI inserts focus-guard siblings, so a `space-y-*` parent shifts — use `flex flex-col gap-*`.
- Importers: **2** — `ui/dropdown-menu.tsx:6`, `ui/tooltip.tsx:5` (relative `./popup`).

**Kit totals**: 9 component files + 2 class-string helpers, 634 lines total. No `card`,
`badge`, `select`, `textarea`, `checkbox`, `radio-group`, `sheet`, `alert`, `empty`,
`skeleton`, `avatar`, `progress`, `table`, `toast`, `tabs`, `toggle-group`, `field/sonner`
exists today — every one of those is hand-built in the app (section 2).

---

## 2. Hand-built UI patterns to replace with shadcn components

Scope: all of `web/src` excluding `components/ui/`. Line numbers are 1-based.

### 2.1 Card — bordered/rounded containers (`→ shadcn Card`)
Count of "card = `rounded-* border` wrapper" occurrences across the app is large (~60);
the ones that are real *cards* (a distinct content surface) rather than list rows/inputs:

- `components/AuthPageLayout.tsx:31` — auth card: `rounded-xl border border-border bg-card p-7 shadow-sm`.
- `pages/SetsPage.tsx:32` — study-set card (link): `rounded-lg border … bg-background p-3.5 shadow-xs` (grid `:79`).
- `pages/SetHomePage.tsx:41` — ActionButton tile: `rounded-lg border … bg-background p-3 shadow-xs`.
- `pages/CardFilePage.tsx:481` — card-edit surface `rounded-lg border border-border/70 p-5`.
- `pages/CardFilePage.tsx:491` — card review face `rounded-lg border border-border/70 p-5`.
- `components/Reader/ReadingSettings.tsx:126` — live-preview box `rounded-lg border … bg-background`.
- `components/Reader/CodeBlock.tsx:81` — `<pre>` frame `rounded-lg border border-border bg-muted/20`.
- `components/Reader/Table.tsx:11` — table frame `rounded-lg border border-border bg-muted/20`.
- `components/Reader/Directives.tsx:18` — callout box `rounded-lg border border-border bg-muted/20`.
- `components/Reader/Directives.tsx:31` — `:::deeper` `<details>` box.
- `components/Settings/SettingTable.tsx:29` — table card `rounded-lg border border-border`.
- `components/ChatDock/ToolCallChip.tsx:18` — chip container `rounded-md border …`.
- `components/Settings/ModelsSection.tsx:153,169` — per-model boxes `rounded-md border border-border/70 p-3`.
- `pages/InboxPage.tsx:145` — severity-issue group `rounded-md border p-3`.
- `pages/InboxPage.tsx:162` — rendered-note box `rounded-md border border-border/70 p-4`.
- `pages/LibrarySourcePage.tsx:54` — parsed-file panel `rounded-md border border-border/70`.
- `pages/SettingsPage.tsx:94` — phone section list `rounded-lg border border-border/70 p-1`.
- `pages/LibraryPage.tsx:106` — source row (card-like link) `rounded-lg border border-border/70`.
- `pages/SetHomePage.tsx:130` — "How it works" panel `rounded-lg border border-dashed border-border/70 p-4`.
- Dashed *empty-state* cards (also §2.9): `LibraryPage.tsx:68`, `SetsPage.tsx:66`,
  `SignIn.tsx:66`, `AccessTokenSection.tsx:175`, `SSOSection.tsx:418`, `SetHomePage.tsx:130`,
  `CardFilePage.tsx:496` (dashed reveal button), `AddSourceSheet.tsx:176` (dashed file picker).
- List-row surfaces grouped in one border (these are **list/table** candidates, not cards):
  `Settings/*` `rounded-xl border border-border` + `divide-y` (SessionsSection:37,
  AccessTokenSection:183, MembersSection:229, LinkedIdentitySection:37, NotificationsSection:154,
  SSOSection:426, BackupsSection:713), `Settings/ServicesSection.tsx:49`,
  `JobsPage.tsx:133,151`, `SetsPage.tsx:79`, `InboxPage.tsx:210`, `SetHomePage.tsx:223,252`,
  `CardsPage.tsx:127`.

### 2.2 Badge — status/tier/count pills (`→ shadcn Badge`)
Shared shape: `rounded-full px-2 py-0.5 text-2xs font-medium` (+ often `uppercase tracking-wide`).
Almost all of these are status/tier/count chips, i.e. Badge `variant="secondary"/"outline"` + custom colors.

**Status chips (job/card/set/inbox status):**
- `pages/JobsPage.tsx:14-33` — `STATUS_CLASSES` (queued/running/done/failed/cancelled) + `StatusChip` `:22-33`.
- `pages/CardsPage.tsx:20-21,68,78` — `STATUS_CHIP_CLASSES` (approved/rejected/…) + "needs review" warning pill `:68`.
- `pages/CardFilePage.tsx:52-63` — `StatusPill` (draft/approved/rejected/exported).
- `components/Activity/ActivityPanelContent.tsx:18-43` — `STATUS_CLASSES` + `StatusChip`.
- `pages/InboxPage.tsx:18-51,71` — severity badge classes, `StatusChip`, per-severity count pills.
- `pages/SetsPage.tsx:20-40` — `STATUS_CLASSES` (draft/active/paused/done) + `<span>` `:37`.
- `components/Settings/SessionsSection.tsx:45` — "This device" pill.
- `components/Settings/MembersSection.tsx:242` — "Archived" pill.
- `components/Settings/ModelsSection.tsx:176` — "later" pill.
- `components/AuthPageLayout.tsx:18` (`AuthChip`) and `pages/AdminSignIn.tsx:22-25` ("Admin" chip).

**Tier badges A–D (credibility):**
- `pages/library-utils.ts:8-20` — `TIER_CLASSES` A/B/C/D + `PENDING_BADGE`; `tierBadge()` `:31-40`.
- Rendered at `pages/LibraryPage.tsx:126` and `pages/LibrarySourcePage.tsx:94`.
- Note: `pages/library-utils.test.ts:25,31,32,36` asserts the exact class strings — a Badge
  migration must update these tests.

**Counts:**
- `components/Activity/ActivityIndicator.tsx:49-54` — activity count bubble `min-w-4 rounded-full bg-primary px-1 text-[10px]`.
- `pages/SetHomePage.tsx:107` — "Waiting on you" count `rounded-full bg-primary/15 px-2 text-xs`.
- `components/AppSidebar/SidebarRow.tsx:66` + `SIDEBAR_ROW_COUNT_RAIL_CLASSES` (`:13,15`) — sidebar row counts.
- `pages/CardsPage.tsx:78` — per-status count chips.

### 2.3 Tabs / ToggleGroup — segmented controls (`→ shadcn Tabs` / `ToggleGroup`)
There is **no** Tabs primitive; four distinct hand-rolled variants exist:
- `components/Reader/ReadingSettings.tsx:39-78` — `SegmentedGroup` (a `<fieldset>` of `aria-pressed`
  buttons; used for text size `:152`, line width `:171`, typeface `:180`, line spacing `:189`).
  This is the clearest `ToggleGroup`/`Tabs` candidate. **[IN FLUX]** (file is being edited).
- `pages/CardFilePage.tsx:449-465` — card review filter tabs (`REVIEW_FILTERS`, underline style
  `border-b-2`); state via `selectFilter` `:188-193`. This is a real `Tabs` candidate.
- `components/Library/AddSourceSheet.tsx:139-160` — Link/File segmented control (`bg-muted p-1`),
  `tab === "link" ? "bg-background shadow-xs" : …`.
- `components/Settings/BackupsSection.tsx:395-456` (`DESTINATION_OPTIONS` buttons, `:399-423`) —
  destination picker cards (`h-20 … rounded-md border`), `aria`-less but selected state at `:402-414`.

Other `aria-pressed` toggle buttons (icon toggles, not tab strips):
`components/Reader/Reader.tsx:317` (History), `:327` (Full screen);
`components/NoteHistory/NoteHistory.tsx:84` (commit selection);
`components/AppSidebar/SidebarRow.tsx:55` (row current/checked state).

### 2.4 Select — native or custom pickers (`→ shadcn Select`)
- `components/Settings/ModelsSection.tsx:32-78` — `SELECT_CLASSES` + `ModelSelect`, a native
  `<select>` with `<optgroup>`s `:65-77` (used `:159,183`). No custom popup; the role pickers
  (`:168-192`) are the main Select migration.
- `components/Settings/BackupsSection.tsx:506-518` — native `<select>` for restore user.
- `components/Settings/BackupsSection.tsx:521-531` — native `<select>` for restore scope.
- Custom "pickers" (not selects): `components/AppSidebar/SetSwitcher.tsx` (DropdownMenu),
  `components/ChatDock/ChatPicker.tsx` (DropdownMenu), `components/Settings/SSOSection.tsx:203-228`
  (template picker — inspect; it is a labelled button row).

### 2.5 Textarea — raw `<textarea>` (`→ shadcn Textarea`)
- `components/NewSetDialog.tsx:87-94` — set goal.
- `components/NewChapterSheet.tsx:84-91` — chapter brief.
- `components/Reader/Reader.tsx:119-125` — the note editor (monospace, full-bleed, not a form textarea).
- `components/Settings/BackupsSection.tsx:283-291` — rclone.conf multi-line field.
- `pages/CardFilePage.tsx:99-100` (shared `fieldClasses`), `:108,120,137,149` — card edit fields (Q/A/Text/Extra).
- `components/ChatDock/ChatPanel.tsx:268-276` — chat composer (Enter-to-send handled by `handleComposerKeyDown`).

### 2.6 Checkbox / RadioGroup / Switch (`→ shadcn Checkbox` / `RadioGroup`)
- Raw `<input type="checkbox">` (3):
  - `components/NewChapterSheet.tsx:100-104` — source multi-select (list of labels).
  - `components/Library/AddSourceSheet.tsx:193-198` — "Add to current set".
  - `components/Settings/BackupsSection.tsx:380-386` — "I've saved the recovery kit" gate.
- Raw `<input type="radio">`: **none**.
- Switch usage (the existing `ui/switch`, already base-ui) — no raw switch anywhere; 5 importers
  listed in §1. Roles/booleans that are *rendered as Switch* but are conceptually radio/checkbox:
  `MembersSection.tsx:89-100,143-154` (Admin/AI toggles), `InstanceSection.tsx:75-78`,
  `NotificationsSection.tsx:177-188`, `SSOSection.tsx:349-355`, `BackupsSection.tsx` (inside forms).
- Note: the checkbox rows are label-wrapped and unstyled (`size-4 shrink-0` or no class), so they
  are the lowest-fidelity controls in the app today — good early Checkbox wins.

### 2.7 Sheet / Drawer — custom bottom sheets and full-screen overlays (`→ shadcn Sheet` / `Drawer`)
Two families: **backdrop sheets** (portal to `<body>`, backdrop tap + Escape) and
**full-screen overlays** (`fixed inset-0 … bg-background`, no backdrop).

Backdrop sheets / modals (`fixed inset-0 … bg-overlay/50`, `rounded-t-xl … md:rounded-xl`):
- `components/NewSetDialog.tsx:55-61,60` — New study set (portal `:53`).
- `components/NewNoteDialog.tsx:48-55,54` — Write a note (portal `:47`).
- `components/NewChapterSheet.tsx:61-62` — New chapter (portal `:60`).
- `components/Library/AddSourceSheet.tsx:115-126` — Add source (`h-[100dvh]` → `sm:` centered card).
- `components/Reader/ReadingSettings.tsx:218-238` — Reading settings bottom sheet (portal `:217`)
  plus its desktop popover `:268-298` with an invisible click-catcher `:270-276`. **[IN FLUX]**
- `components/Activity/ActivityIndicator.tsx:105-121` — activity bottom sheet (portal `:104`);
  desktop popover `:138-156` with catch-all backdrop `:140-146`.

Full-screen overlays (`fixed inset-0 z-50 flex h-[100dvh] … bg-background`, no backdrop):
- `pages/LibrarySourcePage.tsx:30-48` — `ParsedFileSheet`.
- `components/Reader/Reader.tsx:89-127` — note editor overlay (`NoteEditor`).
- `components/NoteHistory/NoteHistory.tsx:153-183` — mobile history sheet.
- `components/ChatDock/MobileChatDock.tsx:36-46` — mobile chat dock.
- `components/AppSidebar/AppSidebar.tsx:359-369` — mobile sidebar drawer (`z-30`, not `z-50`).
- `components/Reader/Reader.tsx:347` — desktop/mobile History column (becomes full-screen < md via classes).

**Portal rule (must preserve):** sheets opened from the phone drawer portal to `<body>` because the
drawer builds a stacking context that would otherwise paint them under the chat FAB. Comments at
`NewSetDialog.tsx:51-52`, `NewNoteDialog.tsx:45-46`, `NewChapterSheet.tsx:58-59`,
`Activity/ActivityIndicator.tsx:103`, `ReadingSettings.tsx:205`. shadcn `Sheet`/`Dialog` portal by
default, so this is preserved *if* the new components are used as-is.

### 2.8 Alert — warning/info/error callouts (`→ shadcn Alert`)
- `pages/CardFilePage.tsx:414-417` — "Stale — the note changed …" (`border-warning/40 bg-warning/10`).
- `components/Reader/Reader.tsx:106-116` — edit-conflict banner (`border-warning/40 bg-warning/10`).
- `pages/InboxPage.tsx:127-131` — "blocker issues / not checked yet" warning.
- `components/Settings/ModelsSection.tsx:143-150` — drafter=checker / provider warnings.
- `components/Settings/SSOSection.tsx:342-356` — "auto-link by email" caution box.
- `components/Settings/BackupsSection.tsx:363-373` — destructive-restore warning box.
- `pages/JobsPage.tsx:89-95` — failed-job error text + warning icon row (not a boxed alert).
- `components/Settings/ServicesSection.tsx:12-27` — health rows with status dot (list, not alert).
- `pages/InboxPage.tsx:23-27,145` — severity section boxes (`border-destructive/40 bg-destructive/5` etc.).
- `pages/LibrarySourcePage.tsx:116` / `LibraryPage.tsx:112-118` — inline `text-amber-600` warning + tooltip.
- `components/Reader/MermaidBlock.tsx:74` — inline destructive "Mermaid Error".

### 2.9 Empty — empty states (`→ shadcn Empty`, or a shared component)
- `pages/LibraryPage.tsx:67-78` — "No sources yet" (icon + copy + CTA).
- `pages/LibraryPage.tsx:80-82` — "No sources match \"{query}\"."
- `pages/SetsPage.tsx:65-76` — "Create your first study set".
- `pages/SetHomePage.tsx:244-250` (`HowItWorks`, `:115-157`) — "How it works" for a new set.
- `pages/SetHomePage.tsx:243` — notes "Loading…" (see §2.10).
- `pages/CardsPage.tsx:82-85` — "No cards yet".
- `pages/CardsPage.tsx:103+` — "Loading cards…"/failure.
- `pages/JobsPage.tsx:130-132` — "Nothing running right now."; `:148-150` "No jobs yet."
- `pages/InboxPage.tsx:207-209` — "Nothing awaiting review."; `:136-137` "No check report yet."
- `components/AppSidebar/AppSidebar.tsx:98-100` — "No notes yet"; `:321` "Select a study set…".
- `components/ChatDock/ChatPanel.tsx:222` — "No chats yet. Type a message below to start one."
- `components/ChatDock/ChatPicker.tsx:29` — "No chats yet" (menu item).
- `components/NoteHistory/NoteHistory.tsx:104` — "No commits yet."; `:143` "Select a commit to view its diff."
- `components/Activity/ActivityPanelContent.tsx:153-155` — "Nothing running right now."
- `components/Settings/MembersSection.tsx:227` — "No members yet."
- `components/Settings/SessionsSection.tsx:35` — "No active sessions."
- `components/Settings/AccessTokenSection.tsx:174-181` — "No access tokens yet" (dashed box).
- `components/Settings/ServicesSection.tsx:50-52` — "No services configured."
- `components/Settings/SettingTable.tsx:41-46` — generic `emptyMessage` (default "No data").
- `router.tsx:48-59` — "Create your first study set" (pre-layout home).

### 2.10 Skeleton / Spinner — loading (`→ shadcn Skeleton` / `Spinner`)
- Bare "Loading…" text (`text-sm text-muted-foreground`), **15 sites**:
  `pages/LibraryPage.tsx:65`, `pages/SetsPage.tsx:63`, `pages/SetHomePage.tsx:243`,
  `pages/JobsPage.tsx:115` ("Loading jobs…"), `pages/NotePage.tsx:18`,
  `pages/LibrarySourcePage.tsx:18,73`, `pages/CardFilePage.tsx:395` ("Loading cards…"),
  `pages/CardsPage.tsx:112` ("Loading cards…"), `pages/InboxPage.tsx:163,186` ("Loading inbox…"),
  `components/NoteHistory/NoteHistory.tsx:102,115`, `components/Settings/ServicesSection.tsx:45`,
  `components/Settings/SessionsSection.tsx:33`, `components/Settings/AccessTokenSection.tsx:173`,
  `components/Settings/MembersSection.tsx:225`, `components/Settings/InstanceSection.tsx:47`,
  `components/Settings/NotificationsSection.tsx:80`, `components/Settings/ModelsSection.tsx:99`,
  `components/AppSidebar/AppSidebar.tsx:97`.
- `animate-spin` lucide spinners (12):
  `pages/AuthCallback.tsx:86`, `pages/SetHomePage.tsx:77`, `pages/JobsPage.tsx:61`,
  `pages/CardFilePage.tsx:439`, `pages/Setup.tsx:133`, `components/PasswordSignInForm.tsx:57`,
  `components/Activity/ActivityIndicator.tsx:48`, `components/Activity/ActivityPanelContent.tsx:73`,
  `components/Settings/ServicesSection.tsx:39`, `components/Library/AddSourceSheet.tsx:278`,
  `components/AppSidebar/AppSidebar.tsx:58`.
- `animate-pulse`: **none**.
- Skeleton placeholders: **none** — every load is text or spinner. (Skeleton is the biggest
  pure-add in this migration.)

### 2.11 Avatar — user initials circles (`→ shadcn Avatar`)
- `components/AppSidebar/AppSidebar.tsx:246-248` — sidebar footer initials (`size-7 rounded-full bg-accent`).
- `components/Settings/MyAccountSection.tsx:172-174` — profile initials (`size-12 rounded-full bg-accent`).
- No image avatars rendered today (the SSO `avatarUrl` mapping at `SSOSection.tsx:76,111,126,324-330`
  is stored/configured but never displayed).

### 2.12 Progress — progress bars (`→ shadcn Progress`)
- **None.** Job progress is text only: `jobs.progress` rendered as a string at
  `components/Activity/ActivityPanelContent.tsx:87`, `pages/JobsPage.tsx:65`,
  `pages/SetHomePage.tsx:80`, `components/AppSidebar/AppSidebar.tsx:62`,
  `components/Library/AddSourceSheet.tsx:280`. (Progress is still a worthwhile add.)

### 2.13 Separator — divider divs and `<hr>`
- The kit `Separator` is used twice (§1). Hand-rolled divider divs:
  `components/AppSidebar/AppSidebar.tsx:310` (`border-t` rail divider),
  `components/Settings/SettingGroup.tsx:25` (via kit).
- `border-t` / `border-b` section dividers inside panels are everywhere (~50; full list in
  the pattern grep) — the migration should leave most inline (they are layout, not Separator)
  but replace the standalone `<div className="mx-3 mt-2 border-t …" />` ones.
- No raw `<hr>` in JSX (only in `index.css` prose styling).
- `divide-y divide-border` grouped lists: see §2.15 (Table) and Settings list boxes.

### 2.14 Toast — `react-hot-toast` (`→ shadcn Sonner`, or keep)
31 files import `toast`/`Toaster`; ~97 `toast.*`/`toast(…)` call sites (grep). Full import list:
`main.tsx:4` (Toaster), `pages/useSignOut.ts:3`, `pages/JobsPage.tsx:6`, `pages/CardsPage.tsx:10`,
`pages/InboxPage.tsx:6`, `pages/CardFilePage.tsx:9`, `pages/Setup.tsx:6`,
`components/NewSetDialog.tsx:6`, `components/NewNoteDialog.tsx:5`, `components/NewChapterSheet.tsx:6`,
`components/PasswordSignInForm.tsx:8`, `components/IdentityProviderButtons.tsx:6`,
`components/Reader/Reader.tsx:4`, `components/Activity/JobToasts.tsx:7`,
`components/Activity/ActivityPanelContent.tsx:8`, `components/Activity/job-start-toast.tsx:1`,
`components/ChatDock/useChatDock.ts:7`, `components/Library/AddSourceSheet.tsx:10`,
`components/NoteHistory/NoteHistory.tsx:5` (default import!), and the Settings sections:
`AccessTokenSection.tsx:7`, `BackupsSection.tsx:6`, `InstanceSection.tsx:5`,
`LinkedIdentitySection.tsx:6`, `MembersSection.tsx:8`, `ModelsSection.tsx:6`,
`MyAccountSection.tsx:6`, `NotificationsSection.tsx:6`, `SSOSection.tsx:7`, `SessionsSection.tsx:6`.

`<Toaster />` mount: `main.tsx:36` (inside `QueryClientProvider`, after `RouterProvider`).
Non-trivial toast usages (need Sonner equivalents):
- `components/Activity/JobToasts.tsx:89-153` — custom JSX toasts, manual cap at 3, `toast.custom`
  nudge with actions, `position: "bottom-center"`, 8–10 s durations.
- `components/Activity/job-start-toast.tsx:6-21` — JSX body + "View" action, 8 s.
- Full call-site list is in the grep in this session; representative: `CardFilePage.tsx:321-382`,
  `MembersSection.tsx:42-209`, `BackupsSection.tsx:139-645`, `ModelsSection.tsx:124-126`,
  `useChatDock.ts:79-119`, `Reader/Reader.tsx:67,151`.

### 2.15 Table — list/table layouts suited to shadcn Table
- `components/Settings/SettingTable.tsx:28-70` — the only real generic `<table>` (used by? — grep
  shows it is **not imported anywhere** today; a dead helper, or used only via Settings sections
  that no longer exist — verify before deleting).
- `components/Reader/Table.tsx:11-82` — markdown-rendered tables (semantic; do **not** convert).
- Row-list layouts that read as tables (each row = icon + primary + meta + actions, wrapped in one
  bordered `divide-y` box):
  - `components/Settings/MembersSection.tsx:229-277` — members.
  - `components/Settings/SessionsSection.tsx:37-66` — sessions.
  - `components/Settings/AccessTokenSection.tsx:183-205` — tokens.
  - `components/Settings/NotificationsSection.tsx:154-172` — push subscriptions.
  - `components/Settings/SSOSection.tsx:426-460` — identity providers.
  - `components/Settings/BackupsSection.tsx:713-` — snapshots (largest; see file).
  - `components/Settings/LinkedIdentitySection.tsx:37-55` — linked identities.
  - `components/Settings/ServicesSection.tsx:12-28` — services.
  - `pages/JobsPage.tsx:56-98,133,151` — running/recent jobs.
  - `pages/CardsPage.tsx:59-90` — card-file rows.
  - `pages/InboxPage.tsx:53-80` — inbox rows.
  - `pages/SetHomePage.tsx:52-113,223,252` — note rows / waiting rows / notes list.
  - `pages/LibraryPage.tsx:98-131` — source rows.
  - `components/Activity/ActivityPanelContent.tsx:45-110` — job rows.
  - `components/NoteHistory/NoteHistory.tsx:77-98` — commit list.

### 2.16 Form layout — label+input groups (`→ shadcn Field` / `FieldGroup`)
The repeated pattern is a bare `<div className="flex flex-col gap-1.5">` wrapping `<Label>` + `<Input>`
(+ a `<p className="text-xs text-muted-foreground">` hint). Occurrences:
- `components/CredentialFields.tsx:18-32,33-47` — username/password pair (also `mt-1` variant).
- `pages/Setup.tsx:70-86,87-97,98-108,109-121` — four fields.
- `components/Settings/MyAccountSection.tsx:48-55,115-125,127-137,138-148`.
- `components/Settings/AccessTokenSection.tsx:72-81,82-92` and `ConfirmDialog.tsx:69-81`.
- `components/Settings/MembersSection.tsx:63-77,78-88,155-165`.
- `components/Settings/SSOSection.tsx:229-241,262-341` (many).
- `components/Settings/BackupsSection.tsx:81-135,175-256,265-291,438-448,505-539`.
- `components/Settings/NotificationsSection.tsx:104-130` (label+input on `mt-1.5`).
- `components/NewSetDialog.tsx:70-95`, `NewNoteDialog.tsx:63-77`, `NewChapterSheet.tsx:71-111`.
- Inline label+control with `mt-1`/`mt-2` instead of the stack: `pages/CardFilePage.tsx:104-114,117-126,134-143,146-155`,
  `components/Settings/ModelsSection.tsx:154-165,170-190`, `components/Settings/InstanceSection.tsx:55-79`.
- There is also a one-off `SettingRow` (`components/Settings/SettingRow.tsx`) and `SettingGroup`
  (`SettingGroup.tsx`) and `SettingSection` (`SettingSection.tsx`) — the Settings-specific form
  scaffolding that shadcn `Field` should probably subsume.

### 2.17 Raw `<button>` that does not use the kit
33 raw `<button>` elements (35 grep hits; 2 are comment text about `<button>` at CardFilePage.tsx:487-488) vs 130 `<Button>` usages. Each one, with why it is raw:
- `pages/LibraryPage.tsx` — none raw.
- `pages/LibrarySourcePage.tsx:127` — parsed-file row button.
- `pages/SettingsPage.tsx:29` — section nav item.
- `pages/CardFilePage.tsx:451` — review filter tab; `:494` — "Tap to reveal" button (comment at
  `:486-490` explains it cannot be a `Button` because the card face contains a copy button).
- `pages/CardsPage.tsx:59` — card-file row button.
- `pages/Setup.tsx:123` — "I have a setup code" text button.
- `pages/InboxPage.tsx:57` — inbox row button.
- `pages/SetHomePage.tsx:38` — `ActionButton`; `:71` — drafting row.
- `components/Library/AddSourceSheet.tsx:120` — backdrop; `:140,150` — Link/File tabs;
- `components/AppSidebar/AppSidebar.tsx:51` — drafting row; `:238` — user footer; `:360` — drawer backdrop.
- `components/AppSidebar/SidebarRow.tsx:51` — nav row (uses `focus.ts` + cva).
- `components/NewNoteDialog.tsx:54`, `NewSetDialog.tsx:60` — backdrops.
- `components/ChatDock/ChatPanel.tsx:37` — "view activity" link-button; `:256` — jump-to-latest FAB.
- `components/ChatDock/ToolCallChip.tsx:24` — chip expander.
- `components/ChatDock/MobileChatDock.tsx:25` — chat FAB.
- `components/Activity/ActivityIndicator.tsx:106` (sheet backdrop), `:140` (popover backdrop).
- `components/Reader/ReadingSettings.tsx:58` (segment), `:219` (sheet backdrop), `:270` (popover backdrop). **[IN FLUX]**
- `components/Reader/CodeBlock.tsx:84` — copy button.
- `components/Activity/JobToasts.tsx:28` — toast action.
- `components/Settings/SSOSection.tsx:208` — template row.
- `components/Settings/BackupsSection.tsx:399` — destination option.
- `components/NoteHistory/NoteHistory.tsx:81` — commit row.
- `components/Activity/job-start-toast.tsx:9` — toast "View" action.

**Raw `<input>`, `<select>`, `<textarea>`** that bypass the kit: see §2.4–2.6 (inputs at
`NewChapterSheet.tsx:100`, `BackupsSection.tsx:380`, `AddSourceSheet.tsx:177,193`; selects at
`BackupsSection.tsx:506,521`, `ModelsSection.tsx:65`; textareas §2.5). All other inputs in the app
already use `ui/input`.

---

## 3. Per page / component inventory

Legend: **Card**=bordered surface card, **Badge**=status/tier/count pill, **Tabs/TG**=segmented/tabs,
**Sel**=select, **TA**=textarea, **C/R/S**=checkbox/radio/switch, **Sheet**=sheet/drawer/overlay,
**Alert**=callout, **Empty**, **Spin**=skeleton/spinner/loading text, **Av**=avatar/initials,
**Sep**=divider, **Toast**, **Table**=list-as-table, **Form**=label+input group.
Numbers are rough occurrence counts (from the greps above). Size: S ≈ one small file / mechanical;
M ≈ one component with several patterns; L ≈ 250+ lines, several behavioural patterns.

### Pages — `web/src/pages/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `AdminSignIn.tsx` (41) | Auth chip + auth card + form (via PasswordSignInForm) | S |
| `AuthCallback.tsx` (106) | Spin 1, Alert 1 (error icon box), Button 1, Auth card | S |
| `CardFilePage.tsx` (583) | Card 3, Badge 2, Tabs 1, TA 4, Alert 1, Empty 1, Spin 1, Sep 3, Toast 8, Table rows, Form 4, raw buttons 2, keyboard shortcuts | **L** |
| `CardsPage.tsx` (143) | Badge 3, Empty 2, Spin 1, Sep 1, Toast 2, Table rows 1, raw button 1 | M |
| `InboxPage.tsx` (224) | Badge 3, Alert 2, Card 2, Sep 3, Empty 2, Spin 2, Table rows 1, Sheet 1 (NewChapter), Toast 2, native confirm 1 | M |
| `JobsPage.tsx` (162) | Badge 2, Alert 1 (warning row), Empty 2, Spin 1, Sep 2, Table 2, Toast 1 | M |
| `LibraryPage.tsx` (132) | Card 2, Badge 1 (tier), Empty 2, Spin 1, Input search 1, Tooltip 1, Sheet 1, Table rows 1 | M |
| `LibrarySourcePage.tsx` (145) | Sheet 1 (full-screen), Card 1, Badge 1, Sep 2, Empty/failure text 2, Spin 1, raw button 1, Table rows 1 | M |
| `NotePage.tsx` (25) | Empty/loading/failure text only | S |
| `SetHomePage.tsx` (268) | Card 2, Badge/count 2, Empty 1 (HowItWorks), Spin 1, Sep 3, Table rows 3, Sheet 2 + Dialog 1, raw buttons 2 | M–L |
| `SetsPage.tsx` (89) | Card 2, Badge 1, Empty 1, Spin 1, Table grid 1, Dialog 1, raw button 0 | M |
| `SettingsPage.tsx` (123) | Section nav (raw buttons, `aria-current`, card wrapper on phone), responsive shell | M |
| `Setup.tsx` (140) | Auth card, Form 4, Spin 1, Toast 5, raw button 1 | S–M |
| `SignIn.tsx` (81) | Auth card, Empty 1 (password disabled), Sep 2, Buttons/links | S |
| `cards-utils.ts` / `library-utils.ts` / `settings-utils.ts` | Logic only. `library-utils.tierBadge` returns class strings (asserted in tests) | S |
| `useLastVisitedSet.ts` / `useSignOut.ts` | Logic; `useSignOut` toasts | S |

### Top-level components — `web/src/components/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `AuthFooter.tsx` (18) | text only | S |
| `AuthPageLayout.tsx` (46) | Card 1, Badge/chip 1 (`AuthChip`), Form | S |
| `ConfirmDialog.tsx` (101) | Dialog 1, Form 1, Input 1, Label 1, Button 2 | S |
| `CredentialFields.tsx` (52) | Form 2, Input 2, Label 2 | S |
| `IdentityProviderButtons.tsx` (46) | Buttons, Toast 1 | S |
| `NewChapterSheet.tsx` (129) | Sheet 1, Form 3, TA 1, Checkbox 1, Toast 1, raw backdrop 0 (portal) | M |
| `NewNoteDialog.tsx` (94) | Sheet 1, Form 1, Input/Label, Toast 1, raw backdrop 1 | S |
| `NewSetDialog.tsx` (113) | Sheet 1, Form 2, TA 1, Toast 1, raw backdrop 1 | S |
| `PasswordSignInForm.tsx` (63) | Form, Spin 1, Toast 1 | S |

### `web/src/components/Activity/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `ActivityIndicator.tsx` (159) | Sheet 1 (ported) + popover 1, Badge/count 1, Spin 1, Sep 3, raw buttons 2, portal, Escape handler | M |
| `ActivityPanelContent.tsx` (200) | Badge 1, Table 1, Empty 1, Spin 1, Sep 2, Toast 3 | M |
| `JobToasts.tsx` (182) | Toast custom x3 (cap, actions, nudge), Button 2, Sep 1 | M |
| `job-start-toast.tsx` (22) | Toast 1 (action button) | S |
| `JobTitleBadge.tsx` (20) | none (sets `document.title`) | S |
| `activity-store.ts` | state only | S |

### `web/src/components/AppSidebar/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `AppSidebar.tsx` (373) | Drawer 1 (mobile), Avatar 1, Badge/count 3 + "Drafting" rows 2, Sep 2, Spin 1, DropdownMenu 1, Tooltip 2, Sheet/Dialog 2, Toast (signout) | **L** |
| `SetSwitcher.tsx` (100) | DropdownMenu 1, Dialog 1, Toast 1, Badge/check | S–M |
| `SidebarRow.tsx` (71) | Nav row, Badge/count 1, `focus.ts` classes, `aria-pressed` | S |
| `SidebarSection.tsx` (21) / `SidebarSectionHeader.tsx` (16) | Section scaffolding, uppercase label | S |
| `SidebarResizeHandle.tsx` (171) | Drag + keyboard resize (bespoke; **do not** shadcn-ify) | S |
| `sidebar-layout.ts` / `index.ts` / `MobileSidebarContext.tsx` / `use*.ts` | cva/surface classes, context, logic | S |

### `web/src/components/ChatDock/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `ChatPanel.tsx` (293) | Card 2 (proposal), Badge 1 (job kind), TA composer, ScrollArea (ref/onScroll!), Tooltip 1, Sep 3, Empty 1, Spin (streaming), raw buttons 2, Toast (via hook) | **L** |
| `ChatPicker.tsx` (42) | DropdownMenu 1 (size sm), Empty 1 | S |
| `DesktopChatDock.tsx` (71) | Resizable dock, Tooltip 2, CollapsedRail | M |
| `MobileChatDock.tsx` (52) | Sheet 1 (full-screen), FAB raw button 1 | M |
| `ToolCallChip.tsx` (40) | Card/expander 1 (badge-like border), raw button 1 | S |
| `MessageMarkdown.tsx` (24) | markdown renderer (no UI kit) | S |
| `ResizeHandle.tsx` (152) | Drag (bespoke) | S |
| `reducer.ts` / `useChatDock.ts` (toasts) / `use*.ts` / `openChatDock.ts` | logic | S |
| `reducer.test.ts` | pure reducer test | S |

### `web/src/components/Library/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `AddSourceSheet.tsx` (283) | Sheet 1, Tabs/segmented 1, Input 1 (+ file input 1), Checkbox 1, Empty/outcome states 5, Spin 1, Alert 1, Toast 3 | **L** |

### `web/src/components/NoteHistory/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `NoteHistory.tsx` (185) | Sheet 1 (full-screen) / side panel 1, Table rows 1, Empty 3, Spin 2, Sep 3, Toast 2, native `window.confirm` 1, raw button 1 | M |
| `DiffView.tsx` (31) | `<pre>` diff renderer (keep) | S |

### `web/src/components/Reader/` — several **[IN FLUX]**

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `Reader.tsx` (353) | Overlay 1 (editor), TA 1, Alert 1 (conflict), Toolbar Buttons 5 + `aria-pressed` 2, Toast 2, native `confirm` 1, keyboard shortcuts | **L** **[IN FLUX]** |
| `ReadingSettings.tsx` (301) | Sheet 1 + popover 1, ToggleGroup 4 (`SegmentedGroup`), Buttons, portal, Escape | **L** **[IN FLUX]** |
| `CodeBlock.tsx` (122) | `<pre>` frame, raw copy button | S |
| `Table.tsx` (83) | markdown table primitives (keep) | S |
| `Directives.tsx` (36) | Card 2 (callout, `<details>`) | S |
| `Citation.tsx` (18) | Tooltip 1 (render-prop on `<sup>`) | S |
| `ImmersiveExitButton.tsx` (68) | Floating Button 1 | S |
| `MermaidBlock.tsx` (91) | SVG render, error text | S **[IN FLUX]** |
| `MarkdownView.tsx` (91) | markdown pipeline | S |
| `highlight.ts` (117) | hljs theming | S **[IN FLUX]** |
| `constants.ts` / `remarkStudium.ts` / `utils.ts` / `index.ts` | logic/barrel | S |
| `Reader.test.tsx` (38) | queries `.katex` + `details` | S |

### `web/src/components/Settings/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `BackupsSection.tsx` (777) | Dialog 1, Select 2 (native), TA 1, Checkbox 1, Switch, Alert 2, Card 4, Table rows 2 (snapshots + destinations), Form ~15, Toast ~12, Sep 1 | **L (largest file in `web/`)** |
| `SSOSection.tsx` (480) | Dialog 1, Table rows 1, Switch 1, Form ~12, Badge 1 (callback), Alert 1, Empty 1 (dashed), Toast 6, Button-as-copy 1 | **L** |
| `MembersSection.tsx` (307) | Dialog 2 + ConfirmDialog 2, Table rows 1, Switch 4, Form 3, Empty 1, Badge 1 (Archived), Toast 7 | **L** |
| `AccessTokenSection.tsx` (223) | Dialog 2 + ConfirmDialog 1, Empty 1 (dashed), Table rows 1, Form 2, Toast 3, copy row Card 1 | M |
| `MyAccountSection.tsx` (203) | Avatar 1, SettingGroup/Row, Dialog 2, Form 3, Toast 4 | M |
| `ModelsSection.tsx` (198) | Select 1 (native, ×9 roles), Card boxes 2, Badge 1 ("later"), Alert 1, Form, Toast 2 | M |
| `NotificationsSection.tsx` (194) | Form 2, Switch 2, Table rows 1, Sep 1, Toast 5, SettingGroup/Row | M |
| `InstanceSection.tsx` (85) | Form, Switch 1, Toast 3, SettingRow | S |
| `LinkedIdentitySection.tsx` (69) | Table rows 1, Form/buttons, Toast 2, SettingGroup | S |
| `SessionsSection.tsx` (81) | Table rows 1, Badge 1, ConfirmDialog 1, Empty 1, Toast 2 | S–M |
| `ServicesSection.tsx` (62) | Table rows 1, Spin 1, Empty 1, Alert-ish health dot | S |
| `DataSection.tsx` (37) | Buttons-as-links (buttonVariants on `<a>`) | S |
| `GeneralSection.tsx` (26) | Button 1 | S |
| `SettingGroup.tsx` (44) | Separator 1, section heading + actions | S |
| `SettingRow.tsx` (53) | Form row + Tooltip 1 | S |
| `SettingSection.tsx` (34) | Section header + bottom border | S |
| `SettingTable.tsx` (75) | `<table>` helper — **currently unused anywhere** (candidate to drop/replace with shadcn Table) | S |
| `format.ts` / `idp-templates.ts` / `settingSections.ts` | logic / registry (12 sections; new "Appearance" section expected in flux) | S |

### Layouts — `web/src/layouts/`

| File | Patterns (counts) | Size |
| --- | --- | --- |
| `RootLayout.tsx` (112) | Shell, CollapsedSidebarRail (Tooltip+Button), responsive sidebar/drawer wiring, immersive. Sheet/dialog hosting for children | M |

**Largest / highest-risk migration targets, in order:** `BackupsSection.tsx` (777),
`CardFilePage.tsx` (583), `SSOSection.tsx` (480), `AppSidebar.tsx` (373), `Reader.tsx` (353),
`MembersSection.tsx` (307), `ReadingSettings.tsx` (301), `ChatPanel.tsx` (293),
`AddSourceSheet.tsx` (283), `SetHomePage.tsx` (268), `AccessTokenSection.tsx` (223),
`InboxPage.tsx` (224).

---

## 4. Styling facts

### `web/src/index.css` — `:root` tokens (light, `index.css:4-56`) **[IN FLUX]**
Colors (all `oklch`):
`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`,
`--primary` (`oklch(0.45 0.08 250)` — the blue), `--primary-foreground`, `--secondary`,
`--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`,
`--destructive`, `--destructive-foreground`, **`--success`**, **`--success-foreground`**,
**`--warning`**, **`--warning-foreground`**, `--border`, `--input`, `--ring`, **`--overlay`**,
`--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`.

Non-color: `--font-sans`, `--font-serif`, `--font-mono`, `--radius: 0.5rem`,
`--shadow-xs`, `--shadow-sm`, `--shadow` (bare), `--shadow-md`, `--shadow-lg`, `--shadow-xl`,
`--shadow-2xl`, **`--shadow-float`** (the 3-layer floating shadow for FABs/popovers).

Dark mode (`index.css:58-88`) is a `@media (prefers-color-scheme: dark)` block that redefines the
same token names. **There is no `.dark` class and no `@custom-variant dark`** on `main` — shadcn
base-nova normally keys dark mode off a `.dark` class on `<html>`. Slice C (themes) is expected to
change exactly this; the migration must land on top of that, not duplicate it. **[IN FLUX]**

### `@theme inline` (`index.css:90-137`)
Maps every token to a Tailwind color: `--color-background`, `--color-foreground`, `--color-card`,
`--color-card-foreground`, `--color-popover`, `--color-popover-foreground`, `--color-primary`,
`--color-primary-foreground`, `--color-secondary`, `--color-secondary-foreground`, `--color-muted`,
`--color-muted-foreground`, `--color-accent`, `--color-accent-foreground`, `--color-destructive`,
`--color-destructive-foreground`, `--color-success`, `--color-success-foreground`,
`--color-warning`, `--color-warning-foreground`, `--color-border`, `--color-input`, `--color-ring`,
`--color-overlay`, `--color-sidebar`, `--color-sidebar-foreground`, `--color-sidebar-accent`,
`--color-sidebar-accent-foreground`.
Fonts: `--font-sans`, `--font-mono`, `--font-serif` (self-referential: `var(--font-sans)` etc).
Type scale: `--text-2xs: 0.6875rem` (11px, lh 1rem), `--text-ui: 0.8125rem` (13px, lh 1.125rem).
Radius: `--radius-sm: calc(var(--radius) - 4px)`, `--radius-md: calc(var(--radius) - 2px)`,
`--radius-lg: var(--radius)`, `--radius-xl: calc(var(--radius) + 4px)`.
Shadows: the seven `--shadow-*` + `--shadow-float`.
Z-index: `--z-index-overlay: 50`, `--z-index-dropdown: 60`, `--z-index-tooltip: 70` → generates
`z-overlay`/`z-dropdown`/`z-tooltip` utilities (`z-dropdown`/`z-tooltip` are used by the kit;
overlays currently hardcode `z-50`).
Also in `@layer base` (`:139-168`): `* { @apply border-border outline-none ring-0 }`, themed
scrollbars (`scrollbar-width: thin` + webkit rules), `body { @apply bg-background text-foreground }`
with safe-area L/R padding. Then plain (unlayered) `.studium-prose` / `.studium-prose-compact`
markdown typography (`:170-end`), which wins over the utility layer without `!important`.

**Tokens shadcn base-nova expects that are absent here:** `--chart-1..5`, `--sidebar-primary*`,
`--radius-*` in shadcn's own scale, `--font-*` naming, and the `.dark` variant. **Tokens here that
shadcn does not ship:** `--success*`, `--warning*`, `--overlay`, `--shadow-float`, `--z-index-*`,
`--text-2xs`, `--text-ui`. Preserve those (the app uses them in ~40 files).

### Font setup
- No webfonts and no external font links. `web/index.html` has **no** `<link>` to Google Fonts
  (only icon/apple-touch-icon/theme-color meta). **[IN FLUX]**
- `--font-sans` is a system stack (`ui-sans-serif, system-ui, -apple-system, …`), `--font-serif`
  `ui-serif, Georgia, …`, `--font-mono` `ui-monospace, SFMono-Regular, Menlo, …` (`index.css:33-38`).
- `body` does not set `font-family` explicitly; the Tailwind preflight default (sans) applies.
- `.studium-prose` uses `var(--reader-font, var(--font-sans))` (`index.css:189`).
- `MermaidBlock.tsx:46` reads `getComputedStyle(document.body).fontFamily` to render diagrams in the
  app font. **[IN FLUX]**

### Radius tokens
`--radius: 0.5rem` (8px) → `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 8px, `--radius-xl` 12px.
`button.tsx` uses `rounded-md`; cards use `rounded-lg`/`rounded-xl`; sheets use `rounded-t-xl`.

### `cn()` helper
`web/src/lib/utils.ts` — `clsx` + `extendTailwindMerge` with `theme.text: ["2xs", "ui"]` so the custom
`text-2xs`/`text-ui` classes merge correctly. This file matters: a new shadcn `cn` must be merged
with this (or keep this one), otherwise `text-ui`/`text-2xs` and any new shadcn classes collide.

### Path alias `@/`
`web/tsconfig.json` → `"paths": { "@/*": ["./src/*"] }` (extends `tsconfig.base.json`; not in the
base). The Vite side is `web/vite.config.ts` → `resolve.alias { "@/": resolve(rootDir, "src") + "/" }`.
shadcn's `components.json` (once created) should set `"aliases": { "components": "@/components", "ui": "@/components/ui", "utils": "@/lib/utils", "lib": "@/lib", "hooks": "@/hooks" }`.

### Tailwind version and configuration
- `tailwindcss@^4.2.4` (a runtime `dependency`), `@tailwindcss/vite@^4.2.4` (devDependency).
- Configured **only** via the Vite plugin: `web/vite.config.ts:3,20` imports `@tailwindcss/vite` and
  adds `tailwindcss()` to `plugins`.
- CSS entry `web/src/index.css:2` is `@import "tailwindcss";`. **No `tailwind.config.*`, no
  `postcss.config.*`** exist anywhere in `web/`. (shadcn for Tailwind v4 writes into `index.css`
  via `@theme`/`@custom-variant`; that is compatible with this setup.)

### `components.json`
**Does not exist** (`web/components.json` and repo-root `components.json` both absent). Expected:
no. The migration must create it (`"style": "base-nova"`, `"tailwind": { "base": "base" }`).

### `web/package.json` — UI-relevant deps (exact ranges as written)
Runtime:
- `@base-ui/react` `^1.7.0`
- `class-variance-authority` `^0.7.1`
- `clsx` `^2.1.1`
- `tailwind-merge` `^3.5.0`
- `lucide-react` `^1.34.0`
- `react` `^19.3.0`, `react-dom` `^19.3.0`
- `react-hot-toast` `^2.6.0` (to be replaced by Sonner)
- `react-router-dom` `^7.18.0`
- `tailwindcss` `^4.2.4`
- `@tanstack/react-query` `^5.104.0`
- content-only: `highlight.js` `^11.11.1`, `katex` `^0.16.45`, `mermaid` `^11.14.0`,
  `react-markdown` `^10.1.0`, `rehype-katex` `^7.0.1`, `rehype-sanitize` `^6.0.0`,
  `remark-directive` `^3.0.0`, `remark-gfm` `^4.0.1`, `remark-math` `^6.0.0`, `unist-util-visit` `^5.1.0`.
Dev:
- `@tailwindcss/vite` `^4.2.4`, `@testing-library/react` `^16.3.2`, `@types/react` `^19.2.14`,
  `@types/react-dom` `^19.2.3`, `@vitejs/plugin-react` `^6.0.1`, `jsdom` `^29.1.1`,
  `typescript` `^7.0.2`, `vite` `^8.3.0`, `vite-plugin-pwa` `^1.3.0`, `vitest` `^5.0.2`.

**Missing for shadcn base-nova:** `tw-animate-css` (shadcn v4 uses it instead of
`tailwindcss-animate`), `sonner` (for toasts), and typically `@base-ui/react` components already
present. `shadcn` CLI itself is normally run with `npx shadcn@latest init` (the task says do not).

---

## 5. Risks

### 5.1 Components with non-trivial behaviour (do not treat as dumb markup)

**Drag / resize (keep bespoke; do not shadcn-ify):**
- `components/AppSidebar/SidebarResizeHandle.tsx` — pointer drag + keyboard resize, rAF-throttled CSS-var preview, `role="separator"`-ish handle (`:133` has a `biome-ignore` explaining it is not an `<hr>`). Wired in `layouts/RootLayout.tsx:81-87`.
- `components/ChatDock/ResizeHandle.tsx` (152 lines) — same pattern for the chat dock; wired in `DesktopChatDock.tsx:49-55`.
- Widths persist via `useSidebarWidth.ts` / `useChatDockWidth.ts` (localStorage).

**Keyboard shortcuts:**
- `pages/CardFilePage.tsx:289-314` — global `keydown`: `a` approve, `r` reject, `e` edit, `j/k`/arrows navigate, `space` reveal; disabled while typing/editing/busy; functions read through `actionsRef` (`:286-287`) to avoid resubscribing.
- `components/Reader/Reader.tsx:163-179` — desktop `f` toggles immersive, `Escape` exits; ignores INPUT/TEXTAREA/SELECT/contentEditable.
- `components/Reader/ReadingSettings.tsx:207-214` — `Escape` closes the sheet. **[IN FLUX]**
- `components/Activity/ActivityIndicator.tsx:71-80` — `Escape` closes the activity sheet.
- `components/ChatDock/useChatDock.ts` — `handleComposerKeyDown` (Enter to send) used at `ChatPanel.tsx:271`.
- `components/AppSidebar/SidebarResizeHandle.tsx` — arrow-key resize.
- If a shadcn Dialog/Sheet adds its own Escape handling and focus trap, verify it does not swallow
  `a/r/e/j/k/space` (card review listener is on `document`, and shadcn/base-ui `Dialog` sets
  `aria-modal` and moves focus — the current hand-rolled sheets do **not** trap focus; shadcn's do).

**Portals / stacking contexts (the phone-drawer rule):**
- Sheets opened from the phone drawer must portal to `<body>`, or the drawer's stacking context
  (`AppSidebar.tsx:359` `fixed inset-0 z-30`) paints them under the chat FAB (`MobileChatDock.tsx:29`,
  `z-40`). Explicit `createPortal(..., document.body)` at
  `Activity/ActivityIndicator.tsx:104-121`, `NewSetDialog.tsx:53-109`, `NewNoteDialog.tsx:47-90`,
  `NewChapterSheet.tsx:60-125`, `Reader/ReadingSettings.tsx:217-241`; comments at each site.
- `ui/dialog.tsx` already portals (base-ui `Dialog.Portal`), so `ConfirmDialog`/Settings dialogs are
  safe. Any replacement must keep `Portal` and must not portal into the drawer subtree.
- z-index ladder on `main`: mobile header `z-20` (`AppSidebar.tsx:337`), mobile drawer `z-30`
  (`:359`), chat FAB `z-40` (`MobileChatDock.tsx:29`), overlays/sheets `z-50` (hardcoded), dropdown
  `z-dropdown` (60), tooltip `z-tooltip` (70). The kit's `DialogBackdrop`/`DialogContent` are `z-50`.
  shadcn base-nova uses `z-50` for overlay/content too, but check the Drawer/Sheet classes — a
  `z-40` sheet would land under the FAB.

**Focus behaviour difference:** the current hand-rolled sheets/modals
(`NewSetDialog`, `NewNoteDialog`, `NewChapterSheet`, `AddSourceSheet`, activity sheet,
`ReadingSettings`) have a backdrop `<button>` and an Escape listener but **no focus trap** and no
initial focus management beyond `autoFocus` on some inputs. shadcn `Dialog`/`Sheet` add both. That
is an improvement, but it changes what `document.activeElement` is while open and can affect the
CardFilePage key handler (which checks `event.target` tagName, not `activeElement` — verify).

**Base UI `onClick` vs `onSelect` (already learned):** every menu item in the app uses `onClick`
(`AppSidebar.tsx:91-92`, `SetSwitcher.tsx:79-91`, `ChatPicker.tsx:32`); `ui/dropdown-menu.tsx` wraps
base-ui `Menu.Item`. shadcn's base-nova dropdown is also base-ui, so keep `onClick`; using Radix
`onSelect` silently does nothing (AGENT_MEMORY gotcha; `docs/prompts/m3b-slice-c.md:45`).

**Select/label/textarea migration is safe** (plain elements), but note `Label` has
`peer-disabled:` styling that only works if the label is a *sibling after* the control — most
current usages put `<Label>` before `<Input>`, so `peer-*` never applies today; shadcn `Field`
fixes this but will change label styling slightly.

### 5.2 Tests that snapshot or query by class name / structure
- `web/src/pages/library-utils.test.ts:25,31,32,36` — asserts the exact Tailwind class strings
  `tierBadge()` returns (`"bg-emerald-100 text-emerald-800 …"`, `"bg-muted text-muted-foreground"`).
  If tier badges become shadcn `Badge` variants, this test must change.
- `web/src/components/Reader/Reader.test.tsx:22` — `document.querySelector(".katex")` (KaTeX class,
  unaffected by shadcn).
- `web/src/components/Reader/Reader.test.tsx:27` — `document.querySelector("details")` (the
  `:::deeper` directive; if the reader markup changes, this breaks).
- No snapshot tests (`toMatchSnapshot` appears nowhere). No test reaches into `data-slot`s.
- Other tests are pure logic: `api/client.test.ts`, `api/events.test.ts`, `ChatDock/reducer.test.ts`,
  `lib/job-format.test.ts`, `lib/job-transitions.test.ts`, `lib/reading-prefs.test.ts`,
  `lib/scroll-memory.test.ts`, `pages/cards-utils.test.ts`, `pages/settings-utils.test.ts`.
  `reading-prefs.test.ts` will need updating for slice C's theme/accent fields. **[IN FLUX]**

### 5.3 What breaks if `dialog.tsx` / `dropdown-menu.tsx` are replaced with shadcn

`dialog.tsx` consumers rely on:
- `DialogContent` **rendering its own backdrop** inside the portal (`ui/dialog.tsx:31-35`). shadcn's
  base-nova `DialogContent` expects a separate `<DialogOverlay />`; without it, dialogs lose their
  dimming. 6 importers: `ConfirmDialog.tsx`, `AccessTokenSection.tsx`, `BackupsSection.tsx`,
  `MembersSection.tsx`, `MyAccountSection.tsx`, `SSOSection.tsx`.
- The `showClose` prop (`ui/dialog.tsx:28-46`): `ShowTokenDialog` passes `showClose={false}`
  (`AccessTokenSection.tsx:110`). shadcn has no such prop → must re-add or use a custom close.
- The **mobile bottom-sheet behaviour** (`inset-x-4 bottom-4 rounded-xl … sm:centered`,
  `ui/dialog.tsx:38-44`): shadcn `DialogContent` is centered at all widths; the bottom-sheet look
  must move to `Sheet` or be re-implemented. Affects every dialog on a phone (ConfirmDialog,
  token/member/SSO/backup dialogs).
- Named exports `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`,
  `DialogPortal`, `DialogTrigger`, `DialogClose` — shadcn's base-nova exports a comparable set, but
  `DialogContent` there does **not** accept `showClose`, and `DialogClose` composition differs.
- `ConfirmDialog` supports `typedConfirmValue` (type-to-confirm, `ConfirmDialog.tsx:26,59,68-81`) —
  keep; that is not part of shadcn and is used for purge/restore.

`dropdown-menu.tsx` consumers rely on:
- The **`size` context** (`"sm"`): only `ChatPicker.tsx:27` uses `size="sm"`; `SetSwitcher`/`AppSidebar`
  use the default. shadcn's dropdown has no size system → either drop `size="sm"` or keep a local wrapper.
- **`modal={false}`** on the root (`ui/dropdown-menu.tsx:9`), so the sidebar/chat menus do not lock
  the page. shadcn's base-nova menu may default differently — must stay non-modal.
- `DropdownMenuLinkItem` (`:101-122`) exists for real links, but **no call site uses it today**
  (grep: only the definition/export). Same for `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`,
  `DropdownMenuShortcut`, `DropdownMenuSub*` — all defined but unused. So the replacement surface is
  effectively `DropdownMenu / Trigger / Content / Item / Separator / Label / Group`.
- `DropdownMenuTrigger` is `forwardRef<HTMLButtonElement>`; `buttonVariants` is used as its
  `className` (`AppSidebar.tsx:86`, `ChatPicker.tsx:23`) — a trigger that is not a `<button>` would
  change semantics.
- `popupMotionClasses` + `data-popup-open` styling: `Button` `quiet` variant highlights while its
  menu is open via `data-popup-open:` (`button.tsx:25`); base-ui sets that attribute, so a shadcn
  trigger must keep it or the open state loses its accent.

**Tooltip is also a breaking swap** (not asked, but it is the same class of risk):
`ui/tooltip.tsx` exposes `TooltipProvider {delay,timeout}`, `Tooltip`, `TooltipTrigger` (with the
base-ui `render` prop used at `RootLayout.tsx:39`, `SettingRow.tsx:37`, `Citation.tsx:13`,
`ChatPanel.tsx:200-215`, `DesktopChatDock.tsx:20,60`, `AppSidebar.tsx:251-266,291-307`),
`TooltipContent` with an arrow. shadcn base-nova's tooltip has a different composition
(`TooltipProvider/Tooltip/TooltipTrigger/TooltipContent`, no `render`), so **8 files** change.

**ScrollArea is a breaking swap:** `ui/scroll-area.tsx` is a native `<div>`; `ChatPanel.tsx:149-194`
attaches a ref + `onScroll` and reads `scrollHeight/scrollTop/clientHeight` for stick-to-bottom and
the jump-to-latest button. A base-ui `ScrollArea` splits Root/Viewport, so those reads return the
wrong element and the chat stops auto-scrolling. `NoteHistory.tsx:101,114` also passes className
that assumes the element itself scrolls.

**`SettingTable.tsx` is unused** (grep: no imports) — safe to delete or replace with shadcn `Table`
without touching call sites; verify with a repo-wide grep first.

**Button variants are a shared interface:** `quiet`, `icon-compact`, `icon-sm`, and the
`aria-pressed` accent styling (`button.tsx:25`) are used across 44 files and cannot be dropped.
shadcn's base-nova `Button` ships `default/destructive/outline/secondary/ghost/link` and
`default/sm/lg/icon` — the migration must extend, not replace, those variant maps, and keep
`buttonVariants` exported for the 4 `<a>`/trigger sites.

**`components/Settings/settingSections.ts`** is the Settings registry (12 sections, keys typed).
A new "Appearance" section from slice C will be added there; the migration must not clobber it.
**[IN FLUX]**

**`react-hot-toast` → Sonner is optional and risky:** `Activity/JobToasts.tsx` implements a
self-managed cap of 3 completion toasts and a `toast.custom` nudge with two action buttons, and
`job-start-toast.tsx` renders a "View" action that opens the activity panel from inside the toast
(which renders outside the router tree — the reason `activity-store.ts` exists). Sonner supports
actions/durations but the cap logic and the `position: "bottom-center"` nudge must be re-created.

**One-shell-at-a-time mounting:** `ChatDock.tsx:18-21` mounts either the desktop dock or the mobile
sheet based on `useMediaQuery("(min-width: 1024px)")`; `ReadingSettings` switches sheet↔popover at
768px; `Reader`'s history switches at 1024px; `ActivityIndicator` at 768px. shadcn `Sheet`/`Drawer`
are CSS-driven (one component, responsive) — replacing these must keep the "only one shell alive"
guarantee, or chat streaming state / scroll pinning will be disturbed on resize.

---

## Summary

### Top 10 migration items by visual impact

| # | Item | Why it matters | Rough touch count |
| --- | --- | --- | --- |
| 1 | **Badge** (status/tier/count pills) | The single most repeated hand-built control; on every page (jobs, cards, inbox, sets, sessions, members, models, tier A–D). One Badge with variant mapping makes the whole app look uniform. | ~30 sites, 15 files |
| 2 | **Sheet + Dialog** (unify overlays) | The app has 6 bespoke overlays (NewSet/NewNote/NewChapter/AddSource/ReadingSettings/Activity) with hand-rolled backdrops, plus 6 kit-Dialog users. Unifying fixes inconsistent animations, radii and close buttons. | 12 overlays, 11 files |
| 3 | **Card** (surface + list-row boxes) | Cards/rows are hand-styled per page (`rounded-lg/xl border`), so sets, library rows, jobs, inbox and Settings lists all differ subtly. | ~20 real cards + ~12 list boxes |
| 4 | **Empty** (empty states) | Every list invents its own icon+copy+CTA layout; some are one line of muted text, some are dashed boxes. High-perceived-quality win on first-run screens. | 19 sites |
| 5 | **Skeleton / Spinner** | 15 bare "Loading…" texts and 12 ad-hoc lucide spinners; no skeletons at all. Skeletons for lists/reader change how fast the app *feels*. | 27 sites |
| 6 | **Form: Field/FieldGroup + Textarea + Select + Checkbox** | The label+input stack is duplicated ~30 times; selects are raw native `<select>`s (Models, Backups restore); checkboxes are unstyled. Biggest single consistency improvement after Badge. | ~35 field groups |
| 7 | **Tabs / ToggleGroup** | Three different segmented-control implementations (reading settings, card filters, add-source tabs) + destination pickers in Backups. | 6 controls |
| 8 | **Table** | Settings lists (members, sessions, tokens, snapshots, subscriptions, providers) and Jobs/Library are list-as-table with per-file markup. | 12 lists |
| 9 | **Tooltip** (and Citation) | 8 files use the current API; the base-nova tooltip is a different API, so this is both a visual and a mechanical change. | 8 files |
| 10 | **Alert / toast** | 5–6 callout boxes (stale note, edit conflict, warnings) plus the `react-hot-toast` → Sonner swap. Lower visual delta but touches many files. | 6 alerts, 31 toast files |
| — | Avatar (2 sites), Progress (0 today), Separator (few) | Small, and Progress is net-new. Do after the above. | — |

### Order I would do it

1. **Bootstrap shadcn first, alone:** create `components.json` (`base: "base"`, style `base-nova`),
   add `tw-animate-css`, reconcile `index.css` tokens with slice C's theme work (`[IN FLUX]` — land
   after it), and confirm dark mode. Extend `Button`'s variants with `quiet`/`icon-compact`/`icon-sm`
   and keep `buttonVariants` exported. Do **not** touch call sites yet; the app must build.
2. **Badge** — pure presentational, highest reach, no behaviour. Also replace the `tierBadge`
   class-string helper and update `library-utils.test.ts` in the same change.
3. **Card + Empty + Skeleton/Spinner** — pure presentational; migrate the list pages
   (Sets, SetHome, Library, Jobs, Inbox, Cards) together so their row/card/empty language matches.
   Leave `Reader/Table.tsx` and `Reader/CodeBlock.tsx` alone (they are article content).
4. **Form primitives** — `Field/FieldGroup` + `Textarea` + `Label/Input` alignment + `Checkbox` +
   `Select`; do the auth screens (Setup/SignIn/PasswordSignInForm/CredentialFields) first as a
   proving ground, then Settings dialog forms, then Models/Backups selects.
5. **Dialog + Sheet + AlertDialog** — migrate the bespoke overlays to shadcn `Sheet`/`Dialog`
   (preserve the `<body>` portal rule and the mobile bottom-sheet look), port `ConfirmDialog`'s
   `typedConfirmValue`, and replace the three native `confirm()` calls
   (`NoteHistory.tsx:59`, `InboxPage.tsx:113`, `Reader.tsx:50`) with AlertDialog. Fix
   `showClose={false}` and keep the `z-50`/`z-30`/`z-40` ladder.
6. **Tabs / ToggleGroup** — ReadingSettings `SegmentedGroup` **[IN FLUX]**, CardFilePage review
   filters, AddSource tabs, Backups destination picker.
7. **Table** — Settings members/sessions/tokens/snapshots/subscriptions/providers, then Jobs and
   Library rows.
8. **Alert, Tooltip, Avatar, Separator, Progress** — Tooltip needs its 8 call sites rewritten to the
   base-nova API; Progress is net-new (wire to `jobs.progress`); Avatar is 2 sites.
9. **Sonner last** (optional, isolated) — port `JobToasts`' 3-toast cap + nudge and the
   `job-start-toast` "View" action; keep `activity-store.ts` for out-of-router navigation.
10. **Verify the behaviour-critical files after every step:** `ScrollArea` consumers
    (`ChatPanel.tsx`, `NoteHistory.tsx`), the two `ResizeHandle`s, `CardFilePage` keyboard
    shortcuts, `Reader` `f`/Escape, and the "one shell mounted at a time" breakpoints in
    `ChatDock`/`ReadingSettings`/`NoteHistory`/`ActivityIndicator`.

### Quick facts for the implementer
- `cn()` stays at `web/src/lib/utils.ts` (it extends tailwind-merge for `text-2xs`/`text-ui`).
- Alias `@/*` → `web/src/*` (tsconfig `paths` + Vite `resolve.alias`).
- No `components.json`, no `tailwind.config.*`, no `postcss.config.*`; Tailwind 4.2.4 via
  `@tailwindcss/vite` + `@import "tailwindcss"`.
- `ui/focus.ts` (`FOCUS_VISIBLE_OUTLINE_CLASSES`) is imported by `SidebarRow.tsx` and the kit's
  button/switch; keep it or its equivalent.
- `ui/popup.ts` (`popupMotionClasses`) is the shared popup animation used by dropdown + tooltip.
- Unused kit surface that can be dropped in the swap: `DropdownMenuLinkItem`,
  `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuShortcut`, `DropdownMenuSub*`,
  and `Settings/SettingTable.tsx`.
- Base UI `Menu.Item` needs `onClick` (never Radix `onSelect`) — the current code already does this.
