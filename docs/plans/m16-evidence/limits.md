# M16 media/source content and size limits — inventory before changes

Baseline `f7363752678ce1fc9c8136ef50758ce1802f3389`. `file:line` is the baseline
location; lines that shifted because of M16 edits are cited at their baseline value.
Rows are grouped by disposition.

## Removed — content-only caps

| # | Baseline file:line | Value | Why it existed | Disposition |
| --- | --- | --- | --- | --- |
| 1 | `server/src/ingest/figures.ts:160` | `ranked.slice(0, 12)` | Bound downloads per source capture | Removed; every non-decorative candidate is captured |
| 2 | `server/src/ingest/images.ts:54` | `if (images.length === 50) return images` | Cap discovered page images | Removed |
| 3 | `server/src/ingest/images.ts:118` | `if (images.length === 50) break` | Cap DOM-discovered images | Removed |
| 4 | `server/src/ingest/web.ts:93` | `.slice(0, 50)` | Cap readability-result images | Removed |
| 5 | `server/src/ingest/web.ts:148` | `.slice(0, 50)` | Cap Firecrawl-result images | Removed |
| 6 | `server/src/tree/media-brief.ts:132` | `lean.figures.slice(0, 6)` | First N figures into the prompt | Removed; relevance ranking + byte budget |
| 7 | `server/src/tree/media-brief.ts:139` | `lean.tables.slice(0, 2)` | First N tables into the prompt | Removed; relevance ranking + byte budget |
| 8 | `server/src/jobs/media-plan.ts:90` | `figures.slice(0, 24)` into the stored brief | First N into the stored brief | Removed; the 5 KB brief decides |
| 9 | `server/src/jobs/media-plan.ts:60` | `tables … .slice(0, 8)` into the stored brief | First N into the stored brief | Removed |
| 10 | `server/src/ingest/figures.ts:147-158` | non-empty caption/alt/section **and** `score > 0` admission | Semantic-overlap admission gate | Removed; labels/overlap only order the queue |

## Raised

| # | Baseline file:line | Value | Why it existed | Disposition |
| --- | --- | --- | --- | --- |
| 11 | `server/src/ingest/image-bytes.ts:1` | `MAX_IMAGE_BYTES = 5 * 1024 * 1024` | One raster's byte cap | Raised to 25 MB |
| 12 | `server/src/ingest/figures.ts:201-202` | decoded `width < 64 \|\| height < 64` | Skip tiny images | Raised to "larger side < 100 px" (keeps 166×68 diagrams) |
| 13 | `server/src/ingest/images.ts:82` | attribute `width < 64 \|\| height < 64` | Skip tiny `<img>` | Raised to "both known dimensions < 100 px" |
| 14 | `server/src/tree/media-brief.ts:88` | `figures: z.array(Figure).max(24)` | Brief schema cap | Raised to `.max(400)` (a schema sanity bound, not a selection rule) |
| 15 | `server/src/tree/media-brief.ts:89` | `tables: z.array(Table).max(8)` | Brief schema cap | Raised to `.max(50)` |
| 16 | `server/src/tree/media.ts:88` | set assets quota `> 50 * 1024 * 1024` | Per-set media disk quota | Raised to 500 MB (`SET_ASSETS_QUOTA_BYTES`) |
| 17 | `server/src/agent/builtins/save-asset.ts:105,168` | `50 * 1024 * 1024` re-checks | Same quota | Raised with #16 |
| 18 | `server/src/agent/builtins/save-asset.ts:97` | `Image exceeds 5 MB` | One saved raster's cap | Raised via `MAX_IMAGE_BYTES` (25 MB) |
| 19 | `server/src/jobs/book-media.ts:63` | copied image `> 10 * 1024 * 1024` → text fallback | Bound PDF build inputs | Raised to 25 MB |

Nb.: the `.max(24)`/`.max(8)` brief schema caps were **raised to 400/50**, not
removed. A chapter whose source set yields more than 400 relevant figures would
still fail brief validation. The owner's requirement is "capture every content
figure", not "store every figure in the prompt": the schema bound is a sanity
ceiling, while the 5 KB prompt budget does the actual selection. If a source ever
exceeds it, the correct change is a higher explicit ceiling, not removing
validation.

## Kept — safety, prompt budget or planning contract

| # | Baseline file:line | Value | Why it exists | Disposition |
| --- | --- | --- | --- | --- |
| 20 | `server/src/tree/media-brief.ts:124` | `MAX_MEDIA_BRIEF_BYTES = 5120` | Prompt brief byte budget (D36) | Kept |
| 21 | `server/src/tree/media-brief.ts:58` | `evidence: … .max(2)` | At most two evidence passages per visual | Kept (prompt budget) |
| 22 | `server/src/tree/media-brief.ts:62` | `visuals: … .max(20)` (plus `media-plan` `slice(0, 20)`) | Interactive-visual plan contract (max two by `interactivePlanIssues`) | Kept |
| 23 | `server/src/tree/media-brief.ts:86` | `images: … .max(3)` | Plan allows 1–3 real-image slots | Kept |
| 24 | `server/src/tree/media-brief.ts:367` | fallback `(chapter.images ?? []).slice(0, 3)` | Mirrors the ≤3 slot contract | Kept |
| 25 | `server/src/tree/media-brief.ts:134-139` | `alt` 160, `caption` 300, `section` 120, `credit` 300, table `text` 400 chars | Prompt-budget truncation of stored fields (full text stays in `.evidence.json`) | Kept |
| 26 | `server/src/tree/media-brief.ts:140` | `video.reason` 300 chars | Prompt budget | Kept |
| 27 | `server/src/tree/media-brief.ts:145-148` | `image.reason` 180, `choice.title` 120, `choice.creator` 180 | Prompt-budget hints; full attribution resolved from the sidecar | Kept |
| 28 | `server/src/jobs/media-plan.ts:61` | table `text` `slice(0, 6000)` | Candidate table excerpt before ranking | Kept |
| 29 | `server/src/tree/media-brief.ts:116` | `Buffer.byteLength(text) > 100000` → brief rejected | Bounded read of a brief file | Kept |
| 30 | `server/src/tree/media-brief.ts:412` | `.slice(0, 200)` media files scanned | Bounded directory scan | Kept |
| 31 | `server/src/tree/media-brief.ts:422` | `stat.size > 2 * 1024 * 1024` | Bounded read of brief/evidence sidecars | Kept |
| 32 | `server/src/ingest/figures.ts:35` `readSourceFigures` | `/^lib-[a-z0-9][a-z0-9-]*$/` id guard, `figures/[a-f0-9]{24}\.(png|jpg|gif|webp)` path regex, malformed JSON → `[]` | Untrusted metadata must never supply permission | Kept |
| 33 | `server/src/ingest/images.ts:43,51,100` | HTTPS-only, no credentials, `.svg` rejected, `size < 2048` srcset filter, decoration regex | Unsafe or decorative page images | Kept |
| 34 | `server/src/ingest/figures.ts:144` | logo/icon/avatar/ad/tracking/pixel/banner/cookie regex | Decorative filter | Kept |
| 35 | `server/src/tree/media.ts:23` | SVG/HTML/visual JSON `> 300 * 1024` | Agent-authored artifacts stay small and sandbox-safe | Kept |
| 36 | `server/src/jobs/book-media.ts:160,186` | widget/sketch `> 300 * 1024` | Bounded sketch/widget book inputs | Kept |
| 37 | `server/src/jobs/book-media.ts:36` | YouTube thumbnail `> 5 * 1024 * 1024` | Thumbnail bound | Kept |
| 38 | `server/src/jobs/book-assemble.ts:50-51` | `BOOK_MAX_CHAPTERS = 200`, `BOOK_MAX_MARKDOWN_BYTES = 5_000_000` | Book assembly bound | Kept |
| 39 | `server/src/jobs/book-job.ts:84` | PDF output `> 50_000_000` | Compile output bound | Kept |
| 40 | `server/src/jobs/book-job.ts:51` | pandoc/typst `timeout: 120_000`, `maxBuffer: 1024 * 1024` | Process timeout/output bound | Kept |
| 41 | `server/src/ingest/pdf.ts:7,9` | `PDF_MAX_PAGES = 2000`, `PDF_MAX_TEXT_CHARS = 20_000_000` | Uploaded PDF bounds (memory/timeout) | Kept |
| 42 | `server/src/ingest/epub.ts:14,15,16` | `EPUB_MAX_UNCOMPRESSED_BYTES = 200 MB`, `EPUB_MAX_ENTRIES = 5000`, `EPUB_MAX_SPINE = 2000` | Zip-bomb/spine bounds | Kept |
| 43 | `server/src/ingest/docx.ts:15` | `DOCX_MAX_DOCUMENT_BYTES = 100 MB` | Uploaded docx bound | Kept |
| 44 | `server/src/ingest/mineru.ts:17` | `MINERU_MAX_BYTES = 64 MB` | MinerU upload bound | Kept |
| 45 | `server/src/ingest/split.ts:4,6` | `PARSED_MAX_BYTES = 50 KB`, `PART_TARGET_BYTES = 40 KB` | Splitting writes one `parsed.md` and part files; it keeps every byte and drops no content, so the cap protects file size, not coverage | Kept |
| 46 | `server/src/ingest/safe-fetch.ts:27,28,30` | timeout 15 s, `SAFE_FETCH_MAX_BYTES = 5 MB`, `INGEST_MAX_BYTES = 40 MB` | SSRF/timeout/size guard | Kept |
| 47 | `server/src/ingest/youtube.ts:228,249` | transcript `512 KB`, download `5 MB` | Video ingest bounds | Kept |
| 48 | `server/src/agent/builtins/save-asset.ts:101-102` | `> 6000×6000 px` | Decode/memory bound | Kept |
| 49 | `server/src/jobs/image-plan.ts:79,90` | `candidates.slice(0, 8)` | One image slot's candidate prompt budget | Kept |
| 50 | `server/src/jobs/image-plan.ts:20`, `server/src/jobs/plan-job.ts:52-53` | at most three `Image:` slots | Plan contract | Kept |
| 51 | `server/src/ingest/safe-fetch.ts:198` | HTTPS-only + private-range block | SSRF guard | Kept |
| 52 | `server/src/tree/media.ts:4` `IMAGE_MIME` | png/jpg/jpeg/gif/webp/svg allow-list | MIME safety | Kept |
| 53 | `server/src/tree/paths.ts:44,97` confinement | realpath/no-symlink | Path safety | Kept |

## Relevance ranking (replaces first-N)

The prompt brief ranks figures and tables by weighted term overlap against the
chapter title (2), scope (3), each visual intent (3) and the video intent (1),
then selects by new-concept coverage plus one quarter of total relevance.
Figures and tables compete together within 5 KB; candidates that cannot fit are
skipped so smaller useful evidence still competes. This keeps functional-group
evidence alongside drawing conventions instead of choosing repetitive figures. `collectChapterMediaCandidates` in `server/src/jobs/media-plan.ts` is the
single production helper that both the refinement job and the M16 selection trial
call.
