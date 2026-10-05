# Teaching in Studium

A chapter should sound like a warm, precise teacher. We use Zerodha Varsity as
our voice benchmark: invite the learner into an idea, then help them use it.

## Voice

- Use “we” and “you” naturally. Be conversational, accurate and respectful.
- Open with a story, question or real situation (2–4 sentences), then explain why
  it matters. Concrete experience comes before abstract terminology.
- Keep paragraphs to four sentences or fewer and one idea per `##` section.
- Give each concept an example. Use analogies the learner already understands;
  explain where an analogy stops working. Never invent personal history.
- Cut filler, hype and ceremonial introductions. Optional depth belongs in `:::deeper`.

## Chapter shape

This is a flexible learning path, not a form to fill out:
hook → why it matters → concept sections with examples → subject-specific blocks
→ **Check yourself** → **Key takeaways** → a one-line bridge to the next chapter.

“Check yourself” contains 3–5 retrieval questions. Put answers in a collapsed
`:::deeper{title="Answers"}` block below them. Ask the learner to try before
opening it. “Key takeaways” has 3–6 short bullets, not a second chapter.

Choose the plan's subject guide in `skills/draft-chapter/references/subject-*.md`:
math, science, technology, history, philosophy, politics, law, economics, finance, language, practical, or general. Missing or unknown subjects use general.
A theorem and a calculation are useful in mathematics; they are not required in history.

## Contested topics

Present major viewpoints fairly, with attribution and their strongest arguments.
Separate established facts from interpretations and normative judgments. Date
time-sensitive claims and specify jurisdiction for law and policy. Never present
a political or moral judgment as fact. Fair treatment does not imply equal
evidential support: explain differences in evidence and scholarly consensus.
For politics, philosophy, law and economics, the independent checker treats
missing major relevant viewpoints, unattributed interpretations, undated volatile
claims and political/moral judgments stated as facts as blockers. Law chapters
are educational, not legal advice.

## Citations a person can use

Keep stable `[^src:id#anchor]` identifiers and cite registered sources. Write
footnote text as `<Author/Org>, *<Title>*, <section or page>`.

Correct: `[^src:lib-history#founding]: UNESCO, *History of the city*, Founding.`
Incorrect: `[^src:lib-history#founding]: parsed/01-part.md, lines 47–59.`

Never invent a locator. Preserve citation identifiers when rewriting, correcting
only their human-facing text. Tool reports may contain internal evidence locators;
chapters may not.

## Never in a chapter

Brief echoes (“this chapter asks”, “this chapter builds”, “the brief”, “the prompt”);
AI self-reference (“as an AI”); file names, paths, parsed line numbers and tool
names; instructions addressed to an AI or operator; “Treat the diagrams as
orientation sketches”; table headings such as “Prompt” when they mean a learner's
question. Give a figure an ordinary caption (“Conceptual map; not to scale”).
Sources are authors, publications and evidence, not internal files.

## Learning principles and where they live

These are design commitments, not promises of a particular learning outcome.
Chapters establish understanding; practice tests transfer; cards support recall.

| SuperMemo rule | Where | How Studium applies it |
| --- | --- | --- |
| 1. Understand before memorising | Both | Chapters explain and illustrate; cards require understood prerequisites. |
| 2. Learn the whole before its parts | Both | Course and chapter maps precede drilling isolated details. |
| 3. Build on basics | Both | Prerequisite-ordered curriculum and basic vocabulary precede refinements. |
| 4. Minimum information | Both | One idea per section; one small retrieval per card. |
| 5. Cloze deletion | Card | Blank one atomic target with an unambiguous cue. |
| 6. Use imagery | Both | M7 figures explain spatial relationships; cards use supported visual cues. |
| 7. Mnemonics | Both | Offer a compact aid for stubborn recall after explaining the idea. |
| 8. Graphic deletion | Card | Occlusion is deferred; never imply unsupported image-card functionality. |
| 9. Avoid sets | Both | Explain meaningful categories; avoid “name every member” retrievals. |
| 10. Avoid enumerations | Both | Chunk processes into meaningful steps and test small links. |
| 11. Combat interference | Both | Contrast confusable concepts; critic compares existing cards. |
| 12. Optimise wording | Both | Cut filler; precise questions reduce parsing effort. |
| 13. Refer to known memories | Both | Use mastered analogies and explicit links to prior chapters. |
| 14. Personalise examples | Both | Use supplied goals/profile context without invented learner history. |
| 15. Emotional salience | Both | Accurate, respectful stories make stakes concrete without hype. |
| 16. Context cues | Both | Supply domain/time/place so a concept or question has one meaning. |
| 17. Useful redundancy | Both | Revisit key ideas through different examples and atomic retrieval routes. |
| 18. Sources | Both | Stable registered citations accompany every source-grounded claim. |
| 19. Date volatile knowledge | Both | State edition, date, jurisdiction or checked software version. |
| 20. Prioritise | Both | Teach what unlocks the learner's goal; omit low-value trivia. |

The complete card diagnostics live in
`skills/critique-cards/references/twenty-rules.md`; the card critic enforces them.
The teaching reference is shipped with `note-authoring`; `draft-chapter` applies
subject guides and `fact-check` blocks teaching defects as well as factual errors.

- **Retrieval practice:** chapter Check yourself questions and M5 quizzes/teach-back
  ask for recall before displaying feedback or answers.
- **Spacing:** Anki owns card scheduling; practice weak spots carry revisit dates.
  Chapters link back to earlier ideas; Studium does not add its own SRS scheduler.
- **Elaboration:** explain why, compare alternatives and connect new ideas to known ones.
- **Dual coding:** M7 figures, timelines and diagrams complement words when they explain
  a relationship; decoration is not evidence.
- **Worked and faded examples:** show reasoning first, then remove selected steps so
  the learner completes them. Adapt the task to the subject, not always arithmetic.
- **Interleaving:** practice mixes previously learned problem/concept types and asks
  the learner to choose the appropriate method.
- **Desirable difficulty:** use manageable, prerequisite-aware retrieval and transfer,
  with feedback; confusing prose and unsupported leaps are not productive difficulty.

## Existing material and review

Existing chapters change only at the learner's request. `rewrite-chapter` keeps
facts, citations, figures, frontmatter and path, resets status to draft, and uses
the same checker/revision loop as a new draft. History provides undo.
Course state comes from matching notes and active jobs, not checkbox ticks alone.
A committed draft ticks the curriculum even if checking later fails; a subsequent
draft's tick pass repairs the set's other stale ticks. Course reads never mutate it.
