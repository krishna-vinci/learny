# Agent Roles, Tools and Jobs

Locked 2026-09-28 (D15). Runtime: Pi SDK behind `server/agent/` (D9).

## Roles

| Role | Mode | Job |
|---|---|---|
| **Tutor** | chat; many chats per set | explain, quiz, edit notes on request, launch jobs |
| **Librarian** | batch | ingest: fetch → parse → clean → `source.md` summary + TOC |
| **Scout** | batch | find and evaluate sources |
| **Outliner** | batch | PLAN draft, curriculum, prerequisite tree |
| **Drafter** | batch, fan-out | write / extend chapters |
| **Checker** | batch, different model | provenance + correctness |
| **Cardsmith** | batch | draft cards |
| **Critic** | batch | SuperMemo 20 rules + interference check vs existing deck |

## Tool allowlist

| Tool | Tutor | Librarian | Scout | Outliner | Drafter | Checker | Cardsmith | Critic |
|---|---|---|---|---|---|---|---|---|
| read/search study tree | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| edit notes | ✅ | | | | ✅ | comments only | | |
| write cards | | | | | | | ✅ | status + reason only |
| write library | | ✅ | | | | | | |
| write PLAN / curriculum | propose | | | ✅ | | | | |
| fetch / extract / MinerU | ✅ | ✅ | | | | | | |
| search (SearXNG, papers, wiki, YouTube) | ✅ | | ✅ | ✅ | ✅ | ✅ | | |
| Anki read | ✅ | | | | | | | ✅ |
| start_job | ✅ | | | | | | | |

No agent writes to Anki. Export is a user action (P10). Pi's default coding tools are
disabled; no bash.

## Model config — `_global/config.yaml`

```yaml
# secrets in env only (ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, base URLs…)
models:
  default: anthropic/claude-sonnet-5
  roles:
    tutor: anthropic/claude-sonnet-5
    drafter: anthropic/claude-sonnet-5
    checker: openai/…            # different provider → no warning (P3)
    critic: openrouter/…
    librarian: anthropic/claude-haiku-4-5
limits:
  max_parallel_jobs: 3
  job_budget_usd: 2.00           # confirm when estimate exceeds (P11)
```

The settings page edits this file; the file is the truth.

## Pipelines (fixed TypeScript, not agent-orchestrated)

```
Ingest:  Librarian → source.md + parsed.md → commit
Cards:   Cardsmith → Critic (≤2 retry rounds) → draft/rejected → user approves
Chapter: Drafter → Checker (≤1 revise round) → checked → user accepts
Plan:    Outliner → PLAN.md draft → user approves
```

## Write safety

- Per-file lock; second writer waits; UI shows the holder.
- Edits are exact-string replacements, never whole-file rewrites (P8).
- One git commit per chat turn or job: `<role>: <summary>` + chat/job id.

## Jobs

- Tutor calls `start_job` with a cost estimate; UI shows a confirm card.
- Queue in memory; on restart, interrupted jobs are marked failed and can be rerun.
- History (role, inputs, cost, result, commit) appended to `<set>/log/jobs.md`.

## Tutor context per turn

System prompt: `_global/profile.md` + `PLAN.md` + curriculum outline + anchored
note/source (if any) + skill index. Full notes, cards and sources load on demand via
tools. Long chats rely on Pi compaction.

## Media tools (M7 / D29)

Tutor and Drafter may use `save_asset` to download a public HTTPS raster image to
this set's `assets/`, returning a local path and exact Markdown. They can create and
edit SVG figures in `assets/` and HTML/poster SVGs in `artifacts/`; canonical paths,
SVG safety, complete-document size limits and the assets quota are enforced.
Drafter jobs still restrict note writes to their reserved chapter; media writes
are additionally allowed and included in their commits. Other roles do not gain
`save_asset` or media write scopes. Cardsmith keeps text/math cards without media.
Tutor and Drafter can load the default `media-authoring` skill. Missing local media
or YouTube videos absent from the library produce advisory write warnings.

The tutor can read library source files and image lists; library writes remain librarian-only.
The drafter also has the optional SearXNG MCP for the source-image search fallback.

### Visual authoring (D32)

Tutor and Drafter can write `<set>/visuals/**` through the same confined, locked
study tools as assets/artifacts. Draft and revision jobs allow these media files
alongside their one reserved chapter; other notes remain forbidden. JSON widget
specs and sketch headers are validated on complete writes; JSON/HTML/SVG ≤300 KB.
Checker/Cardsmith/Critic gain no visual write scope. Tutor/Drafter load `make-visual`
for interactive authoring; static media remains in `media-authoring`. Agents write
new interactive files only in visuals/, preserve legacy artifacts and include posters.

## Classifier consultations (M10 / D33)

The optional classifier routes routine decisions; it never replaces a role.
Tutor consults `tutor.intent` and `context.relevance`; Drafter consults
`context.relevance` and `visual.router`; Checker consults `check.depth` and
`context.relevance`, retaining all cited evidence. Critic consults
`cards.prescreen`; Grader consults `grade.triage`; Librarian consults `ingest.kind`.
Checker and Critic always run, and the grader always assesses free-text answers.

```yaml
models:
  default: your-provider/your-model
  classifier: opencode/jev-1.13-free # absent/null: off
  roles: {}
classifier:
  decisions:
    tutor.intent: {mode: shadow, threshold: 0.8}
    context.relevance: {mode: on, threshold: 0.6}
    check.depth: {mode: shadow, threshold: 0.85}
    cards.prescreen: {mode: shadow, threshold: 0.8}
    visual.router: {mode: on, threshold: 0.7}
    grade.triage: {mode: shadow, threshold: 0.8}
    ingest.kind: {mode: shadow, threshold: 0.8}
```

Skills remain lazy (`load_skill` / `load_skill_reference`). Drafter starts with
FTS-ranked passages (12k estimated-token cap), Checker with anchored cited spans
and neighbours. Unresolved/unanchored citations require `study_read` expansion.
Tutor provider history retains the last four turns verbatim and compacts older
text into escaped excerpts beyond an 8k estimated-token budget; recent large turns
can exceed that budget. Persisted transcripts stay complete. Quick turns can use
`enable_research` to restore research tools and full set context immediately.

Every classifier call logs private, disposable workspace telemetry; known card,
grade and source-kind outcomes feed calibration. Logs are not study-tree records.
