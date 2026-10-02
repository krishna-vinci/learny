# Chapter Visuals implementation report — 2026-10-02

Implemented locally on `codex/visuals`. No commits, pushes, branches, subagents, orchestration skills, new dependencies, real provider calls, paid smoke tests or full-suite test runs. `AGENT_MEMORY.md`, `.env*`, `.claude/` and live `data/` were not edited. The temporary server used its own copied tree, faux agents, an admin supplied through env and port 3197; it has been stopped using its saved PID.

## Design decisions

- **D31 supersedes D29's inline-artifact placement.** Reading / Visuals tabs separate prose from interactive HTML. YouTube stays inline as passive, click-to-load media, retaining the merged robustness changes. Static figures, Mermaid and data charts stay near their explanations.
- The chapter's standalone `::artifact{src="…" poster="…" title="…"}` leaf declarations are its ordered file-based attachment registry. New declarations go at the end, without a registry heading. Existing declarations among paragraphs move through rendering alone; no data rewrite, frontmatter schema, manifest, route or database change. Repeated resolved HTML paths are deduplicated; invalid references remain visible as unavailable entries in Visuals. Fenced/indented examples remain code. Author declarations outside lists/quotes/callouts.
- Visuals uses the available reader width and a vertical list with titles, posters and Run; canvases use 65svh (minimum 20rem). It has empty, loading, retry and offline states. Sticky view controls remain reachable while scrolling. `?view=visuals` supports chapter pointers and browser Back. Inactive panels unmount, stopping hidden media; reading scroll/highlights are restored. Browser scroll anchoring is disabled in the reader to avoid lazy media shifting the restored position.
- Sandboxing stays exactly `allow-scripts`, without same-origin, with a first-document CSP and no-referrer. CSP now explicitly denies connections, frames, objects, base-URL changes and forms, in addition to the existing default deny policy. The component also validates its direct props before fetching. No artifact HTML is fetched before Run.
- **The existing Typst book is updated:** each chapter appends “Visuals in Studium,” with one available static poster, title and a pointer to that chapter's Visuals tab. Missing posters become text pointers; invalid references become unavailable text. HTML is neither read nor executed. A textual pointer avoids inventing a deployment-specific URL. The existing Lua filter already handles these local images; it needed no changes.
- The diff is organized into three reviewable pieces: attachment/PDF plumbing; reader UX/sandbox; skills/docs. They are one uncommitted diff, not separate commits.

## Changed files

- `shared/src/media.ts`: chapter attachment metadata, declaration collection, deduplication and clean reading body.
- `shared/src/media.test.ts`: order, legacy placement, code examples, invalid paths and duplicates.
- `server/src/jobs/book-media.ts`: collect visual fallbacks at chapter end and copy static posters only.
- `server/src/jobs/book-job.test.ts`: fallback placement, missing posters, deduplication, inert examples and real artifact-poster PDF compilation.
- `web/src/components/Reader/Reader.tsx`: sticky Reading/Visuals tabs, query navigation, full reader width, scroll restoration and immediate inactive-panel hiding.
- `web/src/components/Reader/ChapterVisuals.tsx`: ordered visual list, unavailable entries, canvas skeleton and empty return action.
- `web/src/components/Reader/ChapterVisuals.test.tsx`: tab lifecycle, browser Back, saved reading position, direct links and empty state.
- `web/src/components/Reader/ArtifactBlock.tsx`: usable viewport-height canvas, direct-prop validation, stronger CSP and loading skeleton.
- `web/src/components/Reader/MarkdownView.tsx`: remove interactive artifact instantiation from Markdown prose.
- `web/src/components/Reader/Reader.test.tsx`: move artifact tests to Visuals and cover hostile CSP, strict sandbox, no-referrer and no inline execution.
- `skills/media-authoring/SKILL.md`: full-canvas HTML/poster authoring, chapter attachment procedure and book behavior.
- `skills/note-authoring/SKILL.md`: use chapter Visuals for interactive HTML and preserve references.
- `skills/draft-chapter/SKILL.md`: append attachment declarations rather than inline simulations.
- `skills/evolve-note/SKILL.md`: preserve attachments during surgical edits and follow the new authoring procedure.
- `skills/.defaults-history.json`: append the four new default skill hashes, retaining previous hashes.
- `docs/decisions/LOG.md`: D31 explicitly supersedes D29's inline artifact web/book placement.
- `docs/STUDY_TREE.md`: chapter attachment registry and unchanged file/path contract.
- `docs/UI.md`: tabs, loading/empty/error/mobile behavior, strict sandbox and chapter-end PDF fallbacks; align table/footnote video description with merged behavior.
- `docs/DEPLOY.md`: record Visuals placement and explicit CSP restrictions for simulations.
- `docs/plans/2026-10-02-chapter-visuals.md`: local design and three implementation pieces.
- `docs/plans/2026-10-02-chapter-visuals-report.md`: this report and memory log.

## Tests and checks

Final scoped results: **105 tests passed, 0 failed; 1 opt-in real YouTube audit skipped**. The new visual behavior has seven focused test additions plus extensions; existing reader/video and real book coverage also ran.

| Exact command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | Pass; lockfile unchanged. |
| `pnpm --filter @studium/shared exec vitest run src/media.test.ts` | 45 passed, 0 failed. |
| `pnpm --filter @studium/server exec vitest run src/jobs/book-job.test.ts` | 17 passed, 0 failed; real Pandoc/Typst checks ran. |
| `pnpm --filter @studium/web exec vitest run src/components/Reader` | 43 passed, 0 failed, 1 opt-in audit skipped. |
| `pnpm --filter @studium/web exec vitest run src/components/Reader/ChapterVisuals.test.tsx` | 2 passed, 0 failed (also included in the final Reader run). |
| `pnpm --filter @studium/server exec vitest run src/jobs/book-job.test.ts -t 'copies confined SVG and PNG'` | 1 passed, 0 failed, 16 unselected (also included in the final book run). |
| `pnpm --filter @studium/shared exec tsc --noEmit` | Pass, 0 errors. |
| `pnpm --filter @studium/server exec tsc --noEmit` | Pass, 0 errors. |
| `pnpm --filter @studium/web exec tsc --noEmit` | Pass, 0 errors. |
| `pnpm --filter @studium/web build` | Pass; existing large lazy-chunk warnings remain. |
| `node scripts/skill-history.mjs` | Pass; four default histories updated. |
| `git diff --check` | Pass. |

Changed-file Biome command, **11 files passed, 0 failures**:

```sh
rtk proxy pnpm exec biome check shared/src/media.ts shared/src/media.test.ts server/src/jobs/book-media.ts server/src/jobs/book-job.test.ts web/src/components/Reader/Reader.tsx web/src/components/Reader/MarkdownView.tsx web/src/components/Reader/ArtifactBlock.tsx web/src/components/Reader/ChapterVisuals.tsx web/src/components/Reader/Reader.test.tsx web/src/components/Reader/ChapterVisuals.test.tsx skills/.defaults-history.json
```

Biome initially flagged an index key for stateless unavailable entries; an explained suppression is limited to those entries. It also formatted only changed files. Browser iteration exposed and fixed the reader's 74px scroll-anchor displacement after lazy player loading. Early browser harness attempts needed a correct installed Puppeteer entrypoint, waiting for PWA takeover, frame-safe theme setup, isolated auth contexts and waiting for React panel changes; final results below come from a complete successful run.

## Browser and actual book checks

```sh
node /tmp/studium-visuals-safvAt/browser.mjs /tmp/studium-visuals-safvAt
pnpm --filter @studium/server exec tsx /tmp/studium-visuals-safvAt/book.mts
pdftotext /tmp/studium-visuals-safvAt/polymers.pdf /tmp/studium-visuals-safvAt/polymers.txt
pdftoppm -f 10 -l 10 -scale-to 1300 -png -singlefile /tmp/studium-visuals-safvAt/polymers.pdf /tmp/studium-visuals-safvAt/shots/book-visuals
```

Chrome/Puppeteer used real clicks inside and outside iframes, real wheel input, and keyboard input. Test files were copied from the live polymer chapter/HTML/poster into `/tmp/studium-visuals-safvAt`; extra probe/missing/invalid/empty fixtures were created only in that temporary tree. External video navigation was intercepted after checking the correct nocookie URL, so the check made no actual YouTube request.

| Viewport | Theme | Passed | Failed | Uncaught page errors |
| --- | --- | --- | --- | --- |
| 390×844 | Light | 32 | 0 | 0 |
| 390×844 | Dark | 32 | 0 | 0 |
| 1440×900 | Light | 32 | 0 | 0 |
| 1440×900 | Dark | 32 | 0 | 0 |

**128 browser assertions passed, 0 failed.** Verified: real-note artifact discovery; no inline iframe or pre-Run HTML fetch; full available width and usable canvas height; original animation controls; full-screen enter/exit; inactive frame teardown; YouTube stays inline/click-to-load; invalid and empty entries; loading/retry/offline recovery; no horizontal overflow; scripts work while parent DOM and external fetch are blocked even with a permissive later CSP; sticky tab switching; browser Back; a real 460px reading position restores exactly; direct tab links and keyboard navigation. Expected console messages are the security probe's CSP rejection and missing-file 404s.

The real copied-polymer PDF compiled successfully. Its page 10 was rendered and inspected: the static poster and pointer occur after the chapter's takeaways/bridge, in “Visuals in Studium.” Text-only pointers for the missing posters and unavailable reference also compiled.

Evidence remains in `/tmp/studium-visuals-safvAt/browser-results.json`, `shots/` and `polymers.pdf`. The temporary server and browsers have stopped.

## Not done / deviations / open questions

- No task blockers. No on-disk migration was necessary; the existing real standalone reference is handled without rewriting it.
- Kept the existing directive/file tools rather than adding frontmatter or an attachment API. New references are standalone chapter-level leaves; nested list/quote authoring is outside the recorded contract.
- WebKit/iPhone was not run on this host; all browser assertions used Chrome at both requested sizes/themes.
- The existing CSS full-screen portal behavior is retained. Moving into/out of that portal can restart an iframe; tab switches intentionally stop simulations. No persistent simulation-state protocol was added.
- No automatic poster renderer or deployment-specific PDF link was added; authored posters plus chapter pointers satisfy the chosen static contract.

## Five-line memory log

```text
2026-10-02 · chapter-visuals (Sol 6.1): D31 supersedes D29's inline-artifact placement; YouTube stays inline.
Reader.tsx/ChapterVisuals.tsx separate Reading and full-width Visuals; ArtifactBlock keeps strict CSP/sandbox and Run-only loading.
shared/media.ts collects standalone chapter declarations; legacy placement works without data rewrites; reading scroll anchoring is disabled.
book-media.ts appends chapter-end posters/pointers; media/note/draft/evolve skills and default hashes updated.
105 scoped tests + 128 real-click checks pass; real PDF inspected; WebKit untested; CSS fullscreen may restart frames; temp server stopped.
```
