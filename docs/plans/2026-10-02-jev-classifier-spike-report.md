# Jev classifier spike — completed paired report

**2026-10-02 · `codex/jev` · Phases 0–2 complete · verdict: do-not-implement this pre-filter.**

The classifier authenticated successfully and ran on **all 34 real cards and 83 real chapter sections**, reusing every recorded baseline label and token/cost record. There were **117 successful HTTP requests, 0 failures, 0 rate limits**, and **0 extra baseline calls**. Extra actual catalog spend was **$0** with `jev-1.13-free`. The key was loaded solely into the two spike processes with Node's env-file flag; neither the file nor its contents was printed, copied, logged, stored or edited.

The proposed 0.85 gate is unsafe against the current critic baseline: **1 of 4 would-auto-accept cards disagreed with an LLM rejection**. It saves no complete card-file reviews. Sections save only the real one-line `# test` chapter. Including classifier usage, overall verification tokens **increase 13.07%**; paid-list pipeline cost **increases 8.60%**. The small sample, observed error and poor savings do not support Phase 3.

## Phase 0 and regression gates

Both Pi packages remain exactly **1.0.0**. No production compatibility fixes were required. Upstream still reparses each full streamed tool-argument prefix at `dist/utils/json-parse.js:90–95`; recreated the pnpm patch as `patches/@earendil-works__pi-ai@1.0.0.patch` and updated `pnpm-workspace.yaml`/lockfile. The old committed patch remains unreferenced.

The same **280,000-byte / 20-character / 14,000-call** benchmark took **115,075.07 ms unpatched**, versus **434.35 ms and 341.27 ms patched**, with exact final JSON values. The generated performance payload is unrelated to the real learning corpus. Initial frozen install, version-bump install, both package type gates and web build passed. Scoped server dirs produced **306 passed / 1 failed**; the unchanged `server/src/agent/roles.test.ts:284` expects `checked` while the sample note says `status: accepted` and `server/src/course/build.ts:54` preserves `accepted`. It remains an unrelated open test failure.

## Auth smoke, real API and continuation harness

The one-item smoke reviewed **`c-ccc1588a`**, returning **HTTP 200 in 1,345.49 ms** with **6,079 input + 71 output tokens**. Actual SDK result: provider **`opencode`**, model **`jev-1.13-free`**, API **`typesafe-system-one`**. Thus provider/model match the plan. The smoke result was reused in the 116-item continuation, not called a second time.

Pi's question shape at installed `@earendil-works/pi-ai/dist/types.d.ts:448–495` is a record with `instructions` and `criteria`. Choice criteria are a string-keyed map; score criteria are an ordered string array. Bool answers expose `probability`, with no vendor confidence field; Pi maps bool to wire type **`noul`**. Choice answers expose `choice`, `probabilities`, and `confidence`. `ClassifierResult.usage` is optional but was present for every real call here. Requests use the `/zen/v1/systemone` transport. No API workaround or alternate model was needed.

`server/src/spikes/jev-pair.ts` is a classifier-only continuation. Chat streaming throws if called, preventing accidental baseline re-spend. It reads saved baseline rows, reconstructs full text/context from read-only data, validates every saved 300-character prefix, and records current text/context SHA-256 hashes. **Original full-content hashes were not captured**, so equivalence beyond those prefixes is not independently provable. It checkpoints responses and omits credential-bearing provider errors. This continuation only reads study data, so it needs no write-capable tree copy; earlier role runs used temporary copies, all removed.

The corpus remains **34 cards / 4 files; 83 sections / 13 chapters; 0 recorded practice answers**. Every saved item was paired; no learning data was synthesized. The ≥100-card goal is short by **66 cards**. No practice log containing learner answers was found, so grader pairing was not available. Existing practice question files alone cannot provide grading examples.

Cards asked three questions: well-formed/supported bool, semantic duplication bool against actual same-set card content/ids, and `reject/revise/ok` choice. Sections asked one claim-presence bool with full chapter context. Card auto-bypass requires `ok`, a well-formed result, no duplicate, and minimum decision confidence ≥ threshold. Bool decision confidence is derived as `max(p,1-p)`; card confidence takes the minimum across the two bool decisions and vendor choice confidence. Reject/revise/uncertainty/error escalates. Section claim presence or uncertainty escalates. The question wording is recorded in `jev-spike-lib.ts`; it was held fixed throughout this run.

The continuation has explicit HTTP-429 backoff (5/10-second minimum waits, Retry-After handling capped at 45 seconds, up to three attempts), then stops for a smaller sample if still throttled. **This path was not exercised**: every item needed one request. Recorded latency includes transport, provider work and decoding, excluding the intentional 200 ms gap between requests.

## Token savings and billing

[Raw JSON](2026-10-02-jev-classifier-spike-results.json) contains all results, probability/confidence fields, usage, latency, corpus hashes, threshold sweeps and preserved Phase 0 evidence. Card/section excerpts remain ≤300 characters; full contents are used only in process memory for classifier context.

Production's baseline unit is an assigned card-file batch (`server/src/jobs/cards-job.ts:332`) or a whole chapter (`server/src/jobs/draft-job.ts:461`). Baseline used four critic and thirteen checker turns with configured **zai/glm-5.3-flash**, adding a spike-only section-claim label tool and suppressing chapter-status writes. MCP was disabled; built-in research tools remained available. Shared usage is recorded once on each group's leader. **Partial-batch token attribution is not measured.** The counterfactual bypasses a baseline group only when every item in it bypasses; otherwise it retains that group's entire measured role usage.

Below uses the plan's **0.85** gate. “LLM tokens saved” is a replay estimate from saved baseline usage; no production run was changed and no escalation LLM was called again. Total tokens include input, output and cache tokens for both systems.

| Role | Paired | Baseline tokens | Jev tokens | LLM tokens saved | Jev + escalation tokens | Net token savings | Label agreement | Disagreements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| critic | 34 | 225,760 | 128,814 | 0 | 354,574 | -57.06% | 79.41% | 7 |
| checker | 83 | 2,993,356 | 306,625 | 14,617 | 3,285,364 | -9.76% | 93.98% | 5 |
| Overall | 117 | 3,219,116 | 435,439 | 14,617 | 3,639,938 | -13.07% | 89.74% | 12 |

Negative savings mean **additional verification tokens**. LLM-only savings are **0.454%** overall, all from `hyderabad-history/notes/07-test.md` containing just `# test`. Excluding that real empty test note would leave zero complete-group savings. At 0.85, **30/34 cards and 82/83 sections** escalate individually; all four card files still require the LLM. Claim-dense teaching material dominates the section corpus.

| Role | Baseline catalog cost | Jev free cost | Jev paid-list cost | Pipeline at free price | Pipeline at paid-list price |
| --- | ---: | ---: | ---: | ---: | ---: |
| Critic | $0.01640844 | $0 | $0.00530863 | $0.01640844 | $0.02171707 |
| Checker | $0.18174843 | $0 | $0.01280853 | $0.18068130 | $0.19348983 |
| Overall | $0.19815687 | $0 | $0.01811716 | $0.19708974 | $0.21520690 |

Actual classifier usage is **431,361 input + 4,078 output tokens**. Installed catalog prices are $0 input/output per million for free, and **$0.042/MTok input, output free** for `jev-1.13`; paid counterfactual is **$0.018117162**. This is only an estimate at the catalog price, not a paid model call.

Prior total reported baseline spend remains **$0.20257744**, including the completed preliminary probe; paired-corpus usage costs **$0.19815687**. A prior interrupted turn has unrecovered exact usage and a separately recorded **$0.30 uncertainty allowance**, not a measured charge or proven invoice bound. **New baseline spend $0; new classifier spend $0**, below the ~$1 extra-spend cap. The subscription provider's catalog costs are not observed invoice charges. A replay pipeline at the free price saves only **$0.00106713 (0.54%)** in role catalog cost; the paid classifier would cost more than it saves.

## Quality and all 12 verbatim disagreement excerpts

Agreement compares Jev labels to existing LLM labels, **not independently adjudicated correctness**. The critic only emits `ok/reject`, so Jev `revise` is compared as “requires review,” equivalent to rejection. Section agreement tests claim-routing labels, not whether a factual claim was verified correctly. Historical critic/checker material was visible during the earlier LLM re-review, and this is not a blinded holdout.

All five section disagreements were **Jev claims / LLM no-claims**: additional review, not unsafe skipping. Some quoted takeaways contain apparent factual statements, so the LLM's “no-claims” labels themselves need adjudication. Among seven card disagreements, four are **Jev ok / LLM reject** and three are **Jev revise / LLM ok**. One of the four rejected cards would bypass at 0.85. The classifier cannot give a reason, and the recorded baseline has verdict labels rather than retained fresh rationale; no explanation is invented here.

These are exact saved excerpts (up to 300 characters each); cut-off endings reflect the raw-data truncation rule. All **12 observed disagreements** follow.

### 1. `c-963fad31`

LLM: **ok**; Jev: **revise**; decision confidence **0.27**; escalated.

```markdown
**Q:** Hyderabad–Golconda geography — what did the Purana Pul enable?
**A:** Quick travel between Golconda and Hyderabad.


```

### 2. `c-33ae02ab`

LLM: **ok**; Jev: **revise**; decision confidence **0.36**; escalated.

```markdown
**Q:** Hyderabad timeline — what happened to the city in the 1956 linguistic reorganization?
**A:** Hyderabad became the capital of Andhra Pradesh as Hyderabad State was divided on linguistic grounds.

```

### 3. `01-hyderabad-on-the-map-and-timeline.md#section-1`

LLM: **no-claims**; Jev: **claims**; decision confidence **0.98**; escalated.

```markdown
Imagine arriving in Hyderabad with only three names in mind: Golconda, Charminar, and Secunderabad. They belong to the same metropolis, but each points to a different layer of its past. Once you can place the plateau, river, fort, planned city, cantonment, and modern western corridor, the larger sto
```

### 4. `01-hyderabad-on-the-map-and-timeline.md#section-9`

LLM: **no-claims**; Jev: **claims**; decision confidence **0.98**; escalated.

```markdown
## Key takeaways

- Hyderabad is best understood as several historical layers occupying one metropolitan landscape.
- Golconda, the Old City, and Secunderabad are connected, but they are not interchangeable names.
- Charminar is both a monument and evidence for the planned structure of the 1591 city
```

### 5. `03-qutb-shahis-and-the-founding-of.md#section-8`

LLM: **no-claims**; Jev: **claims**; decision confidence **0.96**; escalated.

```markdown
## 7. Check your understanding

1. Why is it misleading to describe Golconda as only a fort?
2. Give two pressures that may have encouraged the foundation of Hyderabad.
3. What makes Charminar part of a city plan rather than merely a freestanding monument?
4. Name three groups or movements of people
```

### 6. `04-reading-the-qutb-shahi-city-in-stone.md#section-1`

LLM: **no-claims**; Jev: **claims**; decision confidence **0.98**; escalated.

```markdown
How can walls, tombs, arches, pipes and streets serve as historical evidence? This chapter treats the Qutb Shahi landscape as a connected system rather than a checklist of monuments. You will practise moving from **observation** to **supported inference**, while remembering that ruins, repairs and l
```

### 7. `04-reading-the-qutb-shahi-city-in-stone.md#section-10`

LLM: **no-claims**; Jev: **claims**; decision confidence **0.95**; escalated.

```markdown
## 9. Check your understanding

1. Why does a site plan reveal more about Golconda than a single skyline photograph?
2. What four questions should you ask when tracing a water feature?
3. How can inscriptions correct a popular tomb identification?
4. Why are Charminar’s radiating streets part of the
```

### 8. `c-611a34b3`

LLM: **reject**; Jev: **ok**; decision confidence **0.89**; **would auto-bypass at 0.85**.

```markdown
**Q:** In $A=U\Sigma V^\top$, what geometric action does each factor perform on an input?
**A:** $V^\top$ rotates the input, $\Sigma$ stretches along axes, and $U$ rotates the result into the output space.


```

### 9. `c-d2947d7d`

LLM: **reject**; Jev: **ok**; decision confidence **0.68**; escalated.

```markdown
**Q:** How does truncating the SVD after $k$ terms produce a rank-$k$ approximation?
**A:** Keep the first $k$ terms $\sum_{i=1}^{k}\sigma_i u_i v_i^\top$; this is the best rank-$k$ approximation in both the Frobenius and spectral norms.


```

### 10. `c-66a0beda`

LLM: **reject**; Jev: **ok**; decision confidence **0.62**; escalated.

```markdown
**Q:** Why keep the top $k$ singular values when making a low-rank compression for ML?
**A:** They retain the most energy in the matrix while discarding lower-ranked components, which can include noise.

```

### 11. `c-7b566258`

LLM: **reject**; Jev: **ok**; decision confidence **0.81**; escalated.

```markdown
**Q:** Does containing carbon alone guarantee that a compound is classified as organic?
**A:** No. Carbonates, cyanides, carbon monoxide (CO), and carbon dioxide (CO₂) are examples of carbon-containing compounds not classified as organic.


```

### 12. `c-15719c95`

LLM: **ok**; Jev: **revise**; decision confidence **0.42**; escalated.

```markdown
**Q:** What did Wöhler's 1828 synthesis of urea from nonliving materials help establish about organic compounds?
**A:** It helped refute vitalism and showed that organic molecules obey the same natural laws as inorganic substances.

```

## Calibration and recommended threshold

The bins below compare the **decision-confidence proxy** with LLM-label agreement. For sections it is the derived bool posterior; for cards it is a minimum including the vendor choice confidence. It is not a joint calibrated probability of full pedagogical correctness.

| Role | Confidence bin | n | Mean decision confidence | LLM-label agreement |
| --- | --- | ---: | ---: | ---: |
| critic | 0.00–0.50 | 5 | 0.320 | 40.00% |
| critic | 0.50–0.70 | 9 | 0.613 | 77.78% |
| critic | 0.70–0.85 | 16 | 0.802 | 93.75% |
| critic | 0.85–0.95 | 4 | 0.868 | 75.00% |
| critic | 0.95–1.00 | 0 | — | — |
| checker | 0.00–0.50 | 0 | — | — |
| checker | 0.50–0.70 | 0 | — | — |
| checker | 0.70–0.85 | 0 | — | — |
| checker | 0.85–0.95 | 1 | 0.920 | 100.00% |
| checker | 0.95–1.00 | 82 | 0.973 | 93.90% |

The **0.85 gate auto-bypasses four cards, with one baseline disagreement (25%)**; its 95% Wilson upper error bound is **69.9%**. In the dangerous case `c-611a34b3`, severity choice confidence is **0.90**, but the nonduplication posterior is **0.89**, so aggregate confidence is **0.89**. Merely selecting the choice's confidence would obscure that distinction.

At **0.90, 0.95 and 0.99**, card auto-bypass count is **zero**. These thresholds did not demonstrate safe automated acceptance; they demonstrated no coverage. For sections, thresholds through 0.95 bypass only the single `# test` item. Its zero disagreements out of one has a **79.3% Wilson upper error bound**, far too little evidence to claim safety on learning content.

**Recommended production threshold: automatic bypass disabled.** The sweep represents this as **1.01**, above the possible confidence range. Keep the current LLM review and avoid adding production classifier overhead. No finite automatic-accept threshold is validated by this sample. A separate experiment could examine a ≥0.90 card gate, but it currently accepts nothing and is not a production recommendation. Any renewed claim-presence test needs labels scoped precisely to the target section, held-out cards, retained rejection reasons and independent adjudication. Missing claim content cannot waive teaching, citation or rewrite-preservation checks.

| Role | Threshold | Auto items | Auto disagreements | Error rate | 95% Wilson upper error | Complete groups bypassed | Net token savings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| critic | 0.50 | 28 | 4 | 14.3% | 31.5% | 2 | -22.84% |
| critic | 0.70 | 20 | 2 | 10.0% | 30.1% | 1 | -48.07% |
| critic | 0.85 | 4 | 1 | 25.0% | 69.9% | 0 | -57.06% |
| critic | 0.90 | 0 | 0 | — | — | 0 | -57.06% |
| critic | 0.95 | 0 | 0 | — | — | 0 | -57.06% |
| critic | 0.99 | 0 | 0 | — | — | 0 | -57.06% |
| critic | 1.01 | 0 | 0 | — | — | 0 | -57.06% |
| checker | 0.50 | 1 | 0 | 0.0% | 79.3% | 1 | -9.76% |
| checker | 0.70 | 1 | 0 | 0.0% | 79.3% | 1 | -9.76% |
| checker | 0.85 | 1 | 0 | 0.0% | 79.3% | 1 | -9.76% |
| checker | 0.90 | 1 | 0 | 0.0% | 79.3% | 1 | -9.76% |
| checker | 0.95 | 1 | 0 | 0.0% | 79.3% | 1 | -9.76% |
| checker | 0.99 | 0 | 0 | — | — | 0 | -10.24% |
| checker | 1.01 | 0 | 0 | — | — | 0 | -10.24% |

## Latency

Each request classifies one target. Card state contains the complete same-set deck (12, 17 or 5 cards); section state contains the complete original chapter. This is not a bulk multi-target classifier invocation. All probabilities and usage came from real API responses.

| Request shape | Calls | Median | p95 (nearest rank) | Range |
| --- | ---: | ---: | ---: | --- |
| 3 questions/card, full set deck in state | 34 | 575.37 ms | 983.35 ms | 515.31–1345.49 ms |
| 1 question/section, full chapter in state | 83 | 580.38 ms | 766.24 ms | 520.86–1336.44 ms |

The 70–500 ms latency assumption was not reproduced: both observed medians exceed 500 ms, and the smoke was about 1.35 s. Existing baseline role-turn medians were **56.58 s critic / 92.86 s checker**, including their tool work. These measure different work units, so classifier latency alone does not imply pipeline speedup when every useful group still escalates.

## Verdict, deviations and remaining work

**Do-not-implement the proposed critic/checker pre-filter in Phase 3.** This question set on this corpus misses a critic rejection above 0.85, adds tokens at every tested gate, and its only checker group saving is an empty test note. Vendor classifier availability and authentication are confirmed; the intended token-saving/quality hypothesis is not supported by these results. This is specific to the measured prompts, corpus and current batch semantics, not a general claim about all Jev use cases.

Phase 3 remains untouched. Future experimentation, if separately requested, should distinguish “contains any factual claim” from “requires a fresh external verification pass,” test each SuperMemo/source-support rule explicitly, avoid repeating entire chapters per target where justified, and benchmark actual partial-batch role behavior instead of assigning invented proportional savings. Grader claims remain untested because no real answers were available.

Material deviations: baseline batches rather than independent per-item LLM turns; spike-only section-label tool; retained baseline labels/usage instead of paying for reruns; current-prefix validation rather than unavailable old full hashes; historical reviews visible to the baseline; no grader sample; only 34 cards rather than ≥100. The full classifier sample was **not reduced**. No rate-limit recovery was needed. No commits, pushes, branch changes, production routing, study-data writes, env edits or broad process stops occurred.

## Changed files

Phase 0 files from the original task remain `server/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and the recreated patch. Original harness files remain under `server/src/spikes/`.

This continuation added/updated:

- `server/src/spikes/jev-pair.ts`: classifier-only baseline reuse, corpus checks, smoke/resume, checkpoints and bounded HTTP-429 backoff.
- `server/src/spikes/jev-pair-metrics.ts`: batch accounting, agreement, threshold sweeps, calibration and Wilson error bounds.
- `server/src/spikes/jev-pair-metrics.test.ts`: three focused shared-usage, uncertainty and missing-usage/error tests.
- `server/src/spikes/jev-summarize.ts`: offline summary, preserved baseline and recommendation metadata.
- `docs/plans/2026-10-02-jev-classifier-spike-results.json`: 117 real classifier results, 12 disagreements, hashes, usage and sweep outputs.
- `docs/plans/2026-10-02-jev-classifier-spike-report.md`: this completed report.

## Tests and exact commands

Original Phase 0 gates remain recorded in raw JSON: server/web `tsc --noEmit` and web build passed; scoped server dirs **306 passed / 1 unrelated failure**. They were not rerun for a spike-only continuation.

- `pnpm --filter @studium/server exec tsc --noEmit`: passed after continuation changes.
- `pnpm --filter @studium/server exec vitest run src/spikes/jev-spike-lib.test.ts src/spikes/jev-pair-metrics.test.ts`: **6 passed / 0 failed**.
- `rtk proxy pnpm exec biome check server/src/spikes/jev-pair.ts server/src/spikes/jev-pair-metrics.ts server/src/spikes/jev-pair-metrics.test.ts server/src/spikes/jev-summarize.ts docs/plans/2026-10-02-jev-classifier-spike-results.json`: passed after formatting.
- `pnpm --filter @studium/server exec tsx --env-file=/path/to/studium/.env src/spikes/jev-pair.ts --smoke --output /tmp/jev-smoke-results.json`: **1 real smoke passed**.
- `pnpm --filter @studium/server exec tsx --env-file=/path/to/studium/.env src/spikes/jev-pair.ts --baseline /tmp/jev-smoke-results.json`: **116 additional items passed**, reusing the smoke; checkpoint file was then used to update the final results artifact.
- `pnpm --filter @studium/server exec tsx src/spikes/jev-summarize.ts`: passed, offline; no env file or provider call.
- `pnpm --filter @studium/server exec tsx src/spikes/jev-pair.ts --dry-run --output /tmp/jev-pair-dry-final.json`: passed; complete roster validation with zero requests and no env file loaded.
- Result integrity checks: **117 successful distinct items, 117 HTTP attempts, zero baseline changes/calls, 12 genuine disagreements, all excerpts ≤300 chars**.
- `git diff --check`: passed. No full-suite tests were run.

## Five-line memory log (orchestrator to append)

```text
2026-10-02 · jev Phases 1–2 continuation · local codex/jev.
Added classifier-only reuse/metrics/tests; completed report + raw JSON; Pi 1.0.0 patch retained.
OpenCode Jev free/System One smoke + 117-item pairing passed; extra spend $0, baseline reused.
0.85: 1/4 card auto-accepts disagrees; 12 total disagreements; pipeline tokens +13.07%; do-not-implement.
Open: 100-card holdout, independent adjudication/practice samples, unrelated accepted/checked test; Phase 3 untouched.
```
