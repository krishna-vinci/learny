# M3b Slice D — Consistent UI on proper shadcn/ui (Base UI), in batches

You are the same frontend implementer who built Slice C (themes). You work in the worktree `/path/to/studium-worktrees/m3b` (branch `codex/m3b`), rebased on main after Slice C merged.
- Only change `web/`. Never touch `server/`, `shared/`, `data/`, `.env*` or `.claude/`. Don't commit: the orchestrator reviews and commits each batch.
- Read first:
  1. `/path/to/studium/AGENT_MEMORY.md` (gotchas)
  2. the UI map `/path/to/studium/docs/prompts/m3b-d-uimap.md` (904 lines: every hand-built pattern with file:line, the per-file inventory, styling facts and **section 5 Risks**)
  3. the `shadcn` skill (`/home/<username>/.claude/skills/shadcn/SKILL.md` plus `rules/base-vs-radix.md`, `rules/composition.md`, `rules/forms.md`, `rules/styling.md`, `cli.md`)
  4. the `ui-ux-pro-max` skill
- Work in **batches**. Do ONLY the batch named in the message you receive. Finish it, verify it and report. The next batch comes in a follow-up message.

## Target

The whole app looks like one product. Use real shadcn/ui components on **Base UI** (`components.json`: `"base": "base"`, style `base-nova`, `iconLibrary: "lucide"`), installed with the shadcn CLI (`npx shadcn@latest add …`) and themed only through our existing tokens. Every theme and accent from Slice C must keep working.

## Global rules
- **Tokens stay ours.** Never let `npx shadcn` overwrite `web/src/index.css` tokens or theme blocks. If `init` or `add` wants to write CSS variables, keep ours; map any missing shadcn tokens (e.g. `--chart-*`, `--sidebar-*` names) onto our existing ones. The `@theme inline` mapping and Slice C's `data-theme`/`data-accent` selectors stay the single source of truth.
- **Use `add --dry-run`/`--diff` first for existing files** (`button`, `dialog`, `dropdown-menu`, `input`, `label`, `separator`, `switch`, `tooltip`, `scroll-area`). Smart-merge (per the skill), preserving:
  - Button variants `quiet`, `icon-compact`, `icon-sm`, the `aria-pressed` accent, and the `data-popup-open:` open state, with `buttonVariants` still exported (44 files use them)
  - Dialog's built-in backdrop, `showClose` prop and mobile bottom-sheet layout (map 5.3)
  - Dropdown `modal={false}` and `onClick` items (never `onSelect`)
- **Components before custom markup** (shadcn composition rules):
  - Badge not styled spans; Alert for callouts; Empty for empty states
  - Skeleton/Spinner for loading (no "Loading…" text, no custom `animate-pulse`)
  - Separator not border divs; Field/FieldGroup for label+control
  - Sheet for side/bottom panels; AlertDialog instead of `window.confirm`
- **Keep bespoke, don't shadcn-ify:**
  - `SidebarResizeHandle.tsx`, `ChatDock/ResizeHandle.tsx`
  - `Reader/Table.tsx`, `Reader/CodeBlock.tsx` (article content)
  - `NoteHistory/DiffView.tsx`
- **ScrollArea:** `ChatPanel.tsx:149-194` and `NoteHistory.tsx` read scroll metrics off the element itself. If you adopt the base-ui ScrollArea, pass the ref and `onScroll` to the **Viewport**, and re-verify chat auto-scroll and the jump-to-latest button.
- **Overlays:**
  - keep the z-ladder (header `z-20`, drawer `z-30`, chat FAB `z-40`, overlays `z-50`, dropdown 60, tooltip 70)
  - everything opened from the phone drawer portals to `<body>`
  - the phone keeps bottom sheets; desktop uses centred dialogs or side sheets
- **Keyboard:** `CardFilePage` a/r/e/j/k/space, Reader `f`/Esc, Enter-to-send in chat, and the resize arrow keys must still work. Check that no new focus trap swallows them.
- **Tests:** update `web/src/pages/library-utils.test.ts` when tier badges become Badge variants.
- **Toast:** keep `react-hot-toast` until batch D6.
- **Dependencies:** only those the shadcn CLI adds for the components listed. Report each added package and version.

## Batches

- **D1: Bootstrap + Badge + design doc**
  1. `components.json` (Base UI, base-nova, our aliases: `@/components/ui`, `@/lib/utils`, `@/hooks`; Tailwind 4 CSS at `web/src/index.css`; `tw-animate-css` if needed).
  2. Smart-merge the existing kit.
  3. Add `badge`, then migrate ALL badge-like pills (map 2.2: status chips, tier A–D, counts, "Archived", "later", job kinds), with variants for status (success, warning, destructive, muted, outline) and tier.
  4. Write `docs/DESIGN.md` with the type scale (existing `text-2xs`/`text-ui`), spacing, radius, surfaces, the status-colour mapping, the component usage rules above, and a mobile-first layout rhythm. Max ~120 lines.
- **D2: Surfaces and states.** `card`, `empty`, `skeleton`, `spinner`, `separator`, applied to the list pages together:
  - SetsPage, SetHomePage, LibraryPage, LibrarySourcePage, JobsPage, InboxPage, CardsPage
  - the Activity panel and the sidebar "Drafting…" rows
  - Skeletons for lists and the reader loading state
- **D3: Forms.** `field`, `textarea`, `select`, `checkbox`, `radio-group`, and Label/Input alignment. Order:
  1. the auth screens (Setup, SignIn, AdminSignIn, PasswordSignInForm, CredentialFields)
  2. the dialog forms (NewSet, NewNote, NewChapter)
  3. the Settings forms (MyAccount, AccessToken, Members, SSO, Notifications, Instance)
  4. the Models and Backups native selects
- **D4: Overlays.** `sheet`, `dialog`, `alert-dialog` (also `drawer` if the skill recommends it for Base UI phone sheets). Migrate the bespoke overlays (NewSet, NewNote, NewChapter, AddSource, Activity, ReadingSettings, MobileChatDock, the note editor overlay, the NoteHistory sheet, LibrarySource full-screen). Port `ConfirmDialog`'s `typedConfirmValue`. Replace the three `window.confirm` calls (`NoteHistory.tsx:59`, `InboxPage.tsx:113`, `Reader.tsx:50`) with AlertDialog.
- **D5: Controls and lists.** Then `tooltip` (all 8 call sites to the base-nova API, including Citation and the sidebar and chat tooltips), `alert`, `avatar`, and `progress` (wired to job progress where a percentage exists; otherwise indeterminate).
  - `tabs` / `toggle-group`: ReadingSettings segmented controls, the CardFilePage filters, the AddSource tabs, the Backups destination picker.
  - `table`: Settings members/sessions/tokens/snapshots/subscriptions/providers, Jobs, Library.
  - Delete the unused `Settings/SettingTable.tsx`.
- **D6 (optional, only if asked): toast.** Swap to the Base UI `toast` component per the shadcn skill. Port the JobToasts 3-toast cap, the nudge and the "View"/"Open" actions.

## Verify every batch
1. `pnpm --filter @studium/web exec tsc --noEmit`, `rtk proxy pnpm exec biome check <changed files>`, the vitest files near your changes, and `pnpm --filter @studium/web build`.
2. Test server:
   - `mkdir -p /tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/m3b-test/d` and copy `/path/to/studium/examples/sample-set` there as `legacy`.
   - From `server/` run `STUDIUM_DATA_DIR=<dir>/data STUDIUM_STUDY_ROOT=<dir>/legacy HOST=127.0.0.1 PORT=3143 STUDIUM_FAUX=1 pnpm exec tsx src/main.ts` in the background.
   - First visit `/setup`. Never `rm -rf` computed paths.
3. Puppeteer-core is in `/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/shot/node_modules`; Chrome is `/usr/bin/google-chrome`.
   - Use REAL clicks (`elementHandle.click()`/`tap()`) at 390×844 (isMobile, hasTouch) and 1440×900, in **Light and Dark** (plus Sepia and Black for D1).
   - Walk every page the batch touched, and screenshot before and after.
   - Re-check the behaviour-critical items in the map's summary step 10 every batch.
4. Stop the server.

## Report per batch
1. Changed and added files, one line each.
2. Packages added.
3. Checks and results.
4. Flows verified.
5. Screenshot paths (before/after pairs).
6. Anything skipped and why.
7. A 5-line AGENT_MEMORY log entry.
