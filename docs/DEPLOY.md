# Deploy & Security

Locked 2026-09-28 (D19).

## Compose — single service

```yaml
services:
  app:
    image: ghcr.io/<owner>/studium:latest
    env_file: .env
    ports: ["127.0.0.1:3000:3000"]
    volumes: ["./data/study:/study"]   # only volume; chats + cache live inside
```

- Image: Node 22 slim + git + pandoc + typst + uv/Python (for stdio MCP servers such as
  paper-search-mcp). Multi-arch (amd64, arm64). Native run: `pnpm start`.
- MinerU, SearXNG, Firecrawl: external, by env URL (`MINERU_URL`, `SEARXNG_URL`,
  `FIRECRAWL_API_URL` + `FIRECRAWL_API_KEY`). Never shipped.
- `mcp.json` supports stdio (run inside the container) and HTTP MCP servers.

## Anki connection

- Default (B): the browser calls AnkiConnect at `localhost:8765` on the learner's machine.
  User adds the app origin to AnkiConnect `webCorsOriginList`. Stats pulled when the app is
  opened.
- Optional (A): `ANKICONNECT_URL` set → server talks to AnkiConnect (e.g. over Tailscale);
  daily scheduled pull.
- One AnkiConnect TypeScript client shared by browser and server.

## Auth

- Env: `STUDIUM_USERNAME`, `STUDIUM_PASSWORD_HASH`.
- Login UI copied from Memos (`reference/memos/web/src`): `pages/SignIn.tsx`,
  `components/AuthPageLayout.tsx`, `AuthFooter.tsx`, `PasswordSignInForm.tsx`,
  `CredentialFields.tsx`. Removed: identity-provider buttons, sign-up link,
  `ChallengeWidget`, Connect-RPC client (→ `POST /api/auth/login`). MIT notice kept.
- Session: signed httpOnly, `SameSite=Strict` cookie, 30-day expiry. Same secret usable as
  a Bearer token for scripts. Login rate-limited.
- No password configured → app refuses to bind to anything but localhost.

## Remote access

Tailscale or a TLS reverse proxy (Caddy, Traefik). The app serves plain HTTP only. Docs
warn against exposing port 3000 directly.

## Agent security

| Threat | Mitigation |
|---|---|
| Prompt injection from ingested content edits/deletes notes | per-role tool allowlist, exact-string edits, git revert, batch output via approval inbox |
| Path traversal / symlink escape | file tools resolve real paths and must stay inside the study root; no bash |
| Exfiltration through search/fetch queries | low-value data; tool calls visible in chat; no email/webhook tools for agents |
| Agent writes to Anki | not possible; export is a user action |
| Agent-generated JS sims | `<iframe sandbox="allow-scripts">` without `allow-same-origin`, separate origin + CSP |
| Raw HTML in notes | rehype-sanitize |

## Secrets

Env only. `config.yaml` holds no keys; settings shows set/unset only.

## Backups

- Study tree is git (history). Optional `STUDY_GIT_REMOTE`: daily auto-push to a private repo.
- Originals and chats are gitignored → full backup = `tar ./data` or a restic snapshot.

## Upgrades

`_global/studium.yaml` holds `schema_version`. On startup the app migrates the study tree,
committing before and after. Upgrade: `docker compose pull && docker compose up -d`.

## Logs

stdout for the app; per-job logs in `.cache/jobs/<id>.log`; summaries in `<set>/log/jobs.md`.
