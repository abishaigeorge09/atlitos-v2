# Contract drift: docs/architecture vs the live implementation

Lane: does the documentation match the implementation.
Run 2026-08-14, branch `integration/p6-audit-fixes` @ `4793ce4`, project `syzzfgaudpifwvbpycyi`.
Every claim below is backed by a read-only catalog query or a file:line. No writes, no DDL, no device.

Method note, because this repo has been bitten nine times by reasoning from an absence: nothing here
concludes "X does not exist" from a grep. Every absence was re-checked against `pg_proc`, `pg_policy`,
`cron.job`, `information_schema`, `supabase_migrations.schema_migrations`, or the deployed edge
function list. Where a doc name was missing from the catalog, the merged/renamed successor was found
and its expression read before calling anything drift.

---

## The single fact that explains most of this table

**The applied migration ceiling on production is `0097`. The repo contains `0099` through `0106`.**

```
supabase_migrations.schema_migrations, newest rows:
  20260807044724  0096a_is_actor_active_anon_revoke
  20260807044458  0096_suspend_enforcement_and_kpis
  20260807043523  0097_report_block
```

```
supabase/migrations/ contains, above that ceiling:
  0099_backfill_coach_setup_from_verification_payload.sql
  0100_clip_owner_delete.sql
  0101_clip_comments_enabled.sql
  0102_notification_types_coaching.sql
  0103_session_transition_notifications.sql
  0104_membership_expiry_sweep.sql
  0105_membership_sweep_schedule.sql
  0106_realtime_notifications.sql
```

`API-MAPPING.md` and `SCHEMA.md` describe the effects of 0099 to 0106 in the present tense, as
shipped contract. They are not shipped. That is D-01 below and it is the root of D-02, D-03 and part
of D-08.

---

## Drift table

| # | Sev | Doc | Claim | Live reality | Evidence |
|---|---|---|---|---|---|
| D-01 | P1 | API-MAPPING L121, L374, L444, L445; SCHEMA.md L700, L719, and the training-groups bullets at L238+ | 0103/0104/0105 behaviour is live: `session_transition_internal` emits notifications via `notify_session_parties`; `sweep_group_memberships` runs daily as `membership-sweep`; `group_memberships` carries `renewal_reminder_sent_at`/`expiry_notified_at` and a `expired` status | None of it exists. Both functions absent from `pg_proc`. `session_transition_internal` source does not contain the string `notify_session_parties`. `cron.job` holds exactly one job. Both stamp columns absent. Status CHECK has no `expired` | queries below |
| D-02 | P1 | API-MAPPING L32 | `submit_coach_verification` "writes `coach_profiles` and `coach_certificates`, `coach_availability_windows`, and the `verification_requests` row atomically" | The RPC writes `coach_profiles`, `coach_certificates`, `verification_requests`. Its source does not mention `coach_availability_windows` or `session_types` at all | `pg_proc.prosrc` probe, below |
| D-03 | P1 | API-MAPPING L36; repeated verbatim in `docs/qa/CURRENT-STATE.md` OPEN section | "`sessions.session_type_id` is `NOT NULL`, so NOTHING IS BOOKABLE FROM THAT COACH" | `sessions.session_type_id` is **NULLABLE**, and so is `player_id`. 0076 relaxed both for group sessions | `information_schema.columns`, below |
| D-04 | P1 | SCHEMA.md L209, L210 (`sessions` column table) | `player_id` "not null", `session_type_id` "not null" | Both nullable. The doc contradicts **itself** 60 lines later at L247: "Group sessions have player_id NULL, session_type_id NULL". `sessions.group_id` is missing from the column table entirely | same query as D-03 |
| D-05 | P1 | `packages/types/src/db/database.types.ts` | Generated from the live schema | A hybrid describing a database that has never existed: missing 5 applied tables and 14 applied functions, while carrying two columns from **unapplied** 0104 | git + parse, below |
| D-06 | P2 | SCHEMA.md L254 heading and its Integrator TODO; API-MAPPING L431, L432 | `coach_trainee_videos` is "(0082, Track F, WRITTEN NOT APPLIED)"; both sibling edge functions "WRITTEN NOT DEPLOYED"; TODO "apply 0082, deploy both functions, regenerate the type, delete that widening" | 0082 is applied, the table exists with exactly the 6 described columns, both edge functions are deployed and ACTIVE, the type has landed, and the widening escape hatch is already gone from `use-coach.ts` | below |
| D-07 | P2 | API-MAPPING, whole document | Every RPC and edge function is mapped | 20 client-callable RPCs are absent from the doc, including two entire surfaces: admin catalog management and the UPA applicant lane | below |
| D-08 | P2 | SCHEMA.md, whole document | Describes the schema | Two applied tables have zero mentions anywhere in the file: `blocked_users` (0097) and `clip_saves` (0088). `blocked_users` is App Store 1.2 / Play UGC load-bearing | `grep -c` = 0 for both |
| D-09 | P2 | RLS.md L177, L241, L244, L327, L523 | Names six policies as current | All six were replaced by 0091's `<table>_select_merged`. **No security regression**: every branch survived, expressions read and quoted below. RLS.md L424 documents the 0091 mechanism, but the per-domain sections were never updated to match | `pg_policy`, below |
| D-10 | P3 | SCHEMA.md column tables | Column lists are complete | Omits applied columns: `clips.failure_reason` (0094), `chat_messages.removed_at`/`removed_reason` (0097), `feature_flags.value_numeric` (0093), `transfers.failure_reason`/`reversal_ledger_entry_group_id`/`updated_at`, `sessions.group_id`, and `created_at` on `categories`, `milestones`, `product_media` | column diff, below |
| D-11 | P3 | API-MAPPING L218 | `court_booking_transition(id, 'reschedule', date, slot)` | Real signature is `(p_booking_id, p_action, p_reason, p_new_date, p_new_slot_start)`. The doc's shorthand puts the date in the `p_reason` slot. The sessions row at L115 gets this right (`session_transition(id, 'reschedule', null, date, slot)`); the courts row does not | `pg_get_function_identity_arguments` |

---

## Evidence

### D-01, the unapplied 0103/0104/0105

```sql
select
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='session_transition_internal'
     and p.prosrc like '%notify_session_parties%') as sti_calls_notify;
-- sti_calls_notify = 0
```

`notify_session_parties` and `sweep_group_memberships` do not appear in the full `pg_proc` listing of
the `public` schema (129 functions enumerated, neither present).

```sql
select jobid, jobname, schedule from cron.job order by jobid;
-- 1 | expire-stale-holds | */5 * * * *
```

One job. No `membership-sweep`. (`pg_cron` **is** installed, so this is a real absence, not a missing
extension.)

```
group_memberships live columns:
  id, group_id, player_id, period_start, period_end, status, price,
  platform_fee, total, payment_intent_id, created_at, updated_at
```

No `renewal_reminder_sent_at`, no `expiry_notified_at`.

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.group_memberships'::regclass and contype='c';
-- group_memberships_status_check | CHECK ((status = ANY (ARRAY['pending','active','lapsed'])))
```

No `'expired'`. So API-MAPPING L374's `renewMembership` contract, "`active` or `expired` memberships
(`0104`: an expired member still holds their seat and renews on the same row)", cannot be satisfied
against production today: the state it renews from is unrepresentable.

`clips` also lacks `comments_enabled` (0101). Live columns: `id, owner_id, cf_stream_uid,
storage_path, playback_id, thumb_path, caption, sport, status, rejection_reason, likes_count,
comment_count, created_at, updated_at, failure_reason`.

### D-02, `submit_coach_verification`

```sql
select (prosrc ~* 'insert\s+into\s+public\.coach_profiles')      as writes_coach_profiles,
       (prosrc ~* 'insert\s+into\s+public\.coach_certificates')  as writes_certificates,
       (prosrc ~* 'coach_availability_windows')                  as mentions_availability,
       (prosrc ~* 'session_types')                               as mentions_session_types,
       (prosrc ~* 'insert\s+into\s+public\.verification_requests') as writes_verif
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='submit_coach_verification';
-- true | true | false | false | true
```

This is the row the 0099 correction paragraph was written to fix. The paragraph at L34 says plainly
"The row above claimed `submit_coach_verification` writes `session_types` and
`coach_availability_windows`. It never has." **The row above it still says `coach_availability_windows`.**
Only `session_types` was struck. The correction was applied to the prose and not to the table.

Where the availability rows actually come from: `coach_availability_windows` holds 14 rows live, written
through the direct `coach_availability_windows_write_own` policy by client code, not by this RPC.

### D-03 / D-04, `sessions` nullability

```sql
select column_name, is_nullable from information_schema.columns
where table_schema='public' and table_name='sessions'
  and column_name in ('player_id','session_type_id','group_id');
-- group_id        | YES
-- player_id       | YES
-- session_type_id | YES
```

The downstream conclusion ("a coach with zero `session_types` is unbookable") still holds, but on a
different mechanism: the athlete booking screen lists only `session_types` where `active`, so the coach
has nothing to book. The NOT NULL claim is not the reason and should not be cited as one.

Live consequence, still present because 0099 is unapplied:

```sql
select (select count(*) from coach_profiles where status='verified') as verified_coaches,
       (select count(*) from coach_profiles cp where cp.status='verified'
          and not exists (select 1 from session_types st
                          where st.coach_id=cp.user_id and st.active)) as unbookable;
-- verified_coaches = 3, unbookable = 1
```

Note also that the generated types file agrees with the live database here (`player_id: string | null`,
`session_type_id: string | null`) while the hand-written SCHEMA.md does not. When the artifact and the
prose disagree, the artifact is the schema.

### D-05, the types file is a hybrid, not merely stale

`packages/types/src/db/database.types.ts`, 6026 lines.

Last genuine regeneration: `c5574e8` (2026-08-04). Everything applied since (`0089` through `0097`,
applied 2026-08-06/07) is absent.

Missing applied **tables** (5): `ai_spend_daily`, `blocked_users`, `clip_saves`, `edge_rate_limits`,
`sweep_failures`. (71 tables in the file, 76 live.)

Missing applied **non-trigger functions** (14, all confirmed present in `pg_proc` and non-trigger):
`admin_get_reported_entity`, `admin_kpi_activity`, `admin_kpi_money`, `admin_kpi_queues`,
`admin_kpi_users`, `admin_reinstate_user`, `admin_suspend_user`, `ai_search_daily_budget`,
`claim_order_refund`, `gratitude_post_exists_for_item`, `is_actor_active`, `record_ai_spend`,
`retry_failed_clip`, `take_rate_limit_token`.

Missing applied **columns**: `clips.failure_reason`, `chat_messages.removed_at`,
`chat_messages.removed_reason`, `feature_flags.value_numeric`.

And yet, in the same file:

```
group_memberships.Row includes: expiry_notified_at, renewal_reminder_sent_at
```

Those two columns come from **0104, which is not applied**. They were hand-added, not generated:

```
git log -S 'renewal_reminder_sent_at' -- packages/types/src/db/database.types.ts
d134628 2026-08-13 feat(notifications): add session and membership notification types
```

So the file is ahead of production in one place and nine migrations behind it in every other. It
cannot be trusted as a description of anything. `npx supabase gen types` against the live project,
after the 0099-0106 apply question is settled, is the only fix; hand-patching it is what produced
this state.

### D-06, `coach_trainee_videos` is applied and deployed

```
supabase_migrations.schema_migrations: 20260725150042 | 0082_coach_trainee_videos
live table coach_trainee_videos: id, coach_id, player_id, storage_path, caption, created_at
```

Exactly the 6 columns SCHEMA.md L254 describes, under a heading that says it is not applied.

Both "WRITTEN NOT DEPLOYED" edge functions are deployed and ACTIVE:

```
coach-trainee-video-upload-url  v3  ACTIVE  created 1784991813695
get-coach-trainee-video-url     v3  ACTIVE  created 1784991855137
```

For completeness: all 25 edge function directories in `supabase/functions/` (excluding `_shared`) are
deployed and ACTIVE. There is no undeployed function and no deployed function missing from the repo.

### D-07, undocumented client-callable RPCs

Diffed all 129 `public` functions against every literal mention in API-MAPPING.md. 20 of the absentees
carry an `authenticated` or `anon` EXECUTE grant, meaning they are reachable surface:

- **Admin catalog management (9)**: `admin_create_product`, `admin_update_product`,
  `admin_set_product_active`, `admin_set_product_media`, `admin_create_variant`, `admin_update_variant`,
  `admin_delete_variant`, `admin_adjust_variant_stock`, `admin_variant_stock`
- **Admin KPI dashboard (4)**: `admin_kpi_users`, `admin_kpi_money`, `admin_kpi_activity`, `admin_kpi_queues`
- **Admin, other (3)**: `admin_reinstate_user`, `admin_request_upa_info`, `admin_update_fee_config`
- **UPA applicant lane (5)**: `submit_upa_application`, `resubmit_upa_application`,
  `reapply_upa_application`, `deactivate_upa_application`, `mark_wishlist_item_delivered`
  (plus `gratitude_post_exists_for_item`)
- **Anon-callable**: `general_fund_balance`

The UPA applicant lane is a structural gap rather than a few missed rows: API-MAPPING has a
`portal-court` section for the venue partner surface and **no equivalent section at all** for
`portal-life` / the UPA applicant, even though its empower section documents the consumer-facing half
of the same domain. The admin catalog RPCs are likewise in scope for this doc, since it already
documents `admin_upsert_drill`, `admin_set_drill_active`, `admin_get_reported_entity`,
`resolve_report`, `admin_approve_verification_request` and `admin_reject_verification_request`.

(16 further undocumented functions are `service_role`-only internals such as `place_order_from_draft`,
`join_training_group`, `renew_group_membership`, `claim_order_refund`. Lower priority: they are not
client contract, though `join_training_group` and `renew_group_membership` sit directly behind
documented edge functions and would be worth naming.)

### D-09, stale policy names in RLS.md

258 policies live in `public`. RLS.md is prose-strategy-per-domain, not a policy registry, so the fact
that it names only a handful is **not** drift and is not reported as such. What is drift is the six
names it does assert that no longer exist:

| RLS.md | line | superseded by |
|---|---|---|
| `clips_select_own`, `clips_select_admin` | 241, 244 | `clips_select_merged` |
| `court_bookings_select`, `court_bookings_select_admin` | 177 | `court_bookings_select_merged` |
| `sessions_select_group_participant` | 327 | `sessions_select_merged` |
| `users_select_own` | 523 | `users_select_merged` |

Before calling this drift I read the merged expressions to confirm no access branch was dropped by
0091. All four preserve everything:

```
clips_select_merged
  (has_role('admin') OR has_role('moderator') OR (owner_id = (select auth.uid())))
court_bookings_select_merged
  (is_court_partner_or_staff(court_id) OR (user_id = (select auth.uid()))
   OR (has_role('admin') OR has_role('moderator')))
sessions_select_merged
  (is_session_participant(id, (select auth.uid()))
   OR (has_role('admin') OR has_role('moderator')
       OR (has_role('coach') AND (coach_id = (select auth.uid())))
       OR (player_id = (select auth.uid()))))
users_select_merged
  (has_role('admin') OR (id = (select auth.uid())))
```

RLS.md's security conclusions therefore all still hold. Only the names are wrong. `clips_select_published`
survives separately as the anon-inclusive public policy, so the permissive-OR warning at L241 remains
correct in substance.

### D-10, omitted columns

Diff of every `### \`table\`` column table in SCHEMA.md against `pg_attribute`, live-only columns:

```
categories        created_at
chat_messages     removed_at, removed_reason        (0097, applied)
clips             failure_reason                    (0094, applied)
feature_flags     value_numeric                     (0093, applied)
milestones        created_at
product_media     created_at
sessions          group_id                          (0076, applied; prose-only)
transfers         failure_reason, reversal_ledger_entry_group_id, updated_at
coach_trainee_videos   entire column table absent   (see D-06)
```

No column is described in SCHEMA.md that does not exist live, other than the 0104 stamps covered by
D-01. `product_variant_availability` appeared as "not a live table" in the first pass and was ruled
out: it is a **view**, and it exists.

---

## Ruled out (looked like findings, are not)

- **`razorpay-create-order` has no edge function directory and is not deployed.** It is listed in
  API-MAPPING's "Edge functions not in the v1 contract" table at L420, which invites the wrong
  conclusion, but the row's own note says "not exposed as its own client-facing endpoint" and
  `PAYMENTS.md:10` is explicit: it is a Deno module, `supabase/functions/_shared/razorpay.ts`, which
  exists. Correct as written, if awkwardly placed.
- **`product_media_public_read` is missing from `pg_policy`.** It is a `storage.objects` policy, not a
  `public` schema one, and RLS.md L346 is in the Storage section. Confirmed present in
  `storage`-schema `pg_policy`.
- **250 of 258 live policies are unnamed in RLS.md.** RLS.md documents strategy per domain, not a
  policy inventory. Absence of a name is not a claim, so this is not drift.
- **0091 dropped an access branch when it merged policies.** It did not. Expressions read and quoted
  under D-09.
- **An edge function in the repo is undeployed.** None is. All 25 are ACTIVE.
- **`delete-account` is missing.** Consistent with the docs: no `0098*.sql` and no function directory
  exist on this branch, and `CURRENT-STATE.md` already records it as written-and-unapplied elsewhere.

---

## Unresolved

- **Is the 0099-0106 gap intentional staging or a silent miss?** The migrations are authored and sit
  on this integration branch; production stops at 0097. I cannot tell from the artifacts whether an
  apply is gated behind a pending merge or whether the docs were simply written ahead of an apply that
  never ran. This needs the integrator or the founder, not another query. Everything in D-01 becomes
  correct the moment 0099-0106 are applied, and stays wrong until then.
- **`0098` (account deletion)** is referenced by `CURRENT-STATE.md` and by SCHEMA.md's account-deletion
  section, but no `0098*.sql` exists anywhere on `integration/p6-audit-fixes`. It is presumably on an
  unmerged branch; I did not check other branches, so I cannot say it is not lost.
- **Nullability was audited by sampling**, not exhaustively across all 76 tables. I checked the
  load-bearing ones (sessions, chat_threads, court_bookings, donations, group_memberships). A full
  nullability sweep is a separate, cheap pass if wanted.
- **The RPC-to-doc diff is name-based.** A row that names the right function but describes the wrong
  behaviour would only be caught where I read the source (D-02). `submit_coach_verification` was read
  because it had a known history; the other ~90 documented functions were confirmed to EXIST with the
  documented signature, not confirmed to DO what their note says.
