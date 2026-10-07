# M4-8 — Security and correctness review of M4 (READ-ONLY, GPT-6.1 Sol)

You are a REVIEWER in `/path/to/studium` (branch main). Do NOT modify any file in the repo, do not commit, and do not run anything against `data/` or port 3000. Don't load orchestration skills or spawn agents. Write the report ONLY to `/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/m4-review.md`.

**Scope:** everything merged for M4 (`docs/plans/2026-09-30-m4-study-loop.md`, M4-0 through M4-7b; see `AGENT_MEMORY.md` "Recently done" and the log).

Check specifically:
1. **Search:** per-user isolation (a workspace can never index or return another user's paths); FTS query handling; the chat-title matching.
2. **Highlights and chat quotes:** path confinement, caps, locking, commit authorship; prompt-injection surface of quoted passages in the tutor turn (reason about it; don't fix it).
3. **Today:** cost on large trees; information leaks.
4. **Outliner / plan-set:**
   - the write policy (only `plan-proposals/`)
   - approve: PLAN/curriculum validation, source ids, the lock usage of `writeTextLocked`, queued job inputs
   - set creation through `plan-set`
5. **Book PDF:**
   - argv safety for pandoc and typst
   - template/filter injection from note content (can a note make typst read arbitrary files, e.g. via `#include`/`#read`/`image()` with absolute paths, or pandoc raw blocks?)
   - timeouts and output size, temp dir confinement, download route confinement
6. **Site import:** SSRF (map URL, returned URLs, redirects), the cap, throttle and dedupe, the AI gate.
7. **Skill sync:** it can't overwrite user-edited skills or write outside `_global/skills/`.
8. **Web:** `dangerouslySetInnerHTML` or raw-HTML paths (search snippets, highlights, plan review, book card); open redirects via `href`s from API data.
9. **The AI gate:** every AI-triggering route added in M4.

**Output:** for each finding give severity (critical/high/medium/low), file:line, a concrete exploit or failure, and the fix. Verify each claim against the code. End with a "looks correct" list. Targeted tests may be run (`pnpm --filter @studium/server exec vitest run <path>`); no full-suite runs.
