# M6 — Simple, calm and polished (Claude cloud task)

**This file is the prompt.** It's self-contained, meant for a Claude Code cloud session on `github.com/krishna-vinci/learny` (branch `main`).

**Goal:** Studium feels natively simple. A beginner opens it on a phone and knows what to do next without reading docs. Nothing nags, nothing confuses, and the powerful features (agents, jobs, sources, cards, practice, books) appear when they're useful, not all at once. The whole app looks and behaves like one product and loads fast.

**Owner's words (the acceptance bar):** "It should feel natively simple and intuitive to use. The user should not sense any annoyance and should not get confused by features."

## Ground rules
- **Read first:** `AGENTS.md`, `AGENT_MEMORY.md` (system map and gotchas: base-ui menu items use `onClick`; sheets opened from the phone drawer portal to `<body>`; admin-from-env test fixture; real-click UI testing), `docs/PRINCIPLES.md`, `docs/UI.md`, `docs/decisions/LOG.md`.
- Use the `ui-ux-pro-max` skill for design decisions and the `shadcn` skill for components.
- **PRs:** a series of PRs, one per section below, each on its own branch `claude/m6-<section>` created from the previous section's branch, so they stack. Open each against `main` with "depends on #…". **Never push to `main` and never merge.** The orchestrator reviews and merges them in order.
- Mostly `web/`. Server changes only where a section says so.
- **Other work in progress:** M5 (Practice: `/s/:set/practice`, Examiner/Grader agents, weak spots on Today) is being built locally at the same time and may merge before or during this work.
  - Rebase on `main` before opening each PR.
  - If Practice screens exist by then, include them in the UX pass. If not, leave a short note in the PR on how they should follow the new patterns.
  - Don't edit `server/src/practice/*` or `web/src/pages/PracticePage.tsx`.
- **No `.env*`, `data/` or `.claude/` changes.** Dependencies: only those the shadcn CLI adds for the components listed in section 2, plus nothing else unless named.
- **Checks per PR:** `tsc --noEmit` (web, plus server/shared if touched), `pnpm exec biome check <changed files>`, the vitest files near your changes, and the web build.
- **Browser verification is required for every PR.**
  - Test server: a copy of `examples/sample-set`, admin from env at first boot:
    ```
    HASH=$(printf 'testpass123\n' | pnpm --filter @studium/server --silent hash-password)
    STUDIUM_DATA_DIR=$T/data STUDIUM_STUDY_ROOT=$T/legacy STUDIUM_USERNAME=admin STUDIUM_PASSWORD_HASH="$HASH" HOST=127.0.0.1 PORT=3180 STUDIUM_FAUX=1 pnpm --filter @studium/server exec tsx src/main.ts &
    ```
    Also test a **brand-new empty instance** (no legacy tree; create the admin via `/setup`) for the beginner flows.
  - Viewports 390×844 (isMobile, hasTouch) and 1440×900; Light and Dark (plus Sepia for visual sections).
  - Real clicks.
  - Take before/after screenshots and attach or describe them in the PR.
  - Stop only the server PID you started.
- **If something doesn't fit the real code,** stop that item and describe it in the PR (file:line, what you saw).

## Sections (in order; one PR each)

### 1. UX audit and simplification plan → PR `claude/m6-ux-audit` (docs only)
1. Walk the app as two personas, and record every friction point with a screenshot or description:
   - **First-timer on a phone** in a fresh instance: sign in → first set → first note → first cards → practice → book
   - **Returning learner:** open → Today → continue → review → practise
2. Check Nielsen's 10 heuristics, jargon, dead ends, duplicated entry points, confusing names, too many choices, missing feedback, slow or janky moments, and nags (toasts, tips, confirms).
3. Write `docs/UX.md`:
   - the findings (ranked by severity and frequency)
   - the **information architecture** proposal (below), a **copy glossary** (internal term → user word) and **interaction rules** (one primary action per screen, undo over confirm, feedback within 100 ms, no modal stacks, …)
   - the list of changes that sections 3–6 will make
4. The orchestrator reviews this PR before you start section 3. Proceed to section 2 in parallel.

### 2. Design system on real shadcn (Base UI) → PR `claude/m6-design-system`
The owner chose to finish milestones first; this is the polish pass. Follow the existing prompt `docs/prompts/m3b-slice-d.md` for **batches D1 and D2 only**:
- D1: `components.json` (base-nova, `base: "base"`), smart-merging our kit, Badge everywhere, `docs/DESIGN.md`
- D2: Card, Empty, Skeleton, Spinner, Separator on the list pages

The UI map `docs/prompts/m3b-d-uimap.md` is from before M4, so refresh it first by grepping the current code. Keep our theme tokens, the 5 themes and 6 accents. Later sections use these components; D3–D5 are done opportunistically inside sections 3–5 only where those screens are touched anyway.

### 3. Navigation and information architecture → PR `claude/m6-navigation`
- **Phone:** a bottom tab bar replaces the hamburger as the main navigation. Tabs: **Today · Notes · Practice · Search · More**. The chat button becomes part of the note/set context: floating only inside a set, never covering bottom bars or action bars (fix the known overlap on the Inbox review bar). "More" opens Library, Cards, To review (Inbox), Activity (Jobs), Settings and set switching.
- **Desktop:**
  - Group the sidebar into **Study** (Today, the current set's notes, Practice, Cards, To review) and **Library** (sources).
  - Put Activity and Settings at the bottom.
  - Keep the set switcher.
- **Renames** (UI copy only, not code identifiers), following `docs/UX.md`'s glossary:
  - Inbox → "To review"
  - Jobs → "Activity"
  - "draft-chapter" → "chapter"
  - "ingest" → "adding a source"
  - "Cardsmith" / "Critic" / "Outliner" / "Drafter" / "Checker" → plain role descriptions
  - "parse tier" and "tier A–D" → "source quality"
- Set home becomes a clear **"Continue"** page:
  - one primary action (the next best step, from Today's do-next for that set)
  - secondary actions in a small row; the rest behind "More actions"
  - fix the orphan fifth card on phones
- Every screen has exactly one visually primary action.

### 4. First-run and beginner guidance → PR `claude/m6-onboarding`
- **First run** (fresh instance or a user with 0 sets): a short friendly flow.
  1. "What do you want to learn?" (goal)
  2. "How deep?" (level)
  3. "By when?" (optional)
  4. "Do you have material?" (add a PDF or link, find sources for me, or skip)
  5. → create the set, then start **Plan with agent** (`POST /api/sets` then `POST /api/jobs {kind:"plan-set"}`; see how `NewSetDialog.tsx` does it) → land on the set with a friendly "Your plan is being prepared" state.
  - Skippable, and resumable if closed.
- **Empty states teach:** every empty screen says what it is, why it matters, and has one button to do the next step.
- **Contextual first-use hints:** at most one at a time, only the first time a feature appears (e.g. "Select any text to ask about it"), dismissible, and never shown again (stored per user in localStorage plus server user settings if cheap). No tours, no modals.
- **Friendly errors:** map server errors to plain sentences with a fix action, e.g.:
  - Firecrawl not configured → "Adding whole sites isn't set up on this server. You can still add single pages."
  - AI disabled for the account → "Ask your admin to enable AI for your account."
  - Rate-limited model → "The AI is busy; we'll retry…"
  - Put the mapping in one module (`web/src/lib/friendly-errors.ts`) with tests.

### 5. Calm interactions → PR `claude/m6-calm`
- **Notification hygiene:**
  - merge repeated toasts
  - no toast for actions whose result is visible on screen
  - success toasts auto-hide in 3 s; failure toasts stay with an action
  - the "turn on notifications" tip shows once, only after a background job finishes while the tab is hidden
- **Undo over confirm:** archive/delete of notes, highlights, proposals and sources use an undo toast where the server supports reverting (git revert or soft delete). Keep typed confirmation only for truly destructive admin actions (purge a user, restore a backup).
- **Loading:**
  - skeletons instead of spinners for lists and the reader
  - optimistic updates for highlights, card approve/reject and settings toggles
  - no layout shift
- **Forms:** sensible defaults, inline validation, Enter submits, focus goes to the first field, no disabled buttons without a reason shown.
- **Touch and accessibility:**
  - 44px targets on phones
  - visible focus
  - `prefers-reduced-motion`
  - screen-reader labels on icon buttons
  - contrast AA in all themes (automated check via a small script comparing the token pairs)

### 6. Fast and offline → PR `claude/m6-performance`
- **Code-splitting:** lazy-load routes, and lazy-load mermaid, KaTeX CSS/JS and highlight.js only when a note contains them. Target an initial JS under 250 kB gzip on the landing page; report before and after sizes from the build.
- **Offline reading (PWA):**
  - cache the last-opened sets' notes, sources' summaries and highlights for offline reading (workbox runtime caching with a size cap)
  - an "Offline" banner
  - writes while offline are blocked with a clear message, not queued silently
  - verify in the browser with the network set to offline
- **Web vitals:** measure LCP/INP on the Today page and a note, and report them.

### 7. Leftover gaps (server) → PR `claude/m6-leftovers`
- **Book PDF:** keep a callout's header with its first lines. No orphaned header at a page bottom, no mostly blank pages (`server/templates/book/book.typ`, `callouts.lua`). Render mermaid into the book as SVG if possible without a heavy dependency; otherwise keep the note. Pandoc and typst aren't in the cloud: install them for testing only (official release tarballs, checksum-verified) or describe the change for local verification.
- **Persistence:** the site-import pending queue and chat job proposals survive a server restart (persist them in the workspace, e.g. under `.cache/`, and reload at boot). See `AGENT_MEMORY.md` for the current in-memory limits.
- **Install guide:** `docs/INSTALL.md`, a step-by-step for a self-hoster (Docker compose and the systemd user service), first-run setup, backups set up in the UI, and optional services (SearXNG, papers MCP, Context7, Firecrawl, MinerU).
- **Security pass on M6 changes:** no `dangerouslySetInnerHTML`, no open redirects, offline cache doesn't store other users' data after sign-out (clear caches on sign-out).

## Out of scope (owner decisions)
- No public release packaging (a Docker registry publish, marketing site), no i18n, no Scout agent in M6.
- No full shadcn D3–D5 sweep; only where sections 3–5 touch screens anyway.

## Done when
- The PRs are open in order.
- The beginner walkthrough in `docs/UX.md` is re-run at the end with before/after results: every top-10 friction point is fixed or explicitly deferred.
- The phone navigation is a bottom tab bar, and no bar overlaps.
- Initial JS is under 250 kB gzip.
- Offline reading works.
- The book has no orphaned callouts.
- Each PR description has:
  - changes per item
  - checks and results
  - verification notes and screenshots
  - anything skipped and why
  - a 5-line `AGENT_MEMORY.md` log entry (the orchestrator adds them)
