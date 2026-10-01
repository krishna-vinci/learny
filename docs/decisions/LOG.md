# Decision Log

Decisions taken while refining the Studium proposal (`docs/PROPOSAL.md`).
Where a decision conflicts with the proposal, the decision wins.
Status: **locked** = agreed · **open** = pending discussion.

---

## D1 — Storage: files are truth, index is disposable · locked · 2026-09-28

- All content (notes, sources, cards, plans) and chats live as files in the study tree.
- Chats: `sessions/<set>/<chat-id>.jsonl` (Pi session format) + a chat index.
- Search, chat listing, job status, token spend → rebuildable cache. Start with none;
  add SQLite (better-sqlite3 + FTS5) only when needed.
- **Rule:** if deleting the cache loses data, that is a bug.

## D2 — Agent runtime must support MCP · resolved by D9/D10

## D3 — Anki: .apkg export + optional AnkiConnect · locked · 2026-09-28

- Basic: generate `.apkg` files for download (no Anki required).
- Advanced: AnkiConnect (the user's desktop Anki) for live sync and retention stats.
- Headless Anki container dropped from the plan. In-app review engine parked.
- Retention telemetry / mastery features require AnkiConnect.

## D4 — Frontend: React (Memos stack) · locked · 2026-09-28

- React 19, Vite, TypeScript, Tailwind 4, shadcn/ui (Base UI), lucide, react-router,
  TanStack Query. Replaces SvelteKit from the proposal.
- Memos (MIT) cloned to `reference/memos/` (gitignored) as design/component reference.
  Components copied from it keep the MIT notice.

## D5 — Unit of study: study set vs book · resolved by D14 (set = goal; books in global library)

- Proposal: a study set is one goal that draws on many sources (books are sources).
- Alternative: one book = one study set. To decide in the study-tree part.

## D6 — Note format: Markdown; Typst for PDF export only · locked · 2026-09-28

- Chapters are Markdown: GFM + LaTeX math (`$…$`, `$$…$$`) + YAML frontmatter +
  directives (`:::definition`, `:::theorem`, `:::example`) + mermaid.
- Rendered in-browser with react-markdown + remark-math/rehype-katex + mermaid + highlight.js.
- "Compile book": Pandoc (MD → Typst) + `typst` CLI with our template → PDF.
  Fallback for math conversion issues: `mitex`.
- Agents never write Typst. `typst.ts` in-browser reader dropped.
- Why: LLMs write MD + LaTeX math reliably; Memos already renders it; interactive
  embeds are possible; notes open in Obsidian/VS Code/GitHub.

## D7 — Web search: SearXNG · locked · 2026-09-28

- Optional, configured by `SEARXNG_URL` (user already runs an instance).
- Without it, Scout uses Wikipedia + paper search only.

## D8 — Web fetch: readability built in, Firecrawl optional · locked · 2026-09-28

- Basic: @mozilla/readability + turndown (static pages).
- Advanced: Firecrawl (`FIRECRAWL_API_URL`, self-hosted or cloud) for JS-heavy
  pages, linked PDFs, site crawls. AGPL, runs as a separate service.
- To verify: Firecrawl self-host using SearXNG as its search backend.

## D9 — Agent runtime: Pi SDK · locked · 2026-09-28

- `@earendil-works/pi-coding-agent`, exact version pinned (0.87.x at decision time).
- Chosen for: file-based JSONL sessions with fork/branch/compaction (= multi-chat
  without a DB), Agent Skills spec support, broad multi-provider support, in-process
  embedding with streaming events and steer/follow-up.
- All Pi usage isolated behind `server/agent/` (own interface: `startChat`, `runJob`,
  `stream`) so the runtime can be swapped (e.g. Vercel AI SDK).
- Rejected: Claude Agent SDK (Claude-only, breaks BYO models), Mastra (memory wants a DB),
  Vercel AI SDK (would require building sessions/compaction/skills), OpenAI Agents JS.

## D10 — MCP: own bridge into Pi custom tools · locked · 2026-09-28

- Pi has no native MCP. Bridge: `@modelcontextprotocol/sdk` client → each MCP tool
  registered as a Pi `customTool`. Fallback: `pi-mcp-adapter`.
- Servers configured in `_global/mcp.json`.
- Core functionality uses built-in tools; the app works with zero MCPs configured.
- Planned MCPs: paper-search (Sci-Hub source disabled by default), wikipedia,
  youtube-transcript, SearXNG, Firecrawl, AnkiConnect.

## D11 — Skills: Agent Skills spec · locked · 2026-09-28

- `<name>/SKILL.md` (+ `references/`, `assets/`) under `_global/skills/` in the study tree.
- Portable to other harnesses (Claude Code, Codex, …): runtime-agnostic by construction.

## D12 — Scoped tools per agent, no bash · locked · 2026-09-28

- Pi default coding tools disabled (`noTools`); custom ResourceLoader loads only our skills.
- Each role gets an explicit tool allowlist. File tools confined to the study root.

## D13 — Principles revised · locked · 2026-09-28

- `docs/PRINCIPLES.md` replaces proposal §2. Changes: auto-git study tree (P1), disposable
  cache allowed (P2), `[^src:<id>]` citation format + warn-only cross-model (P3), approval
  instead of Anki quarantine deck (P4), skill tool fallbacks (P6), git = what / ledger = why
  + per-file lock (P8). Added P9 basic/advanced tiers, P10 propose/approve, P11 cost visible.

## D14 — Study tree contract · locked · 2026-09-28

Spec: `docs/STUDY_TREE.md`. Key points:
- S1: set = goal; sources in global `library/<src-id>/`, referenced by sets (resolves D5).
- S2: chats in `<set>/chats/<id>.jsonl`, gitignored; optionally anchored to a note/source.
- S3: cards as Markdown per chapter (`cards/NN-slug.md`), `## <card-id>` + inline status comment.
- S4: no `INDEX.md`, no per-set `profile.md`; listing derived from `*/PLAN.md` frontmatter.
- S5: source originals gitignored; `sha256` in `source.md`.
- S6: one file per chapter; depth via collapsible `:::deeper` directives.
- S7: source ids `lib-<author>-<short-title>`.

## D15 — Agent roles, tools, jobs · locked · 2026-09-28

Spec: `docs/AGENT_ROLES.md`. Librarian role added (ingest owner). Per-role tool allowlist;
agents never write to Anki. Role→model map in `_global/config.yaml`, secrets in env.
Pipelines are fixed TypeScript (not agent-orchestrated). Per-file lock + exact-string edits;
one git commit per chat turn / job. Tutor launches jobs via `start_job` with cost confirm.
In-memory job queue; history appended to `<set>/log/jobs.md`.

## D16 — Review loop · locked · 2026-09-28

Spec: `docs/REVIEW_LOOP.md`. GUID = card id; `$`→MathJax conversion on export; own note
types + `Studium::<set>::<chapter>` decks; `.apkg` basic / AnkiConnect advanced; in-app quiz
is practice only, logged to `log/quiz.md`; leeches → Critic jobs; stale-card flags; Today
page + optional webhook; mastery rule deferred, data captured now.

Verified 2026-09-28 (for Part 7): Firecrawl self-host supports `SEARXNG_ENDPOINT`;
MinerU ships `mineru-api` with `POST /file_parse` (+ async task endpoint).

## D17 — Ingest pipeline · locked · 2026-09-28

Spec: `docs/INGEST.md`. Entry points: chat, UI, watched `library/_inbox/`. Papers via
paper-search MCP download → own PDF route. MinerU, Firecrawl, SearXNG are env URLs only
(never shipped). Deterministic PDF quality check. Cleanup in code; LLM only writes
summary/TOC. Sources > ~50 KB split into `parsed/NN-slug.md` (amends D14). Page anchors,
A–D credibility tiers, dedupe, async MinerU. Images/audio go to the Librarian model when it
supports them; no OCR or Whisper component.

## D18 — UI · locked · 2026-09-28

Spec: `docs/UI.md`. Memos-derived 3-pane layout (sidebar · reader · chat dock). Reader with
citation hovers, selection → ask/explain/make card, git history + revert. Chat with tool
chips and rich cards (job confirm, edit diff, quiz). Keyboard-driven approvals inbox.
Single SSE stream incl. file watcher. Mobile: read/chat/approve + PWA. Own chat component.

## D19 — Deploy & security · locked · 2026-09-28

Spec: `docs/DEPLOY.md`. Single compose service, one volume. Image bundles git, pandoc,
typst, uv/Python. Anki: browser → AnkiConnect by default, server → `ANKICONNECT_URL`
optional. Auth: username + password hash in env, signed httpOnly cookie, rate limit,
localhost-only without password; login UI copied from Memos (IdP, sign-up, captcha,
Connect-RPC removed). TLS via proxy/Tailscale. Agent-security table, sandboxed sims.
Optional git remote backup. Study-tree schema migrations.

## D20 — Roadmap · locked · 2026-09-28

Spec: `docs/ROADMAP.md`. Notes before cards. MVP = M0 (skeleton) + M1 (sources → notes)
+ M2 (cards & review). pnpm workspaces: `server/`, `web/`, `shared/`, `skills/`,
`examples/sample-set/`. Working title stays "Studium" (repo: learny).

## D21 — Model credentials from the learner's Pi config · locked · 2026-09-28

The app reuses Pi's own config directory (`getAgentDir()`: `PI_CODING_AGENT_DIR`, default
`~/.pi/agent`) for `auth.json` / `models.json`. Providers (GitHub Copilot, zai coding plan,
OpenAI, …) are set up once with Pi's own tooling; credentials never enter the study tree.
Role → model mapping stays in `_global/config.yaml`. Docker: mount the Pi config dir
read-write (OAuth tokens refresh). Supersedes the `_global/models.json` idea in the M0 plan.

## D22 — M1 external tools · locked · 2026-09-29

- Web search via the SearXNG MCP server (`mcp-searxng`, `SEARXNG_URL`), not direct HTTP.
- Paper search via the learner's remote paper-search MCP over Streamable HTTP
  (`PAPERS_MCP_URL`, optional `PAPERS_MCP_TOKEN`); no local copy.
- Wikipedia, web fetch and skill loading are built-in tools (no MCP needed; P9).
- MCP config `_global/mcp.json` (Claude-style `mcpServers`), `${ENV}` interpolation;
  stdio MCP servers get only PATH + their own env (no provider keys).
- Anki (for M2): AnkiConnect / Anki MCP when available, else `.apkg` export.

## D23 — Anki: `.apkg` only, no stats · locked · 2026-09-29

Anki stays an optional export: `.apkg` download is primary; the existing browser
AnkiConnect sync button is kept but frozen (no further work). No retention pull, leeches,
or server-side AnkiConnect. Progress signal comes from in-app practice (D27) instead.
Supersedes the Anki parts of M3 in D20.

## D24 — Accounts like Memos · locked · 2026-09-29

- First-run setup screen creates the admin; `STUDIUM_USERNAME`/password hash in `.env` retire
  (migrated once into the admin account).
- Roles admin / user. Instance settings: allow sign-up (default off), disallow password
  login (once an SSO provider works).
- SSO: generic OAuth2 identity providers managed by the admin in Settings (templates:
  GitHub, Google, GitLab; custom = auth/token/userinfo URLs + scopes + field mapping, covers
  Authentik/Keycloak/Authelia/Pocket ID). Mirrors Memos `idp_service` / `AuthCallback`.
- Personal access tokens, session list with per-device sign-out, profile/password/avatar.
- Storage: SQLite (`data/studium.db`) for users, sessions, tokens, IdPs, instance settings
  only. Study content stays plain files (P-principles unchanged).

## D25 — Multi-user data: one study tree per user · locked · 2026-09-29

`data/users/<username>/` is a full study tree (own sets, library, git repo, chats, jobs).
All tree paths resolve inside the signed-in user's root. The admin's model providers (Pi
config, D21) are shared; the admin can allow/deny AI jobs per user. Set sharing: later.
Migration: existing `data/study` moves into the admin's tree with history intact.

## D26 — Backups: bring-your-own restic target · locked · 2026-09-29

- Built-in restic: repository = any restic backend (local path, `sftp:`, `rest:`,
  `s3:` incl. MinIO/B2/Wasabi, `rclone:`).
- Setup happens entirely in the UI (admin Settings → Backups), no `.env` editing: pick a
  destination type → per-type form (path / host+user / URL / bucket+keys / rclone remote) →
  Test connection → initialise repo. The app generates the repository password and shows a
  one-time "recovery kit" (password + restore steps) to save. Secrets are stored encrypted
  in SQLite (key derived from the instance secret). `.env` values, if present, only prefill.
- Admin Settings: schedule, retention (default 7 daily / 4 weekly / 12 monthly), Back up
  now, snapshot list, restore (note / set / all), monthly `restic check`, last-run status.
- Consistent: writes paused (repo lock) during snapshot; SQLite copied via online backup
  first. Covers everything under `data/` including gitignored chats and originals.
- Per-user "Download all my data" (zip). Docs: `data/` is one volume, so Backrest,
  borgmatic, Duplicati or ZFS snapshots work too.
- Git history is versioning, not backup.
- Learner's own setup: restic rest-server on 192.168.0.55, optional rclone cloud copy.

## D27 — Notifications, background jobs, practice · locked · 2026-09-29

- Notifications: Web Push (PWA, VAPID) and ntfy (topic URL). Events: job done/failed,
  backup failed.
- Drafting never blocks the UI: the user stays on the page; a global activity indicator
  shows running jobs; the note list shows a "drafting…" placeholder; done → toast + push
  with "Open note". Many jobs can be queued.
- Practice (M5): quizzes with weak-spot tracking, teach-back, problem sets. Placement quiz
  and levels dropped; Scout deferred to M6.
- Frontend work uses the `ui-ux-pro-max` skill.

## D28 — Roadmap after MVP · locked · 2026-09-29

M3a Platform · M3b Comfort · M4 Study loop · M5 Practice · M6 Polish (see
`docs/ROADMAP.md`). Supersedes M3–M5 of D20.

## D29 — Media and visuals in notes · locked · 2026-10-01

Every media kind has a web form and a local static book form. Reading and compiling
never fetch internet resources, except HTTPS note images retained under F2 and a
YouTube player explicitly tapped by the learner.

| Kind | Web | Book |
| --- | --- | --- |
| Mermaid | Rendered diagram | Diagram-in-the-app caption (existing behavior) |
| SVG figure / saved image | Image via the asset route | Local image |
| Unsaved HTTPS web image | Image | Caption + URL text |
| YouTube | Local thumbnail → tap → nocookie player | Thumbnail + time + link |
| Vega-Lite | Lazy SVG chart | Server-rendered light SVG |
| Artifact | Poster → tap → sandboxed iframe | Poster + caption |

- **F1:** remark-directive leaf syntax, no space before attributes:
  `::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=843 end=900}` and
  `::artifact{src="../artifacts/x.html" poster="../artifacts/x.svg" title="…"}`.
  Invalid attributes yield a link or unavailable text; never throw.
- **F2:** Paths resolve relative to the note, confined to its set. HTTPS images may
  remain external in the web reader; the book never fetches them.
- **F3:** `<set>/assets/**` and `<set>/artifacts/**` are git-tracked.
- **F4:** PNG, JPEG, GIF and WebP; SVG is agent-written only. No AVIF. Typst 0.15.1
  supports WebP (verified locally); unsupported formats degrade to captions.
- **F5:** Raw HTML stays blocked in notes; no rehype-raw. HTML lives in artifacts.
- **F6:** Artifact iframe sandbox is exactly `allow-scripts`. Its srcDoc begins with
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:">`.
  No allow-same-origin; no network or external resources.
- **F7:** YouTube is click-to-load, with a local thumbnail or neutral placeholder,
  youtube-nocookie player, start/end, autoplay, strict-origin-when-cross-origin,
  autoplay/encrypted-media/picture-in-picture/fullscreen permissions, and an always
  visible Watch on YouTube link with `&t=`. No YouTube requests before the tap.
- **F8:** Saved image credits are `assets/<name>.json` with
  `{url, pageUrl?, sourceId?, alt, license?, savedAt}`. Notes still cite sources.
- **F9:** Downloaded images ≤ 5 MB, ≤ 6000×6000 px; set assets ≤ 50 MB. Artifact
  HTML and agent SVG each ≤ 300 KB. Saves refuse overflow.
- **F10:** Chat embeds are plain links; images must resolve within the chat's set.
- **F11:** Card-writing agents never use media; `.apkg` does not pack files.

Charts use inline `data.values`, the AST expression interpreter and rejecting
loaders in web and book. No URL data. Deferred: Mermaid SVG book rendering via mmdc,
Anki media, chat embeds, and server-side artifact poster rendering.

## D30 — Teaching voice · locked · 2026-10-01

- V1: warm, precise teacher; concrete first, natural we/you, short paragraphs, no internal/operator prose.
- V2: flexible hook → relevance → concepts/examples → subject blocks → Check yourself with collapsed answers → Key takeaways → bridge.
- V3: optional PLAN subject: math, science, technology, history, finance, language, practical, general; unknown/missing uses general.
- V4: stable citations, human footnotes (author/organisation, title, section/page); no internal paths or line numbers.
- V5: learner-requested rewrite-chapter keeps facts, citations, figures, frontmatter/path and uses draft/check/revision and History.
- V6: course states derive from matching notes and active jobs; tick at draft commit and repair stale ticks on the next draft, never a read.

Teaching commitments and the 20-rule mapping: `docs/TEACHING.md`.
