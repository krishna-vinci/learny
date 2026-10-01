---
name: note-authoring
description: Write and maintain Studium notes using the study-tree Markdown contract.
---

# Note authoring procedure

## Before writing

1. Read the existing note before changing it. If it does not exist, inspect its sibling notes and `curriculum.md` so numbering, depth, and terminology stay consistent.
2. Identify the note's single chapter-sized purpose. If it covers two large ideas, recommend a second note rather than crowding this one.
3. Confirm which source IDs are relevant. Notes may cite sources registered in `library/<source-id>/source.md`; do not invent source IDs.
4. If `study_read`, `study_create`, or `study_edit` is unavailable, ask the operator to supply the relevant file text and return an exact edited version instead of silently improvising a different storage workflow.

## File shape

Create `<set>/notes/NN-slug.md` with this frontmatter:

```yaml
---
title: Singular Value Decomposition
order: 3
status: draft
sources: [lib-strang-la]
---
```

Quote a title that contains `: ` or ` #`, e.g. `title: "Before Hyderabad: Deccan and Golconda"`.

Keep `NN` sequential, use a short kebab-case slug, and never change a note filename without recording why in `log/decisions.md`.

## Body conventions

- Begin with a two- to four-sentence orientation: what question this note answers and why it matters to the learner's stated goal.
- Give each concept its own `##` section. Do not mix a definition, proof, worked example, and caveats in one undifferentiated block.
- Use `$...$` for inline mathematics and `$$...$$` for display mathematics. Never paste an equation image when LaTeX can represent it.
- Use the supported directives semantically:

```md
:::definition
For an $m \times n$ matrix $A$, ...
:::

:::theorem
Every real matrix has a singular value decomposition.
:::

:::example
Factor $\begin{bmatrix}3 & 0\end{bmatrix}$ as ...
:::

:::deeper
The polar decomposition explains why ...
:::
```

- Put derivation, rare edge cases, and advanced dependencies in `:::deeper`; the main path should remain useful at the learner's current level.
- Use Mermaid only when a diagram explains a relationship better than prose. Keep node labels short and give the diagram a caption.
- Prefer one worked example with all intermediate steps over three skipped-step examples.
- For each code block using a library, state the library version checked against `mcp_context7_*` docs (resolve the library id, then retrieve docs). If checking is unavailable, report the gap instead of presenting the code as verified.

## Citations

Attach a stable footnote reference to every source-grounded claim:

```md
A real $m \times n$ matrix has $r = \operatorname{rank}(A)$ nonnegative singular values.[^src:lib-strang-la]

[^src:lib-strang-la]: Strang, *Introduction to Linear Algebra*.
```

Use a page or section locator when the parsed source preserves one, for example `[^src:lib-strang-la#p132]`. Preserve every existing citation while editing. If a claim has no source, label it explicitly with `**Uncertain:**` and say what verification is needed.

A Context7 page counts as a source only after it is registered in `library/`. Use `add_source` when available; otherwise report the documentation URL to the owner for registration before citing it.

## Review before finishing

1. Check that frontmatter parses and the status remains `draft` unless the workflow explicitly authorizes another status.
2. Verify headings, directive fences, math delimiters, and footnote IDs are balanced.
3. Ensure one idea per section, every nontrivial claim cited or marked uncertain, and no private source text.
4. Preserve user-authored wording unless the requested edit requires changing it.

For purposeful visuals in notes, load `media-authoring` and follow its local-file and static-book rules.
