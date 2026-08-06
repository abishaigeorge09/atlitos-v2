# Phase 1 security lockdown

Pre launch hardening pass on prod (`syzzfgaudpifwvbpycyi`), scoped to the 5 SAFE NOW items
that do not touch the seed account passwords the ongoing native QA logs in with. Seed
password rotation and the reviewer account are Phase 6, deliberately not touched here.

Branch `phase-11/security-lockdown`, off `3513a8c`. Migration `supabase/migrations/0089_security_lockdown_phase1.sql`
plus two follow up statements applied directly (folded into the same local migration file
so the repo matches prod exactly, see "How this was applied" below).

## 1. Dead seed/tmp edge functions

Confirmed unused before touching anything: `grep -rl` across the whole repo (apps, packages,
supabase, scripts, docs) for each function slug turned up zero references in application
code. The only hits were in historical phase status docs (`docs/phases/PHASE-*-STATUS.md`,
`SHIP-HANDOFF.md`, evidence files), which are records of past work, not live callers. None
of the four functions exist in the local `supabase/functions/` tree at all, they were already
removed from the repo and only remain deployed on prod.

| Function | Repo callers | Decision |
|---|---|---|
| `tmp-seed-demo-users` | none (tombstone name says so) | delete |
| `seed-media` | none | delete |
| `seed-promo-media` | none | delete |
| `fix-home-media-p12` | none | delete |

**Not deleted. Blocked, needs founder action.** The Supabase MCP server available in this
session has `list_edge_functions`, `get_edge_function`, and `deploy_edge_function`, but no
delete tool. The `supabase` CLI is installed and logged in, but to a different Supabase
account (`projects list` shows `gmv_project`, `side-projects`, `Synth_PitchDeck`,
`synth-mvp`, no Atlitos project), and `supabase functions list --project-ref
syzzfgaudpifwvbpycyi` / `api-keys --project-ref ...` both 403 "account does not have the
necessary privileges." `.env.local` (which may hold a management token) is blocked from
read by this session's own permission settings, by design, so it could not be used to work
around this either.

Founder action, once run with the correct Supabase account:

```
supabase functions delete tmp-seed-demo-users --project-ref syzzfgaudpifwvbpycyi
supabase functions delete seed-media --project-ref syzzfgaudpifwvbpycyi
supabase functions delete seed-promo-media --project-ref syzzfgaudpifwvbpycyi
supabase functions delete fix-home-media-p12 --project-ref syzzfgaudpifwvbpycyi
```

Or via the dashboard: Project > Edge Functions > select each > Delete. They remain
`ACTIVE` on prod as of this writing (confirmed via `list_edge_functions`); each is
`verify_jwt: true` (auth required) except none is anonymous, so this is a real but bounded
gap, not an open door, until deleted.

## 2. Storage bucket limits

Applied via SQL update on `storage.buckets` (folded into `0089_security_lockdown_phase1.sql`),
SQL confirmed after:

| Bucket | file_size_limit | allowed_mime_types |
|---|---|---|
| `avatars` | 10485760 (10MB) | image/jpeg, image/png, image/webp, image/heic, image/heif |
| `venue-media` | 10485760 (10MB) | same |
| `upa-photos` | 10485760 (10MB) | same |
| `gratitude-photos` | 10485760 (10MB) | same |
| `product-media` | 10485760 (10MB) | same |

All five were `file_size_limit: null, allowed_mime_types: null` (unlimited, any type) before
this change. Image only for all five: grepped `product_media`/`venue_photos`/schema
migrations for any `media_type`/video column and found none, every one of these buckets is
photo uploads only today. `clips` (video, Cloudflare Stream backed), `coach-certificates`,
and `upa-evidence` are the three non public buckets and were left alone, not in scope (not
public, different upload path).

Verified post change with a direct `select id, file_size_limit, allowed_mime_types from
storage.buckets` (see table above, values read back from prod, not asserted).

## 3. Anon RPC lockdown

`get_advisors(security)` listed 22 `anon_security_definer_function_executable` findings.
Root cause investigation (not just pattern matching): this project's schema level default
privileges grant `EXECUTE` on every newly created function directly to `anon`,
`authenticated`, and `service_role` as named ACL entries. Three earlier migrations (`0005`,
`0081`, `0088`) tried to lock specific functions down with `revoke all on function ... from
public`, which is a no op against those named entries (`public` here means the literal
`PUBLIC` pseudo role, a separate ACL slot that these functions may or may not also hold) so
the intended lockdown never actually took effect for the anon named grant. Confirmed by
querying `pg_proc.proacl` before and after: several functions the migrations clearly meant
to make authenticated only (`is_group_coach` et al., `set_athlete_sports`) still showed
`anon=X` live on prod.

Two even older functions (`handle_new_user`, `has_role`, both from `0001`, plus
`create_group_chat_thread`, `sync_group_chat_membership`, `grant_court_staff_role_on_accept`
from before the named grant convention existed) additionally carried a literal legacy
`PUBLIC` grant, which `anon` inherits regardless of any anon specific revoke. Discovered
this the hard way: the first revoke pass left `has_role` and the four trigger only functions
still `anon` executable per `has_function_privilege`, requiring a second follow up statement
per function to `revoke ... from public` explicitly. All revokes below are the actual grants
verified live on prod after both passes, not the first attempt.

### Decisions, one row per flagged function

**Revoke (10), not guest facing:**

| Function | Why revoked | Verified safe by |
|---|---|---|
| `create_group_chat_thread()` | Trigger only (`after insert on training_groups`), no legitimate direct caller | No `.rpc(` call anywhere in `apps`/`packages`; trigger functions run under the trigger owner's privileges regardless of EXECUTE grants, so revoking breaks nothing |
| `sync_group_chat_membership()` | Trigger only (`after insert or update of status on group_memberships`) | Same as above |
| `grant_court_staff_role_on_accept()` | Trigger only (venue staff invite acceptance) | Same as above |
| `handle_new_user()` | Trigger only (`after insert on auth.users`), `0005` already intended this revoke, it just never fully took | Same as above; this is the fix that finally closes the `0005` gap |
| `has_role(text)` | Internal RLS predicate, reads only the caller's own JWT claims (no table access), not itself sensitive, but no anon facing feature calls it directly and no anon scoped policy invokes it | Grepped every `create policy` block across all migrations for one that both grants to `anon` and calls `has_role(` in the same statement: zero hits. Kept granted to `authenticated`, since dozens of `to authenticated` policies call it, and confirmed post revoke that `set local role authenticated; select has_role('admin')` still returns `false` cleanly (no permission error) |
| `is_group_coach(uuid, uuid)` | `0081` already intended authenticated only | Its only policy reference (`group_memberships_select_coach`) is declared `for select to authenticated`, never evaluated for the anon role at all |
| `is_group_member_live(uuid, uuid)` | Same | `training_groups_select_member` is `to authenticated` only |
| `is_session_coach(uuid, uuid)` | Same | `session_participants_select_coach` is `to authenticated` only |
| `is_session_participant(uuid, uuid)` | Same | `sessions_select_group_participant` is `to authenticated` only |
| `set_athlete_sports(sport[], sport)` | `0088` already intended authenticated only; mutates the caller's own `users.sports`/`athlete_sports`, an onboarding profile write, not a guest browse read | `0088`'s own migration text grants only to `authenticated` |

**Keep (12), genuinely guest facing, each already had a deliberate anon grant in its own
migration plus a real guest facing call site, left untouched:**

| Function | Guest facing evidence |
|---|---|
| `get_coach_busy_slots(uuid, date, date)` | `0020`: "Grant shape matches get_court_busy_slots: anon and authenticated both"; called from `packages/api/src/use-coaching.ts`/`use-coach.ts` (coach availability, public discovery before booking) |
| `get_court_available_slots(uuid, date)` | Court booking availability; called from `packages/api/src/hooks.ts` and the shopper/booking flow |
| `get_court_busy_slots(uuid, date, date)` | Same discovery pattern, `0020` comment cites it as the mirror this function follows |
| `get_court_rating_summary(uuid)` | `0015`, public court rating display, no auth needed to browse courts |
| `is_verified_coach(uuid)` | `0081` explicitly `grant execute ... to anon, authenticated`; used by `training_groups_select_public`, `session_types`/`coach_availability_windows` public discovery policies per RLS.md's guest read table |
| `general_fund_balance()` | `0056` explicit anon grant; feeds the public Empower "General Fund" stat |
| `get_empower_stats()` | `0056` explicit anon grant; verified live as anon (`set local role anon; select get_empower_stats()` returned real stats with no error) |
| `get_group_member_counts(uuid[])` | `0079` explicit `grant execute ... to anon, authenticated`; `training_groups_select_public` is itself guest readable, member counts render on the public group browse list before joining |
| `public_upa_profile(uuid)` | `0056` explicit anon grant; the actual guest donor screen, `apps/mobile/src/app/home/upa/[id].tsx`, PRD-06 FR-4/FR-16 |
| `upa_fund_balance(uuid)` | `0056` explicit anon grant; backs the total raised figure inside `public_upa_profile` |
| `upa_money_summary(uuid)` | `0084` explicit anon grant; per item funding progress shown on the same public campaign view |
| `variant_available_stock(uuid)` | `0033` explicit `revoke all from public; grant to anon, authenticated, service_role`; guest shop browsing needs live stock before login |

### Guest flow verification (post migration, as the real `anon` role, not asserted)

Ran directly against prod with `set local role anon`:

```
venues (status=verified):            4 rows
coach_profiles_public:                3 rows
products (active=true):              14 rows
clips (status=published):            12 rows
get_empower_stats() as anon:          {"general_fund":17.18,"items_funded":3,"total_raised":11271.18,"athletes_supported":2}
```

All non zero, all returned without error, confirming guest browse/feed/search reads and the
kept guest RPC still work after the lockdown.

Also proved the forbidden calls are actually refused, not merely assumed:

```
set local role anon; select handle_new_user();  -> ERROR 42501: permission denied for function handle_new_user
set local role anon; select has_role('admin');  -> ERROR 42501: permission denied for function has_role
set local role authenticated; select has_role('admin');  -> false (no error, confirms authenticated is untouched)
```

### How this was applied

Applied as three sequential `apply_migration` calls against prod (the second and third were
fix ups discovered by verifying `pg_proc.proacl` after the first, not planned in advance):
storage buckets + the first revoke pass, then the legacy PUBLIC grant fix for the four
trigger functions, then the same PUBLIC grant fix for `has_role`. The local migration file
`supabase/migrations/0089_security_lockdown_phase1.sql` in this branch has been edited to
match the final state exactly (includes the `public` revokes inline), so replaying it on a
fresh database produces the same result prod now has, not the intermediate broken state.

## 4. Leaked password protection

`auth_leaked_password_protection` was flagged (HaveIBeenPwned check, currently off). This is
a GoTrue/Auth service setting, not a database row, confirmed by querying for an `auth.config`
table (`relation "auth.config" does not exist`). No tool in this session's Supabase MCP set
can change it (no `update_auth_config` style tool was available).

**Founder action needed.** Supabase Dashboard > Authentication > Sign In / Providers >
Password (the "Leaked password protection" toggle, checks new passwords against
HaveIBeenPwned.org). Turn it on. Not yet done.

## 5. SECURITY DEFINER views

Three views flagged: `coach_profiles_public`, `public_profiles`, `product_variant_availability`.
Read each view's actual column list from `information_schema.columns` on prod (not just the
migration source, in case a later migration changed it) and compared against its base
table's full column set.

| View | Exposed columns | Base table has (not exposed) | Decision |
|---|---|---|---|
| `coach_profiles_public` | `user_id, sport, experience_years, coaching_style, specialization, bio, city, state, rating, rating_count, players_coached_count, created_at`, pre filtered to `status='verified'` | `coach_profiles` also has payout/verification internals not selected here | Intentional. `SECURITY DEFINER` is required because the base table has no anon `SELECT` policy at all (owner + admin only per RLS.md), the view is the only public discovery path. No sensitive column leaks. |
| `public_profiles` | `id, name, avatar_url, channel_name, handle, bio, cover_url` | `users` also has email, phone, dob, address, role internals, none selected | Intentional, matches RLS.md's documented "public facing subset." No sensitive column leaks. |
| `product_variant_availability` | `product_variant_id, product_id, sku, size, color, effective_price, stock, held_qty, available_stock` | No cost/margin/supplier columns exposed, `stock`/`held_qty` are read only availability numbers, not internal accounting | Intentional per its own migration comment (`0033`): `SECURITY DEFINER` "so the reservation join is not silently zeroed by RLS." No sensitive column leaks. |

All three are documented, deliberate designs already, not accidental. No changes made.

## Deferred to Phase 6

- Seed account password rotation (would break the ongoing native QA session that logs in
  with seed passwords, explicitly out of scope for this pass).
- Reviewer account setup.

## Summary of what changed on prod

1. Storage: `file_size_limit` + `allowed_mime_types` set on `avatars`, `venue-media`,
   `upa-photos`, `gratitude-photos`, `product-media`.
2. `EXECUTE` revoked from `anon` (and from `authenticated`/`public` where applicable) on 10
   functions: `create_group_chat_thread`, `sync_group_chat_membership`,
   `grant_court_staff_role_on_accept`, `handle_new_user`, `has_role`, `is_group_coach`,
   `is_group_member_live`, `is_session_coach`, `is_session_participant`,
   `set_athlete_sports`.
3. 12 anon-executable RPCs reviewed and kept as is (already intentional guest surface).
4. 3 SECURITY DEFINER views reviewed, all intentional, no changes.

## Not done, needs founder action

- Delete `tmp-seed-demo-users`, `seed-media`, `seed-promo-media`, `fix-home-media-p12` from
  prod (blocked on tooling/account access, see section 1).
- Turn on leaked password protection in the dashboard (see section 4).
