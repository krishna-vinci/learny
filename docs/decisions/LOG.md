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
