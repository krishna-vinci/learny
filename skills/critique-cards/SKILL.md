---
name: critique-cards
description: Review assigned cards against the twenty rules, source support, and existing-deck interference.
---

# Critique-cards procedure

## Load the standard and evidence

1. Load `references/twenty-rules.md` before judging any card.
2. Read the target note and each cited source passage needed to verify the answer.
3. Read all cards in the set, especially approved and exported cards. These are the comparison set for interference.
4. Identify exactly which cards the job assigned. Review only those cards; do not alter unrelated cards.

Judge the card that exists, not the intention behind it. A polished sentence still fails if it tests several facts, lacks a unique answer, or is unsupported.

## Review each assigned card

Check in this order:

1. **Truth and support:** Is the expected answer correct, understandable from the note, and supported by `src` at the stated locator?
2. **One retrieval:** Does the prompt ask for one atomic response rather than a set, essay, or hidden bundle of facts?
3. **Prompt independence:** Does it name its subject and context without orphan pronouns or reliance on the previous card?
4. **Answerability:** Is there one intended answer at the learner's level? Does wording avoid both ambiguity and giving the answer away?
5. **Type:** Does a basic card have both question and answer? Does a cloze have a valid `{{cN::...}}` deletion with enough surrounding context?
6. **Retention quality:** Apply all twenty rules, including useful cues, concise wording, source/date metadata where relevant, and sensible priority.
7. **Interference:** Compare meaning, not just exact text, against every approved or exported card. Reject a near-identical cue-answer pair and name the other card id.

Interference example:

```text
Existing c-12ab34cd: Q: What matrix has the right singular vectors as eigenvectors?
Candidate:             Q: Right singular vectors are eigenvectors of which matrix?
Verdict: reject — interference with c-12ab34cd; same retrieval in reversed wording.
```

A complementary direction is not automatically a duplicate:

```text
Existing: Q: What are the eigenvectors of $A^\top A$ called? A: Right singular vectors.
Candidate: Q: Why are singular values nonnegative? A: They are square roots of eigenvalues of $A^\top A$.
Verdict: ok — shared context, different retrieval.
```

## Record an actionable verdict

- For a clean card, call `review_card` with `{id, verdict: "ok"}`. This records `critic: ok` but leaves the card in `draft`; only the learner approves it.
- For a failing card, call `review_card` with `{id, verdict: "reject", rule, reason}`. Use the most directly violated numbered rule and explain the smallest concrete repair.
- Keep reasons specific: “rule 4: asks for definition, dimensions, and interpretation; split into three cards” is useful. “Too broad” is not.
- For source errors that do not map neatly to another rule, use rule 18 and state the exact missing or contradictory support.
- For a near-duplicate, use rule 11 and include `interference with <card-id>` in the reason.
- Never rewrite card content, assign ids, approve cards, or export them. The Cardsmith revises; the Critic reviews.

## Re-review revisions

Read the whole revised card again. Confirm the original defect is fixed and run the complete checklist; do not rubber-stamp a revision because one sentence changed. Use `ok` only when the card is ready for learner judgment.

If `review_card` is unavailable, return a table of `id | verdict | rule | reason` and state that no statuses were changed. Do not use a generic edit tool as a substitute.
