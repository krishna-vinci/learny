# M11 rewrite verification

## Follow-up acceptance

See [the complete follow-up report](2026-10-02-m11-followup-report.md) for changed files, exact checks, openings, limitations and the five-line memory log. Total follow-up usage: **86 requests** (60 rewrite + 26 visual), all result events recorded. The following totals sum both ledgers and exclude the earlier M11 run.

| Provider | Fresh | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| github-copilot | 96 | 25,634 | 1,615,363 | 545,347 |
| openai-codex | 330,724 | 21,792 | 1,302,656 | 0 |

| Target | Before | Follow-up |
| --- | --- | --- |
| History | FAIL, 35.1% new / 15.3% replaced; 10/11 assertions | PASS, 100% / 100%; 11/11 |
| Non-history | Vectors BLOCKED: missing Strang parsed evidence | PCA substituted; PASS, 100% / 100%; 11/11 |

PCA checker caveat: retained legacy anchors do not match several parsed headings; the underlying claims were verified by inspection. The task required preserving those IDs. No NumPy execution was performed.

Stage: Finished. Evidence: /tmp/studium-m11-followup-rewrite. Shared ledger: 60 calls recorded (no fixed subscription cap).

The actual createRewriteJob handler runs against temporary study-tree copies. Drafter: openai-codex/gpt-6.1-sol; checker: github-copilot/gpt-6-luna (different subscription providers). Classifier/MCP services are off in the temp config. Automatic study-tree snapshot/drafter/checker commits occur only in temp repos.

Sentence comparison normalizes whitespace/case, removes frontmatter, citation markers, footnote definitions, media declarations and fenced code, then splits on sentence-ending punctuation. New-after fraction and replaced-before fraction must both be >=40%, so merely appending cannot pass.

Follow-up uses PCA in practice instead of Vectors: the original Strang source still has no parsed.md/parsed/ evidence. PCA's two cited sources have parsed text. The real job permits one shallow-rewrite revision before restoring/failing; checker blocker revision remains independently bounded. A case stops after three identical provider/tool failures, with no fixed subscription request cap.

## hyderabad-history

Result: PASS.

```json
{
  "set": "hyderabad-history",
  "note": "notes/02-before-hyderabad-deccan-and-golconda.md",
  "root": "/tmp/studium-m11-followup-rewrite/hyderabad-history",
  "sourceHistory": "4018f01 Studium Tutor tutor: ok go ahead\ne036634 Studium Tutor tutor: visuals seems little messy and not intuitive to understand\n5c98ac9 Studium Tutor tutor: make some visuals for visual tab\nbad86f1 Studium User user: accept notes/02-before-hyderabad-deccan-and-golconda.md\n024a787 Studium Tutor tutor: Lets do 2,4,6. Find deep sources with pictures and do svgs if you want\n244626f Studium system: quote note title (invalid YAML)\n6d63810 Studium Drafter drafter: Before Hyderabad: Deccan and Golconda",
  "parsedSources": [
    "lib-unesco-the-qutb-shahi-monuments-of-hyderabad",
    "lib-unesco-monuments-and-forts-of-the-deccan",
    "lib-wikipedia-history-of-hyderabad"
  ],
  "beforeCommit": "95a549eedf478ec2692d746ce465c70658672145",
  "progress": [
    "Rewriting chapter",
    "Checking chapter",
    "Revising blocker issues",
    "Re-checking revised chapter",
    "Chapter checked"
  ],
  "providers": [
    "openai-codex",
    "github-copilot"
  ],
  "result": {
    "notePath": "notes/02-before-hyderabad-deccan-and-golconda.md",
    "commitSha": "a01cc2b64485c7a12c6d574399b8c522193e967b"
  },
  "sentences": {
    "before": 59,
    "after": 92,
    "newAfterRatio": 1,
    "replacedBeforeRatio": 1
  },
  "openings": {
    "before": "Before Hyderabad was founded, Golconda had already accumulated centuries of political and architectural history. This chapter asks how a hill fort associated with the Kakatiyas passed through Bahmani rule and became the fortified capital and commercial centre from which the Qutb Shahis emerged.",
    "after": "Picture yourself looking up at Golconda's walls: are you seeing one ruler's fort, or several histories fitted together? The Kakatiyas established the stronghold, and later Qutb Shahi builders reshaped it into a capital.[^src:lib-wikipedia-history-of-hyderabad#golconda][^src:lib-wikipedia-history-of-hyderabad#capital] Learning to separate those layers will help you see more than impressive stonework when you visit."
  },
  "metadataPreserved": true,
  "citationIdsPreserved": true,
  "footnotesHumanReadable": true,
  "figuresDeclarationsPreserved": true,
  "mediaBytesPreserved": true,
  "noteLint": [],
  "commits": [
    {
      "sha": "a01cc2b64485c7a12c6d574399b8c522193e967b",
      "date": "2026-10-02T22:48:30+05:30",
      "author": "checker",
      "subject": "checker: Before Hyderabad: Deccan and Golconda"
    },
    {
      "sha": "119a67b5b9d678eb46a218c1520fe23a153ae366",
      "date": "2026-10-02T22:46:15+05:30",
      "author": "drafter",
      "subject": "drafter: Before Hyderabad: Deccan and Golconda"
    },
    {
      "sha": "95a549eedf478ec2692d746ce465c70658672145",
      "date": "2026-10-02T22:41:35+05:30",
      "author": "system",
      "subject": "system: init study tree"
    }
  ],
  "statusAfter": "checked",
  "statusAtDrafterCommit": "draft",
  "oldTextRecoverable": true,
  "assertions": {
    "passed": 11,
    "total": 11
  },
  "verdict": "PASS"
}
```

## linear-algebra

Result: PASS.

```json
{
  "set": "linear-algebra",
  "note": "notes/05-pca-in-practice.md",
  "root": "/tmp/studium-m11-followup-rewrite/linear-algebra",
  "sourceHistory": "0bfb2ff Studium User user: accept notes/05-pca-in-practice.md\ne3760e0 Studium Checker checker: PCA in practice\n5382808 Studium Drafter drafter: PCA in practice",
  "parsedSources": [
    "lib-en-wikipedia-org-singular-value",
    "lib-wikipedia-principal-component-analysis"
  ],
  "beforeCommit": "ea02ef4ff0d5c767d4a0eb8db3373434b69f80a9",
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
    "notePath": "notes/05-pca-in-practice.md",
    "commitSha": "a7b336c80a6c071f346f2e7aad97f6e610356ac2"
  },
  "sentences": {
    "before": 64,
    "after": 118,
    "newAfterRatio": 1,
    "replacedBeforeRatio": 1
  },
  "openings": {
    "before": "How does PCA turn a table of correlated features into a smaller set of useful coordinates? This chapter separates the geometric idea—rotate a centered point cloud toward its widest directions—from the practical recipe implemented with an SVD. We will carry one small dataset from centering through scores and explained variance, then repeat the procedure in NumPy.",
    "after": "Imagine a table with two sensor readings for every observation, and suppose the readings tend to rise together. Could we describe that shared movement with one coordinate instead of carrying both columns? PCA gives us new, orthogonal coordinates ordered by how much variation they capture—a useful way to reduce correlated features before further analysis.[^src:lib-wikipedia-principal-component-analysis#overview] Let's turn that picture into a calculation you can follow by hand, then try in NumPy."
  },
  "metadataPreserved": true,
  "citationIdsPreserved": true,
  "footnotesHumanReadable": true,
  "figuresDeclarationsPreserved": true,
  "mediaBytesPreserved": true,
  "noteLint": [],
  "commits": [
    {
      "sha": "a7b336c80a6c071f346f2e7aad97f6e610356ac2",
      "date": "2026-10-02T22:55:38+05:30",
      "author": "checker",
      "subject": "checker: PCA in practice"
    },
    {
      "sha": "05de607c078c135af88434962b33bad24e50df2b",
      "date": "2026-10-02T22:53:25+05:30",
      "author": "drafter",
      "subject": "drafter: PCA in practice"
    },
    {
      "sha": "ea02ef4ff0d5c767d4a0eb8db3373434b69f80a9",
      "date": "2026-10-02T22:48:30+05:30",
      "author": "system",
      "subject": "system: init study tree"
    }
  ],
  "statusAfter": "checked",
  "statusAtDrafterCommit": "draft",
  "oldTextRecoverable": true,
  "assertions": {
    "passed": 11,
    "total": 11
  },
  "verdict": "PASS"
}
```

## Observed tokens per provider

| Provider | Fresh | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| openai-codex | 139923 | 16445 | 1302656 | 0 |
| github-copilot | 69 | 20261 | 1615363 | 387459 |

Totals below belong to the specified follow-up usage ledger, shared with visual eval when that ledger is used. Historical results and their incomplete interrupted telemetry are preserved separately below.

## Previous M11 run (before follow-up)

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

The existing library entry `/path/to/studium/data/users/<username>/library/lib-strang-la/source.md:11` contains only a summary. No `parsed.md` or `parsed/` exists; the retained `#p12` locator is unresolved. The checker records this at `/tmp/studium-m11-rewrite-WLVHlI/linear-algebra/linear-algebra/log/checks/01-vectors.md:9`. The item stopped with source evidence missing, then the recheck attempt encountered the 200-call cap. Live data remains unchanged.

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
