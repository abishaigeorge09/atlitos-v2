# Deploy runbook: applying migrations to the live project

Owner: whoever is holding the deploy. Written 2026-09-12 after the migration
reconciliation pass. Read this before running anything that touches
`supabase/migrations/` against production (`syzzfgaudpifwvbpycyi`).

## The one thing to know

**`supabase db push` is not safe on this project. Do not run it.**

The repo and the live project version migrations under two different schemes,
and they do not overlap at a single point:

| | Version scheme | Example |
| --- | --- | --- |
| Repo files | zero padded sequence in the filename | `0117_upa_photos_bucket_private.sql` |
| `supabase_migrations.schema_migrations` | UTC timestamp in the `version` column | `20260814013358`, name `0117_upa_photos_bucket_private` |

The CLI matches on `version`, not on `name`. Every local file therefore looks
unapplied to it. A `supabase db push` today would attempt to replay all 116
files from `0001_identity` onward against a database that already has all of
them, which means `create table public.clip_saves`, `alter type ... add value`,
`create policy`, `create index` and every other non idempotent statement
running a second time. Some fail loudly, some succeed and do damage. Replaying
`0027_session_transition_service_role_gate` is called out separately below.

## Current state, 2026-09-12

* Production ledger: **109 rows**, oldest `20260713064243`, newest
  `20260814013358` (`0117_upa_photos_bucket_private`).
* Repo: **116 files** in `supabase/migrations/`.
* 88 ledger rows correspond to repo files `0001` through `0087`, verified by
  comparing the ledger's stored SQL against each file after stripping comments
  and collapsing whitespace. 19 of those rows are recorded under a name with
  the numeric prefix stripped (`anonymous_user_support` is local `0008`,
  `co04_decline_refund` is local `0085`, and so on). One repo file,
  `0028_route_transfers.sql`, was deliberately applied as two ledger rows,
  `route_transfers` (the bare `alter type ... add value`) and
  `route_transfers_rpcs` (everything after it), because `add value` cannot be
  used in the same transaction that creates it. The file stays whole.
* 21 ledger rows had no repo file at all. Those are now **vendored**: the exact
  SQL was read back out of `schema_migrations.statements[1]` and written to
  `supabase/migrations/` under the production name. Each vendored file
  reproduces its ledger entry byte for byte apart from a single trailing
  newline. They carry no added commentary, on purpose: they are a record of
  what is deployed, not a place to write new notes.

  ```
  0088_clip_saves                                0095_admin_order_refund
  set_athlete_sports                             0096_suspend_enforcement_and_kpis
  join_group_member_before_full                  0096a_is_actor_active_anon_revoke
  security_lockdown_phase1                       0097_report_block
  security_lockdown_phase1_public_grant_fix      0107_money_edge_referential_restrict
  security_lockdown_phase1_has_role_public_fix   0108_courts_arm_captured_payment_guard
  0090_rls_initplan_subselect_wrap               0109_capture_finalization_reentry
  0091_consolidate_duplicate_permissive_select   0116_public_bucket_reads_mirror_row_gates
  0092_chat_broadcast_send                       0117_upa_photos_bucket_private
  0093_rate_limit_and_ai_spend
  0094a_clip_failed_enum_value
  0094b_clip_failed_state_and_sweep_capture
  ```

* 8 repo files have **never been applied** to production. They previously sat
  at `0088` and `0090` through `0095`, colliding with different production
  migrations of the same number. They are renumbered above the highest
  production number, order preserved:

  | Was | Now | Status against production |
  | --- | --- | --- |
  | `0088_payment_finalization_recovery` | `0118_payment_finalization_recovery` | overlaps `0109`, do not apply as is |
  | `0089_coach_trainee_video_path_lock` | `0119_coach_trainee_video_path_lock` | needed |
  | `0090_user_suspension_enforcement` | `0120_user_suspension_enforcement` | overlaps `0096`, needs a decision |
  | `0091_order_transition_atomic_audit` | `0121_order_transition_atomic_audit` | needed |
  | `0092_user_blocks` | `0122_user_blocks` | overlaps `0097`, needs a decision |
  | `0093_account_deletion` | `0123_account_deletion` | needed, depends on `0120` |
  | `0094_chat_preview_and_bounds` | `0124_chat_preview_and_bounds` | needed |
  | `0095_rate_limits` | `0125_rate_limits` | overlaps `0093`, do not apply as is |

  QA documents written before 2026-09-12 (`docs/qa/MANUAL-TEST-RUN-2026-09-04.md`,
  `docs/qa/SECURITY-REMEDIATION-2026-09-04.md`,
  `docs/qa/UX-AND-BUG-REPORT-2026-09-05.md`,
  `docs/qa/RELEASE-READINESS-2026-09-07.md`,
  `docs/qa/TEST-SUITE-ATHLETE-APP.md`) still cite the old numbers. They are
  dated records of what was true then; read them through this table.

## Ordering caveats introduced by vendoring, read before running the local harness

Six production migrations carry names with no numeric prefix, so the repo's
filename order is not production's apply order. Two consequences, both only on
a fresh or restored environment. Production is unaffected.

**1. `scripts/verify-migrations-local.sh` fails as of this change.** It applies
`supabase/migrations/*.sql` in glob order under `ON_ERROR_STOP=1`. Glob order
puts `security_lockdown_phase1.sql` before `set_athlete_sports.sql`, because
`sec` sorts before `set`. The last statement of `security_lockdown_phase1` is
`revoke execute on function public.set_athlete_sports(public.sport[],
public.sport) from anon;`, and nothing else in the repo creates that function,
so the revoke raises "function does not exist" and the run stops. Production
applied them the other way round (`set_athlete_sports` at `20260804135244`,
`security_lockdown_phase1` at `20260806204230`).

Two ways to fix, both a founder call because the first one weakens the "the
filename is the production name" rule this vendoring pass established:

* Give the six timestamp-named files an ordering prefix while keeping the
  production name inside it, for example `0087a_join_group_member_before_full.sql`,
  `0088a_set_athlete_sports.sql`, `0089a_security_lockdown_phase1.sql`. Then
  glob order equals ledger order and the harness needs no change.
* Or teach the harness an explicit order file rather than relying on the glob.

Production apply order for the six, for whichever fix is chosen:

```
20260803230110  join_group_member_before_full
20260804133718  0088_clip_saves
20260804135244  set_athlete_sports
20260806204230  security_lockdown_phase1
20260806204314  security_lockdown_phase1_public_grant_fix
20260806204332  security_lockdown_phase1_has_role_public_fix
20260806224130  0090_rls_initplan_subselect_wrap
```

**2. `0096` and `0097` are numbered against their apply order.** Production
applied `0097_report_block` at `20260807043523` and
`0096_suspend_enforcement_and_kpis` at `20260807044458`, so `0097` ran FIRST.
That matters: `0096`'s DO block adds a restrictive suspension policy to every
table that already has a permissive authenticated INSERT policy, and
`blocked_users` is created by `0097`. Production therefore has
`blocked_users_active_insert`; a fresh replay in filename order would not.
The vendored filenames keep production's own names, including this inversion.

## What each pending migration would actually do

Verified against the live catalog on 2026-09-12, not inferred from the file.

**`0118_payment_finalization_recovery`. Do not apply unchanged.** Production
already has `payment_intents.finalized_at` and three more finalization columns
from `0109`, already backfilled. `0118` adds only `finalized_at`, with
`if not exists`, so that part is inert. Two problems remain. Its
`create index if not exists idx_payment_intents_unfinalized` uses the same name
as `0109`'s index with a different definition, so it silently does nothing and
the index `0118` wants never lands. Worse, it replays `expire_stale_holds()`
from before `0108` and before `0094b`: the courts arm loses the captured
payment predicate that stops a paid booking being expired and its slot resold,
and the per arm `sweep_failures` capture disappears. The genuinely new and
wanted part is `payment_finalization_backlog()`, which production does not
have. Recommendation: split that function into its own migration and drop the
rest.

**`0119_coach_trainee_video_path_lock`. Needed, apply.** Production's
`coach_trainee_videos_coach_insert` policy is still the weak version, checking
only `coach_id = auth.uid() and has_role('coach')`. It does not require
`storage_path is null` and does not require a real `sessions` link, so a coach
can still choose an arbitrary object key and attach video to any athlete.
No production migration supersedes this.

**`0120_user_suspension_enforcement`. Partial overlap, founder decision.**
Production got suspension enforcement from `0096` instead, by a different
design. `0096` created `is_actor_active()` and restrictive
`<table>_active_insert` / `_active_update` / `_active_delete` policies across
roughly 40 tables. `0120` creates a second function, `is_active_user()`, and a
second restrictive set named `<table>_active_user_only`, over 12 tables.
Restrictive policies AND together, so applying `0120` does not break access,
but it leaves two functions and two policy families expressing one rule, which
is exactly the drift this runbook exists to stop. `0120` also replaces
`admin_suspend_user` and `admin_reinstate_user` with versions that write a
member notification, which `0096`'s do not, and it adds the suspension arm to
`custom_access_token_hook`, which production's hook still lacks. The hook arm
and the notification are real gains; the duplicate policy family is not.
Recommendation: rewrite `0120` on top of `0096`'s vocabulary before applying.

**`0121_order_transition_atomic_audit`. Needed, apply.** Confirmed on the live
catalog: production's `order_transition()` does not reference `audit_log` at
all, so the audit row is still written by the edge function outside the
transaction, and `before.status` is still fabricated from a lookup on the
target status.

**`0122_user_blocks`. Partial overlap, founder decision.** Production has
`blocked_users` from `0097`; `user_blocks` does not exist. Same concept, two
table names. `0122` also adds restrictive `clips_hide_blocked` and
`clip_comments_hide_blocked` policies, which `0097` deliberately did not,
preferring client side subtraction. Note the live consequence: the app calls
`useClutch().blockUser()` against `user_blocks` (see
`docs/architecture/API-MAPPING.md`), and that table is not in production, so
blocking is broken today. Recommendation: pick one table name, then either
retarget `0122` at `blocked_users` or retarget the client at whichever name
wins.

**`0123_account_deletion`. Needed, apply after `0120` is settled.**
`users.deleted_at` and `delete_my_account()` are both absent from production,
and App Store guideline 5.1.1(v) needs them. It replaces `is_active_user()` and
`custom_access_token_hook` to add the deleted arm, so it inherits whatever
`0120` decides about `is_active_user()` versus `is_actor_active()`.

**`0124_chat_preview_and_bounds`. Needed, apply.** `chat_thread_previews(uuid[])`
does not exist in production. One thing to check before applying: production's
`chat_messages` gained `removed_at` and `removed_reason` in `0097`, and this
preview function predates that, so confirm a removed message does not surface
as a thread preview.

**`0125_rate_limits`. Do not apply unchanged.** Production already has rate
limiting from `0093`, as `edge_rate_limits` plus `take_rate_limit_token()`.
`0125` builds a parallel `rate_limit_counters` plus `rate_limit_hit()`. It also
replays the same pre `0108` `expire_stale_holds()` that `0118` does, so it
carries the identical courts regression. Recommendation: keep the prune arm
idea, drop the duplicate table, and rebase the sweep on production's current
definition.

None of the eight is byte identical in effect to a production migration. None
was deleted; the recommendations above are for a human to act on.

## Safe procedure for applying a pending migration

1. **Read the ledger first.** `supabase migration list` for the project, or
   `select version, name from supabase_migrations.schema_migrations order by
   version;`. Confirm the name you are about to apply is not already there. Per
   the note in `docs/qa/RELEASE-READINESS-2026-09-07.md`,
   `0027_session_transition_service_role_gate` is already applied and its
   repaired file **must not be replayed**. The same caution applies to every
   name in the ledger.
2. **Never `supabase db push`.** Apply one file at a time, explicitly, so the
   set of statements that runs is the set you read.
3. **Rehearse on a scratch database.** `./scripts/verify-migrations-local.sh`
   applies the entire chain from empty to a throwaway Postgres and then runs
   `scripts/verify-security-fixes.sql`. It is the only thing in the repo that
   proves a migration parses and applies in order.
4. **Read the file for `create or replace function` before applying.** That is
   how these migrations regress production: a replayed definition silently
   reverts a later fix. `expire_stale_holds()`, `order_transition()`,
   `custom_access_token_hook()` and `settle_refund()` have each been redefined
   by more than one migration.
5. **Apply, then record the row.** Whatever applies it must leave a
   `schema_migrations` row with a timestamp `version` and the file's name
   without the numeric prefix if that is the local convention, or with it if
   not. Be consistent, and write down which you chose.
6. **Re-run step 1** and confirm the count moved by exactly one.

## How we got here

Migrations were applied to the live project through a mix of paths. Some went
through the CLI, some through the management API or the MCP `apply_migration`
tool, which stamps a fresh UTC timestamp as `version` and takes the name as a
free text argument. That is why 19 rows carry a name with the numeric prefix
stripped: whoever applied them passed `session_abandon_unpaid` rather than
`0024_session_abandon_unpaid`. It is also why the two version schemes exist at
all.

The 21 unvendored migrations came from work done directly against the live
project during the security passes of 2026-08-04 through 2026-08-14, including
the storage bucket leak fixes (`0116`, `0117`) and the money edge repairs
(`0107`, `0108`, `0109`). The SQL was applied and never committed. The 8
unapplied migrations came from the opposite direction: the remediation work of
2026-09-04 and 2026-09-07 was written, reviewed and committed, and the deploy
never happened. The numbering collision was the arithmetic consequence, two
independent sequences both counting up from `0088`.

To keep this from recurring: a migration is not done until it exists both in
`supabase/migrations/` and in `schema_migrations`, and nothing is applied to
the live project that is not already a committed file.
