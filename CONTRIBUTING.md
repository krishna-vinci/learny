# Contributing

Use Node.js 22.15+ and pnpm 10.28.2 (`corepack enable`). Clone the repository, then:

```sh
pnpm install --frozen-lockfile --prefer-offline
cp .env.example .env
pnpm --filter @studium/server dev
# In another terminal:
pnpm --filter @studium/web dev
```

Open the Vite URL and create the first admin. Configure provider credentials as
explained in [deployment](docs/DEPLOY.md). Pandoc/Typst are optional for native dev
unless testing book export. External research services are optional.

Read [AGENTS.md](AGENTS.md) and the relevant specs before changing behavior. Test
only the changed modules locally: `pnpm --filter @studium/server exec vitest run
src/path/module.test.ts` (use `-t` for a small fix). New behavior needs focused tests
plus existing tests for the affected modules. Shared interfaces also need relevant
consumer tests. Auth, tree files/git/migrations, agent tool allowlists, artifact
sandboxing and Anki exports need tests for the whole affected area. Full suites run
in CI. Tests use temporary trees and fake providers/services, never live data or
paid/network services.

Run `pnpm exec biome check <changed files>`; format only your own changes with
`--write`. Run `pnpm --filter @studium/<package> exec tsc --noEmit` for affected
packages when types change. Use conventional commits (`feat:`, `fix:`, `docs:`,
`chore:`) and keep PRs focused.

Before opening a PR, check that behavior and docs agree, scoped checks pass,
third-party notices remain intact, no credentials/private data are included, and
phone UI changes work at 390 px. Describe the change and exact validation commands.
Report vulnerabilities through [SECURITY.md](SECURITY.md).
