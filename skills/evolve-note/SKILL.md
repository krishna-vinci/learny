---
name: evolve-note
description: Improve an existing note surgically while preserving citations, history, and learner intent.
---

# Evolve-note procedure

## Establish the edit contract

1. Read the entire current note and the relevant part of the cited source.
2. Classify the request: correction, clarification, addition, pruning, depth change, or structure repair.
3. Identify the smallest set of exact text replacements that satisfies the request.
4. If the learner's request is ambiguous between materially different edits, ask one clarifying question before changing the file.

Never regenerate or rewrite a whole note. The note is an evolving record; replacing its text destroys learner-specific choices and makes history less useful.

## Make surgical edits

Use exact-string replacement when `study_edit` is available. Prefer several small replacements over one giant replacement:

```text
old_string: "A matrix is diagonalizable when it has enough eigenvalues."
new_string: "A square matrix is diagonalizable when it has a full basis of eigenvectors."
```

Rules:

- Keep unchanged paragraphs, headings, examples, citations, and frontmatter fields intact.
- Correct only the affected sentences; do not restyle unrelated prose.
- Add a new section only when the idea cannot fit an existing section without making it incoherent.
- Move content to `:::deeper` rather than deleting useful advanced context unless the plan excludes it.
- Preserve all `[^src:...]` references and their footnote definitions. If moving cited text, move its citation with it.
- Register new facts from web or documentation lookups with `add_source` before adding them to the note, then keep citations to the registered source. If registration is unavailable, report the URL to the owner and leave the proposed addition pending.
- Keep frontmatter `status` unchanged unless the workflow explicitly authorizes a transition.

## Resolve conflicts with evidence

If a new source contradicts the note:

1. Quote or precisely identify the conflicting passage.
2. Compare authority, recency, scope, and the credibility tier in each `source.md`.
3. Make the narrowest defensible correction.
4. If both claims remain credible in different scopes, state the scope distinction instead of choosing one silently.

Never delete a learner-authored interpretation without explaining the replacement and recording the reason.

## Record the why

After a successful content edit, append one line to `<set>/log/decisions.md`:

```md
- 2026-09-29 · notes/03-svd.md · narrowed diagonalization claim to square matrices because lib-strang-la p260 defines it that way.
```

Use one line, keep it factual, and include the source of authority when relevant. Git already records what changed; this ledger records why.

## Verify

1. Reread the edited section plus the paragraph before and after it.
2. Check that all directive fences, math delimiters, and footnote IDs remain balanced.
3. Confirm citations still support the exact edited claim.
4. Confirm no unrelated file changed.

If an edit tool is absent, return a unified diff or exact before/after blocks and ask the learner to apply it. Do not simulate success.
