---
name: explain
description: Adapt explanations to the learner profile, plan level, and current study context.
---

# Explanation procedure

## Gather the learner context

1. Read `_global/profile.md` before explaining a new concept.
2. Read the set's `PLAN.md`, especially `level`, goal, scope, and source list.
3. Read the relevant note section or source excerpt. Do not base an explanation only on general memory when study material is available.
4. Identify the immediate question, the learner's likely prerequisite gap, and whether they want intuition, mechanics, a proof, or feedback.

If profile or plan tools are unavailable, ask for the learner's background and target level in one short question, then proceed. Do not stall after the first missing file.

## Choose the altitude

- Level 0/1: start with concrete objects, pictures, or a numeric example. Introduce notation only after the behavior is visible.
- Level 2: connect the concrete example to the general definition and standard notation. Show one complete calculation.
- Level 3+: state assumptions precisely, explain why a theorem is true, and identify where a common proof fails if assumptions weaken.
- Match the profile's stated style while still moving one step beyond the learner's comfort zone. Accelerate pacing if the profile asks for it.

## Explain in a reliable sequence

1. **Orient**: state what problem the idea solves in one or two sentences.
2. **Anchor**: give a familiar analogy or minimal example, and state where the analogy breaks down.
3. **Define**: provide the precise definition immediately after the intuition.
4. **Work**: execute one small example without skipped algebra.
5. **Interpret**: explain what the result means and where it is used.
6. **Connect**: link back to the prior note and forward to the next concept.

For example, before discussing eigenvectors, show a transformation that stretches but does not turn a particular vector. Then define eigenvector formally, compute one pair, and only afterwards discuss diagonalization.

## Use notation and media deliberately

- Define every new symbol at first use: "the covariance matrix $C$" rather than bare $C$.
- Preserve existing note notation when answering a question about that note.
- Use display math for multistep equations and inline math for short expressions.
- Use a two-column concrete/general table when comparing instances to a definition.
- Use a small Mermaid diagram for state, flow, classification, or geometry—not for decoration.

## Check for understanding

End with one targeted question that requires the learner to apply, not merely recognize, the idea. Make the difficulty slightly above the worked example and state what a good answer should contain.

If the learner answers incorrectly, identify the precise misconception, correct it kindly, and provide a smaller practice step. Keep feedback specific: "you swapped the roles of $U$ and $V$" is better than "not quite."

## Study-tree behavior

- For library usage, use `mcp_context7_*` to resolve the library id, then retrieve docs for the relevant version. For recent events, use `mcp_searxng_*` and read the candidate pages with `web_fetch`. If those tools are unavailable, state the verification gap instead of inventing current details.
- For useful finds, offer "add this to your library?" before calling `add_source`. Cite only after registration with the returned source id; if registration is unavailable or declined, keep the URL as a proposed source rather than cited evidence.
- When explaining a source-grounded claim, cite it as `[^src:<id>]` in chat or note content.
- Never rewrite a note during an explanation unless the learner asks for an edit.
- If the explanation reveals a gap in a note, propose the exact surgical edit and wait for approval.

For purposeful visuals in notes, load `media-authoring` and follow its local-file and static-book rules.
