# Source recipes by subject and level

Fill slots deliberately. Search 10–20 candidates **per slot**, not 10 near-identical
results for the entire set. Reuse healthy registered sources. Search results are
leads; read the top candidates. A quality score measures parse health, never truth.

| Subject | Base textbook/OER + expert explainer | Subject slot | Video slot when useful |
| --- | --- | --- | --- |
| math | MIT OCW/OpenStax/LibreTexts + a named mathematics educator | Worked examples/proofs at the requested level | Spatial transformations or a teacher working a problem |
| science | OpenStax/LibreTexts + university/discipline society explainer | Lab methods, primary data when a central claim needs them | Lab, physical process, experiment |
| technology | Version-matched official docs + maintainer tutorial | Specification/RFC and runnable worked example | Debugging/workflow demonstration, not API fact lists |
| history/humanities | University/OER synthesis or Stanford Encyclopedia of Philosophy + expert historian | Archives, contemporary primary sources and museum evidence; compare perspectives | Authentic historical footage/site walkthrough only where it adds evidence |
| finance | Regulator/OER foundation + identifiable expert | Jurisdiction/date-specific regulation, official data | Worked calculation or workflow; not definitions or advice claims |
| language | University/OER course + qualified teacher | Dictionary/usage corpus | Pronunciation, listening, conversation |
| practical | Official/manual or training OER + practitioner | Safety/manual/standards as applicable | Physical technique or performance |
| general | Textbook/OER + named expert | Discipline-appropriate primary/official evidence | Only if seeing/hearing teaches better than reading |

Levels 1–2: accessible foundations and worked examples; avoid papers by default.
Level 3: rigorous textbook/official treatment plus examples. Levels 4–5: primary
research when it advances the goal; retain a foundation source for prerequisites.
Research papers only when level >=4, the topic is recent (roughly the last three
years), or a central claim lacks textbook-grade support. Explain the exception.
Do not substitute papers for weak scouting on a basic subject.

Rank on authority, depth, level fit, type, recency (when relevant), and relevance.
Discard SEO/thin pages. Canonicalize tracking/AMP/mirror URLs. If `scout_sources`
is available, submit candidates with honest reasoned 0–5 scores (the LLM fallback)
and `researchNeeded`; it logs shadow classifier proposals and fetches the leaders.
Classifier off/shadow preserves your ranking. Do not claim classifier calibration:
`sources.rank` stays shadow until known-outcome calibration supports enabling it.
Without the tool, do the same checks manually and state inaccessible parses.

Video scouting: propose 1–3 individual lecture/demo videos per set when the subject
benefits. Prefer a named educator/institution, manual captions over auto, suitable
level and 5–30 minute length for chapter moments; verify length/caption type if
metadata is available, otherwise mark them unknown. Never infer manual captions
from search snippets, and never propose a channel/playlist as a video. Fetching a
video candidate does not establish transcript availability. Approval ingests it
through the existing ladder. No transcript means watching only, never claim evidence.
