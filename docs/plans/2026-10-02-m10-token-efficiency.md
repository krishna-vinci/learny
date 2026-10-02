# M10 — Token efficiency with a classifier layer (Jev)

**Goal:** stop spending LLM tokens on routine decisions and on context the model doesn't need. A fast typed classifier (Jev, "System One") makes the routine calls — routing, relevance, depth, intent — and LLMs do only the thinking. Quality must not drop: the classifier never removes a safety check on its own.

**Evidence:** `docs/plans/2026-10-02-jev-classifier-spike-report.md` (+ results JSON). 34 cards + 83 sections cost 3.2 M tokens (~27k per item): the cost is context (whole sources re-read), not verdicts. Jev agreed 94 % on "does this section need fact-checking" and 79 % on card quality; using it to *skip* the critic was unsafe and net +13 % tokens. So: Jev **routes and selects**, it doesn't **skip**.

## Fixed decisions
- **C1 Classifier capability.** `server/src/agent/classifier.ts`: `getClassifier(runtime, config)` over `runtime.getModelsOfType("classifier", …)` (Pi 1.0.0, already installed; see the spike harness on branch `codex/jev`, `server/src/spikes/jev-*.ts`, for the working API shape — `opencode/jev-1.13-free`, API `typesafe-system-one`). Config in `_global/config.yaml`: `models.classifier: opencode/jev-1.13-free` (or `null` = off) and per-decision settings `classifier.decisions.<name>: {mode: off|shadow|on, threshold}`. The key comes from `OPENCODE_API_KEY` (the server already loads `.env`). Missing key, 429, timeout (> 2 s) or error → the decision falls back to today's behaviour, silently, and is logged. A Settings → Models row shows classifier status (configured / working / off) like other models; no key entry in the UI.
- **C2 One decision API.** `decide(name, {state, questions})` → typed answer + confidence + `source: "classifier"|"fallback"`. Every call appends one line to `<workspace>/.cache/classifier-log.jsonl` (decision, inputs hashed + 200-char excerpt, answer, confidence, latency, usage, later outcome when known). Usage is added to the job's token/cost accounting (extend `usageFromPiMessages` callers / job usage with classifier usage).
- **C3 Modes.** `shadow` = run the classifier, log it, act as today (collects calibration on real use). `on` = act on it, above the threshold; below → today's behaviour. Defaults are per decision (below). A small script `pnpm --filter @studium/server exec tsx scripts/classifier-report.ts` summarises agreement/calibration per decision from the log (outcome vs answer), so thresholds get set from our data over time.
- **C4 Never a safety bypass.** The checker and critic always run on every draft/card. The classifier may change **how much** they read, **which model tier** does a light task, and **order/priority**, never whether a check happens. Any decision that would skip an LLM step must be one where a wrong answer is cheap and visible (e.g. not loading a tool set the tutor can still request).

## Part 1 — Token audit and non-classifier savings (do first; biggest wins)
1. **Measure.** Add a per-call prompt breakdown (system prompt, skills, tool schemas, set context, sources/passages, chat history, task) in tokens (estimate via characters/4 if Pi has no tokenizer), logged to `.cache/prompt-audit.jsonl` and summarised by `scripts/prompt-audit.ts`. Run it against the spike's recorded baseline workload (temp copies of the real trees; real models; spend ≤ $2) and against a tutor chat replay. Report the top cost buckets per role.
2. **Fix the top buckets** (expected; confirm with the audit, skip any that the audit shows is small):
   - **Checker reads cited passages, not whole sources:** build the checker's evidence pack from the note's `[^src:id#anchor]` citations → the matching sections/pages of `parsed*.md` (plus ±1 neighbour section), using the existing page/section anchors and `server/src/search/` index. The checker can still `study_read` more if it needs to (tools unchanged).
   - **Drafter gets ranked passages:** for each chapter, retrieve the top passages for the brief from the set's sources via the FTS index (bounded, e.g. 12k tokens), instead of telling it to read every `parsed.md`; it can still read more.
   - **Prompt caching:** keep a stable prefix (system + skills + tool schemas first, volatile task last) and enable the provider's prompt caching where Pi exposes it (check Pi 1.0.0 options via context7 / its d.ts); measure the cached-token share in the audit.
   - **Skills:** load skill bodies only when used (verify `load_skill` laziness); trim always-in-prompt text that the audit flags.
   - **Tutor history:** summarise/compact older turns beyond a budget (keep last N turns verbatim).
   - **Critic batching:** one critic call per card file/chapter, not per card, if any path is per-card.
3. Tests for each change (evidence pack contents from citations; passage retrieval bounds; prompt order stability; compaction keeps last N). Re-run the audit and report before/after tokens per role.

## Part 2 — Classifier decisions (each behind C3 modes)
| Decision | Question shape | Acts on (`on`) | Default |
|---|---|---|---|
| `tutor.intent` | choice: {quick answer, explain from note, needs research, start a job, quiz me, other} | tools/skills/context loaded for the turn (quick answer → no research tools, smaller context; can still escalate by asking) | shadow |
| `context.relevance` | bool per candidate passage/section: "relevant to <brief/question>?" (batched in `state`) | which retrieved passages go into drafter/tutor/checker context (keeps top-K by confidence; never drops cited passages for the checker) | on, threshold 0.6 |
| `check.depth` | bool: "does this section contain checkable factual claims?" (94 % agreement in the spike) | light vs full check per section (light = no source pack, quick consistency read; full = evidence pack). Every section still checked | shadow |
| `cards.prescreen` | choice {reject, revise, ok} + reasons as bool questions | critic order and a "likely issues" hint in the critic's task; the critic still reviews every card | shadow |
| `visual.router` | choice {none, widget, sketch, chart} + widget choice | fills M9's `VisualRouter` slot; hint to the drafter only | on, threshold 0.7 |
| `grade.triage` | score 0–2 {wrong, unclear, correct} for free-text practice answers | ordering + a hint; the grader still grades (no data yet) | shadow |
| `ingest.kind` | choice of source kind / language / "worth a summary" | librarian prompt variant and whether summary depth is short/full | shadow |
Each decision: question text in one module (`server/src/agent/decisions/<name>.ts`), unit tests with a stubbed classifier (on/off/shadow/fallback/threshold), and a log line. Shadow decisions do nothing user-visible.

## Part 3 — Docs and settings
- `docs/decisions/LOG.md` D33 "Classifier layer" (C1–C4, the table, the safety rule).
- `docs/AGENT_ROLES.md` (which roles consult which decision), `docs/DEPLOY.md` (`OPENCODE_API_KEY`, off when missing), `.env.example` comment line (the orchestrator edits `.env.example` only via this plan — allowed here; never `.env`).
- Settings → Models: classifier row (status, mode per decision read-only for now).

## Rules and verification
- Read `AGENTS.md`, `AGENT_MEMORY.md`, the spike report, `server/src/agent/{models,run-role,roles,prompt}.ts`, `server/src/jobs/{draft-job,cards-job,practice-job,grade-job}.ts`, `server/src/search/`.
- Tests stub every model and the classifier; the only real-model runs are the Part 1 audit (≤ $2) and one real classifier smoke call (load the key into that process only with `--env-file=/home/krishna/learny/.env`; never print it).
- Scoped tests: touched server test files + `src/agent/ src/jobs/` dirs; `tsc --noEmit` server/web/shared; web build; biome on changed files.
- Report: audit before/after per role, each decision's implementation, deviations, 5-line log entry.

## Reporting rule (added after owner feedback)
Always report tokens as **fresh input / output / cache read / cache write** separately, never a single total, and per **provider/model**. State whether a provider is subscription (actual charge $0) or metered; label catalog prices as estimates. The spike's "3.2 M tokens" was 0.68 M fresh input + 0.04 M output + 2.49 M cache reads on `zai/glm-5.3-flash` (subscription), across 17 reviews (~43k fresh tokens each). Optimise fresh input first.
