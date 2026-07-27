# @atlitos/e2e

Playwright E2E harness for the four deployed Atlitos web surfaces. Built in
QA-audit phase B1a; domain specs arrive in B1b once the behavior catalog
freezes.

## Run

```sh
# one-time
pnpm install
pnpm --filter @atlitos/e2e install-browsers   # installs chromium

# everything
E2E=1 pnpm --filter @atlitos/e2e test

# just the smoke health spec
E2E=1 pnpm --filter @atlitos/e2e test:smoke

# specs that hit the DB directly or reseed additionally need:
E2E=1 SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @atlitos/e2e test
```

## The guard (why E2E=1)

The harness contains a service-role SQL helper (`helpers/sql.mjs`), and a
service-role client bypasses RLS entirely. So there is a hard, two-part guard
checked before any service-role client or seed reset is created, and mirrored
in `playwright.config.ts` so nothing runs at all without it:

1. The Supabase URL host must be exactly `syzzfgaudpifwvbpycyi.supabase.co`,
   the one allowed test project. Any other host throws.
2. `E2E=1` must be set explicitly. This is an arming switch: a stray
   `playwright test` or an accidental import can never touch the DB.

The service role key is never hardcoded and never stored in this package. It
is read only from `process.env.SUPABASE_SERVICE_ROLE_KEY`, the same contract
as `scripts/seed-demo-users.mjs`.

`helpers/sql.mjs` also exports `assertIsolation(idA, idB)`: call it on the two
owner ids before trusting any cross-party isolation assertion. It throws if
the ids are missing or equal, which is exactly the AT-62 failure mode (an
isolation test that passes vacuously because both sides were the same party).
See CLAUDE.md, "Scope every query by owner".

## Personas and storage states

`auth.setup.ts` (the `setup` project) logs in each demo persona with the
Supabase password grant and writes `state/<persona>.json` (gitignored,
regenerated every run). One state file authenticates all four surfaces: it
carries the supabase-js localStorage entry for athlete-web and admin, and the
`@supabase/ssr` cookie encoding for portal-court and portal-life.

| persona | email |
| --- | --- |
| player | player@atlitos.dev |
| coach1 | coach1@atlitos.dev |
| coach2 | coach2@atlitos.dev |
| partner | partner@atlitos.dev |
| p2-verify-partner | p2-verify-partner@atlitos.dev |
| admin | admin@atlitos.dev |
| upa-verified | upa.verified@atlitos.dev |
| upa-tennis | upa.tennis@atlitos.dev |
| donor | donor@atlitos.dev |

A spec opts into a persona with:

```ts
import { test, expect } from "../fixtures";
test.use({ persona: "player" });
```

No `persona` means an anonymous context. If a persona failed to log in during
setup, requesting it throws with a pointer to `state/_auth-report.json`, which
records every login attempt. Set `E2E_AUTH_STRICT=1` to make any persona
login failure fail the setup project outright.

Known at scaffold time: `upa-verified`, `upa-tennis`, and `donor` get
`invalid_credentials` on the live test DB. `scripts/seed-empower-upa-users.mjs`
(which creates them, service role required) appears not to have been run
there. Run it once with `SUPABASE_SERVICE_ROLE_KEY` set and they will start
passing setup.

## Layout

- `playwright.config.ts` — `setup` project plus one project per surface
  (athlete-web, portal-court, portal-life, admin), each depending on `setup`.
  Workers 4, retries 1, trace retain-on-failure, video off.
- `auth.setup.ts` — persona logins, storage state writer.
- `fixtures/` — `auth` (persona option), `seed` (DB resets), `console-guard`
  (auto-fails any test with uncaught console errors, small allowlist);
  `index.ts` merges all three.
- `helpers/sql.mjs` — guarded service-role client, `assertIsolation`.
- `seed/reset.mjs` — thin, memoized wrappers around the root
  `scripts/seed-*.mjs`; guarded by the same test-DB check.
- `specs/smoke/health.spec.ts` — proof of life: every surface returns 200 and
  renders without console errors.
- `state/` — gitignored per-persona storage states plus `_auth-report.json`.
