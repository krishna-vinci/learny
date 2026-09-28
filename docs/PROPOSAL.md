# Studium — Proposal

> **Superseded in part.** Locked decisions in `docs/decisions/LOG.md` override this document.

> *Working title; rename freely.* A self-hosted, agent-powered learning system.
> Turn any source material into a personal textbook, rule-compliant Anki decks,
> and a daily review loop — owned entirely by the files on your disk.

**Status:** Proposal v1 (design phase)
**License:** MIT (suggested)
**Targets:** Any Docker-capable Linux environment — VPS, VM, homelab, NAS. Headless-friendly, browser is the only UI.

---

## 1. Vision

Most learning tools are either content players (pretty, no learning science) or
flashcard apps (science, no content pipeline). Studium is the missing pipeline:

```
sources (PDF / video / web / papers)
   → parsed clean text (MinerU)
   → a personal TEXTBOOK (Typst chapters, provenance-checked, multi-depth)
   → rule-compliant FLASHCARDS (SuperMemo's 20 rules, critic-enforced)
   → a daily REVIEW LOOP (Anki scheduling + in-app quiz sessions)
   → measured MASTERY (retention telemetry drives level promotion)
```

One agent — embedded in the app — does the work through conversation and batch
jobs. The learner reads in the browser, chats to extend notes, reviews in Anki.

## 2. Principles (the project's constitution — `docs/DECISIONS.md`)

These are non-negotiable design constraints. Contributors may challenge them via
ADR, not by accident.

1. **Files are the system of record.** All content state lives in a plain folder
   tree (the *study tree*). The app is a lens over it; deleting the app deletes
   nothing. Everything is grep-able, git-able, tar-able.
2. **One process.** The app (SvelteKit + embedded agent runtime) is the only
   long-running service. Everything else is an optional, profile-gated Compose
   service. No database, ever. No hidden state: conversations live in session
   JSONL, content in files, *scheduling exclusively in Anki* (we never build an
   SRS scheduler).
3. **Provenance on every claim.** Generated material cites its source. The
   fact-checker runs on a *different model* than the drafter (cross-model
   verification is a feature, not an accident).
4. **The 20 rules are enforced, not aspirational.** Card generation is always
   two agents (Cardsmith drafts, Card Critic rejects against the rules and the
   existing deck). Cards enter Anki only via a quarantine deck.
5. **Bring your own models.** Any provider (OpenAI-compatible base URL, native
   APIs) configured by env. Per-role model routing is user config, not code.
6. **Runtime-agnostic skills.** Pedagogy is authored as plain markdown (rubrics,
   procedures) in the study tree — loadable by the embedded runtime *and* by any
   external agent harness a user prefers. No skill may depend on one harness.
7. **Single learner per deployment.** No multi-tenancy. One auth token for
   remote exposure. Simplicity is the feature.
8. **Evolving notes, never regenerated.** Agents edit chapters surgically in
   place; every mutation appends to the decision ledger; requests accumulate in
   a backlog file. Regeneration is a bug, not a style.

## 3. Architecture

```
docker compose
├── app                     # the one long-running process
│   ├── SvelteKit
│   │   ├── Reader          # typst.ts renders chapters/*.typ in-browser (SVG)
│   │   ├── Sidebar         # study sets from INDEX.md (Memos-style nav)
│   │   ├── Chat dock       # per-set agent conversation, streaming
│   │   └── Quiz surface    # interactive sessions in the chat dock
│   ├── Pi SDK (embedded)   # @earendil-works/pi-coding-agent, in-process
│   │   ├── session per study set (persistent JSONL)
│   │   ├── custom tools: files, AnkiConnect, search, wikipedia,
│   │   │                 yt-transcript, mineru-client, typst-compile
│   │   └── resource loader → skills from <study-root>/_global/skills/
│   └── scheduler           # in-app cron: daily review nudge, retention pulls
├── anki          [profile: anki]     # headless Anki + AnkiConnect (xvfb)
├── mineru        [profile: docs]     # official MinerU image (GPU optional)
├── searxng       [profile: search]   # meta-search
└── volumes
    ├── ./data/study    # the study tree (bind mount — this IS the product)
    ├── ./data/anki     # Anki collection
    └── ./data/sessions # agent session JSONL
```

### 3.1 Model configuration

```env
STUDIUM_LLM_PROVIDERS=...        # any OpenAI-compatible base URLs + keys, native APIs
STUDIUM_ROLE_MODELS=drafter:... , checker:... , cardsmith:... , critic:... , tutor:...
STUDIUM_AUTH_TOKEN=...           # single token; unset = localhost-only
```

Rule 3 (cross-model verification) is satisfied by *config*: docs tell users to
route the checker to a different provider than the drafter. The app warns when
both roles resolve to the same model.

### 3.2 Agent roles

| Role | Runs as | Purpose |
|---|---|---|
| **Tutor** | persistent Pi session per study set | chat: explain, extend notes, quiz sessions, requests backlog |
| **Cardsmith** | batch session | drafts cards from parsed sources |
| **Card Critic** | batch session | rejects against 20 rules + interference check vs existing deck |
| **Drafter** | fan-out batch sessions | writes chapters (one per chapter, parallel) |
| **Fact-checker** | batch session | provenance + correctness pass (different model) |
| **Scout** | batch session | finds and evaluates sources (search/wikipedia/papers) |
| **Outliner** | batch session | syllabus + prerequisite tree |

Batch jobs are Pi sessions spawned and supervised by the app's job runner —
no external harness or CLI agent is ever required. A user *may* point any
external harness at the study tree (principle 6); the product does not assume it.

## 4. The study tree (public data contract)

```
data/study/
├── _global/
│   ├── profile.md            # learner profile (asked once, reused)
│   ├── DECISIONS.md          # the constitution (principle 2)
│   ├── SUPERMEMO_20.md       # Wozniak's rules, verbatim, cited by critics
│   ├── rubrics/              # chapter rubric, card-critic rubric, credibility tiers
│   ├── skills/               # markdown skills (runtime-agnostic)
│   └── INDEX.md              # registry of study sets (status, level, next action)
└── <study-set>/              # one engagement = one goal with a PLAN (flat, no taxonomy)
    ├── PLAN.md               # goal, deadline, scope in/out — user-approved
    ├── profile.md            # placement result, current level, promotion history
    ├── curriculum.md         # syllabus + prereq tree + progress checkboxes
    ├── sources/              # originals + registry.md (metadata, credibility tier)
    ├── parsed/               # MinerU markdown output
    ├── notes/chapters/       # Typst chapters: #let meta = (...) block + body
    ├── decks/                # drafts/ quarantine/ merged/ (lifecycle)
    ├── exercises/            # problem sets + graded attempts
    ├── artifacts/            # interactives (JS sims), diagrams (archify/SVG)
    └── log/                  # decisions.md (append-only ledger), requests.md,
                              # retention.md, session logs
```

The tree is the API between agents and the reason the project has no lock-in:
**export = copy the folder.**

## 5. Core flows

1. **Intake** — chat: goal, deadline, budget, prior exposure → prereq map +
   generated placement quiz → drafted `PLAN.md` → user approves.
2. **Ingest** — drop a URL/PDF/YouTube link in chat (or `sources/` directly):
   fetch → **tiered parse** (Tier 1: instant text-layer extraction, built into
   the app container — handles born-digital PDFs; Tier 2: MinerU fallback for
   scanned/formula/table-heavy documents) → registry entry (credibility tiered).
3. **Compile** — curriculum → Drafter fan-out → Fact-checker gate → user accepts
   chapter → Typst renders in reader; *Compile book* → single PDF via `typst`.
4. **Cardify** — chapter/sources → Cardsmith → Card Critic → quarantine deck →
   user review (or double-clean auto-merge after trust threshold) → Anki.
5. **Daily loop** — scheduler nudges; quiz sessions run in the chat dock;
   Anki retention stats pulled into `log/retention.md`; misses route back into
   exercises and card revisions.
6. **Evolve** — "more worked examples on SVD" → Tutor edits the chapter in
   place, appends the ledger, queues critic re-pass; `requests.md` batches
   async wishes.

## 6. Skill surface (the pedagogy API)

Skills are markdown files with YAML frontmatter: prose procedure + rubric +
prompt contract. Shipped defaults: `intake`, `parse-source`, `explain`,
`video-notes`, `reading-list`, `make-deck`, `quiz-me`, `problem-set`,
`teach-back`, `literature-review`, `typst-authoring`, `build-textbook`.
Community contributions to pedagogy = PRs of markdown. This is the open-source
multiplier: better teachers fork rubrics, not code.

## 7. Repository layout

```
studium/
├── app/                  # SvelteKit + Pi SDK integration
├── services/             # anki/ (Dockerfile: anki+AnkiConnect+xvfb), searxng/, mineru/
├── skills/               # shipped defaults, installed into a new study root
├── docs/                 # DECISIONS.md, ADRs, deployment, SuperMemo rules
├── compose.yaml          # profiles: core | anki | docs | search
└── examples/sample-study-set/   # a tiny worked example for CI + first-run
```

## 8. Deployment

```bash
git clone … && cd studium
cp .env.example .env        # add LLM keys, set AUTH_TOKEN
docker compose --profile core,anki,docs,search up -d
open http://localhost:3000  # or behind your reverse proxy / Tailscale
```

| Profile | Contents | RAM | Notes |
|---|---|---|---|
| `core` | app | ~0.5–1 GB | works alone (chat + reader + typst) |
| `anki` | headless Anki + AnkiConnect | ~0.5 GB | or point at existing desktop AnkiConnect |
| `docs` | MinerU | 4–8 GB | optional accelerator; or point `MINERU_URL` at any existing MinerU host (it can live anywhere) |
| `search` | SearXNG | ~0.3 GB | meta-search; users may instead point to a public instance |

Most sources never reach MinerU: born-digital PDFs (papers, slides, exports)
have a text layer and parse instantly in Tier 1. Benchmark reference — MinerU
on a CPU-class device (Apple M2): ~8 s/page prose, ~0.8 GB API RSS; a 300-page
book is a ~40-minute *background* job. Formula/table-dense documents run
several times slower per page.

Backups = `tar ./data`. Updates = `git pull && docker compose up -d --build`.
The study tree survives every version of the app by design.

## 9. Roadmap

- **M0 — Skeleton:** repo, compose `core`, SvelteKit shell, reader rendering a
  hand-made sample set via typst.ts, chat dock wired to one Pi session that can
  edit a file. *Proves the host layer.*
- **M1 — Retention (MVP):** anki profile, Cardsmith + Critic, quarantine flow,
  quiz sessions in the dock, scheduler. *The loop that justifies the project.*
- **M2 — Acquisition:** MinerU profile, intake skill, sources registry,
  YouTube/paper/web connectors, credibility tiers.
- **M3 — Compiler:** curriculum, Drafter fan-out + Fact-checker, Typst book
  build, multi-depth rendering, problem-set skill.
- **M4 — Mastery:** retention telemetry, level promotion, teach-back,
  literature-review workflow.
- **M5 — Ecosystem:** MCP adapter (community servers), plugin surface, skill
  gallery, i18n of rubrics.

## 10. Explicitly not building

A database · multi-user/multi-tenant · a hosted cloud tier · our own SRS
scheduler (Anki's FSRS is decades ahead) · a desktop app · an agent harness
(runtimes are embedded or external; the product is neither).

## 11. Risks & open questions

- **Headless Anki container** needs an xvfb wrapper and occasional add-on
  maintenance — mitigate with a thin, well-tested Dockerfile and support for
  "bring your own AnkiConnect".
- **MinerU on CPU** — measured ~8 s/page (prose) on a CPU/MPS-class device,
  ~0.8 GB API RSS; viable as background batch parsing on 8–16 GB VMs. The
  tiered parser keeps MinerU off the critical path for most sources, and
  `MINERU_URL` lets it live on a separate machine entirely. Cloud parsing
  never ships by default (privacy).
- **typst.ts WASM footprint** (fonts) — bundle a curated minimal font set.
- **Pi SDK maturity** — it is a young library; the session/tool integration is
  isolated behind one module so the runtime can be swapped (principle 6).
- **Cost of fan-out builds** — visible token spend per chapter in the UI so
  users aren't surprised.

---

*The product is the folder. The app is a lens. The rules are the moat.*
