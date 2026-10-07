# Self-hosting Studium

Studium runs one web server. Accounts live in SQLite; each account's notes,
sources, cards and history live in its own folder. Model providers and search
services run elsewhere. The [ops reference](DEPLOY.md) covers implementation
limits and service isolation.

## Docker compose install

Install Docker Engine with the Compose plugin. Allow roughly 2 CPU cores, 2 GB
RAM and room for your source files as a starting point, not a measured minimum.
PDF compilation and concurrent jobs need more headroom. A model API key or a
supported Pi subscription is needed to generate content; reading and book
compilation run locally.

```sh
mkdir studium && cd studium
curl -fsSLO https://raw.githubusercontent.com/krishna-vinci/studium/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/krishna-vinci/studium/main/.env.example -o .env
docker compose up -d
```

Open `http://localhost:3000` on the Docker host. The release Compose contract is
service `studium`, image `ghcr.io/krishna-vinci/studium:latest`, port
`127.0.0.1:3000:3000`, volumes `./data:/data` and `./pi-agent:/pi-agent`, and
`env_file: .env`. External search/PDF services are optional and separate.
Use a `vX.Y.Z` image tag when you want upgrades to be explicit.

The application container runs as uid 1000. Release Compose includes a
short-lived ownership helper for fresh bind mounts. If an existing mount is not
writable, create `data` and `pi-agent` and grant that uid access to these two directories. Do not make
credentials world-readable. The Pi mount needs write access for OAuth refresh.

## First-run setup

1. Read the first-run setup code in `docker compose logs studium` if prompted.
   A code is generated when an empty instance binds outside localhost.
2. Open the setup page and choose an admin username and a password of at least
   eight characters. This creates the account and signs you in.
3. Connect a provider, then choose a default model in Settings → Models.
   Fresh workspaces initially use `faux/echo`; select a real available model.
4. Start a study set: give it a goal, a level and sources; review the proposed
   plan before drafting chapters.

Do not set the old `STUDIUM_USERNAME` / `STUDIUM_PASSWORD_HASH` variables for a
new installation. They exist to migrate older installations at first boot.

## Adding model providers

### API keys

Set keys in `.env` and recreate the container. Examples of supported names are
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` and `ZAI_API_KEY`.
Leave `STUDIUM_FAUX` unset for real providers. Keys are read by Pi's provider
adapters; they do not belong in `_global/config.yaml`.

```sh
docker compose up -d --force-recreate studium
```

Settings → Models lists providers with configured credentials. This list means
credentials are present, not that a paid request has succeeded. Select models
as `provider/model-id`; use the actual IDs offered by your installation.

### Subscriptions through Pi OAuth

Studium reads Pi's `auth.json` and `models.json`. Run the image's installed Pi
CLI against the same writable configuration volume:

```sh
docker compose exec -it studium pnpm --filter @studium/server exec pi
```

Inside Pi, use `/login` and choose a supported provider, such as OpenAI Codex or
GitHub Copilot. Complete the provider's browser/device flow, then exit Pi.
If you already use Pi on the host, you may copy its configuration from
`~/.pi/agent/` into `./pi-agent/` with restrictive permissions instead. Treat
these files as credentials; never add them to a study tree or public repository.
Container Pi uses `PI_CODING_AGENT_DIR=/pi-agent`; native Pi defaults to
`~/.pi/agent`, or a directory you set with `PI_CODING_AGENT_DIR`.

### Which roles use which model

Every unassigned role uses `models.default`. Settings edits the model map in
each user's `data/users/<username>/_global/config.yaml`.

| Role | Work |
| --- | --- |
| Tutor | Answers questions and makes requested edits |
| Librarian | Summarises ingested sources |
| Outliner | Proposes a plan and media needs |
| Drafter | Writes chapters and teaching visuals |
| Checker | Checks evidence, teaching and media |
| Cardsmith / Critic | Writes cards / checks their wording and accuracy |
| Examiner / Grader | Creates practice / evaluates free answers |

Use a different model for Checker and Drafter; Settings warns when they match.
Source text and selected passages go to the configured providers. Subscription
limits and permitted usage depend on the provider's plan. API providers bill
for input, output and sometimes cached tokens. Jobs show usage and estimated
costs; subscription catalog estimates are not an extra invoice.

The workspace's `billing.subscription` list controls billing labels. It defaults
to `github-copilot`, `openai-codex` and `zai`; edit it to match what you pay for.
The optional classifier is off unless explicitly configured; see the
[classifier reference](DEPLOY.md#optional-classifier-m10--d33).

## Configuration summary

| Setting | Purpose |
| --- | --- |
| `HOST`, `PORT` | Native listen address/port; image uses `0.0.0.0:3000` |
| `STUDIUM_DATA_DIR` | Instance data; `/data` in Docker, `./data` natively |
| `PI_CODING_AGENT_DIR` | Pi credentials and custom model configuration |
| `STUDIUM_BASE_URL` | Public URL; an `https://` value makes session cookies Secure |
| `STUDIUM_TRUST_PROXY=1` | Trust forwarding headers from your controlled proxy |
| `STUDIUM_MAX_PARALLEL_JOBS` | Concurrent workspace jobs; default 3 |
| Provider key variables | Credentials resolved by Pi |
| `SEARXNG_URL`, `EXA_API_KEY` | Optional search backends |
| `MINERU_URL`, `MINERU_API_KEY`, `MINERU_TIER` | Optional PDF parser |
| `FIRECRAWL_API_URL`, `FIRECRAWL_API_KEY` | Optional web extraction |

The app creates `data/.secret` on first boot. Preserve it with the database:
it encrypts stored integration secrets. `STUDIUM_SECRET` can override it, but
changing the key prevents those secrets from being decrypted.

## HTTPS and reverse proxy

A phone visiting a LAN HTTP address does not get the secure context needed for
service workers and normal PWA installation. Use HTTPS with a certificate the
phone trusts. Localhost on the server is a development exception, not remote
phone access. See the [PWA installation reference](https://web.dev/learn/pwa/installation).

Keep port 3000 on loopback. Set `STUDIUM_BASE_URL=https://study.example.org`
and `STUDIUM_TRUST_PROXY=1`, then recreate the container. These examples assume
the proxy runs on the Docker host. A proxy in another container needs an explicit
private network connection to Studium rather than its own `127.0.0.1`.

### Caddy

Point the hostname at your server and allow Caddy to obtain its certificate.
Add this to your Caddyfile:

```caddyfile
study.example.org {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy supplies forwarding headers and proxies the event stream. See the
[Caddy reverse-proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

### nginx

Obtain a valid TLS certificate first; replace the example certificate paths.
In an nginx `http` context, add:

```nginx
server {
    listen 80;
    server_name study.example.org;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name study.example.org;
    ssl_certificate /etc/letsencrypt/live/study.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/study.example.org/privkey.pem;
    client_max_body_size 101m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Overwriting forwarded client IPs matters when proxy trust is enabled. Disabled
buffering lets SSE chat and job updates arrive promptly. See the
[nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

## Phone install

- Android: open your HTTPS address in Chrome, sign in, then use the browser's
  **Install app** or **Add to Home screen** menu.
- iOS: open the HTTPS address in Safari, use Share → **Add to Home Screen**, then
  open the installed app and sign in if needed.

The browser can cache recently opened notes. AI, ingestion and uncached media
still need a connection. Offline sketches have known limits documented in
[UI](UI.md#teaching-visuals-d32). Do not promise a whole course works offline.

## Multi-user accounts

The admin adds accounts in Settings → Users and chooses whether each account
can use AI. There is no public sign-up route. Each user gets an independent
study tree and library; provider credentials are shared at instance level.
An admin can archive accounts and revoke access. SSO providers can be configured
in admin Settings once password access works. Keep a working admin login while
setting up SSO.

## Optional services

Container `localhost` refers to the container. Use a reachable service DNS name
or an explicitly configured host gateway for services on the Docker host. Keep
private service endpoints protected; do not expose parsers/search APIs publicly.

### SearXNG

Set `SEARXNG_URL` to your SearXNG instance and enable JSON search results. It
provides fallback web/video search. The default `_global/mcp.json` also describes
a stdio SearXNG MCP server; missing environment variables disable unavailable
servers. See [search routing](DEPLOY.md#exa-search-budget-m13b--d35).

### Exa

Set `EXA_API_KEY` for search. The per-workspace monthly ledger warns at $8 and
stops new calls at $9.50 by default; other workspaces and use outside Studium
are not included. The last request can cross the threshold. Configure
`search.exa.warnUsd` / `stopUsd` in `_global/config.yaml`; `stopUsd: 0` disables
paid Exa calls. Preserve `.cache/exa-budget.json` when clearing other caches.
See the [budget and fallback details](DEPLOY.md#exa-search-budget-m13b--d35).

### MinerU

Set `MINERU_URL`, optionally `MINERU_API_KEY`, and `MINERU_TIER=basic`.
MinerU 4's basic tier works on CPU; budget about 4–5 GB for loaded models and
more for parsing peaks. An 8 GB limit in the example service is a starting point,
not a guarantee. Studium falls back to unpdf when parsing fails.

Use the [MinerU installation and service example](DEPLOY.md#mineru-4-for-pdfs-optional).
For a small server, a systemd timer can check for ten minutes without CPU work
and restart the idle parser to release loaded model memory. Ensure no parse is
running before restarting. The parser has no built-in idle-unload switch.

### Firecrawl

Set `FIRECRAWL_API_URL` and, if needed, `FIRECRAWL_API_KEY`. It improves difficult
web-page extraction. Its fetching workers and browser must have public-only
outbound access, including redirects and subresources; follow the
[required egress recipe](DEPLOY.md#firecrawl-target-egress-required).

### YouTube cookies

Settings → Integrations → YouTube lets an admin install/update yt-dlp and upload
Netscape-format cookies. They are encrypted in the database and copied to a
private file for a transcript attempt. Use cookies from a dedicated account and
replace them when stale. Some networks are blocked even with cookies; a
watch-only video remains available and is not treated as transcript evidence.
Do not place a cookie export in the study tree.

### ntfy

Each user can configure a topic URL and optional token in Settings →
Notifications. Tokens are encrypted. Jobs can report completion/failure; admins
also receive backup failures. Web Push is another option on supported browsers.
See [notification details](DEPLOY.md#notifications).

### Backups with restic or rclone

Settings → Backups (admin) supports local, SFTP, REST, S3 and rclone destinations.
Test the destination, initialise it, and save the one-time recovery kit outside
the server. Choose a schedule and retention, run a backup and test a restore.
The built-in backup copies SQLite consistently and includes chats/originals.
Pi credentials and `.env` are outside `data`; back them up separately and
privately. Git history alone is not a backup.

For rclone, supply the remote configuration in the backup destination form.
Studium stores it encrypted, then writes a private `data/.backup/rclone.conf`
for restic with `RCLONE_CONFIG` pointing at that file. Mount any extra files
referenced by the remote configuration separately. See
[backup/restore operations](DEPLOY.md#backups).

## Bare-metal and systemd install

Install Node 22 (with `node:sqlite`), pnpm 10, git, restic and rclone. Book export
also needs Pandoc 3.12 and Typst 0.15.1 on PATH. From a checkout:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @studium/web build
pnpm --filter @studium/server start
```

Set `HOST=127.0.0.1`, configure providers and open port 3000 locally to complete
setup. To install the [systemd user unit](../deploy/studium.service):

```sh
bash scripts/install-service.sh
systemctl --user status studium.service
journalctl --user -u studium.service
loginctl enable-linger "$USER"
```

The installer substitutes this checkout path and pins the current Node/pnpm
location. The app loads `.env` itself; the unit does not shell-source it. Put
book executables in `~/.local/bin` or the unit's PATH. Do not run the app as root.

## Upgrading and migrations

Back up first, including `data/.secret`, `.env` and Pi configuration. Then:

```sh
docker compose pull studium
docker compose up -d studium
docker compose logs --tail=100 studium
```

Startup migrates the accounts database and each study tree. Tree schema version
lives in `_global/studium.yaml`; tree migrations use git history. Do not run
older code against a newer schema. For rollback, restore the corresponding
backup and image together. Native installs update the checkout/dependencies,
rebuild the web app, then restart the user service.

### Manual whole-instance backup and restore

For a simple stopped backup, from the installation directory:

```sh
docker compose stop studium
tar -czf studium-backup.tar.gz data pi-agent .env
docker compose start studium
```

Protect that archive: it contains account data and credentials. To restore on
an empty installation using the same image version:

```sh
docker compose stop studium
tar -xzf studium-backup.tar.gz
docker compose up -d studium
```

Do not extract over an active instance. Built-in restic note/set restores make
new history commits; whole-instance recovery uses the recovery kit and
`restic restore latest --target /tmp/studium-restore`, then copies the recovered
instance data into a stopped, empty installation. Verify ownership and the
instance secret before starting.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Login returns to the sign-in page | Use one hostname; confirm `STUDIUM_BASE_URL` matches HTTPS and the proxy overwrites forwarded headers. Secure cookies will not work over plain HTTP. Check browser cookie blocking. |
| PWA still shows the old version | Close all open app tabs/windows and reopen. Reload online; if needed clear site storage and sign in again (this also removes offline caches). |
| YouTube is blocked | Update yt-dlp, replace expired cookies and retry the transcript in Library. Watch-only videos still link to YouTube; agents do not cite an absent transcript as evidence. |
| Out of memory | Reduce `STUDIUM_MAX_PARALLEL_JOBS`, inspect container limits, and move MinerU elsewhere or release idle parser memory. Book builds also need headroom. |
| Port 3000 is in use | Change only the host side of Compose's port mapping, e.g. `127.0.0.1:3001:3000`, and update the proxy/base URL. For native installs set `PORT=3001`. |
| Provider listed but jobs fail | Credentials may be expired or quota-limited. Reauthenticate with Pi, check the job error, and select an available model. |
| Files cannot be written | Verify uid 1000 can write both bind mounts; keep credentials private. |

Use `docker compose logs --tail=100 studium` for startup errors and the Activity
panel for job errors. For a forgotten native password, run
`pnpm --filter @studium/server reset-password <username>`; it prompts privately
and signs out existing sessions. Never paste provider keys or cookies into logs.

## Data layout

```text
data/
  studium.db                  accounts, sessions, encrypted integration secrets
  .secret                     encryption key; preserve with the database
  users/<username>/
    .git/                     note/card/plan history
    _global/                  model map, learner profile, skills, MCP configuration
    library/<source-id>/      source metadata, parsed text, original and figures
    <set>/                    PLAN.md, curriculum.md, notes, cards, visuals, chats
    .cache/                   jobs/search/book data and Exa usage ledger
  .backup/                    backup working files
pi-agent/                     provider credentials and custom model definitions
.env                          instance environment and API keys
```

Chapters are plain Markdown, with citations to registered sources. Images and
visuals are local files. Originals, chats and caches are gitignored. A per-user
Settings export downloads notes, sources and configuration, optionally git
history; chats are excluded. See the [study-tree contract](STUDY_TREE.md).

## Uninstall

Run `docker compose down` to stop/remove containers. Bind-mounted `data` and
`pi-agent` remain. Archive them and `.env` before deliberately deleting them;
that deletion removes accounts, notes and credentials.

For a native install, run `systemctl --user disable --now studium.service`, then
remove its installed unit and run `systemctl --user daemon-reload`. Keep your
checkout/data until you have verified a backup. Stop optional services separately
only if this installation owns them.
