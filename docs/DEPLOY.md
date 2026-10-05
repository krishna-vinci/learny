# Deploy & Security

Locked 2026-09-28 (D19).

## Compose — single service

```yaml
services:
  app:
    image: ghcr.io/<owner>/studium:latest
    env_file: .env
    ports: ["127.0.0.1:3000:3000"]
    environment: ["STUDIUM_DATA_DIR=/data"]
    volumes: ["./data:/data"]   # accounts db, secrets, every user's tree, backups
```

- Image: Node 22 slim + git + restic + rclone + pandoc + typst + uv/Python (for stdio MCP
  servers such as paper-search-mcp). Multi-arch (amd64, arm64). Native run: `pnpm start`.
- MinerU, SearXNG, Firecrawl: external, by env URL (`MINERU_URL`, `SEARXNG_URL`,
  `FIRECRAWL_API_URL` + `FIRECRAWL_API_KEY`). Never shipped.
- `mcp.json` supports stdio (run inside the container) and HTTP MCP servers.

Book export requires **Pandoc 3.12** and **Typst 0.15.1** on the service PATH
(native installs may use `~/.local/bin`). Docker installs the official release
tarballs with pinned SHA-256 checksums for amd64 and arm64. Templates live in
`server/templates/book/`; the book uses A5 pages for phone/tablet reading and
Typst's bundled Libertinus Serif font. Mermaid diagrams are replaced by a short
"diagram in the app" note because Mermaid CLI is not a dependency.
Other images render as italic alt text; raw embedded markup is discarded so
compilation cannot fetch remote assets or execute note-authored Typst code.
The title page uses the PLAN title and goal, plus its `date` when present or the
build date otherwise.
`compile-book` runs locally without AI or model costs. PDFs are written atomically
to `<set>/.cache/book/<set>.pdf` (gitignored); intermediate files under the
workspace `.cache` are removed after success or failure. `GET` and `HEAD` at
`/api/sets/:set/book.pdf` serve the last successful build and its `Last-Modified`
time; both return 404 before the first successful build.

`STUDIUM_DATA_DIR` (container `/data`, host `./data`) holds everything stateful:
`studium.db` (accounts, sessions, tokens, encrypted secrets), `.secret`,
`users/<username>/` (one study tree each), `trash/`, and `.backup/`. The legacy
`./data/study` tree is migrated into the first admin's directory on the first boot.

## Anki connection

- Default (B): the browser calls AnkiConnect at `localhost:8765` on the learner's machine.
  User adds the app origin to AnkiConnect `webCorsOriginList`. Stats pulled when the app is
  opened.
- Optional (A): `ANKICONNECT_URL` set → server talks to AnkiConnect (e.g. over Tailscale);
  daily scheduled pull.
- One AnkiConnect TypeScript client shared by browser and server.

## Auth

- Env: `STUDIUM_USERNAME`, `STUDIUM_PASSWORD_HASH`.
- Set `STUDIUM_BASE_URL=https://…` to mark session cookies `Secure` when TLS terminates upstream.
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

- Set `STUDIUM_TRUST_PROXY=1` only behind a trusted proxy that overwrites forwarding headers.

## Agent security

| Threat | Mitigation |
|---|---|
| Prompt injection from ingested content edits/deletes notes | per-role tool allowlist, exact-string edits, git revert, batch output via approval inbox |
| Path traversal / symlink escape | file tools resolve real paths and must stay inside the study root; no bash |
| Exfiltration through search/fetch queries | low-value data; tool calls visible in chat; no email/webhook tools for agents |
| Agent writes to Anki | not possible; export is a user action |
| Agent-generated JS sims | Chapter Visuals only, Run to load; `<iframe sandbox="allow-scripts">` without `allow-same-origin`, opaque origin + first-document CSP; connections/frames/objects/forms/base changes denied (D31) |
| Raw HTML in notes | rehype-sanitize |

## Secrets

`data/.secret` (0600, auto-created, or `STUDIUM_SECRET`) keys everything encrypted. The
ntfy token, the SSO client secret, the VAPID private key, and the restic repo password
are AES-256-GCM encrypted in `studium.db` under a key derived from it; the UI shows
`hasToken`/`hasClientSecret` rather than the value. `config.yaml` holds no keys.

## Notifications

- ntfy: per user, a topic URL plus an optional token (stored encrypted). Delivery POSTs
  the message body with `Title`, `Click`, and `Tags` headers, 5 s timeout.
- Web Push: VAPID keys are generated once and stored in `studium.db` (private key
  encrypted). Each browser subscription is listed and revocable in Settings.
- Events: job done, job failed (per user); backup failed (admins). A failure in any
  channel is logged and never fails the job.

## Data export

`GET /api/me/export` streams a zip of the signed-in user's tree
(`studium-<user>-<date>.zip`): notes, library, and `_global`, excluding `.git`, `.cache`,
and `chats`. Add `?withHistory=1` to include `.git`.

## systemd user service

`scripts/install-service.sh` copies `deploy/studium.service` to
`~/.config/systemd/user/`, runs `daemon-reload`, and `enable --now`. It never uses sudo.
The unit runs from `%h/learny` with `EnvironmentFile=-%h/learny/.env`. To keep the app up
while logged out, run `loginctl enable-linger $USER` (the script prints this hint).

## Backups

- Study tree is git (history). Optional `STUDY_GIT_REMOTE`: daily auto-push to a private repo.
- Originals and chats are gitignored → full backup = `tar ./data` or a restic snapshot.
- Backups are configured from the UI (Admin → Backups): restic to a local path, sftp, rest,
  s3, or rclone, with an optional daily schedule and retention. The repository password and
  the destination credentials are stored encrypted and are shown once, at setup.
- Per-note and per-set restores run from the UI; both land as a `system: restore …` commit.
- A whole-instance restore is CLI-only: `restic restore latest --target /tmp/studium-restore`
  with the repository URL and password from the recovery kit, then copy the files you need
  back under `users/<username>/`.

## Upgrades

`_global/studium.yaml` holds `schema_version`. On startup the app migrates the study tree,
committing before and after. Upgrade: `docker compose pull && docker compose up -d`.

## Logs

stdout for the app; per-job logs in `.cache/jobs/<id>.log`; summaries in `<set>/log/jobs.md`.

## Firecrawl target egress (required)

The configured Firecrawl endpoint may be on localhost or the LAN. Its **target
fetches must have public-only egress**, including redirects, DNS changes, sitemap
fetches and browser subresources. Studium checks requested and returned URLs;
checking a returned URL cannot undo a private fetch already made by Firecrawl.
Do not rely on Studium's `redirect: "error"`: that governs the service request.

A concrete Linux/Docker Compose recipe is to put **all containers that fetch
pages** (API/queue workers and the Playwright/browser service) on a dedicated
bridge, then enforce destination rules in each container's network namespace.
This also covers loopback and host destinations, which a host FORWARD-only rule
misses. Keep Docker's firewall enabled; use its
[documented firewall hooks](https://docs.docker.com/engine/network/firewall-iptables/)
when implementing the equivalent on the host. This example uses host-installed
`nsenter`, `iptables` and `ip6tables`; it does not install packages in containers.

1. In the **external Firecrawl Compose stack**, disable IPv6 on the fetching
   services (`sysctls: { net.ipv6.conf.all.disable_ipv6: "1" }`), drop `NET_ADMIN`
   and `NET_RAW`, and give required Redis/Postgres/controller peers fixed IPs.
   Do not use host networking or privileged containers.
2. Before exposing the API or accepting jobs, apply the following to every page
   fetching container. Replace service names and dependency IPs/ports with that
   stack's values. Only API/queue workers need dependency exceptions; browser
   containers need no outbound dependency exceptions because controllers connect
   inbound. Never allow an entire private subnet as an exception.

   ```bash
   # Run on an isolated deployment; repeat for every API/worker/browser container.
   fc_container=$(docker compose ps -q playwright-service)
   fc_pid=$(docker inspect -f '{{.State.Pid}}' "$fc_container")
   sudo nsenter -t "$fc_pid" -n iptables -N STUDIUM_EGRESS
   sudo nsenter -t "$fc_pid" -n iptables -I OUTPUT 1 -j STUDIUM_EGRESS
   # Replies to the controller and to previously allowed service connections.
   sudo nsenter -t "$fc_pid" -n iptables -A STUDIUM_EGRESS \
     -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
   # Docker's embedded DNS only; no other loopback access.
   sudo nsenter -t "$fc_pid" -n iptables -A STUDIUM_EGRESS \
     -d 127.0.0.11 -p udp --dport 53 -j ACCEPT
   sudo nsenter -t "$fc_pid" -n iptables -A STUDIUM_EGRESS \
     -d 127.0.0.11 -p tcp --dport 53 -j ACCEPT
   # API/worker only, if needed: exact dependency IP and protocol/port.
   # sudo nsenter -t "$fc_pid" -n iptables -A STUDIUM_EGRESS \
   #   -d 172.30.0.10 -p tcp --dport 6379 -j ACCEPT
   # sudo nsenter -t "$fc_pid" -n iptables -A STUDIUM_EGRESS \
   #   -d 172.30.0.11 -p tcp --dport 5432 -j ACCEPT
   for fc_destination in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 \
     169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 192.0.0.0/24 \
     192.0.2.0/24 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 \
     224.0.0.0/4 240.0.0.0/4; do
     sudo nsenter -t "$fc_pid" -n iptables -A STUDIUM_EGRESS \
       -d "$fc_destination" -j REJECT
   done
   # Defense against IPv6, mapped addresses or an overlooked IPv6 route.
   sudo nsenter -t "$fc_pid" -n ip6tables -I OUTPUT 1 -j REJECT
   ```

   Link-local blocking includes `169.254.169.254` (cloud metadata). Add the
   host's own public IPs and any organization-internal ranges to the deny list.
   Required internal service exceptions are for stack protocols only: configure
   Firecrawl's target policy to reject those IPs too, so they cannot become scrape
   URLs. Add exact controller port exceptions to API workers only if the stack
   needs them; never grant those to the browser. If page requests and required
   service traffic cannot be separated reliably, route page HTTP(S) through a
   dedicated egress proxy whose own network namespace has **no** private service
   exceptions, and prohibit direct outbound page connections.
3. Persist/reapply the policy on **every** container recreation, before enabling
   job intake. Verify public scrape/map success and denial of loopback, RFC1918,
   metadata, private redirects, private sitemap/subresource fetches, and DNS
   rebinding in an isolated stack. A policy check on API alone is insufficient.

These are operator deployment steps; Studium never changes the running Firecrawl
stack. Its current egress policy must be verified separately.

## Book compilation limits

A book accepts at most **200 chapters**, **5 MB (5,000,000 bytes) of assembled
Markdown**, and **50 MB (50,000,000 bytes) of PDF**. As an early input bound, total
note-file bytes (including frontmatter) must also fit within 5 MB. Assembly checks
cancellation between chapter reads. Oversized PDFs are rejected before atomic
publication, preserving the previous PDF and removing temporary files. A second
`compile-book` request for a set with a queued/running build returns that existing
job ID. Once it finishes, a new build may be requested.

The compiler timeout is 120 seconds per executable. These input/output limits do
not impose a compiler memory or intermediate scratch-disk quota; use container
resource/disk quotas when running a shared host with untrusted accounts.

## Optional classifier (M10 / D33)

Set `OPENCODE_API_KEY` in the server environment and explicitly configure
`models.classifier: opencode/jev-1.13-free` in the workspace's `_global/config.yaml`.
Absent/null model or missing key leaves it off. No credentials are entered in the
UI. Models settings show off/configured/working; working means a successful call
in this server process, not a paid health probe. Modes/thresholds are read-only
there; edit workspace YAML for calibration experiments (see AGENT_ROLES.md).

Requests have a 2-second deadline and conservatively bounded state; errors/rate
limits/low confidence preserve the ordinary pipeline. Checker and critic remain
mandatory. The configured classifier receives passage/answer/source excerpts in
its decision state, so enabling it opts into sharing those with OpenCode.

Workspace `.cache/classifier-log.jsonl` and `.cache/prompt-audit.jsonl` are private
telemetry (hashes/excerpts in classifier logs, counts only in prompt audit); they
are disposable and excluded from git/exports. Report tools make no model calls:

```sh
pnpm --filter @studium/server exec tsx scripts/classifier-report.ts /path/to/workspace/.cache/classifier-log.jsonl
pnpm --filter @studium/server exec tsx scripts/prompt-audit.ts /path/to/workspace/.cache/prompt-audit.jsonl
```

Without a path, classifier-report discovers users under `STUDIUM_DATA_DIR`
(default `../data` from the server package), or `STUDIUM_STUDY_ROOT` when set.
Usage includes classifier tokens/costs in jobs; distinguish catalog estimates
from subscription charge. Always report fresh input/output/cache read/cache write
separately per provider/model. Pi's long cache retention is requested where its
provider adapter supports it; the observed cache share is not guaranteed.

## Exa search budget (M13b / D35)

Configure `EXA_API_KEY` only in the server environment; `_global/config.yaml`
contains no credentials. Papers use the existing role-approved papers MCP first,
then Exa publication on unavailable/error/thin MCP; papers never use SearXNG.
Other slots use Exa first, including videos constrained to real YouTube watch URLs.
SearXNG fills gaps when Exa is absent, errors, hits its budget, or supplies too few
usable sources; video fallback uses its youtube engine. Settings → Integrations shows monthly Exa spend and
status without making a paid health request.

The owner's $10 monthly free-tier allowance is protected by a local soft guard:
warn at $8 and stop new Exa calls at $9.50 by default. Customize per workspace:

```yaml
search:
  exa:
    warnUsd: 8
    stopUsd: 9.5
    fallbackMinResults: 3
    detectIndia: true
    userLocation: null # Optional ISO country code override, e.g. IN
```

Unknown settings survive parsing; absent/invalid fields use their defaults. The
warning threshold is clamped to stopUsd. Set stopUsd to 0 to disable paid Exa
requests. India detection uses plan/chapter/subject context and can be disabled.
No migration is needed for existing configs.

Reported response costs accumulate in private `.cache/exa-budget.json` per workspace
and UTC calendar month, across restarts; cache hits are not charged. The guard
serializes concurrent requests in the one server process. Crossing the stop limit
attempts one notification per workspace/month using the configured ntfy/Web Push
channels, then other searches use SearXNG until UTC month rollover; papers remain
MCP-only while Exa is stopped. A last request can
cross the soft stop; this is not a prepaid reservation or an account-wide cap.
Exa's reported response cost is an estimate; provider invoicing remains authoritative
([Exa Search API](https://exa.ai/docs/reference/search)). Other workspaces or external
uses of the same key are not tracked here. Deleting `.cache` resets this estimate;
retain the ledger when clearing other caches. First installation starts at zero
and does not import earlier provider charges.

Missing cost reports, an interrupted in-flight request, or a damaged/unwritable/
symlinked ledger disables Exa until tracking is restored (or a clean month begins
for a valid old ledger). Verify provider usage before manually repairing/resetting
an uncertain ledger. No credentials or raw response bodies are stored in it.
