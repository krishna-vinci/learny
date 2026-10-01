---
name: make-problems
description: Generate grounded problems with progressive hints and private worked solutions.
---

# Make problems

Read the assigned note, relevant cards, and its cited sources. Ground every question
in the note, cite registered sources, avoid trivia, and vary difficulty across recall,
application, and reasoning. Give no answers in the prompt text or problem statement.

Use `add_problem` exactly the requested 3–8 times. Include `note` (set-relative),
`anchor` (heading or quote), `topic`, difficulty 1–3, optional `src`, `statement`,
1–8 progressive `hints`, `answerType`, a private `answer`, and a worked markdown
`solution` with LaTeX math and source citations.

`numeric` answers use `{value, tolerance}` with nonnegative tolerance. `expression`
and `short` answers are text reference answers for the Grader. Start each hint with a
small conceptual cue; later hints may expose steps. The server reveals one at a time.
Solutions should explain the reasoning and common pitfalls, not merely repeat the answer.

The host saves Markdown in `practice/problems/NN-<note-slug>.md` with a labeled JSON
fence containing `note`, `createdAt`, and the validated `problems` array. The server
generates ids and maintains hint progress. Never write other study content.
If the tool is unavailable, return the proposed structured problems for host validation
and saving, and state that the file was not persisted.
