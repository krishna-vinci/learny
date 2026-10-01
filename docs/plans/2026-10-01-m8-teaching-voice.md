# M8 — Teaching voice, subject guides and a usable course plan

**Goal:** chapters read like a good teacher narrating a course (Zerodha Varsity is the bar): clear structure, warm voice, stories and examples, adapted to the subject. Nothing in a chapter looks like an AI prompt or an internal file. The learner can come back to the course plan any time and draft the remaining chapters, from the set page or by asking the tutor.

## Evidence (why)
Live chapters in `data/users/krishna/hyderabad-history/notes/` (read them; never edit them in your work — test on copies) show:
- Openings that echo the brief: "This chapter asks how a hill fort…", "This chapter asks how the Nizams…".
- Internal paths in footnotes: "parsed/01-part.md, lines 47–59", "parsed.md, lines 117–137".
- Operator-style lines: "Treat the diagrams as orientation sketches…", a table column named "Prompt".
- One math-shaped template for every subject. `skills/draft-chapter/SKILL.md` asks for `:::theorem` and "fully worked calculations"; there is no voice, narrative or subject guidance anywhere.
- SuperMemo's 20 rules exist only for cards (`skills/critique-cards/references/twenty-rules.md`); the note-level rules (1–3, 6, 13–16, 19, 20) are not encoded.
- Course plan: after the first batch there's no place to see all planned chapters and draft the rest; the set home only offers one "next step" or a blank "New chapter". `curriculum.md` ticks are wrong (Hyderabad: 04 and 06 exist but are unticked).

## Fixed decisions
- **V1 Voice: "warm teacher" (Varsity-like).** "We" and "you", conversational but precise, story or real situation first, concrete before abstract, short paragraphs (≤ 4 sentences), one idea per `##` section, analogies the learner already knows, no filler, no hype. The teacher never mentions briefs, prompts, sources-as-files, "this chapter asks", tools, or the AI itself.
- **V2 Chapter shape** (flexible, not a form): hook (a question, story or situation, 2–4 sentences) → why it matters → concept sections, each with an example → (subject-specific blocks) → "Check yourself" (3–5 retrieval questions, answers in a collapsed `:::deeper{title="Answers"}`) → "Key takeaways" (3–6 bullets) → one-line bridge to the next chapter.
- **V3 Subjects** (`PLAN.md` frontmatter `subject:`): `math`, `science` (physics, chemistry, biology, earth/medicine), `technology` (programming, computing, AI/ML, engineering, systems), `history` (and other humanities/social sciences), `finance` (economics, markets, business), `language`, `practical` (skills, crafts, health/fitness routines), `general` (fallback). One reference guide per subject.
- **V4 Footnotes are for people:** `[^src:id#anchor]: <Author/Org>, *<Title>*, <section or page>.` Never file names, paths, line numbers or tool names.
- **V5 Rewrite** is a job (`rewrite-chapter`) that keeps facts, citations, figures and the file path, and rewrites voice and structure; it goes through the checker like a draft revision. Existing chapters change only when the learner asks.
- **V6 Course plan state is derived from the notes**, not only the `[x]` ticks: a planned chapter is *drafted* when a note matches it (existing `chapterExists`), *checked* when that note's status is `checked`/later, otherwise *planned*. Fix ticking so `curriculum.md` matches (tick when the draft is committed, not only after the check).

## Part 1 — Teaching philosophy (docs + skills)
1. `docs/TEACHING.md` (new, concise, ≤ 250 lines): V1, V2, V4; the learning principles we commit to and where each lives — all **20 SuperMemo rules** mapped (chapter / card / both) with one line each on how Studium applies it, plus retrieval practice, spacing, elaboration, dual coding (M7 visuals), worked examples and faded examples, interleaving (practice), desirable difficulty; the "never in a chapter" list (from Evidence). Link it from `docs/PRINCIPLES.md` and `AGENTS.md`' read list.
2. `skills/note-authoring/SKILL.md`: a short "Voice" section (V1, the never-list, V4 with a correct and an incorrect footnote) and a pointer to the teaching reference. Keep the file short; details go to references.
3. `skills/draft-chapter/SKILL.md`: replace the math-only outline with V2; "load `references/subject-<subject>.md` for this plan's subject (`general` if missing)"; keep all existing grounding/citation rules and the media-authoring pointer.
4. `skills/draft-chapter/references/subject-<name>.md` for every V3 subject, each ≤ 80 lines: what a great chapter in this subject does, its blocks and callouts, typical examples, common pitfalls, and one tiny model excerpt (≤ 12 lines) in the V1 voice. Highlights:
   - math: intuition → picture → formal statement (`:::definition`/`:::theorem`) → worked example → faded example.
   - science: phenomenon first → model/mechanism → evidence/experiment → equations only when they explain → misconceptions → real-world application.
   - technology: problem the tool solves → mental model/diagram → minimal runnable code (version-checked via context7, as today) → common mistakes/debugging → when not to use it.
   - history: narrative with people, places and dates → causes and consequences → multiple perspectives and contested accounts → timeline (table or chart) → "what you can still see today" when relevant.
   - finance: a real situation with real numbers (Indian context when the plan suggests it) → concept → worked calculation → risks and misconceptions → practical checklist.
   - language: situation → phrases in context → pattern → practice dialogue → pronunciation/notes.
   - practical: goal → steps → common mistakes → safety → a practice routine.
   - general: the V2 shape with the closest of the above.
5. `skills/plan-set/SKILL.md` (the outliner): choose `subject:` from V3 and write it to `PLAN.md`; the curriculum chapter scopes describe content for the learner, not instructions.
6. `skills/critique-cards/…` unchanged; add one line in `docs/TEACHING.md` pointing to it for the card rules.
7. `shared/` `PlanFrontmatter`: optional `subject` enum (V3); unknown → treat as `general` (never fail parsing old plans).
8. Register skill changes via `scripts/skill-history.mjs` (format the JSON with biome afterwards).

## Part 2 — Checker checks teaching quality
1. `skills/fact-check/SKILL.md`: add a "Teaching quality" section to the report with these blockers: brief echo / "this chapter asks"; internal paths, line numbers or tool names in text or footnotes; text addressed to an AI or operator; missing "Check yourself" or "Key takeaways"; sections that are walls of text (> 6 sentences per paragraph). Non-blocking notes for weaker voice issues.
2. A cheap server-side lint (no model): `server/src/agent/note-lint.ts` run on agent writes of `<set>/notes/*.md` (alongside the M7 media warnings, i.e. returned as tool **warnings**, not errors) for: `/\b(parsed(\/[\w-]+)?\.md|source\.md|lines? \d+[–-]\d+)\b/` in footnotes or text, `/^This chapter asks\b/m`, `/\b(as an AI|the brief|the prompt)\b/i`. The checker treats remaining lint hits as blockers. Tests.

## Part 3 — Rewrite in the teaching voice
1. Job kind `rewrite-chapter` `{set, path}`: AI-gated like drafts; the drafter role rewrites the existing note in place (pinned to that path, plus assets/artifacts as in drafts) following the skills, keeping facts, citations (fixing footnote text to V4), figures and frontmatter (status back to `draft`), then the checker runs exactly as in a draft revision. Commit as drafter/checker like drafts. Reuse `draft-job.ts` code paths; don't duplicate the checker loop.
2. Route: `POST /api/jobs {kind:"rewrite-chapter", set, path}` (same validation style as other kinds). Job icon/label in the web job lists ("Rewriting chapter").
3. Web: a "Rewrite in teaching voice" item in the note's actions menu (reader overflow menu — base-ui `Menu.Item` uses `onClick`), with a one-line confirm explaining it keeps facts and sources and can be undone from History. Also on the set's Course plan rows for drafted chapters (overflow).
4. Tests: rewrite job pins the path, keeps citations (stubbed model), runs the checker, error when the note doesn't exist.

## Part 4 — Course plan you can come back to
1. Server: `GET /api/sets/:set/course` → `{subject, chapters:[{order, title, scope, prerequisites, state: "planned"|"drafting"|"drafted"|"checked", path?: string, jobId?: string}]}` from `curriculum.md` + notes + active jobs (V6). Tests.
2. Fix ticking (V6) in `tickCurriculum` / the draft job: tick when the drafter's commit lands. Add a one-off repair on read: `course` derives state from notes regardless of ticks; when it finds drafted-but-unticked rows, it doesn't rewrite the file (read-only route), but the next draft job's tick pass fixes all mismatches for that set. Test.
3. Web: a **"Course plan"** section on the set home (`web/src/pages/SetHomePage.tsx`), below the primary next step:
   - each chapter row: number, title, one-line scope, a state badge; drafted/checked rows link to the note; planned rows have **Draft**; drafting rows show progress.
   - **Draft next 3** (the next 3 planned chapters in order whose prerequisites are drafted; disabled with a reason if none) and **Re-plan** (opens the existing plan-with-agent flow prefilled).
   - collapsed after 6 rows with "Show all N".
   - phone first (390px), 44px targets, all 5 themes; follows `docs/UX.md` rules (one primary action per screen — the next step stays primary; Course plan actions are secondary).
4. Tutor: the tutor prompt (`buildTutorPrompt`) includes a compact course summary (titles + states, ≤ 30 lines) and the instruction that it can start `draft-chapter` (and `rewrite-chapter`) jobs with `start_job` when the learner asks ("draft the next chapter", "draft chapters 5 to 7"). Make sure `start_job` allows both kinds (check `CHAT_JOB_TOOLS` handling); proposals show in chat as today.
5. First-use hint (the existing one-hint-at-a-time mechanism from M6): on the Course plan section, "Tip: you can also ask the tutor to draft the next chapters."
6. Web tests: course section renders states, Draft calls `POST /api/jobs` with the chapter's title/brief, Draft next 3 picks the right rows, prerequisites gate.

## Rules
- Read `AGENTS.md`, `AGENT_MEMORY.md`, `docs/PRINCIPLES.md`, `docs/decisions/LOG.md`, `docs/UX.md` first. Add a decision entry "D30 — Teaching voice" (V1–V6) to the log.
- No new dependencies. Stub models in tests; never call real providers.
- Browser check on a test server (temp copy of `examples/sample-set` plus a copy of the Hyderabad set if useful, admin from env, faux model, your own port): the Course plan at 390×844 and 1440×900, light and dark; the Rewrite menu item; the tutor prompt includes the course summary (log or test).
- If a step doesn't fit the real code, stop that item and report file:line; continue with the rest.

## Verification
```
pnpm --filter @studium/server exec vitest run <touched server test files> src/tree/
pnpm --filter @studium/web exec vitest run <touched web test files>
pnpm --filter @studium/shared exec vitest run <touched shared test files>
pnpm --filter @studium/server exec tsc --noEmit
pnpm --filter @studium/web exec tsc --noEmit
pnpm --filter @studium/shared exec tsc --noEmit
pnpm --filter @studium/web build
rtk proxy pnpm exec biome check <changed files>
```
