# M3a Platform Implementation Plan

**Goal:** Studium becomes a proper multi-user, always-on self-hosted app. It gets accounts
and sign-in modelled on Memos, one study tree per user, restic backups set up entirely in
the UI, ntfy and Web Push notifications, a per-user data export, and a systemd service.

**Spec:** decisions D24–D28 in `docs/decisions/LOG.md`, `docs/ROADMAP.md` (M3a),
`docs/DEPLOY.md`. Memos reference (read-only):
- `/path/to/studium/reference/memos/`, in particular `server/auth/token.go`
  (PAT format, sha256 hashing)
- `proto/api/v1/{auth,user,idp,instance}_service.proto`
- web: `web/src/pages/{SignIn,AuthCallback}.tsx` and `web/src/components/Settings/*`

**Tech:**
- SQLite via Node's built-in `node:sqlite` (`DatabaseSync`; `backup()` exists on Node 22.19)
- scrypt passwords (existing `server/src/auth/password.ts`)
- restic and rclone binaries (installed at `/usr/bin`)
- new deps: `web-push` (T5) only

If a step does not fit the real code, stop and report the mismatch (file:line, what you
saw) instead of improvising.

## Global constraints

- **Memos principles.** Use Memos' concepts and names where they fit:
  - users: `role` = `ADMIN` | `USER`; `state` = `NORMAL` | `ARCHIVED`
  - instance setting `disallowPasswordAuth`
  - OAuth2 identity providers with `identifierFilter` and a field mapping (`identifier`,
    `displayName`, `email`, `avatarUrl`)
  - PKCE, with state and verifier generated on the client and stored in `sessionStorage`
  - an `/auth/callback` page
  - linked identities
  - personal access tokens: prefix `studium_pat_`, stored only as a sha256 hex digest
  - refresh sessions stored per user, listable and revocable
- **Deliberate deviation from Memos.** Memos keeps a 15-minute access JWT in memory. We
  use the DB-backed 30-day session cookie directly for browser requests, because
  EventSource (SSE), `<a download>` and `<img>` can't send Authorization headers.
  Bearer auth is for PATs only.
- **No public sign-up, ever.**
  - Only an admin creates users. There is no sign-up route or page.
  - SSO signs in *existing* users only, via a linked identity or a matching email.
- **Users and data.**
  - Username regex `^[a-z0-9][a-z0-9_-]{1,31}$`. It's immutable, because it names the
    user's data directory.
  - The data dir is `STUDIUM_DATA_DIR` (default `<repo>/data`):
    - `studium.db` — accounts (users, sessions, tokens, identity providers, settings)
    - `.secret` — instance secret, 0600, auto-created if `STUDIUM_SECRET` is unset
    - `users/<username>/` — that user's study tree
    - `trash/` — deleted users' trees
    - `.backup/` — staging area for backups and restores
  - Never touch the real `data/`, `.env*` or `~/` in tests: use `fs.mkdtemp(os.tmpdir())`.
- **Existing security stays in place.**
  - Keep the path confinement (`resolveInRoot`), atomic writes, repo git mutex,
    Origin/Sec-Fetch-Site checks and the login rate limit.
  - Use `timingSafeEqual` for secret compares.
  - Cookies: `httpOnly`, `SameSite=Strict` (unchanged; the SSO callback sets the cookie
    through a same-origin fetch), `Secure` when HTTPS.
- Tests: targeted, per `AGENTS.md`. Auth, tree, backup and workspace code is high-risk, so
  run those whole test directories.

## Architecture

```
server/src/
  db/            db.ts (open, pragmas, migrate), migrations.ts (ordered list), secret.ts
  accounts/      users.ts, sessions.ts, tokens.ts, settings.ts, identities.ts, bootstrap.ts
  auth/          password.ts (keep), middleware.ts (session/PAT → c.var.user), routes.ts (rewritten)
  sso/           oauth2.ts (token exchange + userinfo + mapping), routes.ts
  workspaces/    manager.ts (per-user runtime), migrate-legacy.ts
  backups/       restic.ts, config.ts, crypto.ts, scheduler.ts, routes.ts
  notify/        ntfy.ts, webpush.ts, notifier.ts, routes.ts
  export/        routes.ts (zip of the user's tree)
  server.ts      NEW top-level Hono app: guard → public auth → session → me/admin → workspace delegate → static
  app.ts         becomes the PER-WORKSPACE app (no auth inside)
  main.ts        boots db, bootstrap, WorkspaceManager, server.ts, scheduler
```

**Per-workspace runtime.** `WorkspaceManager.get(username)` returns a cached
`Workspace { username, root, hub, locks, mcp, jobs, chats, app, stop() }`, built exactly
the way `main.ts` builds the single-user runtime today (lines 50–70 and 104–128). The Pi
`runtime` (`createModelRuntime()`) is shared by every workspace.

**Request routing.** Top-level `/api/*` requests that aren't auth/me/admin are forwarded
as `workspace.app.fetch(c.req.raw, c.env)` after auth. SSE stays per user because each
workspace has its own `EventHub`.

## Tasks and order

| id | model | depends on | scope |
|---|---|---|---|
| T1 | `sol` | — | db + accounts + auth rewrite + top-level server + bootstrap |
| T2 | `glm` | T1 | workspaces, per-user trees, legacy migration, AI gate |
| T3 | `sol` | T1 | SSO (OAuth2 IdPs, linked identities) |
| T4 | `fast` | T1 | backups (restic) |
| T5 | `fast` | T2 | notifications (ntfy + Web Push), data export, systemd/compose/docs |
| T6 | one persistent Sonnet session (+ `ui-ux-pro-max`) | T1, then each slice | web UI, delivered in slices: (a) setup, sign-in, account, sessions, tokens, members, instance after T1; (b) SSO screens and callback after T3; (c) backup wizard after T4; (d) notifications and export after T5. The same agent is resumed with SendMessage so it keeps its context. |
| T7 | `precise` audit, then Claude browser check | all | security review + end-to-end |

After T1 merges, T2 (glm), T3 (sol) and T4 (fast) run in parallel, each in its own
worktree. Only one GLM run happens at a time. Each task touches `server.ts`/`main.ts`
only at its named mount/wiring lines, and the orchestrator resolves merge overlaps.
Migration numbers are fixed so the parallel tasks don't collide: T1 = 1,
T3 = 2, T4 = 3, T5 = 4. Each task adds one entry to `server/src/db/migrations.ts`.

---

### T1 — Database, accounts, auth, top-level server (glm)

**Files**
- Create:
  - `server/src/db/db.ts`, `db/migrations.ts`, `db/secret.ts`, `db/db.test.ts`
  - `server/src/accounts/{users,sessions,tokens,settings,bootstrap}.ts` and a
    `.test.ts` for each
  - `server/src/auth/middleware.ts`
  - `server/src/server.ts`, `server/src/server.test.ts`
- Rewrite: `server/src/auth/routes.ts`, `auth/routes.test.ts`
- Delete: `auth/session.ts` and `auth/session.test.ts` (HMAC cookie). `hash-cli.ts` stays.
- Modify:
  - `server/src/app.ts`: remove `requestGuard`, `authRoutes` and `requireAuth` from
    `createApp`, and drop `auth` from `AppDeps`
  - `server/src/app.test.ts`: remove the "requires a session…" test (lines ~130–155),
    which moves to `server.test.ts`, and drop `auth: PASSWORDLESS` from `makeApp`
  - `server/src/http/guard.ts`: remove the passwordless host allowlist and keep the
    Origin/Sec-Fetch-Site checks; `requestGuard()` takes no args
  - `server/src/main.ts`: wiring (below)
  - `.env.example`: document the new vars and mark the old ones legacy

**`db/db.ts`**
- `openDb(file): DatabaseSync` sets `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`.
- `migrate(db)` runs each `migrations[i]` inside a transaction wherever
  `PRAGMA user_version < i+1`, then sets `user_version`.
- `migrations.ts` exports `const migrations: string[]`. T1 adds migration 1:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('ADMIN','USER')),
  state TEXT NOT NULL DEFAULT 'NORMAL' CHECK (state IN ('NORMAL','ARCHIVED')),
  password_hash TEXT,                 -- NULL = SSO-only user
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE sessions (              -- Memos "refresh tokens"
  id TEXT PRIMARY KEY,               -- random 16 bytes hex (public id for listing/revoke)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,   -- sha256 hex of the cookie value (32 random bytes b64url)
  user_agent TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE access_tokens (         -- personal access tokens
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, last_used_at TEXT, expires_at TEXT   -- NULL = never
);
CREATE TABLE instance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- JSON values
```

**`db/secret.ts`**
- `loadInstanceSecret(dataDir, env): Buffer` returns `STUDIUM_SECRET` when it's at least
  32 chars.
- Otherwise it falls back to legacy `STUDIUM_SESSION_SECRET` (at least 32 chars).
- Otherwise it reads `<dataDir>/.secret` (hex). If that file is missing, it creates 32
  random bytes with mode 0600.
- Export `deriveKey(secret, label): Buffer` (HKDF-SHA256, 32 bytes) for T4's encryption.

**`accounts/*`** — synchronous `node:sqlite` functions; each takes `db` as its first
argument.
- `users.ts`:
  - `createUser(db, {username, password?, role, displayName?, email?, aiEnabled?})`
    validates the username regex and hashes via `hashPassword`.
  - Also `getUserById`, `getUserByUsername`, `getUserByEmail` (case-insensitive,
    non-empty only), `listUsers`, and `updateUser(db, id, patch)` (patchable:
    displayName, email, avatarUrl, role, state, aiEnabled, passwordHash).
  - `countAdmins`.
  - The username is never updatable.
  - Type `User` excludes `password_hash`; it has `hasPassword: boolean`.
- `sessions.ts`:
  - `createSession(db, userId, {userAgent, ip}) → {id, token, expiresAt}` (30 days).
  - `resolveSession(db, token) → {session, user} | null`. It rejects expired sessions and
    ARCHIVED users, bumps `last_used_at` at most once a minute, and slides `expires_at`
    to now+30d when fewer than 15 days remain.
  - `listSessions(db, userId)`, `revokeSession(db, userId, id)`,
    `revokeAllSessions(db, userId, exceptId?)`.
- `tokens.ts`:
  - `createAccessToken(db, userId, {description, expiresInDays?}) → {id, token}`, where
    `token = "studium_pat_" + 32 random bytes b64url`.
  - Also `resolveAccessToken(db, token)`, `listAccessTokens` (never returns the token or
    its hash), and `deleteAccessToken(db, userId, id)`.
- `settings.ts`:
  - `getInstanceSettings(db) → {disallowPasswordAuth: boolean, instanceUrl: string}`
    (defaults `false`, `""`).
  - `updateInstanceSettings(db, patch)`.
- `bootstrap.ts` → `bootstrapAccounts(db, env): {setupRequired: boolean}`:
  - With zero users, and `STUDIUM_USERNAME` plus `STUDIUM_PASSWORD_HASH` set, it creates
    an ADMIN with that username and the existing hash (username lowercased; it must match
    the regex, otherwise throw with a clear message). Log `migrated legacy .env login to admin <name>`.
  - With zero users and no env login, `setupRequired = true`.

**`auth/middleware.ts`**
- `sessionAuth(db)` resolves the user and sets `c.set("user", User)` and
  `c.set("sessionId", id | null)`:
  - `Authorization: Bearer studium_pat_…` → `resolveAccessToken`
  - otherwise the cookie `studium_session` → `resolveSession`
  - otherwise 401 `{error:"unauthorized"}`
- `requireAdmin` returns 403 unless `user.role === "ADMIN"`.
- Augment `ContextVariableMap` with `user: User` and `sessionId: string | null`.
- Remove the old `username` variable. Grep its users (`c.get("username")`) and switch
  them to `c.get("user").username`.

**`auth/routes.ts`** → `authRoutes({db, trustProxy, baseUrl, setupCode})`

- `GET /status` (public) returns `{setupRequired, disallowPasswordAuth, instanceUrl}`.
  T3 extends it with `identityProviders`.
- `POST /setup` (public; only while zero users exist)
  - body `{username, password, setupCode?}`
  - if `setupCode` is non-null (see main), the body must match it with a constant-time
    compare → 403 otherwise
  - creates an ADMIN, starts a session and sets the cookie → 201 `{user}`
  - 409 if users already exist
- `POST /signin` (public)
  - body `{username, password}`
  - 403 `{error:"password sign-in is disabled"}` when `disallowPasswordAuth` is on and
    the user isn't ADMIN. Admins can always use a password, which avoids lockout, the
    same as Memos' break-glass.
  - Keep the existing per-IP rate limit (5 failures per 15 minutes → 429) and generic
    401 `{error:"invalid credentials"}`, also for archived and SSO-only users.
  - Success: `createSession` + cookie → 200 `{user}`.
- `POST /signout` (session) revokes the current session and clears the cookie → 204.
- `GET /me` (session) returns `{user}`.
- Compatibility until T6 ships: the current web client calls `POST /login`,
  `POST /logout` and `GET /me` (`web/src/api/client.ts:92-98`). Keep `/login` and
  `/logout` as aliases of `/signin` and `/signout`, and make `GET /me` return `{user}`
  plus a top-level `username` field so the old client keeps working.

**`server.ts`** → `createServer({db, workspaces, webDist?, authOpts})`, in this order:
1. `app.use("/api/*", requestGuard())`
2. `app.route("/api/auth", authRoutes(...))`
3. `app.use("/api/*", sessionAuth(db))`
4. `app.route("/api/me", meRoutes(db))`
   - `GET/PATCH /` — displayName, email, avatarUrl
   - `POST /password` `{currentPassword?, newPassword}` — `currentPassword` required when
     the user has one; minimum 8 chars; revokes the user's other sessions
   - `GET /sessions` — with `current: boolean`; `DELETE /sessions/:id`
   - `GET /access-tokens`; `POST /access-tokens {description, expiresInDays?}` →
     201 `{id, token}` (the token is shown once); `DELETE /access-tokens/:id`
5. `app.route("/api/admin", adminRoutes(db, workspaces))` behind `requireAdmin`
   - `GET /users`
   - `POST /users {username, password?, role, displayName?, email?, aiEnabled?}` → 201
   - `PATCH /users/:id` — role, state, aiEnabled, displayName, email, and `password`
     (reset). Refuse to demote or archive the last admin (409).
   - `DELETE /users/:id` — archives the user and revokes their sessions; `?purge=1`
     moves their tree to `trash/<username>-<ISO>` and deletes the row. Never for the
     last admin or yourself (409).
   - `GET/PATCH /instance` — `disallowPasswordAuth`, `instanceUrl` (valid http(s) URL
     or "")
6. `app.all("/api/*", c => workspaces.for(c.get("user")).app.fetch(c.req.raw, c.env))`
   - In T1, `workspaces` is a stub with one workspace (T2 makes it per-user). Define the
     interface
     `interface WorkspaceProvider { for(user: User): { app: Hono } ; }`.
7. Static web + SPA fallback: move the lines from `app.ts:66-79`.

**`main.ts`**
- Env `STUDIUM_DATA_DIR` (default `<repo>/data`), then `openDb(<dataDir>/studium.db)`,
  `migrate`, `bootstrapAccounts`.
- If `setupRequired` and the host is not local: generate a 6-word or 12-hex-digit setup
  code and print it once:
  `first-run setup code: … (open the app and enter it)`.
- Remove `assertBindAllowed`/`authConfigFromEnv`. Keep `STUDIUM_TRUST_PROXY` and
  `STUDIUM_BASE_URL`, passed to auth routes for the Secure flag and IP handling.
- For T1 the workspace stub wraps today's single runtime on the legacy root, so the app
  keeps working.

**Tests (new)**
- migrate idempotent; secret file created 0600
- create/resolve/expire/slide session; archived user rejected
- PAT create/resolve/list hides token
- bootstrap from env
- setup only once and code enforced
- signin rate limit
- disallowPasswordAuth blocks USER, not ADMIN
- last-admin protections
- `me/password` revokes other sessions
- 401 without cookie on a workspace route
- PAT bearer works

Run:
- `pnpm --filter @studium/server exec vitest run src/db src/accounts src/auth src/server.test.ts src/app.test.ts src/http`
- `tsc --noEmit` for server
- biome on changed files

**Acceptance:** with the real `.env` (legacy login), a fresh `studium.db` boots, you sign
in as `krishna`, and every existing API works unchanged.

---

### T2 — Workspaces: one study tree per user (glm)

**Files**
- Create: `server/src/workspaces/manager.ts`, `manager.test.ts`, `migrate-legacy.ts`,
  `migrate-legacy.test.ts`
- Modify: `server/src/main.ts` (replace the stub), `server/src/server.ts` (AI gate),
  admin `POST /users` (initialise the tree)

**`manager.ts`** → `new WorkspaceManager({dataDir, db, runtime, webDist?, maxParallelJobs, subscriptionProvidersFor(root)})`
- `for(user)` returns a cached `Workspace` for `user.username`, creating it lazily:
  - `root = <dataDir>/users/<username>` — `realpath` it and assert it stays inside
    `<dataDir>/users`
  - `initStudyTree(root)`, `ensureRepo(root)`
  - a new `EventHub`, `FileLocks`, and an `McpManager` from that root's
    `_global/mcp.json` (as in main.ts)
  - a `JobRunner` with the 3 handlers and `seedHistory(loadJobHistory(root))`
  - `ChatService`
  - `app = createApp({root, hub, locks, chats, jobs, settings: {runtime, mcp, env: process.env}})`
    — no `webDist`, since `server.ts` serves the static files
  - `startWatcher(root, hub)`
  - `startInboxWatcher` only if `user.aiEnabled`
  - start mcp
- `startAll()` creates workspaces for every NORMAL user at boot.
- `stop(username)` / `stopAll()` stop the watchers and MCP.
- `provision(username, templateFromRoot?)`, called by admin `POST /users`:
  - `initStudyTree` + `ensureRepo`
  - copy `_global/config.yaml` and `_global/mcp.json` from the first ADMIN's tree when
    it exists, then commit `system: init study tree`
- Archiving a user stops their workspace.

**`migrate-legacy.ts`** → `migrateLegacyTree({dataDir, legacyRoot, adminUsername})`
- If `<dataDir>/users/<admin>` doesn't exist and `legacyRoot`
  (`STUDIUM_STUDY_ROOT`, default `<repo>/data/study`) contains `_global/studium.yaml`:
  `fs.rename(legacyRoot, <dataDir>/users/<admin>)`. It's the same filesystem, the git
  history comes along, and it logs the move.
- If the rename fails with `EXDEV`, stop with a clear error. Never copy then delete.
- Idempotent.
- Runs in `main.ts` right after `bootstrapAccounts`, for the first ADMIN.

**AI gate (`server.ts`, before the workspace delegate)**
- If `!user.aiEnabled`, return 403 `{error:"AI features are disabled for this account"}` for:
  - `POST /api/jobs`
  - `POST /api/library` (ingest)
  - `POST /api/sets/:set/chats/:id/messages`
  - any `POST` under `/api/sets/:set/chats`, except creating a chat
- Check the route list in `server/src/agent/routes.ts`, `server/src/jobs/routes.ts` and
  `server/src/routes/library.ts`, and write down the exact matches you used.

**Tests**
- Two users → isolated roots, so user A's `/api/sets` never lists B's sets.
- A traversal username can't be created.
- The legacy tree moves once and keeps its git log.
- The AI gate returns 403.
- An archived user's workspace is stopped.

Run: `vitest run src/workspaces src/server.test.ts src/tree`, then `tsc`.

**Acceptance:** after a restart, `data/study` has moved to `data/users/<username>`,
`git log` is intact, all 5 notes show up, and a second user sees an empty tree.

---

### T3 — SSO: OAuth2 identity providers and linked identities (glm)

**Migration 2**

```sql
CREATE TABLE identity_providers (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'OAUTH2',
  identifier_filter TEXT NOT NULL DEFAULT '',   -- regex applied to the mapped identifier
  config TEXT NOT NULL                          -- JSON: clientId, clientSecretEnc, authUrl, tokenUrl, userInfoUrl, scopes[], fieldMapping{identifier,displayName,email,avatarUrl}
);
CREATE TABLE user_identities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES identity_providers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, subject)
);
```

**Files**
- Create: `server/src/sso/oauth2.ts`, `sso/routes.ts`, `sso/*.test.ts`,
  `server/src/accounts/identities.ts`, `server/src/db/crypto.ts`
- Modify: `server/src/server.ts` (mount), `auth/routes.ts` (`/status` adds
  `identityProviders`)

**`db/crypto.ts`**
- `encryptSecret(key, plaintext): string` — AES-256-GCM, `v1:<iv b64>:<tag b64>:<ct b64>`.
- `decryptSecret(key, s)`.
- Key: `deriveKey(instanceSecret, "studium-secrets-v1")`.
- T4 reuses this module.

**Routes**
- Public `GET /api/auth/status`: `identityProviders: [{id, title, authUrl, clientId, scopes}]`.
  Never include `tokenUrl`/`userInfoUrl` secrets.
- Public `POST /api/auth/sso` `{providerId, code, redirectUri, codeVerifier?}`:
  - Exchange the code: POST form to `tokenUrl` with `grant_type=authorization_code`,
    `code`, `redirect_uri`, `client_id`, `client_secret`, plus `code_verifier` if given.
    Accept a JSON or form response (GitHub returns form unless `Accept: application/json`,
    so send that header).
  - GET `userInfoUrl` with `Bearer access_token`.
  - Map the fields with dotted-path lookup (e.g. `identifier: "login"`).
  - If `identifierFilter` doesn't match → 403.
  - Resolve the user: by `user_identities(provider, subject = mapped identifier)`, else by
    a unique email match (`getUserByEmail`), which then links the identity automatically.
    No match → 403 `{error:"no Studium account is linked to this identity; ask the admin"}`.
  - Archived → 403.
  - Success → session cookie → `{user}`.
  - The `redirectUri` must equal `<instanceUrl or request origin>/auth/callback`,
    otherwise 400.
  - Outbound fetch: 10 s timeout, `redirect: "error"`, response ≤ 1 MB.
- Session `GET /api/me/identities`, `DELETE /api/me/identities/:providerId`.
- Session `POST /api/me/identities` `{providerId, code, redirectUri, codeVerifier?}` links
  the identity to the current user. 409 if it's linked to someone else.
- Admin CRUD: `GET/POST/PATCH/DELETE /api/admin/identity-providers[/:id]`.
  - `clientSecret` is write-only: responses carry `hasClientSecret: true`, and a PATCH
    without it keeps the old one.
  - Validate the URLs as https (http allowed only for localhost/RFC1918 hosts).

**Templates** — web-only constants, provided to T6:
- **GitHub:** `https://github.com/login/oauth/authorize`,
  `https://github.com/login/oauth/access_token`, `https://api.github.com/user`,
  scope `read:user user:email`; mapping `identifier: login`, `displayName: name`,
  `email: email`, `avatarUrl: avatar_url`.
- **Google:** `https://accounts.google.com/o/oauth2/v2/auth`,
  `https://oauth2.googleapis.com/token`, `https://openidconnect.googleapis.com/v1/userinfo`,
  scopes `openid email profile`; mapping `identifier: sub`, `email: email`,
  `displayName: name`, `avatarUrl: picture`.
- **GitLab:** `https://gitlab.com/oauth/authorize`, `https://gitlab.com/oauth/token`,
  `https://gitlab.com/api/v4/user`, scope `read_user`; mapping `identifier: username`,
  `email: email`, `displayName: name`, `avatarUrl: avatar_url`.
- **Custom:** blank.

**Tests** use a fake IdP (local Hono server or stubbed `fetch`):
- code exchange (JSON and form)
- mapping
- filter
- linked vs email-match vs no-match
- archived
- redirectUri mismatch
- the secret is never returned
- link and unlink

Run: `vitest run src/sso src/accounts src/db src/auth`, then `tsc`.

---

### T4 — Backups with restic, configured from the UI (fast)

**Migration 3**: none. Config lives in `instance_settings` under key `backup` as JSON,
with the secrets encrypted via `db/crypto.ts`. If T3 isn't merged yet, create
`db/crypto.ts` exactly as specified in T3; the orchestrator dedupes.

**Files**
- Create: `server/src/backups/{restic,config,scheduler,routes}.ts` and their tests
- Modify: `server.ts` (mount under `requireAdmin`), `main.ts` (start the scheduler)

**Config shape**

```ts
type BackupDestination =
  | { type: "local"; path: string }                                   // absolute dir
  | { type: "sftp"; host: string; port: number; user: string; path: string }   // key generated by app
  | { type: "rest"; url: string; username?: string; password?: string }        // restic rest-server
  | { type: "s3"; endpoint: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey: string; region?: string }
  | { type: "rclone"; remote: string; path: string; rcloneConfig: string };     // pasted rclone.conf section
interface BackupConfig {
  destination: BackupDestination | null;
  repoPasswordEnc: string | null;
  schedule: { enabled: boolean; time: "HH:MM" };              // local time, daily; default 03:30
  retention: { daily: number; weekly: number; monthly: number }; // 7/4/12
  lastRun: { at: string; ok: boolean; message: string; snapshotId?: string } | null;
  lastCheck: { at: string; ok: boolean; message: string } | null;
}
```

**`restic.ts`**
- `runRestic(args, dest, password, {signal, timeoutMs}) → {code, stdout, stderr}` uses
  `spawn("restic", [...args, "--json"])`. The env contains only:
  - `PATH`, `HOME` (set to `<dataDir>/.backup/home`)
  - `RESTIC_PASSWORD`
  - the destination vars: `RESTIC_REPOSITORY`, `AWS_*` for s3, `RESTIC_REST_USERNAME`/`PASSWORD`
  - for sftp: `-o sftp.command=ssh … -i <key> -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=<dataDir>/.backup/known_hosts`
  - for rclone: `RCLONE_CONFIG=<dataDir>/.backup/rclone.conf` (0600)
- Never log secrets; redact them in error messages.
- Repository strings:
  - local → the path
  - sftp → `sftp:user@host:/path`
  - rest → the URL
  - s3 → `s3:<endpoint>/<bucket>/<prefix>`
  - rclone → `rclone:<remote>:<path>`

**SFTP key.** `POST /api/admin/backups/sftp-key` generates an ed25519 keypair with
`ssh-keygen -t ed25519 -N "" -f <dataDir>/.backup/id_ed25519` (0600), returns
`{publicKey}`, and is idempotent.

**Routes** (`/api/admin/backups`)
- `GET /` → config with secrets redacted, plus `{resticVersion}`.
- `POST /test {destination}` checks reachability:
  - `restic cat config` with the stored password if a repo exists
  - otherwise `restic snapshots` expecting "repository does not exist" versus an
    auth/network error
  - returns `{ok, state: "empty"|"existing"|"error", message}`
- `POST /init {destination, existingPassword?}`:
  - if the state is `empty`, generate a password (32 random bytes → base64url) and run
    `restic init`
  - if `existing`, the caller must pass `existingPassword`, which is verified
  - save the config, then return `{recoveryKit: {repository, password, restoreSteps: string[]}}`
    — the only time the password is shown
- `PATCH /` → schedule/retention.
- `POST /run` → a backup now. It's also a job-like status object in memory with
  `GET /status` → `{running, phase, startedAt, lastRun}`.
- `GET /snapshots` → `restic snapshots --json`, mapped to `{id, shortId, time, paths, sizeBytes?}`.
- `POST /restore {snapshotId, scope: {type:"note"|"set", username, path}}`:
  1. `restic restore <id> --target <dataDir>/.backup/restore-<ts> --include /<abs path of users/<username>/<set or note>>`
  2. copy into the user's tree, overwriting under that workspace's locks, and commit
     `system: restore <path> from snapshot <short>`
  3. delete the staging dir
  - Whole-instance restore is CLI-only: document it in DEPLOY.md.
- `POST /check` → `restic check --read-data-subset=5%` and records `lastCheck`.

**Backup run**
1. `db.backup(<dataDir>/.backup/studium.db)` (online SQLite backup), then
2. `restic backup <dataDir> --exclude <dataDir>/studium.db* --exclude <dataDir>/.backup/restore-* --exclude **/.cache --tag studium`
   — this keeps `.backup/studium.db` and `.secret`
3. `restic forget --prune --keep-daily … --keep-weekly … --keep-monthly …`
4. record `lastRun`, and on failure call `notifier.notifyAdmins("backup failed", message)`
   (T5 interface; no-op until T5)

**`scheduler.ts`** — a `setTimeout` to the next `HH:MM` local time that reschedules
itself. A monthly check runs on the 1st after the backup. `stop()` on shutdown. Only one
run at a time (mutex).

**Tests** use a real restic against a local-path repo in a tmpdir (restic is installed;
skip with a clear message if `restic` is missing):
- test → init → run → snapshots
- delete a note, restore it, and it's back and committed
- the password is never returned after init
- the env contains no stray `process.env`

Run: `vitest run src/backups`, then `tsc`.

---

### T5 — Notifications, data export, service files (fast)

**Migration 4**

```sql
CREATE TABLE user_settings (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
```

**Files**
- Create: `server/src/notify/{ntfy,webpush,notifier,routes}.ts` and their tests,
  `server/src/export/routes.ts` and its test, `deploy/studium.service`,
  `scripts/install-service.sh`
- Modify:
  - `server.ts` (mount `/api/me/notifications`, `/api/me/export`)
  - `main.ts` (create the notifier)
  - `workspaces/manager.ts`: subscribe to each workspace hub; for `{type:"job"}` events
    whose status becomes done or failed, call `notifier.notifyUser(user, …)`
  - `compose.yaml`, `Dockerfile` (install restic + rclone; volume `./data:/data`,
    `STUDIUM_DATA_DIR=/data`)
  - `docs/DEPLOY.md`
- Dependency: `web-push` (exact version pinned) + `@types/web-push`.

**Notifier** → `notifyUser(userId, {title, body, url})` and `notifyAdmins(...)`
- **ntfy:** user setting `ntfy = {url: "https://ntfy.sh/<topic>" | self-hosted, token?}`
  (token encrypted). POST the body with headers `Title`, `Click` (absolute url from
  `instanceUrl`), and `Tags`. 5 s timeout.
- **Web Push:**
  - VAPID keys are generated once and stored in `instance_settings.vapid`, with the
    private key encrypted.
  - Send via `web-push` to each subscription. On 404/410, delete the subscription.
  - Payload `{title, body, url}`.
- Failures are logged, never thrown into job code.

**Routes** (`/api/me/notifications`)
- `GET` → `{ntfy: {url, hasToken}, vapidPublicKey, subscriptions: [{id, userAgent, createdAt}], events: {jobDone, jobFailed}}`
- `PUT /ntfy {url, token?}`
- `POST /push {endpoint, keys: {p256dh, auth}}`, `DELETE /push/:id`
- `PATCH /events`
- `POST /test` sends a test notification to all channels.

**Export.** `GET /api/me/export` streams a zip (jszip `generateNodeStream`, already a
dependency) of the user's tree: everything except `.git`, `.cache` and `chats`, plus a
`?withHistory=1` option that includes `.git`. Filename `studium-<username>-<date>.zip`.

**Service**
- `deploy/studium.service` — a systemd *user* unit:
  - `WorkingDirectory=%h/learny`
  - `ExecStart=/usr/bin/env pnpm --filter @studium/server start`
  - `Restart=on-failure`
  - `Environment=NODE_ENV=production`
  - `EnvironmentFile=-%h/learny/.env`
- `scripts/install-service.sh`: copies it to `~/.config/systemd/user/`, runs
  `daemon-reload`, `enable --now`, and prints the `loginctl enable-linger $USER`
  reminder. The script doesn't run sudo.

**Tests**
- ntfy request shape (stub fetch)
- web-push dispatch with a stubbed `sendNotification`, and a 410 removes the subscription
- job done → notifyUser
- export zip contains notes, not `.git` or `chats`

---

### T6 — Web UI for M3a (Sonnet, must use `ui-ux-pro-max` skill)

Port from Memos where noted and keep its MIT notice. Layout follows Memos'
`components/Settings/*` pattern (`SettingSection`, `SettingGroup`, `SettingRow`,
`SettingTable`, `settingSections.ts`).

- **`/setup`**: shown when `status.setupRequired`. Fields: username, password ×2, and
  the setup code when the server requires one. Creates the admin.
- **`/auth` (SignIn)**: port Memos `SignIn.tsx`:
  - a password form (hidden for non-admins when `disallowPasswordAuth`; an "Admin sign-in"
    link like Memos `AdminSignIn`)
  - one button per identity provider
  - an SSO click builds the auth URL with `state` + PKCE S256 (`code_challenge`), and
    stores `{state, codeVerifier, providerId, mode: "signin"|"link", returnUrl}` in
    `sessionStorage`
  - no sign-up link
- **`/auth/callback`**: port Memos `AuthCallback.tsx`. Validate the state, then POST
  `/api/auth/sso` (sign-in) or `/api/me/identities` (link) and navigate back.
- **Settings** (sections like Memos `settingSections.ts`):
  - Account: profile, password, linked identities, sessions (revoke), access tokens
    (create → show once → copy)
  - Notifications: ntfy URL/token and test; "Enable push on this device", which asks
    permission and subscribes via the service worker; event toggles
  - Data: "Download all my data"
  - Admin only:
    - Members: list, create (username, password, role, AI on/off), edit, archive, purge
      with confirm
    - SSO: providers with the GitHub/Google/GitLab/Custom templates from T3 and the
      callback URL shown for copying
    - Instance: instance URL, disallow password sign-in
    - **Backups** wizard:
      1. choose a destination type (cards)
      2. fill the form (SFTP shows the generated public key with a copy button)
      3. Test connection
      4. Set up
      5. **recovery kit** screen: password + steps + "Download as .txt"; can't continue
         until "I saved it" is ticked
      Then a status panel: last run, next run, schedule, retention, Back up now, Check,
      and a snapshot list with Restore (pick set/note) and confirm.
- **Service worker:** handle `push` (show the notification) and `notificationclick`
  (open the url). vite-plugin-pwa is already there; add a custom `sw` handler via
  `injectManifest`, or `importScripts` in the workbox config — pick the smallest change
  that works.
- All at 390px and 1440px, with real-click verification.

---

### T7 — Audit and end-to-end (precise, then Claude)

- `precise` read-only security audit of T1–T5:
  - session/PAT handling
  - SSO (redirect URI, state, secret exposure)
  - path confinement for usernames and restores
  - restic env and secret leaks
  - last-admin rules
  - AI gate coverage
- Findings go to `scratchpad/m3a-audit-report.md`.
- Claude, end to end on a copy of the real data:
  - legacy migration
  - sign in
  - a second user is isolated
  - GitHub SSO link and sign-in (if the learner provides an OAuth app)
  - a backup to a local repo, then restore of a deleted note
  - ntfy test
  - export zip
  - the systemd service survives a reboot of the unit

## Rollout on the learner's box

1. Stop the dev server.
2. `cp -a data data.pre-m3a` as a safety copy.
3. Merge and `pnpm --filter @studium/web build`.
4. `scripts/install-service.sh`.
5. The first boot migrates the `.env` login and moves `data/study` → `data/users/<username>`.
6. Sign in and check the notes.
7. Set up backups in Settings to restic rest-server on backup.example.com; the learner runs
   `rest-server` there or picks SFTP.
