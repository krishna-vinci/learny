# M4 Study Loop — Plan

**Goal:** the app tells the learner what to do today, finds anything instantly, turns any passage into a question, a simpler explanation or a card, plans a whole set from a goal, and compiles a set into a PDF book. Research agents use the new tools (paper search, Context7, SearXNG, Firecrawl) properly.

**Spec:** `docs/ROADMAP.md` (M4 row), `docs/UI.md` (Today, Reader selection menu, ⌘K), `docs/AGENT_ROLES.md` (Outliner; "Plan: Outliner → PLAN.md draft → user approves"), D6 (Typst for PDF export only), D23 (no Anki stats), D27 (background jobs).

**Rules:**
- Read `AGENT_MEMORY.md`.
- Prompts go in `docs/prompts/m4-<task>.md`. The orchestrator asks the owner, per task, whether they run it or the orchestrator dispatches.
- If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.

**Routing (owner's rules):**
- `sol61` (GPT-6.1 Sol): backend and high-scope tasks.
- `fast` (DeepSeek): quick exploration and simple fixes.
- `precise` (GLM Flash): light, tightly-scoped fixes.
- `luna`: trivial fixes.
- **Sonnet:** all UI, one session for the whole milestone, driven by precise prompts.
- New UI uses the existing `web/src/components/ui` kit; the shadcn migration waits for M6.

## Decisions to confirm with the owner

| # | Decision | Proposal |
|---|---|---|
| 1 | Search index | SQLite FTS5 (built into `node:sqlite`, checked: porter stemming and snippets work). One index per user at `<tree>/.cache/search.db` (gitignored, rebuildable). Updated by the file watcher and fully rebuilt on boot. Covers notes, sources (`source.md` plus parsed text), cards and chat titles. |
| 2 | Highlights storage | `<set>/highlights/<note-file>.json`, holding `[{id, quote, prefix, suffix, color, note?, createdAt}]`. Anchored by quote, prefix and suffix, so it survives small edits. Committed as `user:`. |
| 3 | Book output | `<set>/.cache/book/<set>.pdf` (not committed; regenerated on demand) plus a download button. The Typst template lives in `server/templates/book/`. Requires **pandoc** and **typst** on the host and in Docker; the owner installs them on the host (the agent can't sudo). |
| 4 | Set planning flow | A new **Outliner** role and job `plan-set`. Input: goal, level, deadline, chosen sources. Output: a *draft* `PLAN.md` + `curriculum.md` (chapter list with prerequisites) shown in the Inbox as a plan to approve. Approve → queue `draft-chapter` jobs for the first N chapters (default 3; the learner chooses). |
| 5 | Whole-site import | Firecrawl `/v2/map` → the learner picks pages (search, filter, select-all by path) → one `ingest` job per page, queued and rate-limited (max 3 at once). Capped at 100 pages per import. |
| 6 | MinerU | Code exists (`server/src/ingest/mineru.ts`). The owner runs a MinerU server and sets `MINERU_URL`. We only verify it on a formula-heavy PDF. |

## Tasks

| id | who | depends | what |
|---|---|---|---|
| **M4-0 Research skills** | `sol61` | — | New `skills/find-sources/SKILL.md`, plus research-tool guidance in draft-chapter, fact-check, source-summary, explain, evolve-note, note-authoring, make-deck and critique-cards (the table agreed with the owner on 2026-09-30). Add `find-sources` to the tutor and librarian skill lists (`server/src/agent/roles.ts`). **Skill sync:** on boot, update default skills in each user tree whose content still matches a known earlier default (hash list in `server/src/tree/init.ts`); never overwrite user-edited skills; commit `system: update default skills`. |
| **M4-1 Today API** | `sol61` | — | `GET /api/today`, per user, across sets. Per set: title, `next_action`, deadline (days left), chapters awaiting review (inbox), draft cards, stale cards, running jobs, last studied (latest user commit or chat), next chapter from `curriculum.md`. Global: the suggested "do next" list (rules: overdue first, then reviews, then the next chapter). No Anki stats (D23). |
| **M4-2 Search API** | `sol61` | — | FTS5 index module `server/src/search/` (schema, indexer, watcher hook, rebuild). `GET /api/search?q=&set=&kind=&limit=` returns `{kind, set, path, title, snippet, score}`. Path-confined per workspace; no cross-user reads. |
| **M4-3 Selection + highlights API** | `fast` | — | Chat messages accept `quote` next to `anchor` (`server/src/agent/routes.ts:61`); the tutor prompt receives the quoted passage. Highlights CRUD at `/api/sets/:set/highlights?note=` (read, add, update, delete), write-locked, committed as user. |
| **M4-4 Outliner + plan-set** | `sol61` | 0 | New role `outliner` in `roles.ts` (read the tree, the library, paper search, SearXNG, Context7; write only `PLAN.md` drafts and `curriculum.md` via the inbox). Job kind `plan-set` in `shared` `JobKind` + runner + routes. New skill `skills/plan-set/SKILL.md`. Inbox item type "plan", with approve → queue N draft-chapter jobs. Settings role map: `outliner` moves out of `FUTURE_ROLE_KEYS` (`server/src/routes/settings.ts:18`). |
| **M4-5 Book PDF** | `sol61` | owner installs pandoc and typst | Job kind `compile-book`: notes in `order` → one Markdown file (strip frontmatter; directives → Typst callouts through a small Lua or Pandoc filter; mermaid → pre-rendered SVG via the existing mermaid pipeline, or skipped with a note; math through Pandoc's Typst writer; citations → footnotes plus a bibliography from `library/*/source.md`) → `pandoc -t typst` → `typst compile` with `server/templates/book/` (title page, table of contents, chapter headers, readable body type). `GET /api/sets/:set/book.pdf`. Dockerfile adds pandoc and typst. |
| **M4-6 Site import API** | `sol61` | — | `POST /api/library/site-map {url, search?, limit}` → Firecrawl `/v2/map` (the endpoint from `ingest/firecrawl.ts`; the site URL passes `assertPublicUrl`). `POST /api/library/site-import {urls[], set?}` → queued ingest jobs with max 3 concurrent and a 100-URL cap. |
| **M4-7 UI (Sonnet, one session, sliced)** | Sonnet | 1–6 | (a) **Today page** at `/today`, the default landing: "Do next" cards and per-set rows. (b) **⌘K search palette** (desktop keyboard; phone search icon in the header), grouped results that jump to the note and scroll to the match. (c) **Reader selection menu:** Ask about this, Explain simpler, Make a card (prefilled Cardsmith request), Highlight (4 colours), with highlights rendered and a list per note. (d) **Plan a set:** a "New study set" form with an optional "Let the agent plan it" (goal, level, deadline, sources), and a plan review in the Inbox with approve and "draft first N". (e) **Book:** a "Download book (PDF)" button with job progress on the set home. (f) **Import a docs site** tab in Add source: map → filter and select → import. Each slice uses real-click verification at 390 and 1440 px, light and dark. |
| **M4-8 Review** | `sol61` read-only | all | Security and correctness review (search isolation, highlight write paths, site-import SSRF and caps, the book job running pandoc/typst safely with no shell and fixed argv, plan approval) → the orchestrator fixes via prompts → end-to-end on a copy of `data/`. |

**Order:**
1. M4-0, M4-1, M4-2 and M4-3 in parallel (separate worktrees; different files except `server.ts` mounts).
2. M4-4, M4-5, M4-6.
3. M4-7 slices follow as their APIs land.
4. M4-8.

M4-5 waits until pandoc and typst are installed on the host.

**Done when:**
- The app opens on Today with sensible "do next" items.
- ⌘K finds a phrase across notes, sources and cards.
- A selected passage becomes a chat question, a simpler explanation, a card request or a highlight.
- A set planned from a goal produces an approvable outline that queues drafts.
- "Linear algebra for ML" downloads as a readable PDF book.
- A docs site imports as library sources.
