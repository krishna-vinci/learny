# Security

Report suspected vulnerabilities privately through GitHub's **Security → Report a
vulnerability** on [the repository](https://github.com/krishna-vinci/studium/security/advisories/new).
Include the affected version, installation method, reproducible steps and impact;
redact tokens, cookies and personal learning content. If reporting is unavailable,
ask the maintainer to enable private vulnerability reporting without posting exploit
or secret details in a public issue. Do not publish details before a fix is available.

## Supported versions

Security fixes target the latest released 0.1.x version. Earlier prerelease builds
and the moving `main` branch have no separate support guarantee. Until v0.1.0 is
published, there is no supported stable release.

## Model

Authenticated sessions use httpOnly, SameSite Strict cookies; HTTPS base URLs enable
Secure cookies. Login/setup are rate limited. Non-loopback first boot needs the
one-time setup code printed in server logs. There is no public sign-up: admins add
users. Personal access tokens can be revoked. Each user has a separate study tree;
file tools confine real paths to that root and take per-file locks. Git records edits.

Fetches validate public destinations and redirects to reduce SSRF. Configured
Firecrawl/MinerU endpoints are operator-trusted exceptions: isolate them and give
Firecrawl public-only egress. Generated artifacts run in an opaque-origin iframe
with `sandbox="allow-scripts"` (no `allow-same-origin`) and a restrictive CSP.
Agents have per-role tool allowlists, no shell, and no direct Anki writes.

Keep data, instance secrets, backups and `/pi-agent` credentials private. Model
providers receive the passages needed for requested jobs. API keys/Pi credentials
are instance-wide; use a trusted group of users. Bind the published port to loopback
and use TLS for remote access. Enable trusted proxy headers only behind a proxy
that overwrites them. See [deployment](docs/DEPLOY.md) for details.
