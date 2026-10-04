---
name: plan-set
description: Propose a study plan and prerequisite-ordered curriculum for learner approval.
---

# Plan a study set

1. Read the learner profile, current `PLAN.md` and `curriculum.md`, and the chosen
   library sources' `source.md` summaries. Use the supplied goal, level (1–5), and
   optional deadline. Size the work to the learner's background and available time.
2. Load `find-sources` to identify missing material. Search and evaluate using the
   tools actually available. Reuse chosen registered sources. The Outliner has no
   `add_source`: propose new URLs with a short reason, never register them or invent
   a library source id. If research tools are absent, state the limitation and mark
   candidate URLs unverified.
3. Propose 6–14 chapters, ordered so prerequisites precede dependent chapters.
   Each chapter should cover one manageable learning unit at the requested level.
   Choose `subject:` from math, science, technology, history, finance, language,
   practical, general and include it in the proposed PLAN.md frontmatter. History
   includes humanities/social sciences; use general when no closer subject fits.
   Scopes describe content for the learner, never instructions to an AI/operator.
   State its one-line scope and prerequisites: `none`, or a comma-separated list
   of distinct existing two-digit chapter numbers strictly lower than the current
   chapter. Reject self, forward, unknown, duplicate and malformed references.
   Distinguish what the goal includes from what it deliberately excludes.
4. Create the assigned `plan-proposals/<timestamp>.md` with `study_create`. If the
   harness supplies a precise filename, use it exactly. Write only this proposal;
   never edit `PLAN.md`, `curriculum.md`, notes, or the library. If file tools are
   unavailable, return the complete proposal text for the learner to save there.
5. End with a brief description of the proposed learning path and state that it
   awaits approval in the Inbox. Do not start drafting chapters yourself.

## Proposal format

Use exactly these headings and two Markdown fences. The `PLAN.md` fence contains
the complete plan with the existing frontmatter schema: `title`, `status`, `level`,
`deadline`, `sources`, `subject`, and `next_action`. Use `null` for an absent deadline; sources
contain only chosen, registered library ids. The plan can be `active` because this
content is installed only after approval. Use `- [ ] NN — Title` curriculum lines
numbered consecutively from 01. Keep Scope and Prerequisites on separate indented
lines. The example below has six chapters; replace their content for the actual goal.

````markdown
# Study plan proposal

## PLAN.md
```markdown
---
title: "Linear algebra for ML"
status: active
level: 2
subject: math
deadline: null
sources: [lib-strang-la]
next_action: Review the first drafted chapter
---

## Goal
Understand the linear algebra used in common machine learning models.

## Scope — in
Vectors, matrices, least squares, eigenvalues, SVD, and applications.

## Scope — out
Abstract algebra and advanced numerical analysis.
```

## curriculum.md
```markdown
# Curriculum

- [ ] 01 — Vectors
  Scope: Vector operations, linear combinations, and geometric intuition.
  Prerequisites: none
- [ ] 02 — Matrices
  Scope: Matrix operations and transformations.
  Prerequisites: 01
- [ ] 03 — Linear systems
  Scope: Elimination, rank, and solution spaces.
  Prerequisites: 01, 02
- [ ] 04 — Least squares
  Scope: Projections and fitting overdetermined systems.
  Prerequisites: 03
- [ ] 05 — Eigenvalues
  Scope: Eigenvectors, diagonalization, and interpretation.
  Prerequisites: 02, 03
- [ ] 06 — Singular value decomposition
  Scope: Low-rank approximations and ML applications.
  Prerequisites: 04, 05
```

## Sources to add
- https://example.org/course — Candidate course; verify before adding.
````

If there are no additional sources to recommend, write `None.` under Sources to add.
Newly proposed URLs stay separate from `PLAN.md` sources until the learner adds them.

## Source quality and video proposals (D34)

Load find-sources `references/recipes.md`. Fill foundation + expert + subject slots,
searching 10–20 candidates per slot and evaluating leaders with `scout_sources`
when available. Papers require level >=4, a recent topic, or an uncovered central
claim; state that reason. Avoid thin/SEO sources even if they rank in search.
When seeing/hearing teaches better, propose 1–3 named educator/institution videos
under Sources to add. Verify individual URLs, level, length (prefer 5–30 minutes),
and caption type; prefer manual captions. Unknown metadata stays unknown. Explain
which concept each demonstration would teach. Never propose decorative videos.
The approval kickoff ingests proposed video URLs via the transcript ladder.
