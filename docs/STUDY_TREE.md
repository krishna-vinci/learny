# Study Tree — Data Contract

The study tree is the product (P1). It is the API between agents, the app, and any
external harness. Locked 2026-09-28 (D14).

## Layout

```
study/                          # git repo; app auto-commits after agent mutations
├── .gitignore                  # **/original.*, */chats/, .cache/
├── _global/
│   ├── profile.md              # learner profile, asked once, reused by all sets
│   ├── config.yaml             # role→model map, feature toggles (no secrets; secrets = env)
│   ├── mcp.json                # MCP server config
│   └── skills/<name>/          # Agent Skills: SKILL.md + references/ + assets/
├── library/                    # shared sources, parsed once, reused by any set
│   └── <src-id>/
│       ├── source.md           # metadata frontmatter + summary/TOC body
│       ├── original.<ext>      # gitignored; re-fetchable
│       ├── parsed.md           # extracted text (> ~50 KB: parsed/NN-slug.md, split by heading)
│       └── assets/             # extracted figures/images
├── <set-slug>/                 # one learning goal
│   ├── PLAN.md                 # frontmatter + goal/scope (user-approved)
│   ├── curriculum.md           # syllabus + prereq tree + progress checkboxes
│   ├── notes/NN-slug.md        # chapters
│   ├── cards/NN-slug.md        # cards for chapter NN
│   ├── highlights/<note-file>.json  # learner highlights, one file per note
│   ├── exercises/
│   ├── artifacts/              # JS sims, diagrams
│   ├── chats/<id>.jsonl        # Pi sessions; gitignored
│   └── log/
│       ├── decisions.md        # append-only why-ledger
│       ├── requests.md         # async wish backlog
│       └── retention.md        # Anki stats pulls
└── .cache/                     # disposable index; gitignored
```

Names: set slugs and file slugs are kebab-case. Names starting with `_` or `.` and the
name `library` are reserved at the root.

## Source ids

`lib-<author>-<short-title>` (e.g. `lib-strang-la`). Unique within `library/`.
Cited from notes and cards as `[^src:<id>]` (optionally `[^src:<id>#p42]` for a location).

## `library/<src-id>/source.md`

```md
---
id: lib-strang-la
title: Introduction to Linear Algebra
authors: [Gilbert Strang]
type: book            # book | paper | article | video | notes | other
url: https://…        # optional
credibility: A        # tier, defined by the source-credibility skill
parse_tier: basic     # basic | mineru | firecrawl | transcript
sha256: …             # of original; detects changed files
added: 2026-09-28
---

Summary and table of contents (agents read this before parsed.md).
```

## `<set>/PLAN.md`

```md
---
title: Linear algebra for ML
status: active        # draft | active | paused | done
level: 2              # current level; changes recorded in log/decisions.md
deadline: 2026-12-15
sources: [lib-strang-la, lib-3b1b-essence]
next_action: Review chapter 3 cards
---

## Goal
## Scope — in
## Scope — out
```

## Notes: `<set>/notes/NN-slug.md`

Markdown (D6): GFM, `$…$` / `$$…$$` math, mermaid, directives
(`:::definition`, `:::theorem`, `:::example`, `:::deeper`). `:::deeper` blocks render
collapsed — one file serves multiple depths. A directive may carry a title attribute,
`:::definition{title="Rank"}`: callouts show it after the label ("DEFINITION · Rank") and
`:::deeper{title="Why it works"}` uses it as the summary text instead of "Deeper". The title is
plain text (rendered escaped, at most 200 characters); other attributes are ignored.

```md
---
title: Singular Value Decomposition
order: 3
status: accepted      # draft | checked | accepted
sources: [lib-strang-la]
---
```

## Cards: `<set>/cards/NN-slug.md`

```md
---
deck: Linear Algebra::SVD
note: notes/03-svd.md
---

## c-8f3a
<!-- status: approved · anki: 1712345678 · src: lib-strang-la -->
**Q:** …
**A:** …
```

- Card id: `c-<4+ hex>`, stable forever; maps to the Anki note id once exported.
- Status: `draft → approved → exported`, or `rejected` (with `critic:` reason).
- Only `approved`/`exported` cards leave the app (P4).

## Chats

`<set>/chats/<id>.jsonl` in Pi session format. Optional anchor (a note or source) is
stored in session metadata; an optional quoted passage from that anchor is part of the
learner's message. Chat listing is derived (cache), never hand-maintained.

## Highlights

`<set>/highlights/<note-file>.json` holds one JSON array per note (for
`notes/03-svd.md` the file is `highlights/03-svd.md.json`):

```json
[{ "id": "h-8f3a1b2c", "quote": "…", "prefix": "…", "suffix": "…", "color": "yellow", "note": "…", "createdAt": "…" }]
```

- Anchored by `quote` plus up to 64 chars of `prefix`/`suffix` context, so highlights
  survive small edits. `quote` ≤ 2000 chars, `note` (an optional learner annotation) ≤
  1000 chars, at most 500 highlights per note.
- `color` is one of `yellow`, `green`, `blue`, `pink`. `id` is `h-<8 hex>`.
- Written by the app only, through the per-file lock, and committed as `user:`.

## Git

Tracked: everything except originals, chats and `.cache/`. Commits are made by the app
after each agent mutation, with the agent role and a short summary as the message.

## Media (D29, D31)

`<set>/assets/**` holds saved raster images, SVG figures and image-credit sidecars;
`<set>/artifacts/**` holds self-contained HTML and static poster SVGs. Both are
tracked in git. Credit `assets/<name>.json` stores
`{url, pageUrl?, sourceId?, alt, license?, savedAt}`.
Paths in notes are note-relative: `notes/03-svd.md` embeds
`![Projection](../assets/projection.svg)`. Resolution stays within the same set.

Web sources have `library/<id>/images.json` with up to 50
`{url, alt, nearHeading}` candidates collected before cleaning. YouTube sources have
`thumb.jpg` when downloading succeeds and `<!-- t:<seconds> -->` at the start of
transcript paragraphs. Cite moments with `[^src:<id>#t843]` alongside page citations.

Media leaf directives use no space before attributes:
`::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=843 end=900}` and
`::artifact{src="../artifacts/demo.html" poster="../artifacts/demo.svg" title="Explore"}`.
Vega-Lite charts are `vega-lite` JSON fences with inline `data.values` only.
PNG, JPEG, GIF and WebP may be downloaded; SVG must be written by an agent. No AVIF.
See D29 for limits and web/book behavior. The files remain usable in Obsidian/GitHub:
local images render there; directives, HTML and chart specs stay readable as files.


### Chapter visual attachments (D31)

Standalone `::artifact{…}` leaf declarations associate HTML with the chapter that
contains them. Append new declarations at the end, after prose/footnotes, without
a registry heading. Do not nest them in lists, blockquotes or callouts; fenced and
indented examples are code. The existing `src`, optional `poster` and `title`
attributes are unchanged. No frontmatter field, index or sidecar is added.
The same file may be attached to several chapters; duplicate references within
one chapter yield one visual (first declaration wins). Order is declaration order.
Paths resolve relative to the chapter within its own set’s `artifacts/` folder.
Invalid references yield unavailable entries; missing files are retryable on Run.

The app collects attachments into a chapter Visuals view and omits declarations
from the reading body, including legacy declarations placed among paragraphs. No
on-disk migration is needed. Agents create HTML plus a static SVG poster with the
existing file tools and then append a declaration, preserving existing attachments
during edits. The existing book compiler appends poster/title/text pointers at the
chapter end; it never reads or executes interactive HTML. See D31 for behavior.
