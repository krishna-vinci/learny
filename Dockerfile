# syntax=docker/dockerfile:1

# ---- build: install the workspace and compile the SPA -------------------------
FROM node:22-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm

WORKDIR /app

# Manifests first so the dependency install is cached independently of source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @studium/web build

# ---- runtime: server process + built SPA -------------------------------------
FROM node:22-slim AS runtime

ARG TARGETARCH

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production \
    STUDIUM_DATA_DIR=/data \
    STUDIUM_STUDY_ROOT=/data/study \
    HOST=0.0.0.0 \
    PORT=3000 \
    PI_CODING_AGENT_DIR=/pi-agent
RUN corepack enable pnpm \
    && apt-get update \
    && apt-get install -y --no-install-recommends git restic rclone ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Official release archives, pinned and checked for both supported architectures.
RUN set -eu; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) pandoc_arch=amd64; typst_arch=x86_64; \
        pandoc_sha=67d7d011fed8c8543306022b985b9b2499ab9b74818df91d8727c7e9ebc5ba06; \
        typst_sha=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c ;; \
      arm64) pandoc_arch=arm64; typst_arch=aarch64; \
        pandoc_sha=6cefcf7100e23a99447c26f89d1ff5b253f3407fcef99a9e27ae06f3ed16cb82; \
        typst_sha=5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee ;; \
      *) exit 1 ;; \
    esac; \
    curl -fsSL --connect-timeout 20 --max-time 180 --retry 3 "https://github.com/jgm/pandoc/releases/download/3.12/pandoc-3.12-linux-${pandoc_arch}.tar.gz" -o /tmp/pandoc.tar.gz; \
    curl -fsSL --connect-timeout 20 --max-time 180 --retry 3 "https://github.com/typst/typst/releases/download/v0.15.1/typst-${typst_arch}-unknown-linux-musl.tar.xz" -o /tmp/typst.tar.xz; \
    printf '%s  %s\n' "$pandoc_sha" /tmp/pandoc.tar.gz "$typst_sha" /tmp/typst.tar.xz | sha256sum -c -; \
    mkdir /tmp/book-tools; \
    tar -xzf /tmp/pandoc.tar.gz -C /tmp/book-tools; \
    tar -xJf /tmp/typst.tar.xz -C /tmp/book-tools; \
    install -m 0755 /tmp/book-tools/pandoc-3.12/bin/pandoc /usr/local/bin/pandoc; \
    install -m 0755 "/tmp/book-tools/typst-${typst_arch}-unknown-linux-musl/typst" /usr/local/bin/typst; \
    pandoc --version; typst --version; \
    rm -rf /tmp/book-tools /tmp/pandoc.tar.gz /tmp/typst.tar.xz

# yt-dlp for YouTube transcripts, pinned and SHA-256-verified against the release's
# own checksums file. Node (for `--js-runtimes node`) is already in this image.
ARG YTDLP_VERSION=2026.08.19
RUN set -eu; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) ytdlp_asset=yt-dlp_linux ;; \
      arm64) ytdlp_asset=yt-dlp_linux_aarch64 ;; \
      *) exit 1 ;; \
    esac; \
    base="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}"; \
    curl -fsSL --connect-timeout 20 --max-time 300 --retry 3 "$base/$ytdlp_asset" -o /tmp/yt-dlp; \
    curl -fsSL --connect-timeout 20 --max-time 60 --retry 3 "$base/SHA2-256SUMS" -o /tmp/yt-dlp.sums; \
    expected="$(awk -v f="$ytdlp_asset" '$2 == f { print $1 }' /tmp/yt-dlp.sums)"; \
    test -n "$expected"; \
    printf '%s  %s\n' "$expected" /tmp/yt-dlp | sha256sum -c -; \
    install -m 0755 /tmp/yt-dlp /usr/local/bin/yt-dlp; \
    rm -f /tmp/yt-dlp /tmp/yt-dlp.sums; \
    yt-dlp --version

ARG VERSION=dev

LABEL org.opencontainers.image.source="https://github.com/krishna-vinci/studium" \
    org.opencontainers.image.description="Self-hosted learning with cited notes, flashcards and practice" \
    org.opencontainers.image.licenses="AGPL-3.0-only" \
    org.opencontainers.image.version="${VERSION}"

ENV STUDIUM_VERSION=${VERSION}

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# tsx is a runtime dependency; omit build/test dependencies and discard the store.
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod --filter "@studium/server..." \
    && rm -rf /pnpm/store

# Copied with --chown so the non-root runtime user reads them without a recursive chown.
COPY --chown=node:node tsconfig.base.json LICENSE NOTICE ./
COPY --chown=node:node shared ./shared
COPY --chown=node:node server ./server
COPY --chown=node:node skills ./skills
COPY --chown=node:node --from=build /app/web/dist ./web/dist

# Writable defaults for the two volumes: the data dir and Pi's config dir.
RUN mkdir -p /data /pi-agent && chown -R node:node /data /pi-agent

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e 'fetch("http://127.0.0.1:" + (process.env.PORT || "3000") + "/api/healthz", {signal: AbortSignal.timeout(4000)}).then(async r => {if (!r.ok || (await r.json()).ok !== true) process.exit(1)}).catch(() => process.exit(1))'

WORKDIR /app/server

CMD ["node", "--import", "tsx", "src/main.ts"]
