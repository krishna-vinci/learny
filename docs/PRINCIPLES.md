# Principles

The project's constitution. Non-negotiable design constraints; challenge them via a
decision-log entry, not by accident. Settled 2026-09-28 (see `docs/decisions/LOG.md`).

1. **Files are the system of record.** All content lives in a plain folder tree (the
   *study tree*). The app is a lens over it; deleting the app deletes nothing. The study
   tree is a git repo: the app auto-commits after every agent mutation.

2. **One process; no database as source of truth.** The app is the only required
   long-running service. External services (SearXNG, Firecrawl, MinerU, AnkiConnect) are
   optional and configured by URL. A disposable, rebuildable cache is allowed; if deleting
   it loses data, that is a bug. Scheduling lives exclusively in Anki — we never build an
   SRS scheduler.

3. **Provenance on every claim.** Notes and cards cite sources with `[^src:<id>]`
   footnotes resolving to the source registry. Chat answers cite when source-grounded.
   The fact-checker should run on a different model than the drafter; the app warns
   (does not block) when they resolve to the same model.

4. **The 20 rules are enforced, not aspirational.** Card generation is always two agents:
   Cardsmith drafts, Card Critic rejects against SuperMemo's 20 rules and the existing
   deck. Cards leave the app (to `.apkg` or AnkiConnect) only after approval.

5. **Bring your own models.** Any provider, configured by the user. Per-role model routing
   is config, not code.

6. **Runtime-agnostic skills.** Pedagogy is authored as Agent Skills (`SKILL.md`). A skill
   may name app tools but must describe a fallback when a tool is absent.

7. **Single learner per deployment.** No multi-tenancy. One credential for remote access.

8. **Evolving notes, never regenerated.** Agents edit notes surgically in place. Git
   records *what* changed; `log/decisions.md` records *why*. One writer per file at a time
   (per-file lock).

9. **Basic built in, advanced optional.** Every capability works with zero extra services;
   advanced tiers switch on by configuration.

10. **Agents propose, the learner approves.** Batch output (plans, chapters, cards, source
    picks) waits for approval. In chat, the learner's request is the approval for that edit.

11. **Cost is visible.** Every job shows estimated cost before it runs and actual token /
    money spend after.
