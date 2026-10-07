# M4-8 fixes report — server/shared only

Implemented against baseline `c69020a` in `/path/to/studium-worktrees/m4-8fix`.
No files under `web/` were edited or added. Shared API changes are additive and
optional at the type level; new server responses always include review counts and
parsed chapters. Existing fields and kind unions remain intact. No subagents,
commits, pushes, deployment changes, live Firecrawl calls, real LLM calls, or edits
to AGENT_MEMORY.md, `.env*`, `data/`, `.claude/`, or `reference/`.

## Findings 1–11

| Decision | Implementation | Regression coverage |
| --- | --- | --- |
| 1 — AI permission | Top-level approval gate covers absent/default and positive `draftFirst`; explicit zero remains allowed. `JobRunner.assertAiAllowed` and every enqueue use one `NON_AI_JOB_KINDS` allowlist (`compile-book`). Workspace callback reads the user from SQLite at enqueue time, rather than retaining the creation-time permission. Approval checks before writes and after async validation. Typed failures map to the existing 403 message. | Real inbox approval: disabled default/positive requests preserve proposal/PLAN, zero approves without jobs. Top-level authenticated server uses the real approval route. Runner tests cover all current AI kinds and book exemption. Workspace test changes DB permission on an existing runner. |
| 2 — Firecrawl | Scrape validates every supplied `metadata.sourceURL`, `metadata.url`, and `data.url`, including lower-priority aliases. Map rejects an otherwise eligible on-site URL failing `assertPublicUrl`; unrelated/malformed links still filter out. DEPLOY documents the required public-only fetch egress boundary and a Docker/network-namespace firewall recipe. | Fake-service tests reject metadata/loopback/private final URLs, shadowed aliases and private DNS map results. Live egress remains unverified. |
| 3 — Skill sync | Reject symlinks in every destination component, check canonical parent containment within the individual skill directory, and repeat checks for temp writes, publication and cleanup. Log and skip unsafe files; preserve ordinary edited skills and historical-default matching. | Existing external escape test now verifies skip/preservation. New internal `explain -> ../../alpha/notes` test verifies neither missing-file creation nor historical-default overwrite. Existing nested-file/preservation tests pass. |
| 4 — Passage trust | Tutor message contains an escaped `<selected_passage source="…">` data block followed by a separate learner request. Tutor system instructions identify selected passages, sources, notes and fetched pages as untrusted evidence, and require learner authorization for mutations, ingestion, new URL fetches and disclosure. Ask/Explain keep their tools. | Delimiter/provenance escaping test; real fake-provider chat message/transcript assertions; prompt-builder trust-rule assertions. No model exploit or real provider run. |
| 5 — Prerequisites | Validate `none` or comma-separated, distinct existing earlier chapter numbers before installing or enqueueing a plan. Reject malformed, unknown, forward, self and duplicate references. Update plan-set skill and default hash history. | Parser rejects invalid references; real approval with a forward reference preserves PLAN and never enqueues. |
| 6 — Today cost | Workspace-app-local snapshot cache invalidates on file/commit and actual job status changes. A shared refresh promise coalesces concurrent requests. Dirty requests inside the two-second window wait for the next refresh, rather than receiving a stale snapshot with no subsequent update. Set scans run two at a time, card/chat reads four per listing; all tree Git subprocesses share a global four-slot limiter. Correct the history complexity comment. | Eight simultaneous GETs share one scan; dirty parallel requests coalesce for two seconds; progress/usage ticks reuse the cache; file, commit and terminal status changes refresh; workspace isolation/confinement remains covered. New limiter tests verify four active operations and failure slot release. Existing card listing tests pass. Web invalidation deferred. |
| 7 — Books | Reject over 200 chapters, over 5,000,000 bytes of input note files or assembled Markdown, and over 50,000,000 PDF bytes. Check cancellation in assembly read loops. Reject before publication and clean scratch state, retaining the previous PDF. Coalesce queued/running book requests for the same set at enqueue. Document limits. | Chapter and Markdown caps, cancellation between input reads, oversized sparse PDF rejection with previous-PDF preservation and cleanup, queued/running coalescing and fresh rebuild after completion. Existing real Pandoc/Typst compilation passes. |
| 8 — Plan preview | GET plan proposal adds server-parsed `chapters` from the same fence-aware curriculum parser used for approval. Includes checked/ticked state. | Fenced Decoy is absent; six real chapters remain; checked first chapter is excluded when choosing first eligible draft. GET response includes the new fields; existing approval queue tests pass. Web preview deferred. |
| 9 — Today counts | `chaptersToReview` counts chapter/legacy items; `plansToReview` counts plan items; `inboxCount` stays their sum. Plan suggestion reads “Review your study plan”; both plan/chapter suggestions keep legacy `kind: "inbox"` and add `reviewKind`. Overdue fallback details distinguish counts. | Plan-only and mixed inbox tests verify counts, suggestions and overdue wording. Web wording deferred. |
| 10 — Search fences | Track opening marker length; closure needs matching marker character, at least that length, and no info string. | Four-backtick/triple-backtick nested example and long tilde/info-bearing closing marker regressions. |
| 11 — Passage cards | Optional `passage` (maximum 2,000 characters) flows through start_job tool validation, ProposalStore input, persisted proposal event sidecar, job input and Cardsmith's escaped data block. Tutor/tool guidance requests passage propagation; cost estimates include its length. Source note, Critic review and learner confirmation are preserved. | Fake tutor/tool test verifies proposal and disk-sidecar passage; proposal consumption preserves it; confirmed job route delivers it; oversized passage rejects; Cardsmith fake run checks escaped selection and completes the normal drafting/review flow. |

## Exact web handoff after M6 merges

These are instructions only; none of the following files were changed.

### Decision 6 — SSE invalidation

**File:** `web/src/api/queries.ts`, `useLiveStudiumUpdates` (currently near line 491).

Remove Today invalidation from the current combined file/commit/job/chat-settled
condition. Give Today its own condition: invalidate `queryKeys.today` on `commit`
and on a job's **status transition**, not file events, chat-settled events,
progress, usage, or title-only ticks. Keep other queries' existing invalidation
behavior. Track previous status by `event.job.id`, compare `event.job.status`,
and update the tracking map on each job event. Seed known job statuses from the
startup jobs snapshot when available, and bound/clear the map with hook lifetime.
An unknown new job may invalidate once. Cover queued → running → done/failed/
cancelled; repeated terminal statuses must not invalidate again. The existing
`createJobTransitionTracker` in `web/src/lib/job-transitions.ts` detects only
first done/failed completions, so it alone is insufficient for this requirement.

**API fields:** SSE `event.type`, `event.job.id`, `event.job.status`; query key
`queryKeys.today`. No new event type or server progress flag is needed.

### Decision 8 — Plan review parity

**Files:** `web/src/pages/InboxPlanReview.tsx`, `web/src/pages/plan-proposal.ts`,
and relevant `web/src/pages/plan-proposal.test.ts`/plan-review tests.

Replace `parseProposedChapters(data.curriculum)` with the proposal's `chapters`.
Keep the PLAN summary parser if useful; stop parsing curriculum Markdown for the
approval preview. Remove/update `ProposedChapter` and `parseProposedChapters`
usage in `plan-proposal.ts`, or adapt a presentation helper to accept
`PlanProposalChapter[]`. Render `number`, `title`, `scope`, `prerequisites` and
`ticked` directly. Format the numeric chapter number with `padStart(2, "0")`
only for display.

Use this exact selection for the drafting preview and request count:

```ts
const chapters = data.chapters ?? [];
const eligible = chapters.filter((chapter) => !chapter.ticked);
const maxDraft = Math.min(5, eligible.length);
const count = Math.min(draftFirst, maxDraft);
const toDraft = eligible.slice(0, count);
```

Show the titles/numbers in `toDraft` beside “Draft first N”; send that same `count`
as `draftFirst` to the approval endpoint. Remove `maxDraft || MAX_DRAFT_FIRST`
fallbacks: no eligible chapters means count zero and the increment button disabled.
Do not filter out chapters merely because a same-number note already exists:
approval currently selects **unticked chapters**, in server order. If chapters
are absent from an older response, keep approval without drafting available and
show preview unavailable; do not silently use the unsafe Markdown parser.

**API:** `GET /api/sets/:set/plan-proposals/:file` still returns `plan`, `curriculum`,
`sourcesToAdd`, and adds:

```ts
chapters: {
  number: number;
  title: string;
  scope: string;
  prerequisites: string;
  ticked: boolean;
}[]
```

Approval remains `POST …/approve` with `{ draftFirst: 0…5 }`; its response is still
`{ sha, jobIds }`. Existing `api.inbox.planProposal`/`usePlanProposal` already use
shared `PlanProposal`, so no transport rename is required. Add a fenced-Decoy and
checked-first-chapter frontend regression against the server chapter data.

### Decision 9 — Today wording and identity

**File:** `web/src/pages/TodayPage.tsx` (set summary currently near line 135), plus
any Today UI moved by M6 and its tests.

Replace `{set.inboxCount} chapters to review` with separate counts from
`set.chaptersToReview` (“chapters to review”) and `set.plansToReview` (“plans to
review”), optionally hiding zero counts. Keep `inboxCount` only for a combined
neutral “items to review” display or compatibility fallback. If the new fields
are missing, use `${set.inboxCount} items to review`; never assume every legacy
inbox item is a chapter.

Render each do-next item's server `title`, `detail` and `href`; use
`item.reviewKind === "plan"` to distinguish study-plan review from chapter
review. Both intentionally retain `kind: "inbox"` for compatibility with the
current exhaustive icon map. **Include `reviewKind` in the React list key**
(currently `${item.set}-${item.kind}-${item.href}`), because a mixed inbox now
returns two items with the same set/kind/href. For example:
`${item.set}-${item.kind}-${item.reviewKind ?? ""}-${item.href}`. Use a plan icon
if desired without changing the existing kind union.

**API fields:** `GET /api/today` → `sets[].chaptersToReview`,
`sets[].plansToReview`, legacy `sets[].inboxCount`; `doNext[].reviewKind` is
`"plan" | "chapter"` for review items. Overdue `detail` is already corrected by
server aggregation.

## Minimal integration edits

- `server/src/app.ts`: pass EventHub to Today and map typed enqueue permission failures to 403, preserving existing HTTPException/default handling.
- `server/src/routes/library.ts`: stop a pending import tail on permission revocation so a denied enqueue cannot throw out of an EventHub completion callback.
- `server/src/routes/practice.ts`: map the new enqueue error through the existing practice error handler.
- `server/src/jobs/routes.ts`: preflight plan-set permission before creating a missing set; keep enqueue's authoritative recheck.
- `shared/src/api.ts`: optional fields preserve current frontend fixtures and exhaustive kind maps; no field or enum member removed/renamed.

## Tests run

All commands ran from the worktree root. No full-repository suite was run.

```sh
pnpm install --frozen-lockfile --prefer-offline
node scripts/skill-history.mjs
pnpm --filter @studium/server exec vitest run src/server.test.ts src/routes src/jobs src/today src/tree src/agent src/search src/ingest src/inbox src/workspaces src/concurrency.test.ts --maxWorkers=2 --no-cache
pnpm --filter @studium/server exec vitest run src/cards/store.test.ts -t 'listCardFiles' --maxWorkers=2 --no-cache
pnpm --filter @studium/web exec vitest run src/pages src/api --maxWorkers=2 --no-cache
pnpm --filter @studium/server exec tsc --noEmit
pnpm --filter @studium/shared exec tsc --noEmit
pnpm --filter @studium/web exec tsc --noEmit
```

- Install/history generation: successful.
- Broad **targeted** server scope: **65 files, 466 passed, 0 failed, 0 skipped**.
- Changed card-listing module: **1 file, 3 passed, 0 failed, 8 intentionally filtered out**.
- Existing frontend tests: **6 files, 36 passed, 0 failed, 0 skipped**.
- Total final targeted coverage: **469 server + 36 web = 505 passing tests**.
- Server/shared/web type checks: **all pass**.
- Biome on every changed/new TypeScript/JSON file: **44 files pass**. Exact final command:

```sh
rtk proxy pnpm exec biome check server/src/agent/chat-service.test.ts server/src/agent/chat-service.ts server/src/agent/passage.test.ts server/src/agent/passage.ts server/src/agent/prompt.ts server/src/app.ts server/src/cards/store.ts server/src/concurrency.test.ts server/src/concurrency.ts server/src/inbox/plans.test.ts server/src/inbox/plans.ts server/src/ingest/firecrawl.test.ts server/src/ingest/firecrawl.ts server/src/jobs/book-assemble.ts server/src/jobs/book-job.test.ts server/src/jobs/book-job.ts server/src/jobs/cards-job.test.ts server/src/jobs/cards-job.ts server/src/jobs/proposals.test.ts server/src/jobs/proposals.ts server/src/jobs/routes.test.ts server/src/jobs/routes.ts server/src/jobs/runner.test.ts server/src/jobs/runner.ts server/src/routes/inbox.test.ts server/src/routes/inbox.ts server/src/routes/library.test.ts server/src/routes/library.ts server/src/routes/practice.ts server/src/routes/today.test.ts server/src/routes/today.ts server/src/search/plaintext.test.ts server/src/search/plaintext.ts server/src/server.test.ts server/src/server.ts server/src/today/build.test.ts server/src/today/build.ts server/src/tree/git.ts server/src/tree/skill-sync.test.ts server/src/tree/skill-sync.ts server/src/workspaces/manager.test.ts server/src/workspaces/manager.ts shared/src/api.ts skills/.defaults-history.json
```
- `git diff --check`: passes; tracked and untracked web diff lists are empty.

Preliminary runs (before final corrections):

```sh
pnpm --filter @studium/server exec vitest run src/server.test.ts src/routes/inbox.test.ts src/jobs/runner.test.ts src/ingest/firecrawl.test.ts src/tree/skill-sync.test.ts src/inbox/plans.test.ts src/routes/today.test.ts src/today/build.test.ts src/jobs/book-job.test.ts src/jobs/cards-job.test.ts src/jobs/proposals.test.ts src/jobs/routes.test.ts src/agent/chat-service.test.ts src/agent/passage.test.ts src/search/plaintext.test.ts --maxWorkers=2
pnpm --filter @studium/server exec vitest run src/agent/chat-service.test.ts -t 'sends a quoted passage|publishes a make-cards proposal' --maxWorkers=2 --no-cache
```

First run: **129 passed, 1 failed**. The new assertion mistakenly searched the
message-content helper for Pi system sections. Corrected to assert the
prompt-builder output. Focused rerun: **2 passed, 12 filtered out**; final broader
run passes. Initial server type check also caught an untyped `Response.json()`
test read; fixed with a `TodayView` cast. No unrelated failures remain.

## Not done / open questions

- All web edits above are deliberately deferred until M6 merges; existing web tests/type checks pass unchanged. A mixed inbox can produce duplicate React keys in the current Today UI until the documented key change is applied.
- Firecrawl's running egress policy was neither inspected nor changed. Verify it on an isolated stack before relying on public-only target access. Returned-URL validation is defense in depth, not proof that the service never fetched a private address.
- Compiler limits do not enforce memory/CPU/intermediate disk quotas. The deployment docs state this boundary; no exhaustion tests or quota changes were performed.
- Pending proposal validity still follows the existing in-memory ProposalStore lifetime. Persisting the passage in its event sidecar does not add full server-restart recovery for proposal execution.
- Today refreshes depend on the existing workspace file/commit/status event stream; calendar-dependent derivation still runs on each GET without rereading files.

## Suggested memory log (not appended)

```text
2026-10-01 · M4-8 fixes · server/shared/skills/DEPLOY changes on c69020a; no commits, no web edits.
AI approval/enqueue now read DB permission; skill sync rejects internal aliases; passage trust/card propagation fixed.
Today caches/coalesces 2 s, Git max 4; books cap 200 chapters/5 MB Markdown/50 MB PDF and coalesce builds.
API adds chapters, review counts and reviewKind; apply the three exact web handoffs after M6, including Today list keys.
505 targeted tests and all package types pass; live Firecrawl egress remains unverified; see m4-8-fixes-report.md.
```

## Changed files

- `docs/DEPLOY.md` — Firecrawl egress recipe and deterministic book limits.
- `docs/prompts/m4-8-fixes-report.md` — Per-finding evidence, file list, tests, memory log and exact deferred web handoff.
- `server/src/agent/chat-service.test.ts` — Chat passage/trust assertions and persisted card passage sidecar coverage.
- `server/src/agent/chat-service.ts` — Separate escaped passage data from the learner request.
- `server/src/agent/passage.test.ts` — Delimiter and provenance escaping regression.
- `server/src/agent/passage.ts` — Shared passage delimiter/provenance escaping.
- `server/src/agent/prompt.ts` — Tutor trust boundary and passage-card tool guidance.
- `server/src/app.ts` — Today hub wiring and typed AI error mapping.
- `server/src/cards/store.ts` — Bound card-file listing concurrency.
- `server/src/concurrency.test.ts` — Bounded work, FIFO slot release and ordered mapping coverage.
- `server/src/concurrency.ts` — FIFO resource limiter and bounded ordered mapping.
- `server/src/inbox/plans.test.ts` — Invalid prerequisite and fence-aware chapter preview regressions.
- `server/src/inbox/plans.ts` — Prerequisite validation and parsed proposal chapters.
- `server/src/ingest/firecrawl.test.ts` — Private final aliases and private-DNS map rejection regressions.
- `server/src/ingest/firecrawl.ts` — Validate all final URL aliases and reject unsafe on-site map targets.
- `server/src/jobs/book-assemble.ts` — Chapter/Markdown bounds and cancellation checks.
- `server/src/jobs/book-job.test.ts` — Book input limits, cancellation and oversized PDF preservation/cleanup regressions.
- `server/src/jobs/book-job.ts` — Forward assembly cancellation and check PDF size before publication.
- `server/src/jobs/cards-job.test.ts` — Cardsmith selected-passage prompt in the normal Critic workflow.
- `server/src/jobs/cards-job.ts` — Validate and deliver optional selected passage to Cardsmith.
- `server/src/jobs/proposals.test.ts` — Passage-bearing proposal event and consumed input assertions.
- `server/src/jobs/proposals.ts` — Passage tool schema, estimate, proposal input and persisted event validation.
- `server/src/jobs/routes.test.ts` — 403 enqueue mapping, confirmed passage flow and maximum-length rejection.
- `server/src/jobs/routes.ts` — Map enqueue denial and guard plan-set creation.
- `server/src/jobs/runner.test.ts` — AI revocation and queued/running/completed book coalescing regressions.
- `server/src/jobs/runner.ts` — DB callback authorization, typed denial and per-set book coalescing.
- `server/src/routes/inbox.test.ts` — Guard-before-write, zero-draft approval, invalid prerequisites and chapter response coverage.
- `server/src/routes/inbox.ts` — Guard approval before mutation and map AI denial.
- `server/src/routes/library.test.ts` — Revoked-permission import-tail completion regression.
- `server/src/routes/library.ts` — Stop queued site-import tail safely when authorization is revoked.
- `server/src/routes/practice.ts` — Map background-grade enqueue denial to 403.
- `server/src/routes/today.test.ts` — Cache/status/event/coalescing coverage and explicit fixture invalidation.
- `server/src/routes/today.ts` — Single-flight cached snapshots, status-only job invalidation and bounded scans.
- `server/src/search/plaintext.test.ts` — Long and nested fence regressions.
- `server/src/search/plaintext.ts` — Require matching fence length and bare closure.
- `server/src/server.test.ts` — Authenticated approval permission regression using the real route.
- `server/src/server.ts` — Gate default/positive approval drafts using the shared non-AI allowlist.
- `server/src/today/build.test.ts` — Plan-only/mixed review counts and overdue wording regressions.
- `server/src/today/build.ts` — Split review counts and distinguish study-plan suggestions/overdue details.
- `server/src/tree/git.ts` — Limit all shared Git subprocess work to four concurrent processes.
- `server/src/tree/skill-sync.test.ts` — External/internal alias skip and preservation regressions.
- `server/src/tree/skill-sync.ts` — Canonical skill-parent/temp confinement and symlink logging/skips.
- `server/src/workspaces/manager.test.ts` — Permission change on an already-open workspace runner.
- `server/src/workspaces/manager.ts` — Read current owner AI permission from SQLite at enqueue time.
- `shared/src/api.ts` — Add backward-compatible chapters, review counts/discriminator and proposal passage.
- `skills/.defaults-history.json` — Record the final plan-set skill hash.
- `skills/plan-set/SKILL.md` — State prerequisite syntax and earlier/distinct-reference rule precisely.
