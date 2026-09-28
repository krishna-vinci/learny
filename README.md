# Studium

A self-hosted, agent-powered learning app: sources become evolving Markdown notes and Anki
cards, stored as plain files in a *study tree*. Design specs live in `docs/`.

## Quick start

Requirements: Node 22 and pnpm 10 (`corepack enable pnpm`). Docker is optional.

### Local development

```sh
pnpm install
pnpm dev:init                                        # copies examples/sample-set -> data/study
cp .env.example .env                                 # optional on first run
echo -n 'your-password' | pnpm --filter @studium/server hash-password   # into STUDIUM_PASSWORD_HASH
```

Run the API and the SPA dev server in two terminals:

```sh
pnpm --filter @studium/server dev                                     # API on 127.0.0.1:3000
pnpm --filter @studium/web dev                                        # SPA on 127.0.0.1:5173
```

Open http://127.0.0.1:5173. With no `STUDIUM_PASSWORD_HASH` the app binds to localhost only
and skips login, so `STUDIUM_FAUX=1` (already set in `.env.example`) is enough for a first run.
To exercise the production shape in one process, build the SPA and start the server, which
serves `web/dist` when it exists:

```sh
pnpm --filter @studium/web build && pnpm --filter @studium/server start   # http://127.0.0.1:3000
```

### Docker

The image builds the SPA, installs git, and runs the server as the non-root user `node` with
`HOST=0.0.0.0`, `PORT=3000`, `STUDIUM_STUDY_ROOT=/study` and `PI_CODING_AGENT_DIR=/pi-agent`.

```sh
docker build -t studium:dev .
```

Because `HOST=0.0.0.0` binds outside localhost, a login password is mandatory and the server
refuses to start without one. Put these in `.env` first:

```sh
STUDIUM_USERNAME=you
STUDIUM_PASSWORD_HASH=$(echo -n 'your-password' | pnpm --filter @studium/server hash-password)
STUDIUM_SESSION_SECRET=$(openssl rand -hex 32)
```

```sh
pnpm dev:init   # populate ./data/study (skip if you already have a study tree)
docker run --rm -p 127.0.0.1:3000:3000 --env-file .env \
  -v "$PWD/data/study:/study" \
  -v "${PI_AGENT_DIR:-$HOME/.pi/agent}:/pi-agent" \
  studium:dev
```

Open http://127.0.0.1:3000. Add `-e STUDIUM_FAUX=1` to run without a real model provider.

Volumes:

- `/study` — the study tree (a git repo). The container runs as uid 1000 (`node`), so the
  host directory must be writable by that user: `sudo chown -R 1000:1000 data/study`.
- `/pi-agent` — Pi's config directory (`auth.json`, `models.json`) from `$PI_AGENT_DIR`
  (default `~/.pi/agent`), mounted read-write because OAuth tokens refresh while the app runs.
  Model credentials live only here and never enter the study tree.

`compose.yaml` builds and runs the same single service (`build: .`, `127.0.0.1:3000:3000`,
`env_file: .env`) with both volumes.

```sh
docker compose up -d --build
```
