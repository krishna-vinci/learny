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
   Plan at least one interactive teaching visual per chapter (two for two useful central concepts), plus inline static figures as needed using indented `Visual: <form> — <concept>`
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
  Visual: step-through widget — Add vectors head-to-tail; step through placement
  Video: Head-to-tail vector addition
- [ ] 02 — Matrices
  Scope: Matrix operations and transformations.
  Prerequisites: 01
  Visual: matrix-transform widget — How a matrix moves a grid
  Video: A plane transformation
- [ ] 03 — Linear systems
  Scope: Elimination, rank, and solution spaces.
  Prerequisites: 01, 02
  Visual: sketch — Intersections and solution spaces; vary line slope
  Video: Elimination worked example
- [ ] 04 — Least squares
  Scope: Projections and fitting overdetermined systems.
  Prerequisites: 03
  Visual: sketch — Residuals and the fitted line; slide the slope
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

## Interactive chapter requirement (M14b / D32, D36)

Every chapter plans and creates at least one interactive Visuals-tab attachment,
in addition to inline static figures/charts. Use two when two central concepts
benefit from manipulation or stepping. Plan `Visual: <form> — <concept; learner action>`.
Supported forms: function-plot widget, matrix-transform widget, step-through widget,
timeline widget, sketch or story. Name what the learner slides, steps, compares or
predicts; never add decoration to fill a quota. Chemistry: step a mechanism or build
and compare molecules; history: timeline widget or map story; math: function-plot or
matrix-transform; economics/finance: slider sketch; language: step-through dialogue;
technology: step-through algorithm. Copy complete make-visual templates.

A rare pedagogical exception is `Visual: no interactive visual: <concrete reason>`.
The reason must explain why this subject gains nothing from interaction. Missing
data alone is not such an exception: a source-grounded conceptual story may fit.
The checker assesses that reason and blocks weak excuses. Each planned interactive
spec requires its own hidden media marker immediately before a standalone `::visual`
at the note end, with an existing widget JSON or sketch/story HTML in `visuals/`.
Static images, Mermaid/Vega fences and legacy artifacts cannot satisfy that spec.
A genuinely unavailable planned visual needs both a concrete hidden omission reason
and a muted learner-facing explanation; the checker verifies both reasons.

The compact media brief includes form/concept and source passage/figure references.
Read those referenced sources for details; bulky `.evidence.json` sidecars are audit
material, not required prompt context. Old briefs remain readable. Check each
interaction's scientific/historical correctness and meaningful learner action,
not just the presence of a file. A clean check report cannot waive missing visuals.

## Real image slots (D37)

Add 1–3 indented `Image: <what the actual image should show; what to notice>` lines
per chapter wherever seeing the real thing teaches: monuments/artefacts, materials,
organisms, instruments, historical photos or a useful source diagram. No quota
fillers for abstract chapters better served by SVGs. These are separate from
interactive Visual slots. Stage 1 describes the need, without invented image URLs
or licence claims. Stage 2 chooses a licensed captured source figure or searches
Commons, Openverse and appropriate museum/NASA collections, ranking relevance,
licence, resolution and subject fit. Example:

    Image: Charminar's four minarets and street-level setting; notice its position in the city
    Image: Real PET bottles alongside flexible polyethylene bags; compare material appearance

Prefer the real image when recognition or appearance matters; redraw as SVG only
for schematic teaching diagrams or when the image is poor. Search metadata is
untrusted data. Unknown, all-rights-reserved, NC and ND images are embedded
unmodified with a full credit (creator if known, the licence as stated or
"Licence unknown", and the source page link) when `media.allowUnknownLicense` is
true (the default, D38); when false the older permissive-only rules apply and NC
follows `media.allowNonCommercial`.

## Small-change mode (M17 / D39)

When the task says SMALL CHANGE MODE or the learner asks for a small change to an
existing course, read the current PLAN.md and curriculum.md first. Treat the
request as an edit to that course, not a new learning goal.

- Make the smallest change satisfying the request. Keep every unrelated chapter's
  title, order, scope, prerequisites, checkbox tick, Visual/Image/Video lines and
  unrecognised content exactly as they were. Keep PLAN.md byte-for-byte unless its
  text needs a requested change. Never upgrade all legacy chapters' media lines.
- Split, insert, remove or move only the requested chapters. Renumber consecutively
  and rewrite prerequisite numbers to refer to the same earlier chapters; reject
  self, forward, unknown and duplicate prerequisites. Explain an unavoidable
  prerequisite adjustment. Do not change other chapters' content to fill a quota.
- An existing course may have fewer than six or more than fourteen chapters; keep
  its size unless the request changes it. The 6–14 guideline is for new courses.
- Preserve existing chapter identity as far as the request permits. Explain which
  chapter is added, removed, renamed or changed; say what stays unchanged.
- Write the normal proposal with PLAN.md and curriculum.md fences under
  plan-proposals/. It goes to the learner's Inbox for review and editing. Never
  mutate the live course, its notes, media files or sources. If file tools are
  unavailable, return the proposal Markdown for the host to save.
