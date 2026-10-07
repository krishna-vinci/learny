# M19 — Open-source release: licence, hygiene, Docker images, README with screenshots

**Goal:** a stranger can find the repo, understand Studium in one screen of README with real screenshots, and self-host it with Docker in a few minutes. Nothing personal or secret leaks.

## Owner decisions (2026-10-07)
- Licence **AGPL-3.0-only**. Memos-derived code keeps its MIT notice (NOTICE file lists it and other third-party code).
- Repo renamed `learny` → **`studium`**. The orchestrator does this with `gh` at the end; GitHub redirects the old URL. Docs and README already use `krishna-vinci/studium`.
- **Prebuilt multi-arch images on GHCR**: `ghcr.io/krishna-vinci/studium`, tags `vX.Y.Z`, `X.Y` and `latest`. Built by GitHub Actions on `v*` tags (amd64 + arm64). The compose file uses the image, so hosters don't build.
- SearXNG, MinerU, Firecrawl and the like stay **external, optional services**, documented with a link and env var. They are not in compose.
- README screenshots come from a **fresh demo instance** with open-licensed content. No personal notes, chats, names or hosts.
- The repo is **already public**. If the history scan finds real secrets, stop: the owner rotates them first, then we decide on a history rewrite.

## Shared contract (both tasks use exactly these)
- Image: `ghcr.io/krishna-vinci/studium:latest`. Compose file: `compose.yaml` at the repo root. Service `studium`, port `127.0.0.1:3000:3000`, volumes `./data:/data` and `./pi-agent:/pi-agent`, `env_file: .env`.
- Quick start = `mkdir studium && cd studium`, download `compose.yaml` and `.env.example` → `.env`, `docker compose up -d`, open `http://localhost:3000`, first-run setup creates the admin. If the first-run flow differs in the real code, M19a fixes the code or the contract and reports.
- Screenshot folder: `docs/screenshots/` with the names listed in M19b.

## M19a — hygiene, licence, Docker, CI (Codex)
See `docs/prompts/m19a-release-infra.md`.

## M19b — demo instance, screenshots, README, self-hosting guide (Codex)
See `docs/prompts/m19b-readme-screens.md`.

## Orchestrator (after both merge)
Review, merge, deploy, push → `gh repo rename studium` → update the git remote → tag `v0.1.0` → watch the image build → pull and run the image on a temp dir as a smoke test → set the repo description, topics and social preview image (the hero screenshot).
