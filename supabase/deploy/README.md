# supabase/deploy

Post-deploy scripts. These are NOT migrations, and `supabase/migrations/` must never contain
them again: a migration has to be replayable, unattended, on a clean database in any
environment, and a script that depends on environment-specific secrets (a project URL, a
service-role key, a live vault entry) cannot make that promise. Put one there and either it
fails a from-scratch apply everywhere that has not manually pre-seeded the vault, as
`0111_notification_push_sweep_schedule.sql` did (moved 2026-08-14, see below), or someone
weakens the guard into a silent skip, which CLAUDE.md is explicit is worse: a check that should
apply but cannot run is a failure, not a skip.

A script in this directory is:

- **Idempotent.** Safe to run twice. Re-running produces the same end state, not an error and
  not a double schedule.
- **Guarded, not silent.** If a precondition is missing (an extension, a vault secret), the
  script raises with the exact remediation, the same shape the removed migration used. It does
  not fall through to "did nothing" without saying so.
- **Run once per environment, by a human, after the schema migrations for that environment are
  applied.** Not part of `supabase db push`, not part of `supabase start`, not part of CI.

## Scripts

### `notification_push_sweep_schedule.sql`

Schedules the R-7 push relay (`notify-push-sweep`) via `pg_cron` plus `pg_net`, authenticated
from two Supabase Vault secrets that must exist first:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url',
  'Base URL for in-database calls to edge functions');
select vault.create_secret('<service-role key>', 'service_role_key',
  'Service role key used by pg_cron jobs that call edge functions');
```

Run those two statements once per environment, against that project only, then run this script:

```
psql "$ATLITOS_DB_URL" -f supabase/deploy/notification_push_sweep_schedule.sql
```

It refuses to run, with a named error, if `pg_cron`, `pg_net`, or either vault secret is
missing. It never falls through to a silent no-op.

**Not yet run against production** as of 2026-08-14. Production has zero rows in
`vault.secrets` (verified read only), so the two `vault.create_secret` calls above are still
outstanding there. Until they run, `notifications.pushed_at` accumulates unclaimed rows in
production; see `docs/DEBT.md`.

**Was migration `0111_notification_push_sweep_schedule.sql`, moved 2026-08-14.** The guard logic
is unchanged, character for character, from what the migration raised. Only its location and
the fact that it is no longer numbered into `schema_migrations` changed. Every place that used
to cite `0111` now cites this file: `supabase/functions/notify-push-sweep/index.ts`,
`docs/qa/verify/SCALE-REALTIME.md`, `docs/architecture/API-MAPPING.md`.
