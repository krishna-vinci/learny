# Agent memory (shared by every agent working on learny)

Read this before starting. It saves you re-exploring the repo.

At the end of every task, append ONE entry to the **Log** at the bottom, 5 lines max:
- date and task id
- what changed (files)
- what the next agent needs to know
- anything left open

Keep the rest of this file current. When you fix something listed under "Open gaps", move it to "Recently done" with the commit. Do not paste code here. Do not store secrets.

## Owner and how we work
- The owner is a sole developer who uses the app mostly on a phone (installed PWA, 390px). Goal: Studium, a self-hosted, agent-powered learning app. Agents turn sources into cited Markdown notes and Anki cards stored as plain files.
- **Orchestrator:** GPT-6.1 Sol (Codex) or Claude.
  - It plans (`docs/plans/YYYY-MM-DD-*.md`) and writes task prompts (`docs/prompts/<task>.md`).
  - It asks the owner whether they want to run a prompt themselves or have it dispatched.
  - It reviews, verifies, commits and merges.
- **Implementers** do exactly the prompt. If it doesn't fit the code, stop and report file:line.
  - Never load orchestration skills. Never spawn workers. Never commit or push.
  - Never touch `.env*`, `data/`, or `.claude/`.
- **Model routing** (`.claude/skills/codex-orchestrate/dispatch.sh` aliases):
  - `precise` (GLM 5.3 Flash) is the default for careful work. Full `glm` hit its quota; use it only if asked.
  - `fast` (DeepSeek 4.1 Flash) for simple, broad work.
  - `sol` (GPT-5.6 Sol) and `sol61` (GPT-6.1 Sol) for hard or security work.
  - Frontend work goes to GLM Flash or Claude Sonnet, with the `ui-ux-pro-max` skill.
  - Only one GLM run at a time (429s).
- Specs: `docs/PRINCIPLES.md`, `docs/decisions/LOG.md` (D1–D28; it overrides `docs/PROPOSAL.md`), `docs/ROADMAP.md`, `AGENTS.md` (testing policy, high-risk areas).

## System map
- **`server/`** (Hono, Node 22, tsx)
  - `server.ts`: top-level app with guard, `/api/auth`, session, `/api/me`, `/api/admin`, AI gate, and the per-user workspace delegate.
  - `app.ts`: the per-workspace app.
  - `workspaces/manager.ts`: one runtime per user (tree, hub, locks, MCP, jobs, chats, watchers).
  - `db/`: SQLite via `node:sqlite` with migrations; `accounts/`; `auth/`; `sso/`.
  - `backups/`: restic. `notify/`: ntfy and Web Push. `export/`.
  - `agent/`: the only place that imports Pi; roles in `agent/roles.ts`, builtins in `agent/builtins/`.
  - `jobs/`: runner, draft/cards/ingest jobs. `ingest/`: safe-fetch, Firecrawl v2, PDF/EPUB/web. `tree/`: fs, locks, git.
- **`web/`**: React 19, Vite, Tailwind 4, base-ui wrappers in `components/ui`, TanStack Query (`api/queries.ts`, one shared SSE `EventSource`), PWA.
- **`shared/`**: zod schemas and API types. **`skills/`**: default agent skills copied into new trees.
- **Data** (`STUDIUM_DATA_DIR`, default `data/`):
  - `studium.db` (accounts)
  - `users/<name>/` (study trees; each is its own git repo)
  - `.backup/`
  - `.secret`
- **Live app:** systemd *user* unit `studium.service` on 0.0.0.0:3000.
  - Restart with `systemctl --user restart studium`; logs with `journalctl --user -u studium`.
  - Web-only change: `pnpm --filter @studium/web build`, no restart needed.
- **Services** (all set up in `.env`):
  - SearXNG MCP
  - paper-search MCP (remote, secret path)
  - Context7 MCP (key)
  - Firecrawl, self-hosted on this machine at `http://127.0.0.1:3002` (v2, no key)
- The study tree git repo auto-commits per role author (tutor/librarian/drafter/checker/cardsmith/critic/user/system).

## Gotchas learned the hard way
- **Biome:** run it as `rtk proxy pnpm exec biome check <files>`. Plain biome output gets rewritten into a fake "out of memory" error.
- **base-ui:** `Menu.Item` fires `onClick`, NOT `onSelect` (Radix). `onSelect` silently does nothing.
- **Overlays:** sheets and dialogs opened from the phone drawer must portal to `<body>`. The drawer's stacking context puts them under the chat button.
- **UI verification needs real input:** `elementHandle.click()`/`tap()`/`mouse.click`, never `el.click()` in `evaluate`. Use `waitUntil: "domcontentloaded"` plus a timeout, since SSE keeps the network busy.
- **Test against a COPY of `data/`**, never the live dir. Agent-written notes differ from the sample set (unquoted YAML frontmatter), and a save bug only showed on real data.
- **Faux model:** `STUDIUM_FAUX=1` can't complete draft-chapter jobs (they fail). Verify drafting with real models on a data copy.
- **`.env` in a shell:** don't `source` it. `$` in the scrypt hash gets expanded. The app reads `.env` itself (`process.loadEnvFile`). Worktrees have no `.env`; symlink it only for tests, then remove the symlink.
- **systemd:** the user unit has no nvm PATH; `scripts/install-service.sh` pins the node dir.
- **Firecrawl:** the configured endpoint is trusted (it may be LAN or localhost). The scraped page URL still goes through `assertPublicUrl`.
- **Codex tool limits:** `rm -rf` on computed paths is rejected. Put test data under the scratchpad. If `apply_patch` fails, write the file with a heredoc.
- **Sessions:** DB-backed cookie `studium_session` (SameSite Strict). Personal access tokens use the `studium_pat_` prefix. There is no public sign-up; the admin adds users.

## Status (2026-09-30)
- **Done:**
  - M0 skeleton, M1 sources→notes, M2 cards
  - M3a platform: accounts and SSO, per-user trees, backups, notifications, export, service
  - M3b slice A (background jobs UX) and slice B (reading comfort)
- **Next:** M3b slice C (themes), then M4 (study loop).

## Open gaps
- **M3b slice C:** themes (System/Light/Dark/Sepia/Black, 6 accents, Settings → Appearance, no flash on load, status bar colour).
- **Skills update** (awaiting the owner's go):
  - a new `find-sources` skill
  - research-tool guidance in `draft-chapter`, `fact-check`, `source-summary`, `explain`, `evolve-note`, `note-authoring`, `make-deck`, `critique-cards`
  - a server change that syncs default skills into existing trees without overwriting skills the user edited
- **Reading width default:** 72ch (the plan's number); the old look was 68ch. The owner may prefer 68.
- **M4 items:** Firecrawl map/crawl ("add a whole docs site"), Today page, search, selection actions, Outliner, book PDF (Pandoc → Typst; not installed), MinerU.
- **ROADMAP follow-ups:**
  - revert scope
  - persist chat proposals across reloads
  - resumed-ingest title
  - per-field frontmatter fallback
  - directive attributes
  - code-splitting (the bundle is over 500 kB)
- **Backups:** not configured yet on the live instance. The owner does this in Settings → Backups.

## Recently done
- 499eb3a M3b slice B · 0265a62 M3b slice A · 8b12aca Context7 MCP · Firecrawl v2 + LAN endpoint
- ceaad1d M3a audit fixes · M3a T1–T5 + web (accounts, SSO, workspaces, backups, notify/export)

## Log
- 2026-09-30 · m3b-a2 (GLM Flash) · Slice A: `web/src/components/Activity/*`, `lib/job-transitions.ts`, NewChapterSheet/Reader/AddSource/Chat stay in place · the faux model can't finish drafts; verify with real models · none open.
- 2026-09-30 · m3b-a2 (GLM Flash) · Slice B: `lib/reading-prefs.ts` (extendable for themes), `lib/immersive-store.ts`, `lib/scroll-memory.ts`, `Reader/ReadingSettings.tsx`, ImmersiveExitButton · wake lock can't be tested headless · width default 72 vs 68 undecided.
