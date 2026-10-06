# M14b implementation plan

Approved scope: the M14b implementer prompt. Execute inline; no delegates, commits, production writes or dependency additions.

1. Add a common interactive-intent parser for supported widget and sketch/story forms, preserving legacy curriculum parsing. New plans require at least one interactive intent (up to two, alongside static intents) or `Visual: no interactive visual: <concrete reason>`. Carry form/concept into briefs and refuse static substitution at checking.
2. Ground each visual in ranked source passage/figure references. Persist a compact prompt brief bounded to 5,120 UTF-8 bytes; retain full evidence in a confined non-prompt sidecar. Compact legacy briefs on prompt reads without rewriting them.
3. Diagnose actual Pressbooks image fetches and OpenStax/Chemguide HTML. Save small original HTML excerpts as offline fixtures. Recover lazy image attributes/captions before Readability; preserve license logic, HTTPS/public-network validation and raster limits.
4. Extend existing tests for planning, compact briefs, checked-status blocking and all three site shapes. Run touched tests and ingest/tree/jobs directories, all package typechecks, web build and requested Biome wrapper.
5. Refresh the four sources on a temporary live-tree copy. Draft polymers chapter 03 with two concept-specific interactive intents, record source counts, visual paths/interactions, compact size, provider/Exa usage and a 390px Visuals-tab screenshot. Write the required report and five-line handoff.
