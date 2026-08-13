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

## Danger: the default URL in every seed script is PRODUCTION

`scripts/seed-demo-users.mjs`, `scripts/seed-empower-upa-users.mjs`,
`scripts/seed-coaching-fixtures.mjs` and `scripts/seed-affiliate-catalog.mjs` all default
`SUPABASE_URL` to `https://syzzfgaudpifwvbpycyi.supabase.co` (production) when the env var is
unset. Always export `SUPABASE_URL=http://127.0.0.1:54321` before running any of them locally.
None of these scripts were run without that override in this pass.
