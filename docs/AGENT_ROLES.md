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
