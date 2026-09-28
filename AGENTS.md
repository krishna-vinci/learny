# AGENTS.md

Instructions for coding agents (Codex, Claude, others) working in this repo.

Studium (repo: learny) is a self-hosted, agent-powered learning app: agents turn sources into
evolving Markdown notes and Anki cards, stored as plain files in a *study tree*.
Read before planning or claiming behaviour:

- `docs/PRINCIPLES.md` — non-negotiable constraints.
- `docs/decisions/LOG.md` — locked decisions (override `docs/PROPOSAL.md`).
- Specs: `docs/STUDY_TREE.md` (data contract), `docs/AGENT_ROLES.md`, `docs/INGEST.md`,
  `docs/REVIEW_LOOP.md`, `docs/UI.md`, `docs/DEPLOY.md`, `docs/ROADMAP.md`.
- Plans: `docs/plans/`.

## Repo layout (pnpm workspaces, TypeScript)

| Path | What |
| --- | --- |
| `server/` | Hono API + SSE; `agent/` (Pi SDK wrapper — the only place that imports Pi), `jobs/`, `ingest/`, `tree/` (study-tree fs, per-file lock, git), `anki/` |
| `web/` | React 19 + Vite + Tailwind 4 + shadcn UI, derived from Memos |
| `shared/` | zod schemas (frontmatter, config), shared types, AnkiConnect client |
| `skills/` | default Agent Skills (`<name>/SKILL.md`), copied into new study trees |
| `examples/sample-set/` | hand-made study tree used by dev and tests |
| `reference/memos/` | gitignored Memos checkout — read-only reference; in a worktree use `/home/krishna/learny/reference/memos/` |

Some of these directories do not exist until their milestone lands; create only what your task names.

## Working rules

- Do exactly the task you were given. No drive-by refactors, renames, or formatting of untouched code.
- Keep diffs small and reviewable. Match surrounding code style, naming, and comment density.
- Never commit secrets or real credentials. Never touch `.env*` files.
- Do not `git commit`, `git push`, rebase, or switch branches unless the task explicitly says so. The orchestrator reviews and commits.
- If the task is ambiguous or blocked, or a step does not fit the real code, stop and report (file:line, what you saw) instead of guessing.
- Never delete or modify committed files you did not change for your task.
- Never edit `reference/`. Code copied from Memos keeps its MIT notice.
- Do not add dependencies beyond those the task names. Pin exact versions for `@earendil-works/*` (Pi SDK).

## High-risk areas

Changes here need the wider test scope (see table) and extra care:

- **Study-tree file tools** (`server/tree/`): path confinement to the study root (realpath, no symlink escape), per-file lock, exact-string edits. A bug here corrupts or leaks user files.
- **Git auto-commit / revert** (`server/tree/git*`): never rewrites history, never commits gitignored originals/chats.
- **Auth** (`server/auth/`): cookie signing, rate limit, localhost-only bind without a password.
- **Agent tool allowlists** (`server/agent/`): per-role tools; no bash; agents never write to Anki.
- **Sandboxed artifacts** (`web/` iframe for agent JS): `sandbox="allow-scripts"` without `allow-same-origin`.
- **Study-tree schema + migrations** (`shared/` schemas, `server/tree/migrations/`): data loss risk.
- **Anki export** (`server/anki/`): note GUID = card id; changing it duplicates users' cards.

## Testing policy (important)

Test what the change touches, not the whole repo. Full-suite runs are **not** allowed unless the task explicitly asks for one.

### Pick the scope from the change

| Change | What to run |
| --- | --- |
| Docs, comments, markdown, skills text only | Nothing. |
| Small bug fix / local logic change | The test file(s) covering the changed module, narrowed with `-t "<name>"`. |
| New feature / new behavior | The new tests you wrote + existing test files for the changed modules. |
| Shared helper or public interface (`shared/`, exported server APIs) | Above, plus test files that import the changed symbol (`grep -rl "<symbol>" server web shared --include=*.test.ts*`). Cap at the few most relevant. |
| Types / signatures changed | Above + `tsc --noEmit` for each affected package. |
| High-risk area (list above) | Whole test directory for that area, e.g. `server/tree/`. Still not the full suite. |
| Frontend component | Its `*.test.tsx` (if any) + biome on changed files + `tsc --noEmit` for `web` if props/types changed. |

### Commands (run from repo or worktree root)

- Tests: `pnpm --filter <server|web|shared> exec vitest run <path/to/file.test.ts> [-t "<name>"]`. Tests sit next to source: `server/tree/lock.ts` → `server/tree/lock.test.ts`.
- Lint/format: `pnpm exec biome check <changed files>` (add `--write` to fix formatting of your own files only).
- Types: `pnpm --filter <pkg> exec tsc --noEmit`.
- Never run bare `pnpm test` / `vitest` without a path from the repo root.
- Tests that touch the filesystem use a temp dir (`fs.mkdtemp(os.tmpdir())`) or a copy of `examples/sample-set/`; never the real study tree or `~/`.
- Tests never call real LLM providers or network services. Use fakes/stubs for Pi, MCP, AnkiConnect, MinerU, Firecrawl, SearXNG.
- In a fresh worktree run `pnpm install --frozen-lockfile --prefer-offline` once before tests.

### Writing tests

- Add tests only for new or changed behavior: usually 1–3 focused tests per behavior, not exhaustive matrices.
- Extend an existing test file before creating a new one. Reuse existing fixtures and helpers.
- Don't add tests for pure refactors that keep behavior the same; run the existing ones.

### When a test fails

- Fix failures caused by your change.
- If a failure looks pre-existing or unrelated, don't fix it and don't widen the run. Report it with the test id and the error line.

## Final report

End every task with:

1. **Changed files**: one line each on what changed.
2. **Tests run**: exact commands and pass/fail counts.
3. **Not done / open questions**: anything skipped, blocked, or uncertain.
