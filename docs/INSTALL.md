# Install Studium

A step-by-step guide for running Studium on your own machine or server. Two routes: Docker
compose (recommended) or a native install run as a systemd user service. Design background
and the security model live in [DEPLOY.md](DEPLOY.md).

## 0. What you need

- A machine that stays on if you want notes and reminders at any hour (a small VPS, a home
  server, or just your laptop).
- An AI provider login or key (Anthropic, OpenAI, OpenRouter or any provider Pi supports).
  Without one the app runs, but agents can't draft anything.
- Docker with compose, **or** Node 22, pnpm (`corepack enable`), git, pandoc 3.12 and
  typst 0.15.1 (the last two only for the PDF book export).

## 1. Get the code and configure

```sh
git clone https://github.com/krishna-vinci/learny.git
cd learny
cp .env.example .env
```

Edit `.env`. The defaults work on one machine. Things you may want to change:

| Variable | When |
| --- | --- |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | You use a key rather than a Pi login. |
| `STUDIUM_BASE_URL=https://…` | The app sits behind HTTPS (makes cookies `Secure`). |
| `STUDIUM_TRUST_PROXY=1` | Only behind a reverse proxy you control. |
| `HOST` | Leave at `127.0.0.1`. See "Remote access" below before changing it. |

Never commit `.env`.

## 2a. Docker compose

```sh
mkdir -p data
docker compose up -d --build
docker compose logs -f app      # watch for the first-run setup code
```

The app listens on `127.0.0.1:3000`. Everything stateful lives in `./data`: accounts,
secrets, each user's study tree and backups. Provider logins are read from `~/.pi/agent`
(mounted as `/pi-agent`; override with `PI_AGENT_DIR`).

Upgrade with `git pull && docker compose up -d --build`. The study tree migrates itself on
boot and commits before and after.

## 2b. Native, as a systemd user service

```sh
pnpm install --frozen-lockfile
pnpm --filter @studium/web build
scripts/install-service.sh           # writes ~/.config/systemd/user/studium.service, enables it
loginctl enable-linger "$USER"       # keep it running when you are logged out
systemctl --user status studium
journalctl --user -u studium -f      # logs
```

The script never uses sudo. To run in the foreground instead: `pnpm start`.
Upgrade with `git pull && pnpm install --frozen-lockfile && pnpm --filter @studium/web build
&& systemctl --user restart studium`.

## 3. First-run setup

1. Open `http://127.0.0.1:3000`.
2. Create the admin account. On a non-loopback host the server prints a one-time setup
   code in its log; paste it when asked.
3. Sign in to your AI provider: set a key in `.env`, or run `pi` once on the host and log in
   (this writes `~/.pi/agent/auth.json`).
4. Follow the Welcome page: name a study set, add a first source, and let the agent draft.

Try it without a provider by setting `STUDIUM_FAUX=1` (a built-in fake model, for testing only).

## 4. Remote access

The app serves plain HTTP. Do not expose port 3000 directly. Use Tailscale, or a TLS reverse
proxy (Caddy, Traefik) in front of `127.0.0.1:3000`, set `STUDIUM_BASE_URL=https://your.host`
and, only for a proxy that overwrites forwarding headers, `STUDIUM_TRUST_PROXY=1`. With no
password configured the app refuses to bind anywhere except localhost.

Install it as an app from your phone's browser menu ("Add to Home screen"). Notes you opened
recently stay readable offline; changes need a connection.

## 5. Backups

Configure them in the app: **Settings → Admin → Backups**. Pick a destination (local path,
sftp, rest, s3 or rclone), an optional daily schedule and how many snapshots to keep. The
repository password is shown **once** at setup; store it in a password manager.

Also good to know:

- Each study tree is a git repo, so every agent edit is undoable. Restore one note or a whole
  set from the UI.
- Originals and chats are not in git. A full copy is `tar czf studium-backup.tgz data/`
  (stop the app first for a consistent copy).
- **Settings → Account → Export** downloads your tree as a zip at any time.
- Whole-instance restore is CLI only; see "Backups" in [DEPLOY.md](DEPLOY.md).

## 6. Optional services

All are off by default and each missing one only disables its own feature. Set the variables
in `.env` and restart.

| Service | Adds | Variables |
| --- | --- | --- |
| **SearXNG** | Web search for agents | `SEARXNG_URL` |
| **Papers MCP** | Academic paper search and reading | `PAPERS_MCP_URL`, `PAPERS_MCP_TOKEN` (only if your server checks a token) |
| **Context7** | Current library and API docs | `CONTEXT7_API_KEY` (works without one at lower limits; free key at context7.com) |
| **Firecrawl** | Reading JavaScript-heavy pages | `FIRECRAWL_API_URL` (+ `FIRECRAWL_API_KEY` for the cloud API; none for self-hosted) |
| **MinerU** | Better PDF parsing (formulas, tables) | `MINERU_URL`; unset uses built-in text extraction |
| **AnkiConnect** | Server-side Anki sync | `ANKICONNECT_URL`. By default the browser talks to Anki on your own machine instead; add the app origin to AnkiConnect's `webCorsOriginList`. |

Extra MCP servers (stdio inside the container, or HTTP) go in the study tree's `mcp.json`.

### YouTube transcripts

Videos are always added even when YouTube refuses to hand over captions: you still get the
real title, channel and thumbnail, and the video embeds for watching. A transcript is needed
only for moment citations and chapter drafting.

**Docker already includes yt-dlp.** Nothing else is required for the "improved" tier.

For native installs, open **Settings → Integrations → YouTube**:

1. The panel shows **Transcripts: basic** with an **Install** button when yt-dlp is missing.
   **Install** downloads the latest official yt-dlp release for this server, checks its
   published SHA-256 checksum, and installs it under the data directory (no pip, no SSH, no
   restart). **Update** does the same when a newer release fixes an extraction error. If the
   server is an unsupported platform the panel says so instead of failing.
2. To read videos YouTube blocks, upload a `cookies.txt` (optional). The panel lists the
   steps: make a throwaway Google account → use a separate browser profile → install a
   cookies.txt exporter → sign in to YouTube → export → upload here → don't use that profile
   again. The file is stored encrypted and never shown again. Uploading a wrong file tells
   you it should start with `# Netscape HTTP Cookie File`.
3. Headless installs can point at a cookie file with `YOUTUBE_COOKIES_PATH` instead; the
   panel says when the cookies come from the server environment.

When the cookie session expires the panel flips to **Sign-in expired — re-export cookies**
and the admin is notified once. Re-export from the untouched profile and upload again.

yt-dlp is resolved as `YTDLP_PATH`, then `<data dir>/bin/yt-dlp`, then `yt-dlp` on `PATH`.
An invalid `YTDLP_PATH` is reported rather than silently ignored.

## 7. Troubleshooting

- **Blank page or 502 after an upgrade:** rebuild the web app (`pnpm --filter @studium/web build`)
  and hard-refresh; the old service worker can serve a stale shell for one load.
- **"Book export unavailable":** pandoc or typst is not on the service's `PATH`. The Docker
  image includes both; for systemd, put them in `~/.local/bin`.
- **Agents do nothing:** check the provider login or key, then the job log at
  `<set>/.cache/jobs/<id>.log`.
- **"YouTube blocked the transcript":** the video needs sign-in; upload cookies in
  Settings → Integrations → YouTube, then use **Retry transcript** on the source page.
- **Lost the setup code:** restart the app and read it from the log again.
