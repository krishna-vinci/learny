---
name: make-deck
description: Draft small, source-grounded cards from an accepted note without duplicating the existing deck.
---

# Make-deck procedure

## Establish the card-making contract

1. Read the target note, its `PLAN.md`, `_global/profile.md`, and the relevant registered source passages.
2. Read the target cards file if it exists. Treat approved and exported cards as established memories: do not replace them, renumber them, or recreate them.
3. Use the requested count as a ceiling, not a quota. Prefer fewer useful cards to filler. With a count of zero, add no cards; that run is for re-checking existing cards.
4. Select durable knowledge that serves the plan: definitions, distinctions, causal links, key steps, and transfer-worthy examples. Skip prose trivia and anything the note does not make understandable.

Never invent a card id. `add_card` creates the permanent `c-` id. Never approve or export a card; new cards remain drafts until the learner approves them.

## Turn knowledge into retrieval prompts

Make each card test one clear retrieval. The question must make sense when seen alone weeks later.

- Put the subject and needed scope in the prompt. Replace orphan wording such as “Why does it work?” with “Why does gradient descent require a learning rate?”
- Ask for one fact, relation, decision, or short reasoning step. Split prompts joined by “and,” multi-part answers, and long lists.
- Keep the answer as short as accuracy permits. Put explanation or a worked check in `extra`, not in the required recall target.
- Preserve the note's notation and level. Do not test a prerequisite that the learner has not yet learned.
- Use a context cue when a term is ambiguous: “Linear algebra — rank:” is better than bare “Rank?”.
- Compare the proposed prompt with every approved or exported card in the set. If it would retrieve the same answer from nearly the same cue, skip it or choose a genuinely different direction.

Bad:

```text
Q: What is the SVD and what are all of its properties and applications?
A: A long paragraph with several independently forgettable claims.
```

Better:

```text
Q: In $A = U\Sigma V^\top$, what does a diagonal entry of $\Sigma$ represent?
A: A singular value of $A$.
```

## Choose the card type

Use `basic` when the learner should produce an explanation, distinction, consequence, or compact result:

```json
{"type":"basic","q":"Why is every singular value nonnegative?","a":"It is the square root of an eigenvalue of $A^\\top A$.","src":"lib-strang-la#p364"}
```

Use `cloze` for an atomic term, symbol, or short step embedded in enough context to have one intended completion:

```json
{"type":"cloze","text":"The columns of $V$ are eigenvectors of {{c1::$A^\\top A$}}.","extra":"This is the right-singular-vector relation.","src":"lib-strang-la#p364"}
```

For a necessary sequence, make overlapping or individually cued clozes rather than one “name every step” card. Do not blank several unrelated facts in one cloze. A cloze must contain at least one valid `{{cN::...}}` deletion.

## Cite the exact support

- Give every card a `src` value using a registered source id and the narrowest available locator, such as `lib-strang-la#p364`.
- Check the cited passage supports the answer as written. Never copy a locator from the note without checking it.
- Do not put the citation in the material the learner must recall.
- If the note makes a useful claim but no registered source supports it, do not make the card. Report the gap.

## Add and inspect cards

1. Call `add_card` once per proposed card with only its content, type, and source. Let the tool return the id.
2. Reread each resulting card as an isolated review item. Check for ambiguity, orphan pronouns, multiple facts, accidental hints, malformed math, and duplicated prompts.
3. Report the ids created and any requested topics intentionally skipped.
4. When revising a Critic rejection, edit the same card in place and keep its id. Address the stated rule and reason; do not evade the finding with cosmetic rewording.

If `add_card` is unavailable, return proposed payloads without ids and state that no cards were added. Do not fabricate tool success or write a whole cards file through a generic file tool.
