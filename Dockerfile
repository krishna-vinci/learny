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
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @studium/web exec vite build

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

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# `start` runs through tsx, a devDependency, so dev deps stay installed.
RUN pnpm install --frozen-lockfile --filter "@studium/server..."

# Copied with --chown so the non-root runtime user reads them without a recursive chown.
COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node shared ./shared
COPY --chown=node:node server ./server
COPY --chown=node:node --from=build /app/web/dist ./web/dist

# Writable defaults for the two volumes: the data dir and Pi's config dir.
RUN mkdir -p /data /pi-agent && chown -R node:node /data /pi-agent

USER node

EXPOSE 3000

CMD ["pnpm", "--filter", "@studium/server", "start"]
