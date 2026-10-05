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
   Choose `subject:` from math, science, technology, history, philosophy, politics,
   law, economics, finance, language, practical, general and include it in the proposed PLAN.md frontmatter. History
   covers historical inquiry; use general when no closer subject fits.
   Scopes describe content for the learner, never instructions to an AI/operator.
   State its one-line scope and prerequisites: `none`, or a comma-separated list
   of distinct existing two-digit chapter numbers strictly lower than the current
   chapter. Reject self, forward, unknown, duplicate and malformed references.
   Plan 1–2 teaching visuals per chapter using indented `Visual: <form> — <concept>`
   lines (figure/diagram, chart, named widget type, sketch/story), and one
   `Video: <concept or moment to show>` line. These are short learner-facing
   intents; sources will refine them after ingestion.
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
lines, followed by Visual and Video intent lines. The example below has six chapters; replace their content for the actual goal.

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
  Visual: figure — Vector addition geometrically
  Video: Head-to-tail vector addition
- [ ] 02 — Matrices
  Scope: Matrix operations and transformations.
  Prerequisites: 01
  Visual: matrix-transform widget — How a matrix moves a grid
  Video: A plane transformation
- [ ] 03 — Linear systems
  Scope: Elimination, rank, and solution spaces.
  Prerequisites: 01, 02
  Visual: diagram — Intersections and solution spaces
  Video: Elimination worked example
- [ ] 04 — Least squares
  Scope: Projections and fitting overdetermined systems.
  Prerequisites: 03
  Visual: chart — Residuals and the fitted line
  Video: Projection onto a line
- [ ] 05 — Eigenvalues
  Scope: Eigenvectors, diagonalization, and interpretation.
  Prerequisites: 02, 03
  Visual: matrix-transform widget — Directions that stay parallel
  Video: Eigenvector geometry
- [ ] 06 — Singular value decomposition
  Scope: Low-rank approximations and ML applications.
  Prerequisites: 04, 05
  Visual: story — Rotation, scaling, rotation
  Video: Low-rank approximation
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
For every chapter, seek at least one high-quality named educator/institution video
under Sources to add. Verify individual URLs, level, length (prefer 3–25 minutes or a relevant moment range),
and caption type; prefer manual captions. Unknown metadata stays unknown. Explain
which concept each demonstration would teach. Record "no suitable video: <reason>" when none meets authority, relevance, language
and level fit. Never fill the quota with a weak or decorative video. English is
the default unless the plan specifies another language.
The approval kickoff ingests proposed video URLs via the transcript ladder.
