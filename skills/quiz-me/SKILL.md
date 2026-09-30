---
name: quiz-me
description: Run an adaptive one-question-at-a-time quiz from the learner's notes and cards, then log each result.
---

# Quiz-me procedure

## Prepare a focused quiz

1. Read `_global/profile.md`, the set's `PLAN.md`, and the note or topic in the learner's request.
2. Read relevant cards when available. Use them as evidence of intended retrievals, not as a script that must be recited word for word.
3. Choose a starting question at the plan's current level. Prefer application or explanation over trivia, while keeping one clear grading target.
4. Keep the answer and grading criteria private until the learner responds.

If no topic is named, select the current note or `next_action`; if neither identifies a useful scope, ask the learner to choose one.

## Run one turn at a time

Ask exactly one question, then stop and wait. Do not bundle a quiz into a numbered worksheet and do not answer your own question.

Bad:

```text
1. Define rank. 2. Compute this rank. 3. Explain nullity. Here are the answers...
```

Better:

```text
For $A=\begin{bmatrix}1&2\\2&4\end{bmatrix}$, what is $\operatorname{rank}(A)$, and what feature of the rows tells you?
```

Although the better prompt asks for a result and its evidence, it has one grading target: recognizing the single independent row. Avoid unrelated subquestions.

## Grade consistently

Compare meaning, not exact wording, against the note and sources.

- `right`: the central claim and required reasoning are correct; harmless notation or wording differences are acceptable.
- `partial`: the core idea is present but a necessary condition, step, or distinction is missing.
- `wrong`: the central claim is absent, contradicted, guessed without the requested reasoning, or based on a different concept.

Reply with the verdict and one sentence explaining why. Then give the correct answer or missing piece in the smallest useful form. Cite a registered source when resolving a source-grounded disagreement.

```text
Partial — you recognized the rows are dependent, but rank is 1 rather than 0 because one row is nonzero.
```

Do not inflate a verdict to be encouraging, and do not mark a sound equivalent answer wrong because it differs from stored card text.

## Log every answered question

After grading, call:

```json
{"topic":"matrix rank","question":"For A=..., what is rank(A), and why?","verdict":"partial","gap":"Treated dependent rows as if every row were zero."}
```

Use `record_quiz_result` once per answered question. Include the set-relative `note` path when known. The tool keeps `log/quiz.md`, also appends to `log/practice.jsonl`, and updates `practice/weak-spots.json` so chat quiz results feed Today practice suggestions. Keep `gap` short and diagnostic; omit it for a clean correct response unless a useful hesitation was evident. Never include secrets or sensitive profile details.

If the tool is unavailable, continue the quiz and show the proposed log payload once. State that the result was not persisted; do not claim to have appended `log/quiz.md` and do not use a generic edit tool as a substitute.

## Adapt the next question

- After `right`, move one step harder: apply the idea, contrast a near neighbor, or remove a cue.
- After `partial`, stay on the concept with a narrower question targeting the missing condition.
- After `wrong`, give the one-line correction, step back to a prerequisite or concrete example, and then ask a smaller question.
- After repeated difficulty, change representation rather than repeating the same wording.
- Periodically revisit an earlier miss after intervening questions, without announcing the answer through the cue.

Ask the next question only after the feedback and log action. Continue one question at a time until the learner stops or the requested scope is covered; then summarize strengths and the one or two most important gaps.

## Offer changes; never apply them silently

After a `partial` or `wrong` result, offer one concrete follow-up when useful:

- add a draft card for the missing retrieval;
- revise an ambiguous existing card; or
- make a surgical clarification to the note.

Name the proposed target and change, then wait for explicit approval. A quiz request authorizes practice and logging, not card or note edits. Even after approval, preserve existing card ids and keep new cards in `draft`.
