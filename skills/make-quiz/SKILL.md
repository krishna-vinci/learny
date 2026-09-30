---
name: make-quiz
description: Generate a source-grounded practice quiz with private answers and varied retrieval types.
---

# Make a quiz

Read the assigned notes, relevant cards, and the sources the notes cite. Ground every
question in the note, cite registered source ids, avoid trivia, and vary difficulty
(1 recall, 2 application, 3 reasoning) unless the learner selected a difficulty.
Never put answers, explanations, or answer cues in the prompt text.

Use `add_practice_question` once per question, exactly the requested count (5–20).
The server generates permanent ids and stores the quiz at `practice/quizzes/<id>.json`.
Supply a set-relative `note`, its heading or quote as `anchor`, `topic`, `difficulty`,
`prompt`, private `answer` and `explanation`, and an optional registered `src` id.

- `mcq`: four distinct option strings; `answer` is exactly one option string.
- `multi`: 2–8 distinct options; `answer` is an array of all correct option strings.
- `numeric`: `answer` is `{value: number, tolerance: nonnegative number}`; optional `unit`.
- `cloze`: exactly one blank in the prompt, with its text as `answer`.
- `short`: a concise grading reference as `answer`; assess meaning, not verbatim recall.

Respect the requested notes, topics, types, and difficulty. Use realistic distractors
and useful explanations with citations. Keep irrelevant optional fields absent or blank.
When the tool is unavailable, return the proposed structured questions for a host to
validate and save. State that nothing was persisted. Never write notes, cards, or sources.
