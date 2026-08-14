# Local Supabase stack

First written 2026-08-14, the day this repo got a working local Supabase stack for the first
time. Everything below was run, watched, and quoted; nothing is assumed. See `docs/DEBT.md` for
what remains unresolved and `docs/qa/verify/SCALE-REALTIME.md` for the R-7 push sweep this setup
had to route around.

## Prerequisites

- `export PATH=/opt/homebrew/bin:$PATH` (Homebrew's supabase CLI, not an older one on PATH).
- colima running: `colima start` (4 CPU / 8 GB / 40 GB was the tested profile). `docker run
  hello-world` should pass first.
- **Analytics is disabled in `supabase/config.toml`.** Under colima, the analytics
  (vector/logflare) service bind mounts the docker socket to tail container logs, and colima's
  docker socket is a macOS unix socket shared into the VM over virtiofs, which cannot proxy live
  socket special files. `supabase start` fails on every run with "mkdir
  .../docker.sock: operation not supported" until this is off. Does not affect Docker Desktop; if
  this repo ever runs there instead, analytics can be re-enabled.

## Bring the stack up

```
supabase start
```

Applies every migration in `supabase/migrations/` in order, then starts the containers.
`supabase status` after a clean start: 10 containers healthy (db, auth, rest, realtime, storage,
kong, studio, pg_meta, inbucket, edge_runtime). `imgproxy`, `pooler`, `analytics`, `vector` show
as stopped, which is correct: pooler and image_transformation are OFF by config default, and
analytics is disabled for the colima reason above. None of the four is a failure.

Two structural migration bugs were found and fixed getting to this point, both explained at
length in the commit messages of `fix(deploy): move R-7 push sweep scheduling out of migrations`
and `fix(migrations,local): first clean supabase start on this repo`:

1. `0111_notification_push_sweep_schedule.sql` depended on two Supabase Vault secrets that
   cannot exist on a clean database in any environment. Moved to
   `supabase/deploy/notification_push_sweep_schedule.sql`, a post-deploy script, not a migration.
2. `0113_bounded_reads_support.sql` mixed `CREATE INDEX CONCURRENTLY` with ordinary DDL in one
   file. supabase's migration runner pipelines every statement in a file, and `CONCURRENTLY`
   refuses to run inside a pipeline. Split into `0114_notifications_covering_index.sql`.

## Seed the database

The 7 files in `supabase/seed/` are NOT a `supabase db reset` seed set (`config.toml`'s
`[db.seed] sql_paths` still points at the single, nonexistent `./seed.sql`, unchanged from the
CLI's own default). Three of the seven need service-role scripts run first to create demo
`auth.users` accounts, because `auth.users` cannot be written by a raw SQL insert that GoTrue
will ever recognize for real sign-in (`seed_identity.sql`'s own header explains why).

Verified working order, every step actually run against a from-scratch local stack:

```
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`, the "Secret" key>

node scripts/seed-demo-users.mjs            # player/partner/admin/coach1/coach2@atlitos.dev
psql "$LOCAL_DB_URL" -f supabase/seed/seed_identity.sql
psql "$LOCAL_DB_URL" -f supabase/seed/seed_p2.sql          # 8 venues, needs partner@atlitos.dev
psql "$LOCAL_DB_URL" -f supabase/seed/seed_p4_commerce.sql # 14 products, 27 variants
psql "$LOCAL_DB_URL" -f supabase/seed/seed_p5_clutch_fixtures.sql
node scripts/seed-empower-upa-users.mjs      # upa.*/donor@atlitos.dev
psql "$LOCAL_DB_URL" -f supabase/seed/seed_p6_empower_fixtures.sql
psql "$LOCAL_DB_URL" -f supabase/seed/seed_p7_learn.sql
psql "$LOCAL_DB_URL" -f supabase/seed/seed_promo_banners.sql
```

`$LOCAL_DB_URL` is the URL `supabase status` prints under Database, normally
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

**`seed_identity.sql` targets `demo.coach@atlitos.dev` / `demo.admin@atlitos.dev`, which
`scripts/seed-demo-users.mjs` does NOT create** (it creates `coach1@atlitos.dev`,
`coach2@atlitos.dev`, `admin@atlitos.dev` instead). Both scripts are real and both run clean, but
their email lists never intersect, so `seed_identity.sql` inserts 0 rows against a stack seeded
only by `seed-demo-users.mjs`. Not fixed here since it is not blocking (the accounts
`seed-demo-users.mjs` does create already cover coach/admin/partner/player roles); flagged for
whoever next needs the exact two `demo.*` accounts.

`seed_p5_clutch_fixtures.sql` and `seed_p7_learn.sql` needed real fixes, not just an order,
because they were written against an older schema or an assumed-preexisting user set that no
script in this repo actually creates; see their own file headers, dated 2026-08-14, for exactly
what was wrong and why the fix is shaped the way it is. `seed_p5` additionally now seeds 36
comments on one clip so the comments-sheet overflow bug is provable for the first time (production
carries 3 comments across two clips total).

Other `scripts/seed-*.mjs` files exist (`seed-groups-demo.mjs`, `seed-coaching-fixtures.mjs`,
`seed-affiliate-catalog.mjs`, `seed-upa-verified-donations.mjs`, `seed-clutch-clip-bytes.mjs`,
`seed-onboarding-demo.mjs`) and were NOT run or verified in this pass; two of them
(`seed-groups-demo.mjs`, `seed-upa-verified-donations.mjs`) read
`apps/mobile/.env`'s `EXPO_PUBLIC_SUPABASE_URL` directly rather than accepting `SUPABASE_URL`,
so they need that file to point at the local stack before they can run against it safely, and
that file was never read in this pass (permission denied by design; credentials come from
`supabase status` only).

## Pointing the mobile app at the local stack

`apps/mobile/.env` stays untouched: it is permission denied by design on this repo, and even
without that, a build that silently points at localhost and gets shipped is a far worse outcome
than any bug chased here.

`apps/mobile/scripts/run-local.sh` exports `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY` (both from `supabase status`) and a Razorpay TEST key directly
into its own process before execing `expo run:ios --configuration Release`. Expo's env loader
only fills a variable from a `.env` file when it is not already present in the process
environment, so these three exported values win over `apps/mobile/.env` for that one run only,
no file on disk changes. Run it with `pnpm --filter @atlitos/mobile ios:local` or directly as
`apps/mobile/scripts/run-local.sh`.

Why it cannot leak into a shipped build:
1. It is a plain, reviewable script, never invoked by `eas build`, `pnpm build`, or any CI or
   release path in this repo. Only a developer running it by name triggers it.
2. `eas build`'s production profile (`apps/mobile/eas.json`) sets its own `EXPO_PUBLIC_*` values
   under `build.production.env`, a separate code path unaffected by this script, and EAS builds
   run in EAS's own cloud checkout with a fresh process environment that never sees it.
3. The URL is hardcoded to `127.0.0.1`, unreachable outside the machine running the simulator, so
   even a mistaken invocation produces an app that obviously cannot talk to anything, not a silent
   pointer at production.

## Cric Squad fixture for the write-path Maestro flows

`.maestro/groups-athlete.yaml` and `.maestro/groups-coach.yaml` have never run, since production
is read only and both write. They both depend on a "Cric Squad" training group that only
production's fixtures had. `supabase/seed/local_seed_cric_squad.sql` recreates it locally,
idempotently, with two values pinned to what the flows literally assert rather than left
"reasonable": capacity 8 (so the coach detail screen's "4 of 8 spots left" matches the flow's
".*of 8 spots left.*") and every membership's `period_end` fixed at 2026-09-25 (matching the
flow's literal "Active until 25 Sep 2026" string). It also creates a `coach_profiles` row for
`coach1@atlitos.dev`, verified, since the local stack's demo accounts never completed coach
onboarding (`seed_identity.sql`'s email mismatch, documented above, leaves coach1 with zero
coach_profiles rows on a from-scratch stack) and `training_groups.coach_id` references
`coach_profiles(user_id)`, not `users(id)`, so nothing coach-owned can exist without it.

Run after the seven `supabase/seed/*.sql` files above:

```
psql "$LOCAL_DB_URL" -f supabase/seed/local_seed_cric_squad.sql
```

## Danger: the default URL in every seed script is PRODUCTION

`scripts/seed-demo-users.mjs`, `scripts/seed-empower-upa-users.mjs`,
`scripts/seed-coaching-fixtures.mjs` and `scripts/seed-affiliate-catalog.mjs` all default
`SUPABASE_URL` to `https://syzzfgaudpifwvbpycyi.supabase.co` (production) when the env var is
unset. Always export `SUPABASE_URL=http://127.0.0.1:54321` before running any of them locally.
None of these scripts were run without that override in this pass.

---

## Running the Maestro suite locally, and the four things that will waste your day

Added 2026-08-14 after the first full local suite run: 16 flows, 8 pass, 4 fail,
and EVERY failure was environment or leftover state. Not one was a product
regression. Read this before you file anything.

### 1. Reset the fixtures first. Write-path flows eat what they assert on.

    ./scripts/reset-local-fixtures.sh

`groups-coach` asserts its seeded session is `Accepted`, then starts it, marks
attendance and ENDS it. So it passes once and fails forever after, on an
assertion that was correct both times. That is true of every write-path flow.

The reset also clears the PREVIOUS run's attendance marks, which matters more
than it sounds: leaving them makes `3 of 3 present` pass BEFORE the flow marks
anything. A green that proves nothing is worse than a red.

It refuses any non-loopback target.

### 2. The QA simulator must carry Atlitos and nothing else.

`8AF6A5E2-F889-4477-8634-97B4AB5D5453` had Follow Me and BelieversDiary on it
from other projects. Opening `atlitos://` raised a springboard chooser ON TOP of
a correct screen, holding accessibility focus so every assert beneath it failed;
one run handed the deep link to BelieversDiary entirely and captured its
onboarding screen mid-suite. It is NOT a scheme collision (all three
Info.plists were read; none claims another's scheme) but stale LaunchServices
state, and it survived both a Cancel tap and an uninstall until the simulator
was rebooted. Both sibling apps are now removed.

### 3. Authenticated EDGE FUNCTION calls 401 locally on CLI 2.75.

    {"msg":"Invalid JWT"}   HTTP 401

Local GoTrue issues **ES256** (asymmetric, with a `kid`); the edge gateway
verifies **HS256** against the legacy secret. Every authenticated edge function
is unreachable, which is most of the write paths: `book-session`, `checkout`,
`verify-payment`, `join-group`, `stream-upload-url`, `ai-search`.

This is what made `search-domains` fail. Note the app itself behaved WELL there,
showing an honest "Couldn't run that search" rather than a silent empty list,
which is the opposite of the empty-catch bugs found the same day.

RESOLVED 2026-08-14 by upgrading the CLI 2.75.0 -> 2.114.0. Verified after the
upgrade: the token is STILL ES256, but the 2.114 edge gateway verifies
asymmetric tokens correctly, and `ai-search` returns HTTP 200 with real results
(a badminton query resolved a clip and a Kukatpally Badminton Academy court).
So the fix was the gateway, not the token.

**MINIMUM CLI VERSION IS THEREFORE 2.114.0.** On 2.75 every authenticated edge
function is unreachable locally and the write-path suite cannot run at all. If
you are on an older CLI, upgrade before concluding anything about an edge
function. Three separate audit tracks each invented a DIFFERENT workaround for
this exact wall (a hand-signed JWT, the GoTrue admin API, abandoning HTTP), and
their results were consequently not comparable to each other.

### 4. Flows written against production assume production's dataset.

`courts-header` scrolled for a court named "Turf B". It exists locally, but
local carries 24 venues against production's handful (many are e2e artifacts:
ALPHA/BRAVO/MONEY/BLAST/FR7 Arena), so it sat below where the scroll gave up.
The screen was perfect in the failure screenshot. Assert on a shape, not on a
specific row whose position depends on the dataset.

### Seeding

`scripts/seed-*.mjs` now refuse a production target via
`scripts/lib/guard-target.mjs`. All eight previously DEFAULTED to production,
which is how production acquired fixture rows across five tables. Point them at
the local stack:

    SUPABASE_URL=http://127.0.0.1:54321 \
    SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2-) \
    node scripts/seed-demo-users.mjs

Coach availability is seeded by the reset script. Without it NO coach is
bookable and the whole athlete booking funnel is untestable, because the coach
profile CTA stays on "Choose a type, date, and time" with no slots to choose.
