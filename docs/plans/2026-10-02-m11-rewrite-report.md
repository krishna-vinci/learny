# M11 rewrite verification

Stage: Finished. Evidence: /tmp/studium-m11-rewrite-WLVHlI. Shared ledger: 200/200 calls reserved.

Verdicts below describe the real runs **before the replacement fix**. History fails substantial replacement, with 10/11 assertions passing. Math is blocked during recheck by missing source evidence and the exhausted shared call cap. The prompt/guard fix passes regression tests, but no post-fix live rerun was made. This report does not claim Part 4 is proven.

The actual createRewriteJob handler ran against temporary study-tree copies. Drafter: openai-codex/gpt-6.1-sol; checker: github-copilot/gpt-6-luna (different subscription providers). Classifier/MCP services were off in the temp config. Automatic study-tree snapshot/drafter/checker commits occurred only in temp repos. Existing research tools remained available; the math checker fetched independent public references, which cannot substitute for the missing cited primary source.

Sentence comparison normalizes whitespace/case, removes frontmatter, citation markers, footnote definitions, media declarations and fenced code, then splits on sentence-ending punctuation. New-after fraction and replaced-before fraction must both be >=40%, so merely appending cannot pass.

## hyderabad-history

Result: FAIL.

```json
{
  "set": "hyderabad-history",
  "note": "notes/02-before-hyderabad-deccan-and-golconda.md",
  "root": "/tmp/studium-m11-rewrite-WLVHlI/hyderabad-history",
  "sourceHistory": "4018f01 Studium Tutor tutor: ok go ahead\ne036634 Studium Tutor tutor: visuals seems little messy and not intuitive to understand\n5c98ac9 Studium Tutor tutor: make some visuals for visual tab\nbad86f1 Studium User user: accept notes/02-before-hyderabad-deccan-and-golconda.md\n024a787 Studium Tutor tutor: Lets do 2,4,6. Find deep sources with pictures and do svgs if you want\n244626f Studium system: quote note title (invalid YAML)\n6d63810 Studium Drafter drafter: Before Hyderabad: Deccan and Golconda",
  "beforeCommit": "7e02a9521c320a4f28a643e9c4b80e63421e086e",
  "progress": [
    "Rewriting chapter",
    "Checking chapter",
    "Chapter checked"
  ],
  "providers": [
    "openai-codex",
    "github-copilot"
  ],
  "result": {
    "notePath": "notes/02-before-hyderabad-deccan-and-golconda.md",
    "commitSha": "8961fa8008fddbdf2568c2277f790d2dff79b05d"
  },
  "sentences": {
    "before": 59,
    "after": 77,
    "newAfterRatio": 0.35064935064935066,
    "replacedBeforeRatio": 0.15254237288135594
  },
  "openings": {
    "before": "Before Hyderabad was founded, Golconda had already accumulated centuries of political and architectural history. This chapter asks how a hill fort associated with the Kakatiyas passed through Bahmani rule and became the fortified capital and commercial centre from which the Qutb Shahis emerged.",
    "after": "Look at Golconda's walls rising over the rocky hill. Are you looking at one ruler's fort, or at a place reshaped by generations? Long before Hyderabad was founded, Golconda had accumulated political and architectural layers under the Kakatiyas, Bahmanis and Qutb Shahis.[^src:lib-wikipedia-history-of-hyderabad#golconda][^src:lib-wikipedia-history-of-hyderabad#bahmani][^src:lib-wikipedia-history-of-hyderabad#rise] Learning to separate those layers will help you see a fortress, a capital and a trad"
  },
  "metadataPreserved": true,
  "citationIdsPreserved": true,
  "footnotesHumanReadable": true,
  "figuresDeclarationsPreserved": true,
  "mediaBytesPreserved": true,
  "noteLint": [],
  "commits": [
    {
      "sha": "8961fa8008fddbdf2568c2277f790d2dff79b05d",
      "date": "2026-10-02T22:11:07+05:30",
      "author": "checker",
      "subject": "checker: Before Hyderabad: Deccan and Golconda"
    },
    {
      "sha": "f8a4cfca43888ea704bb2415215f005b45cd449a",
      "date": "2026-10-02T22:09:23+05:30",
      "author": "drafter",
      "subject": "drafter: Before Hyderabad: Deccan and Golconda"
    },
    {
      "sha": "7e02a9521c320a4f28a643e9c4b80e63421e086e",
      "date": "2026-10-02T22:06:42+05:30",
      "author": "system",
      "subject": "system: init study tree"
    }
  ],
  "statusAfter": "checked",
  "statusAtDrafterCommit": "draft",
  "oldTextRecoverable": true,
  "assertions": {
    "passed": 10,
    "total": 11
  },
  "verdict": "FAIL"
}
```

## linear-algebra

Result: BLOCKED.

```json
{
  "set": "linear-algebra",
  "note": "notes/01-vectors.md",
  "root": "/tmp/studium-m11-rewrite-WLVHlI/linear-algebra",
  "sourceHistory": "ef2bd7e Studium system: init study tree",
  "beforeCommit": "14af72177e06bdf4f5a21747fe78f7b8e64e1e4a",
  "verdict": "BLOCKED",
  "error": "Checker model github-copilot/gpt-6-luna failed: Eval model-call cap reached"
}
```

## Root cause and correction

History's new conversational opening did not entail reworking the chapter: only 15.3% of original sentences disappeared, and only 35.1% of the result was new. The generic drafter prompt allows surgical edits (`server/src/agent/prompt.ts:109`); old rewrite validation enforced metadata/citation/figure preservation and draft status without measuring replacement. `server/src/jobs/draft-job.ts:463` now requests replacement throughout the concept sections/examples, and `:133` enforces both fractions >=40%. Rejected output restores the original note before committing/checking. Regression cases verify append-only and shallow rewrites fail without a checker call or commit, while a substantive replacement passes; metadata/citation/media edits alone do not count. The final scoped suite passes 143 tests. No model calls remain for a live rerun.

## Blocked math item: offline final inspection

The existing library entry `/home/krishna/learny/data/users/krishna/library/lib-strang-la/source.md:11` contains only a summary. No `parsed.md` or `parsed/` exists; the retained `#p12` locator is unresolved. The checker records this at `/tmp/studium-m11-rewrite-WLVHlI/linear-algebra/linear-algebra/log/checks/01-vectors.md:9`. The item stopped with source evidence missing, then the recheck attempt encountered the 200-call cap. Live data remains unchanged.

Offline observations saved in `/tmp/studium-m11-rewrite-WLVHlI/offline-final.json`:

| Assertion | Math observation |
| --- | --- |
| Prose changed | 12 before / 48 after; 97.9% new-after, 91.7% replaced-before |
| Frontmatter | Preserved apart from status |
| Every original citation id and readable footnote definition | Preserved |
| Figures/declarations/media bytes | Preserved; original chapter has no figures |
| Note lint | Clean |
| Status | Draft at drafter commit and in current file; not checked |
| Commits | Drafter `5a905fe2308f80ac1cfa036c158c68c425e7c8f4`; no checker commit |
| Old text recoverable | Yes, snapshot `14af72177e06bdf4f5a21747fe78f7b8e64e1e4a` |

Before opening: “A vector in $\mathbb{R}^n$ is an ordered list of $n$ real numbers. We can add vectors and scale them, and almost everything else in linear algebra is built from those two moves.”

After opening: “Imagine reaching a point by taking a few steps right and a few steps up. Can those two directions get you anywhere in the plane, and would a diagonal direction let you reach anything new? We'll use that small question to get comfortable with vectors before moving on to matrices.”

Independent verification also checked every original history citation id has its own readable footnote definition; the history result above remains FAIL only on replacement.

## Observed tokens per provider

| Provider | Fresh | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| github-copilot | 192 | 47495 | 814395 | 636180 |
| openai-codex | 627165 | 32427 | 317696 | 0 |

Totals include visual eval and interrupted prototype requests where usage was observed; interrupted pre-lock usage is incomplete.
