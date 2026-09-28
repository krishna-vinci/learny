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

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production \
    STUDIUM_STUDY_ROOT=/study \
    HOST=0.0.0.0 \
    PORT=3000 \
    PI_CODING_AGENT_DIR=/pi-agent
RUN corepack enable pnpm \
    && apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

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

# Writable defaults for the two volumes: the study tree and Pi's config dir.
RUN mkdir -p /study /pi-agent && chown -R node:node /study /pi-agent

USER node

EXPOSE 3000

CMD ["pnpm", "--filter", "@studium/server", "start"]
