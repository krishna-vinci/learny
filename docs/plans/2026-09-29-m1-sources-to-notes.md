# M1 Sources → Notes Implementation Plan

> **For agentic workers:** Execute only the task you were given. Do not load brainstorming or other workflow skills. Read `/path/to/studium/AGENTS.md` first. If a step does not fit the real code or a library API differs from what is written here, stop and report the mismatch (file:line, what you saw) instead of improvising. Run biome as `rtk proxy pnpm exec biome check <files>` (without `rtk proxy` a shell hook fakes an "out of memory" crash when biome finds problems; if `rtk` is missing, run biome directly).

**Goal:** The learner adds sources (PDF, web page, Wikipedia, YouTube, EPUB/DOCX, papers) from chat, the UI or a drop folder; a Librarian writes each source's summary; the Tutor can search the web and papers; a Drafter writes a cited chapter that a Checker on a different model reviews; the learner accepts it from an Inbox — all visible and usable on a phone.

**Architecture:** Builds on M0 (`server/src/agent/` wraps Pi). M1 adds: an MCP bridge (`server/src/mcp/`) turning configured MCP servers into Pi custom tools; built-in tools (Wikipedia, fetch, skills); a role system so every agent (Tutor, Librarian, Drafter, Checker) is one config (model role, tool allowlist, prompt, skills); an in-process job runner (`server/src/jobs/`) with cost tracking and SSE progress; a basic-tier ingest pipeline (`server/src/ingest/`) writing `library/<src-id>/`; and web pages for Library, Jobs, Inbox and Settings.

**Tech Stack:** M0 stack + `@modelcontextprotocol/sdk@^1.31.0`, `unpdf@^1.8.1`, `mammoth@^1.13.0`, `turndown@^7.2.4` (+ `@types/turndown`), `@mozilla/readability@^0.6.0`, `linkedom@^0.18.13`, `jszip@^3.10.2`, `youtube-transcript-plus@^2.0.3`.

**Spec:** `docs/INGEST.md`, `docs/AGENT_ROLES.md`, `docs/STUDY_TREE.md`, `docs/UI.md`, `docs/PRINCIPLES.md`, `docs/decisions/LOG.md` (D10, D11, D14–D17, D21, D22), M0 plan `docs/plans/2026-09-28-m0-skeleton.md` (API contract conventions).

## Global Constraints

- Everything from the M0 plan's Global Constraints still applies (packages, ESM, pinned Pi `0.87.1`, no real network or LLM calls in tests, agents never get bash).
- Principle 9: every external service is optional. With no `_global/mcp.json` entries and no `SEARXNG_URL`/`FIRECRAWL_API_URL`/`MINERU_URL`, the app still ingests PDF/web/Wikipedia/YouTube/EPUB/DOCX and drafts chapters.
- Principle 10: batch output waits for approval. Drafted chapters land as `status: draft`; only the learner's "Accept" sets `status: accepted`.
- Principle 11: every job records token usage and cost (Pi usage data) and shows it.
- Env (document in `.env.example`, never edit `.env`): `SEARXNG_URL`, `FIRECRAWL_API_URL`, `FIRECRAWL_API_KEY`, `MINERU_URL`, `STUDIUM_MAX_PARALLEL_JOBS` (default 3). MCP secrets are referenced from `mcp.json` as `${ENV_NAME}` and live only in env.
- Mobile first: every new screen must work at 390px width (full-screen sheets on phones, like the chat and history), verified by screenshot in T11.
- Tests use fakes: an in-process fake MCP server, stubbed `fetch`, fixture PDFs/EPUB/DOCX generated in the test or stored under `server/test/fixtures/` (small, < 50 KB each).

## Decisions (fixed)

1. **MCP config** `_global/mcp.json` (Claude-style): `{ "mcpServers": { "<name>": { "command", "args", "env" } | { "url", "headers" } } }`. `${VAR}` in `env`/`headers`/`url` is replaced from `process.env`; a missing var disables that server with a health error. Transports: stdio and Streamable HTTP (SSE fallback not needed). Tool names exposed to agents: `mcp_<server>_<tool>` (non-alnum → `_`, max 64 chars).
2. **Default `mcp.json`** written on init (only if missing) and added to the sample set:
   ```json
   { "mcpServers": {
       "searxng": { "command": "npx", "args": ["-y", "mcp-searxng@2.4.0"], "env": { "SEARXNG_URL": "${SEARXNG_URL}" } },
       "papers": { "url": "${PAPERS_MCP_URL}", "headers": { "Authorization": "Bearer ${PAPERS_MCP_TOKEN}" } }
   } }
   ```
   A header whose `${VAR}` is unset is dropped (not an error); an unset `url` var disables the server.
3. **Built-in tools** (always available, no MCP): `wiki_search` + `wiki_read` (Wikipedia REST API, language `en`), `web_fetch` (URL → markdown via readability + turndown, Firecrawl when configured; 200 KB cap), `load_skill` (returns a skill's `SKILL.md` text + list of its `references/` files; `load_skill_reference` returns one reference file). Pi's own skill listing is not used because it relies on Pi's `read` tool, which agents don't have.
4. **Roles** `server/src/agent/roles.ts`: one table `ROLES: Record<RoleName, RoleSpec>` with `modelRole` (key in `config.yaml` `models.roles`), `tools` (names; MCP tools by server via `mcpServers: string[]`), `skills: string[]` (listed in the prompt), `promptBuilder`. Roles in M1: `tutor`, `librarian`, `drafter`, `checker`. Allowlists (from `docs/AGENT_ROLES.md`):
   | Role | Study tools | Built-ins | MCP servers | Extra |
   |---|---|---|---|---|
   | tutor | list/read/edit/create | wiki, web_fetch, load_skill | searxng, papers | `start_job`, `add_source` |
   | librarian | read library source, write `source.md` only | load_skill | — | — |
   | drafter | list/read (set + library), create/edit `notes/**` | wiki, web_fetch, load_skill | papers | — |
   | checker | list/read (set + library), write `log/checks/**` only | wiki, web_fetch, load_skill | searxng, papers | — |
   A role's write rule is enforced in the tool (like `isWritableByAgent`), not only by prompt.
5. **Job runner**: in-memory queue, `STUDIUM_MAX_PARALLEL_JOBS`, job = `{ id, kind, set, title, status: queued|running|done|failed|cancelled, progress: string, startedAt, finishedAt, usage: { input, output, cacheRead, cacheWrite, costUsd }, result?: { notePath?, sourceId?, commitSha? }, error? }`. Publishes `{ type: "job", job }` StudiumEvents on every change. On finish appends one line to `<set>/log/jobs.md` (or `library/_jobs.md` for set-less ingest). Restart → queue lost (acceptable, D15).
6. **Job kinds in M1**: `ingest` (fetch → extract → clean → write library → Librarian summary), `draft-chapter` (Drafter → Checker → ≤1 revise round → `status: checked` or leave `draft` with open issues).
7. **Cost confirm**: Tutor's `start_job` tool does not start the job; it creates a pending job proposal event `{ kind: "job_proposal", proposalId, jobKind, title, estimate }` (ChatStreamEvent) and returns "awaiting learner confirmation". The web chat renders it as a card with Run / Dismiss; Run → `POST /api/jobs` with the proposal. Estimate = rough tokens from input sizes × model cost; show "subscription" when the model cost is 0.
8. **Ingest ids**: `lib-<author-or-site>-<short-title>` slug (≤ 48 chars), suffix `-2`, `-3` on collision. Dedupe by sha256 (files), normalized URL, arXiv id / DOI; a hit returns the existing id (and links it to the set's `PLAN.md` `sources` if a set was given — via a user-attributed edit, not an agent write).
9. **Split**: `parsed.md` ≤ 50 KB, else `parsed/NN-slug.md` per top-level heading (fallback: ~40 KB chunks at paragraph boundaries) and a TOC table in `source.md`.
10. **PDF**: `unpdf` text per page with `<!-- p:N -->` markers; quality check per `docs/INGEST.md` (chars/page < 200 or replacement-char ratio > 5% → poor). Poor + `MINERU_URL` set → MinerU `POST /file_parse` (sync endpoint, 30 min timeout) else keep text + `parse_warning` in `source.md`.
11. **Chapter status flow**: Drafter creates `notes/NN-slug.md` with `status: draft` (NN = next free number). Checker writes `log/checks/NN-slug.md` (issues list with severity + quotes + suggested fix) and, if no blocking issues, sets note `status: checked` (checker may edit only the `status` frontmatter line of that note — enforced). Accept in UI → `status: accepted` (user commit).
12. **Commits**: each job commits only paths it wrote, author `tutor` for tutor turns, new git authors `librarian`, `drafter`, `checker` (add to `AUTHOR_ENV`, emails `<role>@studium.local`).

## New API (extends the M0 contract; types go in `shared/src/api.ts`)

| Method & path | Request | Response |
|---|---|---|
| `GET /api/library` | — | `SourceSummary[]` |
| `GET /api/library/:id` | — | `{ source: SourceSummary, body: string, parsedFiles: string[] }` |
| `POST /api/library` | JSON `{ url, set? }` or multipart `file` (+ `set`) ≤ 100 MB | `202 { jobId }` or `200 { sourceId, deduped: true }` |
| `GET /api/jobs?set=` | — | `JobView[]` newest first (running + last 50) |
| `POST /api/jobs` | `{ kind: "draft-chapter", set, title, brief?, sources?: string[] }` or `{ proposalId }` | `202 { jobId }` |
| `POST /api/jobs/:id/cancel` | — | `204` |
| `GET /api/sets/:set/inbox` | — | `InboxItem[]` (notes with status draft/checked + their check report) |
| `POST /api/sets/:set/notes/accept` | `{ path }` | `200 { sha }` |
| `GET /api/settings` | — | `{ models: ConfigYaml["models"], available: string[] /* provider/id */, warnings: string[], services: ServiceHealth[] }` |
| `PUT /api/settings/models` | `{ roles: Record<string,string>, default: string }` | `200` (writes `_global/config.yaml`, user commit) |

`SourceSummary { id, title, authors: string[], type, url: string|null, credibility: string|null, parseTier, addedAt, sets: string[], warning: string|null }`; `JobView` = decision 5 shape; `InboxItem { path, title, status, check: { issues: {severity: "blocker"|"major"|"minor", text: string}[], summary: string } | null, updatedAt }`; `ServiceHealth { name, kind: "mcp"|"http", ok: boolean, detail: string, tools?: number }`. New StudiumEvents: `{ type: "job", job: JobView }`; new ChatStreamEvent `{ kind: "job_proposal", proposalId, jobKind, title, estimate: { tokens: number, costUsd: number | null } }`.

## Execution waves

| Wave | Task | Model | Isolation | Depends on |
|---|---|---|---|---|
| 1 | T1 MCP bridge + health | `sol` | worktree `m1-mcp` | — |
| 1 | T2 Built-in tools (wiki, web_fetch, skills) + default skills content | `glm` | worktree `m1-builtins` | — |
| 1 | T3 Job runner + jobs API + shared types | `fast` | worktree `m1-jobs` | — |
| 1 | T4 Ingest extractors (pdf, web, wiki, youtube, epub, docx, mineru, firecrawl) | `fast` | worktree `m1-extract` | — |
| 2 | T5 Role system (refactor Tutor onto it) + git authors | `sol` | worktree `m1-roles` | T1, T2 |
| 2 | T6 Library writer (ids, dedupe, split, source.md) + library API + `_inbox` watcher | `fast` | worktree `m1-library` | T3, T4 |
| 3 | T7 Librarian + ingest job + Tutor `add_source` | `glm` | worktree `m1-librarian` | T5, T6 |
| 3 | T8 Drafter → Checker job, inbox/accept API, Tutor `start_job` proposals | `sol` | worktree `m1-draft` | T5, T3 |
| 3 | T9a Web: Library page + Add-source sheet | Sonnet | worktree `m1-web-library` | T6 |
| 4 | T9b Web: Jobs panel + Inbox (chapter review) + chat job-proposal card | Sonnet | worktree `m1-web-inbox` | T8 |
| 4 | T9c Web: Settings (models per role, service health) | Sonnet | worktree `m1-web-settings` | T5, T1 |
| 5 | Audit (read-only) of mcp/, ingest/, jobs/, agent/ | `glm` | main | all merged |
| 5 | T10 E2E API verification | `luna` | worktree | all merged |
| 5 | T11 Browser click-through at 390px and 1440px (orchestrator) | Claude | main | all merged |

One GLM run at a time: T2 runs in wave 1; T7 and the audit wait for a free GLM slot.

---

### T1: MCP bridge + health (`sol`)

**Files:** create `server/src/mcp/config.ts`, `client.ts`, `bridge.ts`, `health.ts` (+ tests, incl. `server/src/mcp/fake-server.test-helper.ts` exporting an in-process fake MCP server with two tools: `echo {text}` and `fail {}`); modify `server/package.json` (add `@modelcontextprotocol/sdk`).

**Produces:**
```ts
export interface McpServerConfig { name: string; command?: string; args?: string[]; env?: Record<string,string>; url?: string; headers?: Record<string,string> }
export function loadMcpConfig(root: string, env: NodeJS.ProcessEnv): { servers: McpServerConfig[]; disabled: { name: string; reason: string }[] }; // decision 1–2 interpolation rules
export class McpManager {
  constructor(configs: McpServerConfig[]);
  start(): Promise<void>;                       // connect all; failures recorded, never thrown
  tools(servers: string[]): ToolDefinition[];   // Pi custom tools named mcp_<server>_<tool>; execute calls the MCP tool; result text joined; isError mapped; 60 s timeout; output capped at 100 KB
  health(): ServiceHealth[];
  stop(): Promise<void>;
}
```
**Decisions:** lazy reconnect on next tool call if a stdio process died (one retry). Tool input schema: pass the MCP JSON schema through as Pi `parameters` (TypeBox accepts raw JSON Schema objects via `Type.Unsafe`) — verify against Pi `ToolDefinition` typing. Stdio servers inherit `PATH` + their own `env` only (not the whole process env — no leaking provider keys to MCP servers).
**Tests:** config interpolation (missing url var disables; missing header var drops header); fake server tools exposed with prefixed names and callable; error result mapped; health reports ok/failed; stdio env does not contain `OPENAI_API_KEY` when set in process env.
**Run:** `vitest run src/mcp/`, `tsc --noEmit`, biome on `server/src/mcp`.

### T2: Built-in tools + default skills (`glm`)

**Files:** create `server/src/agent/builtins/wiki.ts`, `web-fetch.ts`, `skills.ts` (+ tests with stubbed `fetch`); create `skills/` at repo root with `note-authoring/`, `explain/`, `evolve-note/`, `draft-chapter/`, `fact-check/`, `source-summary/` each containing `SKILL.md` (Agent Skills frontmatter `name`, `description`) and optional `references/`; modify `server/src/tree/init.ts` to copy `skills/*` into `<root>/_global/skills/` for skills that don't exist there yet (never overwrite user edits), and to write the default `_global/mcp.json` (decision 2) if missing; update `examples/sample-set/_global/` with the same skills + mcp.json; add deps `@mozilla/readability`, `linkedom`, `turndown`, `@types/turndown`.
**Skill content requirements** (write real, useful procedures, 40–120 lines each, following `docs/STUDY_TREE.md` and `docs/PRINCIPLES.md`): note-authoring (MD conventions: frontmatter, `$`/`$$` math, `:::definition|theorem|example|deeper`, mermaid, citations `[^src:<id>#pN]` with footnote definitions, one concept per section, worked examples); explain (learner-level adaptation using `_global/profile.md` and PLAN level, analogies, check-for-understanding question); evolve-note (surgical edits only, never rewrite, preserve citations, append a one-line why to `log/decisions.md`); draft-chapter (outline → sections → citations from library sources only, mark uncertain claims, depth via `:::deeper`); fact-check (for each claim: find support in cited source text by quote, severity rubric blocker/major/minor, cross-check with wiki/papers, output format of `log/checks/*.md`); source-summary (summary ≤ 200 words, TOC mapping to parsed files, credibility tier A–D per `docs/INGEST.md` with a one-line reason).
**Produces:** `wikiTools(): ToolDefinition[]` (`wiki_search {query, limit?}`, `wiki_read {title}` → markdown, ≤ 60 KB), `webFetchTool(opts: { firecrawlUrl?: string; firecrawlKey?: string }): ToolDefinition` (`web_fetch {url}`; http(s) only; blocks private/loopback IPs and `*.local` hosts to prevent SSRF from prompt injection; 15 s timeout; 5 MB download cap; → markdown ≤ 200 KB), `skillTools(root: string, allowed: string[]): ToolDefinition[]` (`load_skill {name}`, `load_skill_reference {name, file}`; confined to `_global/skills/<allowed name>/`), `listSkills(root, allowed): {name, description}[]`.
**Run:** `vitest run src/agent/builtins/ src/tree/init.test.ts`, tsc, biome.

### T3: Job runner + jobs API + shared types (`fast`)

**Files:** create `server/src/jobs/runner.ts`, `log.ts`, `routes.ts` (+ tests); modify `shared/src/api.ts` (add all "New API" types and events above), `server/src/app.ts` (mount `/api/jobs`), `server/src/main.ts` (construct `JobRunner`).
**Produces:**
```ts
export type JobKind = "ingest" | "draft-chapter";
export interface JobContext { signal: AbortSignal; progress(text: string): void; addUsage(u: Partial<JobView["usage"]>): void }
export type JobHandler = (input: unknown, ctx: JobContext) => Promise<JobView["result"]>;
export class JobRunner {
  constructor(deps: { root: string; hub: EventHub; maxParallel: number });
  register(kind: JobKind, handler: JobHandler): void;
  enqueue(kind: JobKind, input: unknown, meta: { set: string | null; title: string }): JobView;
  list(set?: string): JobView[]; get(id: string): JobView | undefined; cancel(id: string): boolean;
}
export function usageFromPiMessages(messages: unknown[]): JobView["usage"]; // sums Pi assistant message usage (verify field names in pi-ai types)
```
Routes: `GET /api/jobs`, `POST /api/jobs/:id/cancel` (T8 adds `POST /api/jobs`). Log line format in `log/jobs.md`: `- 2026-09-29T10:00Z · draft-chapter · "Title" · done · 12.3k in / 2.1k out · $0.04 · commit abc1234`.
**Run:** `vitest run src/jobs/`, tsc (server + shared), biome.

### T4: Ingest extractors (`fast`)

**Files:** create `server/src/ingest/detect.ts`, `pdf.ts`, `web.ts`, `wikipedia.ts`, `youtube.ts`, `epub.ts`, `docx.ts`, `mineru.ts`, `firecrawl.ts`, `clean.ts`, `types.ts` (+ tests, fixtures generated in tests where possible); add deps `unpdf`, `mammoth`, `jszip`, `youtube-transcript-plus` (+ reuse T2's readability/linkedom/turndown — if T2 is not merged, add them too; the orchestrator resolves the lockfile).
**Produces:**
```ts
export type InputKind = "pdf" | "epub" | "docx" | "pptx" | "html" | "markdown" | "text" | "web" | "wikipedia" | "youtube" | "arxiv" | "doi" | "image" | "audio";
export function detectInput(input: { url?: string; filename?: string; mime?: string; bytes?: Uint8Array }): InputKind;
export interface Extracted { title: string | null; authors: string[]; markdown: string; pages: number | null; parseTier: "basic" | "mineru" | "firecrawl" | "transcript"; warning: string | null; url: string | null; originalExt: string | null }
export async function extract(kind: InputKind, input: { url?: string; bytes?: Uint8Array; filename?: string }, opts: { mineruUrl?: string; firecrawlUrl?: string; firecrawlKey?: string; signal?: AbortSignal }): Promise<Extracted>;
export function cleanMarkdown(md: string): string; // de-hyphenate line breaks, strip repeated headers/footers (lines repeating on ≥ 50% of pages), normalize headings, collapse blank runs; keeps <!-- p:N -->
export function pdfQuality(pages: string[]): { ok: boolean; reason: string | null };
```
arXiv URLs/ids → PDF URL `https://arxiv.org/pdf/<id>` (the paper-search MCP is for search/metadata; ingestion downloads the PDF itself). `image`/`audio` kinds throw `UnsupportedInputError` in T4 (T7 handles vision-capable models). Network fetches use a shared `safeFetch` (same SSRF rules as T2's `web_fetch`; if T2 unmerged, implement `server/src/ingest/safe-fetch.ts` and report).
**Tests:** detection table; PDF page markers + quality (generate a tiny PDF in-test with a minimal hand-written PDF string or skip with a fixture); cleanMarkdown rules; web extraction from an HTML string; EPUB built with jszip in-test; DOCX fixture; YouTube + Wikipedia + MinerU + Firecrawl with stubbed fetch.
**Run:** `vitest run src/ingest/`, tsc, biome.

### T5: Role system + git authors (`sol`)

**Files:** create `server/src/agent/roles.ts`, `server/src/agent/run-role.ts` (+ tests); modify `server/src/agent/chat-service.ts` (Tutor uses `ROLES.tutor`: study tools + builtins + MCP tools + skills list in prompt), `server/src/agent/tools.ts` (generalize: `studyTools({ root, scope: { set: string | null; library: boolean }, write: (rootRel) => boolean, ... })` keeping the Tutor behavior identical), `server/src/agent/prompt.ts` (skills section), `server/src/tree/git.ts` (authors `librarian`, `drafter`, `checker`), `server/src/main.ts` (construct `McpManager`, pass to ChatService/roles).
**Produces:** decision 4 table as code, and
```ts
export async function runRole(role: RoleName, opts: { root: string; set: string | null; task: string; locks: FileLocks; mcp: McpManager; runtime: ModelRuntime; hub?: EventHub; signal?: AbortSignal; onWrite?: (p: string) => void; extraTools?: ToolDefinition[] }): Promise<{ text: string; messages: unknown[]; written: string[] }>;
// one-shot, in-memory Pi session (SessionManager.inMemory), model from config.yaml role, tools per ROLES[role]
```
**Tests:** each role gets exactly its allowlisted tool names (faux model); librarian cannot write a note; checker can write `log/checks/x.md` but not `notes/x.md`; tutor behavior unchanged (existing chat tests pass).
**Run:** `vitest run src/agent/ src/tree/git.test.ts`, tsc, biome.

### T6: Library writer + API + `_inbox` watcher (`fast`)

**Files:** create `server/src/ingest/library.ts`, `ids.ts`, `split.ts`, `inbox-watcher.ts`, `server/src/routes/library.ts` (+ tests); modify `server/src/app.ts` (mount), `server/src/main.ts` (start inbox watcher), `server/src/watcher.ts` (ignore `library/_inbox/` partial files: only act on `add` after `awaitWriteFinish`).
**Produces:** `writeSource(root, extracted, original?: { bytes, ext }): Promise<{ id: string; deduped: boolean }>` (decision 8–9; writes `source.md` frontmatter per `docs/STUDY_TREE.md` with `summary: pending`, `parsed.md` or `parsed/*`, `original.<ext>`; commit author `librarian` for only those paths), `findDuplicate(root, key)`, `listSources(root)`, `readSource(root, id)`. Library routes per API table; `POST /api/library` validates, enqueues an `ingest` job via `JobRunner` (the ingest handler itself is registered by T7 — until then the route enqueues and T6's tests register a stub handler). Multipart via Hono `c.req.parseBody()` with a 100 MB limit.
**Run:** `vitest run src/ingest/library.test.ts src/ingest/split.test.ts src/routes/library.test.ts src/ingest/inbox-watcher.test.ts`, tsc, biome.

### T7: Librarian + ingest job + Tutor `add_source` (`glm`)

**Files:** create `server/src/jobs/ingest-job.ts` (+ test), `server/src/agent/builtins/add-source.ts`; modify `server/src/main.ts` (register handler), `server/src/agent/roles.ts` (tutor gets `add_source`).
**Behavior:** ingest job = detect → dedupe → extract (progress messages per step) → `writeSource` → `runRole("librarian", …)` with skill `source-summary` to fill `source.md` body (summary, TOC, credibility + reason) → commit (author librarian) → result `{ sourceId, commitSha }`. If `set` given: add id to that set's `PLAN.md` `sources` (author `user`, message `user: link <id>`). Images/audio: if the librarian model's `input` includes `image`, pass the image to the Librarian to transcribe to markdown; audio → unsupported warning (D17). `add_source {url}` Tutor tool enqueues the ingest job directly (ingest is cheap; no confirm) and returns the job id.
**Run:** `vitest run src/jobs/ingest-job.test.ts src/agent/`, tsc, biome.

### T8: Drafter → Checker job + inbox/accept API + `start_job` proposals (`sol`)

**Files:** create `server/src/jobs/draft-job.ts`, `server/src/jobs/proposals.ts`, `server/src/routes/inbox.ts` (+ tests); modify `server/src/jobs/routes.ts` (`POST /api/jobs`), `server/src/agent/roles.ts` (tutor gets `start_job`), `server/src/agent/chat-service.ts` (publish `job_proposal` stream events), `server/src/app.ts`.
**Behavior:** decisions 6, 7, 11. Drafter task text includes title, brief, the set's PLAN/curriculum, and the source ids (default: PLAN `sources`); must load skills `draft-chapter` + `note-authoring`. Checker loads `fact-check`, reads the note + cited parsed sources, writes `log/checks/<note>.md`; blockers → one revise round (Drafter gets the check file) → re-check; result note status `checked` or stays `draft`. Proposals stored in memory for 30 min. Accept route: set frontmatter `status: accepted` via a user-authored exact edit + `commitPaths` author `user`.
**Run:** `vitest run src/jobs/ src/routes/inbox.test.ts src/agent/`, tsc, biome.

### T9a / T9b / T9c: Web (Sonnet, narrow scope each)

All: mobile-first (full-screen sheet pattern from `MobileChatDock`), `useStudiumEvents` for live `job` events, types from `@studium/shared`, sidebar placeholders become real links.
- **T9a Library:** `/library` page (list with tier badge, parse tier, warning, linked sets; search box), `/library/:id` detail (rendered `source.md` via `MarkdownView`, list of parsed files → viewer), "Add source" sheet (URL field + file picker/drag-drop, optional "link to current set", shows the ingest job's live progress and the result link).
- **T9b Jobs + Inbox + proposal card:** Jobs panel (sidebar link → page on mobile, popover/panel on desktop: running with progress text, recent with status, tokens, cost, cancel); `/s/:set/inbox` (draft/checked chapters: open note, check report with severities, Accept button → commit toast; "New chapter" form: title + brief + source multi-select → `POST /api/jobs`); chat `job_proposal` card (title, estimate "≈12k tokens · subscription"/"$0.04", Run / Dismiss).
- **T9c Settings:** `/settings` (models per role from `GET /api/settings` with dropdown of `available`, warning banner when drafter == checker model, Save → `PUT`; services list with health dots and tool counts).
Each: tests for pure logic only (formatters, reducers), `tsc`, biome via `rtk proxy`, `vite build`.

### Audit + T10 + T11

- Audit (`glm`, read-only): SSRF in `web_fetch`/ingest, MCP env leakage, role write enforcement, prompt-injection blast radius from ingested text, job cancellation, multipart limits, path handling in library/inbox. Report to scratchpad.
- T10 (`luna`, temp study root, faux model + fake MCP where needed): add a Wikipedia URL and a local PDF → sources with summaries; draft a chapter → check file + status; accept → commit; jobs log line; settings round trip.
- T11 (orchestrator): headless-Chrome click-through at 390px and 1440px of every new screen and the chat proposal card, with a real model on one short chapter. Report with screenshots. **M1 is not done until T11 passes.**
