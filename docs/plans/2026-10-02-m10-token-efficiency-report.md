# M10 — Token efficiency implementation report

## Scope and execution

Parts 1–3 / C1–C4, local `codex/m10`. No delegation, commits, pushes, env edits, real-data writes, dependencies or production restarts. Install succeeded. Implementation checkpoints live in this report.

## Part 1 — audit and savings (complete)

The audit replays the 17 recorded Jev review batches (13 checker chapters / 4 critic files) on temp copies, plus one chapter-outline and one synthetic long tutor conversation. Controlled one-call reviews isolate prompt input costs; they are **not** full production jobs or proof of quality equivalence. Character/4 estimates include stable instructions, skill listings, schemas, set context, sources, history, task. Live hooks record every provider request and its reported usage.

| Role | Before estimated input | After estimated input | Reduction |
|---|---:|---:|---:|
| checker | 456,505 | 125,237 | 72.6% |
| critic | 6,601 | 6,601 | 0.0% |
| drafter | 31,534 | 17,368 | 44.9% |
| tutor | 203,936 | 66,321 | 67.5% |

These are offline prompt-input estimates. Real replay is complete; ceilings were $1.75 for the corpus and $0.20 for the separate tutor replay (combined $1.95). Before/after raw rows checkpoint to `2026-10-02-m10-token-efficiency-audit.json`.

Implemented: citation/page/section/time evidence packs with ±1 neighbours and unresolved-location warnings; FTS5 BM25 ranked drafter passages capped at 12k estimated tokens; per-call audit hooks + summary script; long cache retention through Pi; old tutor projection excerpts while keeping four recent turns and full persisted history. Checker/critic calls and tool permissions are preserved.

Skipped with evidence: skill bodies are already lazy (`server/src/agent/builtins/skills.ts:119`); always-present checker skill listing is 754/456,505 estimated tokens (0.17%). Critic already batches assigned IDs per file (`server/src/jobs/cards-job.ts:329`); no per-card production call exists. Prompt prefix is already instructions → skill listing → profile/set context (`server/src/agent/prompt.ts:126`); no speculative provider-specific cache payloads added, Pi exposes `cacheRetention` in `pi-ai/dist/types.d.ts:142`.

Focused tests: `pnpm --filter @studium/server exec vitest run src/agent/efficiency.test.ts` — 5 passed, 0 failed. Server typecheck passed. Touched-module checks passed.

### Preserved historical baseline (17 production review jobs)

All historical review calls used `zai/glm-5.3-flash`, configured as subscription: additional actual charge $0; catalog prices below are estimates. These full-job measurements predate M10 and must not be compared directly with the controlled one-call replay.

| Role / provider-model | Fresh input | Output | Cache read | Cache write | Catalog estimate USD |
|---|---:|---:|---:|---:|---:|
| checker / zai/glm-5.3-flash | 626,559 | 35,661 | 2,331,136 | 0 | 0.18174843 |
| critic / zai/glm-5.3-flash | 57,596 | 5,796 | 162,368 | 0 | 0.01640844 |

Part 1 additional validation: `pnpm --filter @studium/server exec vitest run src/agent/efficiency.test.ts src/agent/roles.test.ts src/agent/chat-service.test.ts src/jobs/draft-job.test.ts` — 54 passed / 0 failed (before adding the two confinement/history safety tests); updated efficiency file — 7 passed / 0 failed; updated role allowlist/audit file — 17 passed / 0 failed. `pnpm --filter @studium/server exec tsc --noEmit` passed after billing-aware telemetry.

Passage-index adaptation: existing workspace FTS combines all parsed text into one source row (`server/src/search/index.ts:154`), losing section offsets. A transient FTS5 passage index uses the same tokenizer/plaintext pipeline; public search results stay unchanged. Unanchored/missing locations are explicitly reported and require further `study_read`; resolved cited spans/neighbours are retained without truncation.

### Part 1 completion checkpoint — before Part 2 implementation

All 17 recorded review groups replayed before/after, plus a drafter outline and corrected tutor replay: **38 successful measured calls** (26 checker / 8 critic / 2 drafter / 2 tutor). The models actually used are recorded below. Both providers are configured subscriptions: **additional actual charge $0**; catalog rates are estimates, not invoices.

| Role / provider-model | Phase | Fresh input | Output | Cache read | Cache write |
|---|---|---:|---:|---:|---:|
| checker / zai/glm-5.3-flash | before | 544,243 | 10,430 | 14,912 | 0 |
| checker / zai/glm-5.3-flash | after | 112,353 | 10,293 | 21,248 | 0 |
| critic / zai/glm-5.3-flash | before | 6,757 | 2,324 | 768 | 0 |
| critic / zai/glm-5.3-flash | after | 5,605 | 2,388 | 1,920 | 0 |
| drafter / zai/glm-5.3-flash | before | 36,177 | 865 | 128 | 0 |
| drafter / zai/glm-5.3-flash | after | 17,661 | 567 | 320 | 0 |
| tutor / github-copilot/gpt-6-luna | before | 3 | 266 | 0 | 22,262 |
| tutor / github-copilot/gpt-6-luna | after | 3 | 264 | 1,059 | 10,175 |

Catalog spend estimate: **$0.12736259**; actual subscription charge: **$0**. No unresolved reservations. Classifier smoke remains for Part 2 (free catalog model).

- checker / zai/glm-5.3-flash: fresh input 544,243 → 112,353 (79.4% lower).
- critic / zai/glm-5.3-flash: fresh input 6,757 → 5,605 (17.0% lower).
- drafter / zai/glm-5.3-flash: fresh input 36,177 → 17,661 (51.2% lower).
- tutor / github-copilot/gpt-6-luna: fresh input 3 → 3 (0.0% lower).

Cache interpretation: critic prompts are unchanged, so its fresh-input difference is incidental cache variation, **not a batching win**. The tutor provider reports nearly all uncached input as cache writes (22,262 → 10,175), with fresh input unchanged at 3 → 3; do not call that a fresh-input saving. Sources dominate checker inputs (438,673/456,505 estimated prompt-input tokens, 96.1%). Corrected ordinary tutor estimated input is 23,962 → 12,073. Cache-hit changes do not isolate retention-specific savings.

Deviations: controlled single-call reviews rather than mutating full jobs; review and outline comparisons use the configured checker model, not the drafter production model; tutor rows used github-copilot/gpt-6-luna as recorded. Outputs capped at 1,024 (some stop at length); no quality-equivalence claim. No recorded live-chat workload, so tutor history is synthetic. Four initial tutor attempts failed locally with zero usage because the hand-built assistant messages omitted mandatory Pi usage metadata (`pi-ai/dist/utils/estimate.js:66`); offline reproduction confirmed it, valid metadata fixed it, and the two corrected real calls passed. Stress-replay failures remain in the corpus artifact; corrected tutor rows are in the separate artifact.

Exact audit commands:
- `pnpm --filter @studium/server exec tsx scripts/token-audit-workload.ts --output /tmp/m10-dry-audit.json` — 38 offline snapshots, no requests.
- `pnpm --filter @studium/server exec tsx --env-file=/home/krishna/learny/.env scripts/token-audit-workload.ts --real --output ../docs/plans/2026-10-02-m10-token-efficiency-audit.json` — 36 measured calls, 2 local tutor failures.
- `pnpm --filter @studium/server exec tsx --env-file=/home/krishna/learny/.env scripts/token-audit-workload.ts --real --tutor-only --budget 0.20 --output ../docs/plans/2026-10-02-m10-token-efficiency-tutor-audit.json` — initial 2 local failures; corrected rerun 2 successful calls, 0 failures.

## Part 2 — classifier layer (complete)

Implemented C1–C4 with nullable/absent model = off, env-only OpenCode key, classifier catalog lookup, enforced 2-second deadline, silent fallback, validated typed answers, per-question confidence, hashed/200-character decision logs, outcome rows, and immediate job token/cost accounting (including unsuccessful returned classifier usage). Seven question modules own their prompts/defaults. Per-decision settings are typed; shadow logs but returns existing behavior.

- `tutor.intent`: quick turns trim set context and hide research tools; `enable_research` restores tools/full context within the same turn. Retrieval/escalation instructions are provider projection only, not persisted learner messages.
- `context.relevance`: batched bounded previews; original LLM passages retained; top-K confidence selection never removes cited evidence, and empty results preserve fallback evidence. Tutor off/shadow/failure leaves on-demand context behavior.
- `check.depth`: section hints choose evidence depth; cited sections force full depth; a checker still reads/checks every chapter/section.
- `cards.prescreen`: reject/revise/ok + unsupported/duplicate reasons; applied mode orders critic IDs and adds hints; every assigned ID still requires `review_card`; actual critic outcomes logged.
- `visual.router`: fills the M9 interface via a factory; applied hints only. Existing `nullRouter`/legacy `visuals.router: off` stays compatible; classifier C3 mode governs the new caller.
- `grade.triage`: free-text score hint only, never replaces LLM assessment; grade outcomes logged (0/partial/1 → 0/1/2). There is one answer per job, so no within-job ordering to alter.
- `ingest.kind`: kind/language/short-vs-full summary hints; deterministic extraction/type/security stays authoritative and librarian always runs; detected source kind logged as a partial outcome.

`classifier-report.ts` joins later outcomes, reports agreement/calibration only for actual classifier proposals, separates model usage, and leaves unknown outcomes unpaired. Checker claims/intent/relevance/visual choices lack independent labels, so no fabricated agreement is logged. Reporting tools work without keys/model calls.

Validation: initial classifier module — 33 passed / 0 failed; scoped `pnpm --filter @studium/server exec vitest run src/agent/ src/jobs/ src/search/index.test.ts` — 245 passed / 0 failed; strengthened safety run `pnpm --filter @studium/server exec vitest run src/agent/classifier.test.ts src/agent/chat-service.test.ts src/jobs/draft-job.test.ts src/jobs/cards-job.test.ts` — 71 passed / 0 failed. Narrow latest compaction/escalation/calibration checks recorded below. Server typecheck passed.

Real smoke: `pnpm --filter @studium/server exec tsx --env-file=/home/krishna/learny/.env scripts/classifier-smoke.ts` — **1 passed / 0 failed**, opencode/jev-1.13-free, accepted quick answer at confidence 0.99, 1,425 ms; **fresh input 397 / output 68 / cache read 0 / cache write 0**; catalog and actual cost $0. Task catalog estimate remains $0.12736259 / actual charge $0. No additional paid runs planned.

Deviations: catalog context size is conservatively bounded in bytes, so oversized state falls back rather than truncating important evidence; ordinary summaries are deterministic excerpts instead of another LLM call; no model tier switch is needed for depth hints; unknown labels stay unpaired. Classifier defaults to absent/off until explicitly configured; per-decision defaults take effect once enabled.


## Part 3 — docs and settings (complete)

D33 records C1–C4/defaults/safety/accounting; AGENT_ROLES describes consultations and YAML; DEPLOY explains env auth, privacy, passive status and report commands; `.env.example` has only an optional-key comment. Models has a read-only status/model/decision-mode/threshold row, semantic badges and wrapping text, without key entry. Saving role models preserves classifier and other existing model config fields. Settings status makes no probe/model call.

Part 3 checks: settings route file 4 passed / 0 failed; ModelsSection 2 passed / 0 failed; shared frontmatter/config 5 passed / 0 failed. API/schema changes are compatible with old config and old SettingsView consumers. UI matched existing styling; no browser screenshot QA was performed.

## Final verification

- `pnpm install --frozen-lockfile --prefer-offline` — passed; no dependency/lockfile changes.
- `pnpm --filter @studium/server exec vitest run src/agent/ src/jobs/ src/search/index.test.ts src/routes/settings.test.ts` — **251 passed / 0 failed, 29 files**. This is the requested scoped run, not the full suite.
- `pnpm --filter @studium/web exec vitest run src/components/Settings/ModelsSection.test.tsx` — **2 passed / 0 failed**.
- `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts` — **5 passed / 0 failed**.
- `pnpm --filter @studium/server exec tsc --noEmit` — final pass. Initial final run found `settings.test.ts:179` accessing an unknown Hono JSON result; added the SettingsView annotation, then reran this command successfully.
- `pnpm --filter @studium/web exec tsc --noEmit` — passed.
- `pnpm --filter @studium/shared exec tsc --noEmit` — passed.
- `pnpm --filter @studium/web build` — passed; existing large-chunk warning remains; no dependency or bundle refactor.
- `pnpm --filter @studium/server exec vitest run src/routes/settings.test.ts -t "shows classifier status"` — **1 passed / 0 failed / 3 skipped** after the annotation fix.
- `pnpm --filter @studium/server exec vitest run src/agent/chat-service.test.ts -t "a quick turn"` — **1 passed / 0 failed / 14 skipped**, including tool and full-context escalation without persisted routing instructions.
- `pnpm --filter @studium/server exec vitest run src/agent/classifier.test.ts -t "calibration joins"` — **1 passed / 0 failed / 33 skipped**.
- `pnpm --filter @studium/server exec tsx scripts/classifier-report.ts` — passed, empty local deployment roster, no keys/network.
- `pnpm --filter @studium/server exec tsx scripts/prompt-audit.ts /tmp/m10-prompt-report-fixture.jsonl` — passed on the captured audit rows converted to JSONL, model/billing buckets separated.
- `pnpm --filter @studium/server exec tsx scripts/classifier-report.ts /tmp/m10-classifier-report-fixture.jsonl` — passed on the smoke row converted to JSONL; 1 applied / 0 independent labels / null agreement (no invented calibration).
- Biome exact final scoped command below — **44 files checked, 0 errors/warnings**; the one subsequently edited test file was checked again with the required rtk proxy.
- `git diff --check` — passed.

```sh
rtk proxy pnpm exec biome check server/src/agent/{cache-log,history,prompt-audit,efficiency.test,classifier,classifier.test,classifier-workspace,classifier-report,context-selection,chat-service,chat-service.test,roles.test,run-role,practice-grader,visual-router}.ts server/src/agent/decisions/*.ts server/src/search/passages.ts server/src/jobs/{draft-job,draft-job.test,cards-job,cards-job.test,ingest-job}.ts server/src/routes/{settings,settings.test}.ts server/scripts/*.ts shared/src/{api,schemas,frontmatter.test}.ts web/src/components/Settings/{ModelsSection,ModelsSection.test}.tsx docs/plans/2026-10-02-m10*.json
```

## Changed files (one line per file)

- `.env.example` — Part 3: optional OpenCode key comment only.
- `docs/AGENT_ROLES.md` — Part 3: role consultations, YAML, passage/history behavior.
- `docs/DEPLOY.md` — Part 3: env key, passive status, privacy, telemetry commands.
- `docs/decisions/LOG.md` — Part 3: D33 with C1–C4 and decision defaults.
- `docs/plans/2026-10-02-m10-classifier-smoke.json` — Part 2: one genuine Jev smoke response, latency and usage.
- `docs/plans/2026-10-02-m10-token-efficiency-audit.json` — Part 1: checkpointed complete controlled corpus comparisons.
- `docs/plans/2026-10-02-m10-token-efficiency-report.md` — Parts 1–3: durable measurements, progress, tests, deviations and memory log.
- `docs/plans/2026-10-02-m10-token-efficiency-tutor-audit.json` — Part 1: corrected ordinary tutor before/after replay.
- `server/scripts/classifier-report.ts` — Part 2: workspace log discovery and agreement/calibration CLI.
- `server/scripts/classifier-smoke.ts` — Part 2: temp-only one-call classifier smoke; no credential output.
- `server/scripts/prompt-audit.ts` — Part 1: bucket/cache/usage summaries per role/provider/model and billing.
- `server/scripts/token-audit-workload.ts` — Part 1: temp-tree before/after replay with reservations and checkpoints.
- `server/src/agent/cache-log.ts` — Part 1: private, symlink-rejecting, non-blocking cache telemetry.
- `server/src/agent/chat-service.test.ts` — Part 2: same-turn research/full-context escalation and unchanged learner transcript.
- `server/src/agent/chat-service.ts` — Parts 1–2: per-call audit, history projection, intent/relevance and escalation.
- `server/src/agent/classifier-report.ts` — Part 2: known-outcome joining, confidence bins and separate usage buckets.
- `server/src/agent/classifier-workspace.ts` — Part 2: workspace config loader and job accounting bindings.
- `server/src/agent/classifier.test.ts` — Part 2: all seven modes/threshold/error paths, timeout, citations and calibration.
- `server/src/agent/classifier.ts` — Part 2: C1–C3 typed service, auth/catalog, deadlines, validation, logs and usage.
- `server/src/agent/context-selection.ts` — Part 2: confidence selection, protected citations and safe fallback.
- `server/src/agent/decisions/cards.prescreen.ts` — Part 2: cards.prescreen questions, typed answers and C3 defaults.
- `server/src/agent/decisions/check.depth.ts` — Part 2: check.depth questions, typed answers and C3 defaults.
- `server/src/agent/decisions/context.relevance.ts` — Part 2: context.relevance questions, typed answers and C3 defaults.
- `server/src/agent/decisions/grade.triage.ts` — Part 2: grade.triage questions, typed answers and C3 defaults.
- `server/src/agent/decisions/index.ts` — Part 2: typed decision registry.
- `server/src/agent/decisions/ingest.kind.ts` — Part 2: ingest.kind questions, typed answers and C3 defaults.
- `server/src/agent/decisions/tutor.intent.ts` — Part 2: tutor.intent questions, typed answers and C3 defaults.
- `server/src/agent/decisions/types.ts` — Part 2: shared question/answer decoder helpers.
- `server/src/agent/decisions/visual.router.ts` — Part 2: visual.router questions, typed answers and C3 defaults.
- `server/src/agent/efficiency.test.ts` — Part 1: passage bounds/anchors, history, prompt buckets and path confinement.
- `server/src/agent/history.ts` — Part 1: escaped old-turn excerpts with recent turns and tool pairs retained.
- `server/src/agent/practice-grader.ts` — Part 2: free-text triage hint, mandatory grader and later outcome.
- `server/src/agent/prompt-audit.ts` — Part 1: every provider request/result observed without content logging.
- `server/src/agent/roles.test.ts` — Part 1: assert live audit hooks alongside role allowlists.
- `server/src/agent/run-role.ts` — Part 1: per-session provider-request audit and billing-aware long retention.
- `server/src/agent/visual-router.ts` — Part 2: classifier factory fills the M9 slot; legacy null router retained.
- `server/src/jobs/cards-job.test.ts` — Part 2: prove confident clean screening still invokes critic and preserves approval.
- `server/src/jobs/cards-job.ts` — Part 2: prescreen order/hints and outcome logging; mandatory critic unchanged.
- `server/src/jobs/draft-job.test.ts` — Part 2: prove confident light hint still invokes checker with cited evidence.
- `server/src/jobs/draft-job.ts` — Parts 1–2: ranked draft/cited checker evidence, depth/relevance/visual hints.
- `server/src/jobs/ingest-job.ts` — Part 2: summary variant hints, authoritative parser and mandatory librarian.
- `server/src/routes/settings.test.ts` — Part 3: status, defaults, missing key, preservation and secret exclusion.
- `server/src/routes/settings.ts` — Part 3: passive classifier status; preserve classifier when saving role models.
- `server/src/search/passages.ts` — Part 1: anchor-aware evidence, neighbours, FTS5 ranking and bounded rendering.
- `shared/src/api.ts` — Part 3: optional classifier status view for backward compatibility.
- `shared/src/frontmatter.test.ts` — Parts 2–3: config null/off compatibility and settings validation.
- `shared/src/schemas.ts` — Part 2: classifier model and per-decision mode/threshold schema.
- `web/src/components/Settings/ModelsSection.test.tsx` — Part 3: working/off display, read-only modes and no key input.
- `web/src/components/Settings/ModelsSection.tsx` — Part 3: read-only classifier model/status/decision rows.

## Not done / open questions / deviations

- No production enablement, restarts, paid setup smoke tests, commits/pushes/branch changes, real-data writes, AGENT_MEMORY edits, `.env` edits or `.claude` access. Only `.env.example` was edited as authorized; credentials were loaded only in the isolated audit/smoke processes.
- Owner's independently added reporting rule in `2026-10-02-m10-token-efficiency.md` is preserved; it was not edited by the implementer.
- Replay isolates prompt-input effects; it is not a blind quality holdout or measured end-to-end production saving. Tutor conversation was synthetic; source packs can still need further reads. Cache retention cannot be isolated from cache warmth by this replay. Critic already batches and skills were already lazy, so no speculative refactor there.
- Independent intent/relevance/claims/visual labels remain unavailable. Card agreement is per decision batch; ingest agreement compares only deterministic detected kind (not language/depth or independently adjudicated source kind). Gather shadow outcomes before enabling those hints broadly.
- Conservative classifier byte bound at `server/src/agent/classifier.ts:128` may fall back on large batches instead of using the model's full token window. Logs make these skips visible; no evidence is truncated solely to force an API call.
- Last four tutor turns remain verbatim even when they exceed the 8k target budget; this is deliberate recent-context preservation (`server/src/agent/history.ts:6`). Older compaction uses bounded excerpts, not an additional model.
- No browser screenshot QA or phone check; read-only row behavior is covered by component tests and the web build. Existing large bundle warnings remain outside this task.
- Final actual additional charge **$0**; catalog estimate **$0.12736259**, below $2. Classifier smoke cost **$0**. No further real calls.

## Five-line memory log (orchestrator to append)

```text
2026-10-02 · M10 Parts 1–3 · local codex/m10; no commit/push/deploy.
Added passage/history/prompt audits; typed classifier, seven decisions, usage/log/report plumbing and Models status.
Cited evidence protected; Checker/Critic/Grader remain mandatory; classifier opt-in via model + OPENCODE_API_KEY.
251 server + 5 shared + 2 web scoped tests; three typechecks, web build and Biome pass; actual $0, catalog ~$0.12736.
Open: controlled/synthetic replay is not a quality holdout; independent shadow calibration labels and phone UI QA remain.
```
