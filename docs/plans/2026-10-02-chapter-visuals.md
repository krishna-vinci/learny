# Chapter visuals implementation plan

Goal: keep chapter reading free of interactive HTML while providing a dedicated, full-width Visuals view.

Design: retain standalone `::artifact{src="…" poster="…" title="…"}` leaf declarations as the chapter's file-based attachment registry. Author new declarations at the end of the chapter, without a visible registry heading. Existing declarations anywhere in prose are discovered in order and removed from the rendered reading body. Fenced examples remain code. Paths and sandboxing keep D29's confinement and CSP. Passive YouTube, static figures, Mermaid and data charts stay inline. No frontmatter schema, API, dependencies, storage migration or data writes are needed.

## 1. Attachment plumbing and book

- Add shared parsing for standalone artifact declarations, ordered metadata and clean reading body. Resolve HTML/posters with existing note-relative confinement; keep invalid entries visible as unavailable in Visuals. Ignore fenced/indented examples and deduplicate repeated HTML paths.
- Reuse parsing in the reader and book. Book preprocessing appends a chapter-end `Visuals in Studium` section, one static poster (when available), title and instruction to open that chapter's Visuals tab. No artifact HTML is read/executed; no deployment URL is invented. A missing poster degrades to text.
- Extend shared media tests and existing book tests for parsing, order, invalid paths, code examples, duplicates and static fallback placement. Run relevant shared consumers and server type checks.

## 2. Reader and sandbox

- Add sticky chapter Reading / Visuals controls. The count includes unavailable declarations; an empty tab explains the space and offers Return to reading.
- Keep Reading at the saved prose measure. Visuals uses the available reader width; a vertical list presents each title/poster and Run. The iframe uses a usable viewport-height canvas on phones rather than a short landscape aspect ratio.
- Unmount inactive panels so neither a simulation nor a YouTube player continues running invisibly. Restore saved highlights when Reading remounts. Preserve reading scroll separately and disable browser scroll anchoring in the reader to prevent lazy media from shifting restored positions. Query `view=visuals` allows browser back and shareable chapter pointers.
- Preserve lazy Run, first-document CSP, `sandbox="allow-scripts"`, no same-origin, no network, retry, offline and CSS full screen. Test strict sandbox, hostile CSP, no pre-run fetch, tab lifecycle and scroll behavior.
- Run Reader tests, web types and changed-file Biome. Build and check real clicks at 390×844 and 1440×900 in light and dark on a temporary copy of real notes, own server port, faux agents and admin from env.

## 3. Skills and docs

- Record D31 explicitly superseding D29's inline artifact placement. Update STUDY_TREE/UI and media-authoring/note-authoring/draft-chapter/evolve-note guidance: create self-contained files and posters, append declarations, give a learner action, no inline-height constraints.
- Refresh default skill hashes. Write a final report with design decisions, changed files, scoped command counts, browser results, deviations and a five-line memory log. No commits, pushes, AGENT_MEMORY changes, env edits or live-data writes.
