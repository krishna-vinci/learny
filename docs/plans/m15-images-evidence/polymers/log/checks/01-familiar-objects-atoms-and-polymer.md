# Check: notes/01-familiar-objects-atoms-and-polymer.md

## Summary

Two blockers and one minor issue remain. The note now answers the previously unanswered eight-proton retrieval prompt, and the particle visual no longer asserts unsupported compound/mixture labels. However, the chapter still defers compound-versus-mixture teaching despite that being an explicit chapter objective, and the Khan Academy video remains a full-length Watch link rather than a verified bounded transcript-linked moment. Do not mark the note checked.

## Issues

### 1. Blocker — compound and mixture objective is deferred rather than taught

- **Claim:** The chapter will distinguish elements, atoms, molecules and mixtures across scales, and its planned visual will sort elements, compounds and mixtures.
- **Source:** The plan specifies this scope and visual. The note now says classification is “postponed” and its particle comparison only counts atoms/molecules. The registered evidence was inspected: `lib-libretexts-1-5-development-of-chemical/parsed.md#bonding-overview` distinguishes ionic and covalent bonding and discusses compounds/molecular compounds, but does not define or contrast compounds and mixtures; `lib-libretexts-5-8-polyatomic-molecules-water/parsed.md#water` teaches H₂O, and the Khan Academy `t0` transcript teaches element identity and atomic particles. None supplies the introductory compound-versus-mixture distinction needed for the planned lesson.
- **Verdict:** The note’s current particle-counting examples are factually sound and avoid assigning unsupported mixture/compound labels. The earlier claim that the visual teaches those labels is resolved. The planned learning outcome itself remains unmet.
- **Problem:** Deferring the distinction removes a named chapter objective rather than teaching it. The visual’s unavailable marker explains the evidence gap, but an evidence gap does not complete the requested curriculum.
- **Fix:** Add a registered introductory source that defines elements, compounds and mixtures, then explain the distinction and realize the planned sorting activity with answers. Otherwise revise the chapter’s scope and plan explicitly, not just the note’s exercise.

### 2. Blocker — selected video is not a bounded transcript-linked moment

- **Claim:** The Khan Academy video supports the paragraph on proton-defined element identity and atomic particles.
- **Source:** `lib-academy-elements-and-atoms-atoms-compounds/parsed.md#t0` explains that proton number defines an element and discusses protons, neutrons and electrons. This is semantically aligned with the paragraph immediately before the link.
- **Verdict:** Relevant video material is available at the transcript’s `t0` marker; no unrelated moment is used. The note links to the whole video from 0 seconds and says a short bounded segment is unavailable. No verified end marker or duration appears in the registered transcript.
- **Problem:** The media contract requires a bounded moment (no more than 180 seconds) placed after the paragraph it teaches, with the transcript citation. A start-only marker does not verify an endpoint, and the link does not realize the selected moment.
- **Fix:** Inspect for and use a real endpoint within 180 seconds of `t0`, then implement the bounded video moment with `[^src:lib-academy-elements-and-atoms-atoms-compounds#t0]` adjacent to the supported paragraph. Do not invent an ending time. If no endpoint can be verified, keep the video as an explicitly watch-only resource and do not cite it as evidence; that still would not satisfy a selected transcript-moment requirement.

### 3. Minor — cotton image credit has malformed creator text

- **Claim:** The cotton-boll image is credited to the National Archives and Records Administration and marked public domain.
- **Source:** `assets/cotton-bolls-2.json` records public-domain status and a credit string beginning “Unknown authorUnknown author or not provided U.S. National Archives and Records Administration.” The note repeats that string in the image title.
- **Verdict:** Public-domain status, source page and institutional source are supplied, but the duplicated/concatenated unknown-author text is a visible metadata artifact.
- **Problem:** This is confusing attribution, not a permission defect; the image is unmodified and the recorded permission is public domain.
- **Fix:** Use a clean credit naming the U.S. National Archives and Records Administration as the source, indicate that the author is unknown only once if required, and retain the source link and public-domain designation.

## Claims checked

- **PE packaging bags/films and PET soft-drink bottles:** Supported by `lib-openstax-21-1-hydrocarbons-chemistry-atoms/parsed.md#recycling-plastics`: polyethylene is used primarily for packaging “(bags and films),” and PET is named with soft-drink bottles. The note properly warns that shape alone does not identify unknown material.
- **Polymer definition, scale and natural rubber:** Supported by `lib-wikipedia-polymer/parsed/01-polymer.md#polymer` and its live page, freshly fetched because the registered source is `parse_tier: basic`. The source describes polymers as material/substance comprising very large molecules with repeating subunits and identifies polyisoprene of latex rubber as a natural polymer. The note’s necklace/scale analogy is expressly limited and does not equate an object with one molecule.
- **Cotton/cellulose:** Supported by `lib-wikipedia-cotton/parsed/01-part.md` lines 3–7 and confirmed by a fresh fetch of the live page because the registered source is `parse_tier: basic`: cotton fibers grow in bolls around seeds, are “almost pure cellulose” with minor constituents, and are commonly spun into yarn/thread for textiles. The note correctly describes the displayed photograph as bolls before spinning/weaving.
- **Element identity and particles:** Supported by Khan Academy transcript `t0`: proton count defines element identity; protons and neutrons are in the nucleus and electrons are associated with the region around it. Its “not quite right” caveat about planetary electron orbits supports the note’s model warning. The six-proton carbon example and electron-loss explanation are consistent with the transcript.
- **Water and particle counts:** Supported by `lib-libretexts-5-8-polyatomic-molecules-water/parsed.md#water`: H₂O consists of one oxygen and two hydrogen atoms. Counts are correct: two molecules contain 4 H + 2 O = 6 atoms; three contain 6 H + 3 O = 9 atoms. The particle-sort JSON’s separate H₂ and H₂O structures/counts are also internally consistent; it does not currently classify them as element/compound/mixture.
- **Source coverage:** All six cited `source.md` records and the relevant cited parsed passages were inspected. The Wikipedia sources were re-fetched as required for `parse_tier: basic`. OpenStax and both LibreTexts entries are marked `firecrawl`, with no source-record parse warning reported. No citation in the note is fabricated; the LibreTexts chemistry text is not used as evidence for compound/mixture definitions.

## Teaching quality

The note includes a “Check yourself” section with five prompts answered in a collapsed `Answers` block, and the separate faded eight-proton example now also has a correct collapsed answer: eight protons identifies oxygen; changing neutron count does not change element identity. It has four takeaway bullets. Paragraphs stay within the six-sentence limit. No planning-instruction echoes, internal paths, or AI/operator-facing prose were found in learner-facing text. The main teaching blocker is the deferred compound/mixture objective (Issue 1). The concrete-first object comparisons, scale analogy and safety warning are effective. Both interactive declarations have separate markers and the JSONs prompt predictions/steps; the first supports scale reasoning, while the second teaches particle counting but does not satisfy the planned classification concept. The bag-and-bottle image omission has a concrete reason and muted learner-facing explanation; the latex and cotton photos are credited and captioned, subject to the cotton credit cleanup in Issue 3.
