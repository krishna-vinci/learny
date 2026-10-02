# Jev Classifier Spike — Measure Token Savings Before We Commit

**Status:** Proposal (test-first). Do NOT implement in production paths yet.
**Theme:** Less tokens, still more intelligent, proper management.
**Owner:** Agent to execute Phase 0–2, then report; implementation (Phase 3) is gated on the report.

---

## 1. Why

LearnY's recurring token spend is dominated by verification-shaped work that a
*chat* model currently performs one LLM turn at a time: the **critic** reading
every card, the **checker** reading every draft section, the **grader** reading
every practice answer. Most of these verdicts are routine, low-ambiguity
decisions that only need a typed label — not prose.

Jev (TypeSafe "System One" classifier, served by OpenCode Zen) answers typed
questions (choice / score / bool) with calibrated probabilities at
70–500 ms and ~$0.042/MTok input (output free; the `-free` tier is $0 input).
It cannot generate text, so it can only *filter, route, score, and gate* —
which is exactly the shape of our verification stages.

Hypothesis: a Jev pre-filter on critic/checker/grader inputs removes 70–90%
of those verification tokens with negligible quality loss (measured, not assumed).

## 2. Environment facts (verified against Pi 1.0.0)

- Pi packages are pinned at **0.87.1**. Pi **1.0.0** is a drop-in upgrade:
  the exported API surface of `@earendil-works/pi-coding-agent` and
  `@earendil-works/pi-ai` contains **zero removals** between the two
  (verified by diffing the npm tarballs' `dist/index.d.ts`). Classifiers only
  exist from v0.99+, so the upgrade is a hard prerequisite.
- Jev on opencode is exposed by Pi as provider **`opencode`** (this is
  **OpenCode Zen**, `baseUrl https://opencode.ai/zen/v1`, auth env
  `OPENCODE_API_KEY`, System One protocol at `/zen/v1/systemone`):
  - `opencode/jev-1.13` — $0.042/MTok input, 32k context
  - `opencode/jev-1.13-free` — $0 input, 32k context ← use this for the spike
  - **Not** the `opencode-go` provider — that is a separate Pi provider
    ("OpenCode Go") with chat models only and no classifier support.
- SDK access path (headless, no codemode needed):
  `ModelRuntime.getModelsOfType("classifier", "opencode")` →
  `ClassifierModel<ClassifierApi>` →
  `ModelRuntime.classify(model, { state, questions })` →
  `ClassifierResult` with per-question answers + probabilities + confidence.
  Existing wiring: `server/src/agent/models.ts` already owns the `ModelRuntime`
  (`ModelRuntime.create({ authPath, modelsPath })`), so no new config surface
  is needed beyond the env var.

## 3. Phase 0 — Upgrade Pi to 1.0.0

1. In `server/package.json` bump `@earendil-works/pi-ai` and
   `@earendil-works/pi-coding-agent` from `0.87.1` to exact `1.0.0`
   (repo policy: exact pins).
2. `pnpm install`, then the repo gates: `npm run check` and `./test.sh`.
3. Fix anything that surfaces (none expected; note anything found in the report).
4. Do this in a worktree (`../learny-worktrees`), not on main.

## 4. Phase 1 — Benchmark harness (no production changes)

Build a standalone spike script (e.g. `server/src/spikes/jev-spike.ts`,
runnable via `pnpm --filter server exec tsx src/spikes/jev-spike.ts`).

Inputs: real data from existing study trees — a sample of ≥100 real cards from
`_cards/` (with their critic verdicts if available) and ≥20 draft sections.
Respect `_global/config.yaml` role model config; the spike uses the same
`createModelRuntime()`.

For each item, run BOTH:

1. **Baseline (current behavior):** the existing critic/checker LLM pass via
   `run-role.ts` paths (cards-job / draft-job logic), recording tokens and cost
   via the existing `usageFromPiMessages` helper from `jobs/runner.ts`.
2. **Jev pre-filter:** `runtime.classify()` per item with these question shapes:
   - Cards (critic pre-filter): `bool` — "Is this card a well-formed question
     with an unambiguous answer from the context?"; `bool` — "Does it duplicate
     a concept already in this batch?" (batch ids in `state`); `choice` —
     severity `{reject, revise, ok}`. Escalate to the LLM pass only when
     confidence < 0.85 or verdict ≠ ok.
   - Draft sections (checker pre-filter): `bool` — "Does this section contain
     factual claims that need verification?" → only claim-dense sections go to
     the checker LLM.
   - Practice answers (grader pre-filter, if sample data allows): `score` 0–2 —
     "obviously wrong / ambiguous / obviously correct" → grade LLM only for
     ambiguous.

Record per item: Jev answer, probability, confidence, whether escalated,
LLM tokens saved, wall time.

## 5. Phase 2 — Report (write `docs/plans/2026-10-02-jev-classifier-spike-report.md`)

Report must include, with raw numbers:

1. **Token savings:** verification-stage tokens (baseline vs Jev+escalation),
   overall % saved per role. Note: Jev usage arrives in `ClassifierResult.usage`.
2. **Quality:** agreement rate between Jev-only verdicts and LLM verdicts on
   items where both ran; disagreement examples quoted verbatim (≥10).
3. **Calibration:** accuracy vs stated confidence (is ">0.85 → auto" actually
   safe on our data?). If not, propose the real threshold.
4. **Latency:** per-call time for `classify()` at our batch sizes.
5. **Cost:** at `jev-1.13-free` ($0) and at `jev-1.13` list price.
6. **Verdict:** proceed / proceed-with-changes / do-not-implement, with the
   recommended question sets and thresholds for Phase 3.

## 6. Phase 3 — Implementation plan (ONLY after a positive report)

Sketch (to be refined by the report):

1. Add a `classifier` capability to `agent/models.ts` (`getClassifier()` helper
   over `ModelRuntime.getModelsOfType("classifier")`), config-driven per role
   in `_global/config.yaml` (e.g. `models.classifiers.jev`), with automatic
   fall back to full-LLM verification when Jev is unavailable (429/missing key) —
   mirroring the existing role-model fallback in `run-role.ts`.
2. Wire the pre-filter into `jobs/cards-job.ts` (critic stage),
   `jobs/draft-job.ts` (checker stage), and the practice grader, behind a
   config flag (default off) so it can be enabled per deployment.
3. Extend `usageFromPiMessages` / job cost accounting to include
   `ClassifierResult.usage` so savings stay visible in job telemetry.
4. Later (separate proposal): codemode adoption, `generateImages()` for the
   asset pipeline, session trees for draft-job.

## 7. Risks / non-goals for the spike

- Jev cannot generate, so drafter/tutor/cardsmith outputs are untouched.
- TypeSafe evals are vendor-published; our own calibration data decides, not theirs.
- `jev-1.13-free` may be rate-limited; if the spike is throttled, note it and
  fall back to a smaller sample rather than synthethic data.
- No changes to production code paths in Phases 0–2 except the version bump.
