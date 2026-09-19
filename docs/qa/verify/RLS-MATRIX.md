# RLS and cross-user isolation matrix

Lane: RLS and cross-user isolation, the security floor.
Run date: 2026-08-14. Branch `integration/p6-audit-fixes` at `4793ce4`.
Project: `syzzfgaudpifwvbpycyi`. Every DB claim below is a read-only query against the LIVE
catalog, not against the migration files, because this repo has been bitten by
grep-absence three times (CURRENT-STATE.md, "Absence of the literal string is not absence of
the thing").

Applied migration ceiling on this project is **0097** (`supabase_migrations.schema_migrations`,
newest rows `0096a_is_actor_active_anon_revoke`, `0096_suspend_enforcement_and_kpis`,
`0097_report_block`). Migrations `0099` through `0106` exist in the tree and are NOT applied.
`0098` is not in this tree at all. Everything below describes the live project, and flags
separately where an unapplied migration changes the picture.

---

## Verdict summary

| # | Finding | Severity |
|---|---|---|
| 1 | The pre-push security gate is a no-op: `scripts/security-invariants.sh` and `scripts/dod.sh` do not exist, and the hook's `[ -x ... ]` guard makes their absence PASS. There is no CI at all. | P1 |
| 2 | Suspension enforcement (0096) does not cover the 27 mutating SECURITY DEFINER RPCs. Zero definer functions call `is_actor_active()`. The migration claims platform-wide coverage. | P2 |
| 3 | `user_roles` and `audit_log` carry anon + authenticated INSERT/UPDATE/DELETE grants with ZERO write policies. Single-leg enforcement on the privilege-escalation table and the audit trail. | P2 |
| 4 | Five SECURITY DEFINER functions still carry the PUBLIC EXECUTE grant that 0089's own docblock says must be revoked alongside the named grant. | P3 |
| 5 | 0096's restrictive-companion loop is one-shot. Nothing re-runs it and nothing fails when a future migration adds a permissive write policy without its `_active_*` companion. Zero drift today, but the guard is absent. | P3 |

**Clean, with evidence:** the permissive-OR code audit (step 2) found NO unfiltered read of any
danger-set table anywhere in `apps/`, `packages/` or `scripts/`. The money tables refuse client
writes on BOTH legs. Restrictive suspend coverage has zero gaps against the live catalog.

---

## 1. The danger set: tables carrying BOTH an owner policy and a public policy

Source: `pg_policy` joined to `pg_class`, `polcmd in ('r','*')`, all 76 public tables scanned.

RLS is enabled on all 76 tables in `public` (`count(*) = 76`, `count(*) filter (where
relrowsecurity) = 76`). `relforcerowsecurity` is false everywhere, which is
correct: it only affects the table owner (`postgres`), and PostgREST connects as `anon` or
`authenticated`. No policy anywhere in `public` targets the PUBLIC pseudo-role (`0 = any(polroles)`
returns zero rows), so no policy silently applies to every role.

### DANGER SET, 17 tables

Each of these returns other users' rows to an unscoped `select`, because policies combine with OR.

| Table | Owner-scoped SELECT policy | Public/broad SELECT policy (roles) |
|---|---|---|
| `venues` | `venues_select_merged` — admin OR `partner_user_id = auth.uid()` | `venues_select_public` — `status = 'verified'` (authenticated, anon) |
| `courts` | `courts_select_merged` — admin OR owning partner via `venues` | `courts_select_public` — parent venue verified (authenticated, anon) |
| `court_availability_windows` | `..._select_own` — owning partner via `courts` join `venues` | `..._select_public` — parent venue verified (authenticated, anon) |
| `court_blackouts` | `..._select_own` — owning partner | `..._select_public` — parent venue verified (authenticated, anon) |
| `court_pricing_rules` | `..._select_own` — owning partner | `..._select_public` — parent venue verified (authenticated, anon) |
| `venue_photos` | `venue_photos_select_own` — owning partner | `venue_photos_select_public` — parent venue verified (authenticated, anon) |
| `session_types` | `session_types_select_merged` — admin OR `coach_id = auth.uid()` | `session_types_select_public` — `is_verified_coach(coach_id)` (authenticated, anon) |
| `coach_availability_windows` | `..._select_merged` — admin OR `coach_id = auth.uid()` | `..._select_public` — `is_verified_coach(coach_id)` (authenticated, anon) |
| `training_groups` | `..._select_merged` — admin OR coach OR `is_group_member_live` | `..._select_public` — `active = true AND is_verified_coach(coach_id)` (authenticated, anon) |
| `clips` | `clips_select_merged` — admin/mod OR `owner_id = auth.uid()` | `clips_select_published` — `status = 'published'` (authenticated, anon) |
| `clip_comments` | `..._select_merged` — admin/mod OR the clip's owner | `..._select_on_published` — parent clip published (authenticated, anon) |
| `upa_applications` | `..._select_merged` — admin/mod OR `applicant_user_id = auth.uid()` | `..._select_verified` — `status = 'verified'` (authenticated, anon) |
| `upa_wishlist_items` | `..._select_own` — via owning `upa_applications` row | `..._select_verified` — parent UPA verified (authenticated, anon) |
| `gratitude_posts` | `..._select_own` — via owning `upa_applications` row | `..._select_public` — published AND parent UPA verified (authenticated, anon) |
| `products` | `products_select_admin` — `has_role('admin')` | `products_select_public` — `active` (authenticated, anon) |
| `product_variants` | `..._select_admin` | `..._select_public` — parent product active (authenticated, anon) |
| `product_media` | `..._select_admin` | `..._select_public` — parent product active (authenticated, anon) |

### Owner-scoped ONLY (safe to read unscoped, still worth an explicit filter)

`addresses`, `athlete_sports`, `audit_log`, `blocked_users`, `cart_items`, `chat_messages`,
`chat_thread_members`, `chat_threads`, `clip_saves`, `coach_certificates`, `coach_profiles`,
`coach_trainee_notes`, `coach_trainee_videos`, `court_bookings`, `donations`, `drill_completions`,
`feature_flags`, `fee_config` (any authenticated user, not anon), `group_memberships`,
`ledger_entries`, `notification_prefs`, `notifications`, `order_feedback`, `order_items`,
`order_timeline`, `orders`, `payment_intents`, `payout_accounts`, `product_wishlist_items`,
`push_tokens`, `refunds`, `reports`, `session_participants`, `sessions`, `support_tickets`,
`transfers`, `upa_evidence`, `user_milestones`, `user_roles`, `users`, `venue_staff`,
`verification_requests`, `xp_events`.

### Public-readable ONLY (no owner dimension, nothing to leak)

`affiliate_products`, `categories`, `clip_likes`, `drills`, `follows`, `milestones`,
`product_offers`, `promo_banners`, `roadmap_stages`.

### RLS on, ZERO policies (deny-all to anon and authenticated)

`ai_spend_daily`, `donation_drafts`, `edge_rate_limits`, `order_drafts`, `stock_reservations`,
`sweep_failures`, `webhook_events`. These are service-role only by construction, which is correct.

### Views: three bypass RLS by design

`pg_class.reloptions`, all owned by `postgres`:

| View | `security_invoker` | Effect |
|---|---|---|
| `public_profiles` | `false` (explicit) | Runs as `postgres`, so `users` RLS does NOT apply. Projects `id, name, avatar_url, channel_name, handle, bio, cover_url` for EVERY user, readable by anon. No email, no phone, no dob. |
| `coach_profiles_public` | `false` (explicit) | Runs as `postgres`. Row filter `status = 'verified'` is inside the view, not RLS. Safe column subset. |
| `product_variant_availability` | NOT SET (defaults to definer) | Runs as `postgres`. Joins `products` on `p.active`, and reads `stock_reservations`, which is a deny-all table under RLS. Exposes aggregate held quantity only, no reservation identity. |
| `creator_stats`, `shopper_categories`, `venue_bookings_today` | `on` / `true` | Invoker views, RLS applies normally. |

The three definer views are the intended "hide the base rows, project a safe subset" pattern, not
a defect. Recorded here because a future column added to any of them escapes RLS silently, and
because `public_profiles` does allow anon to enumerate the display identity of every account.

---

## 2. Code audit of the danger set: every read carries its own ownership filter

CLAUDE.md's rule is that every read of a permissive-OR table must carry its own explicit filter.
I traced **every** `.from("<table>")` call site in `apps/`, `packages/` and `scripts/` for all 17
danger-set tables. Result: **no unfiltered read found**. This is a genuine clean, not an untested
assumption; the call sites and their filters are below.

### `venues` (the known example)

| Call site | Filter |
|---|---|
| `apps/portal-court/src/components/venue-scope.tsx:81` | `.or("partner_user_id.eq.<uid>,id.in.(<accepted staff venue ids>)")`, and the 33-line docblock above it states the permissive-OR reason |
| `apps/portal-court/src/app/dashboard/layout.tsx:35` | `.eq("status","verified").eq("partner_user_id", user.id)` |
| `apps/portal-court/src/app/onboarding/page.tsx:34` | `.eq("partner_user_id", user.id)` |
| `apps/portal-court/src/app/onboarding/review/page.tsx:52` | `.eq("partner_user_id", user.id)` |
| `apps/portal-court/src/app/onboarding/pending/page.tsx:49` | `.eq("partner_user_id", user.id)` |
| `apps/portal-court/src/lib/onboarding.ts:90` | `.eq("partner_user_id", user.id)` |
| `scripts/verify-realtime.mjs:347` | `.eq("partner_user_id", partnerUserId)`, with the AT-62 incident written into the docblock at lines 335 to 344 |
| `apps/admin/src/pages/venues/{list,show}.tsx`, `bookings/list.tsx:85` | Unfiltered by design: the admin app signs in as an admin, and `venues_select_merged` grants admin the whole table. Correct. |

### `courts`, `court_availability_windows`, `court_blackouts`, `court_pricing_rules`, `venue_photos`

Every read is transitively scoped: `.eq("venue_id", scope.selectedVenueId)` or
`.in("court_id", courtIds)`, where `selectedVenueId` comes from the owner-filtered
`VenueScopeProvider` above and `courtIds` comes from a `.eq("venue_id", venueId)` read.
Verified at `apps/portal-court/src/app/dashboard/page.tsx:39,71,72`,
`.../slots-pricing/page.tsx:41,189,304,421`, `.../venues/page.tsx:235,236`,
`.../live-today/page.tsx:85`, `.../earnings/page.tsx:46`,
`apps/portal-court/src/lib/onboarding.ts:104,105`,
`apps/portal-court/src/app/onboarding/{review,photos}/page.tsx`,
`apps/portal-court/src/app/onboarding/use-onboarding-guard.ts:71`.
`packages/api/src/hooks.ts:656` (`listCourts`) is a deliberate public browse and adds
`.eq("venues.status","verified")` as defence in depth over the RLS join.

### `session_types`, `coach_availability_windows`

| Call site | Filter |
|---|---|
| `packages/api/src/use-coach.ts:821` `listMyTypes` | `.eq("coach_id", userId)` where `userId = await requireUserId(client)` |
| `packages/api/src/use-coach.ts:886,901` update/setActive | `.eq("id", typeId).eq("coach_id", userId)`, both legs |
| `packages/api/src/use-coach.ts:946` `listWindows` | `.eq("coach_id", userId)` |
| `packages/api/src/use-coach.ts:981` `deleteWindow` | `.eq("id", windowId).eq("coach_id", userId)` |
| `packages/api/src/use-coaching.ts:273,327,333` | Athlete-side browse, `.in("coach_id", ids)` / `.eq("coach_id", coachId)` where ids come from `coach_profiles_public`. Public by intent. |

### `training_groups`

`packages/api/src/use-groups.ts:402` `listMyGroups` carries `.eq("coach_id", userId)` and the
docblock at line 396 to 398 states verbatim: "the public browse policy would otherwise leak every
verified coach's groups into an unscoped read". `:418` `listGroupsForCoach` is a deliberate public
browse with `.eq("coach_id", coachId).eq("active", true)`. `:438` and `:615` are id-scoped
(`.eq("id", groupId)`, `.in("id", groupIds)` from the caller's own membership rows).
`packages/api/src/use-chat.ts:293` scopes to `.in("id", groupIds)` derived from the caller's own
threads, with the reason in the docblock above it.

### `upa_applications`, `upa_wishlist_items`, `gratitude_posts`

`apps/portal-life/src/lib/empower.ts:68` and
`apps/portal-life/src/app/(app)/status/status-view.tsx:82` both carry
`.eq("applicant_user_id", userId)` with an explicit permissive-OR comment.
`upa_wishlist_items` reads at `wishlist/page.tsx:16`, `wishlist-manager.tsx:52`,
`home/page.tsx:32`, `gratitude-view.tsx:28` all carry `.eq("upa_id", <own application id>)`;
`wishlist/[itemId]/funding-detail.tsx:42` carries BOTH `.eq("id", itemId)` and
`.eq("upa_id", upaId)`. `packages/api/src/use-empower.ts:315` `listUpas` is the public grid and
adds an explicit `.eq("status","verified")` precisely so a signed-in UPA owner's own non-verified
row cannot surface into a public browse.

### `clips`, `clip_comments`

`packages/api/src/hooks.ts:1402` `getFeed` adds an explicit `.eq("status","published")` with a
docblock naming the exact hazard (an owner's own `uploading`/`rejected` clips surfacing into the
public feed). `:1755` `getCreatorClips` adds `.eq("owner_id", creatorId).eq("status","published")`.
`:1788` `getMyClips` adds `.eq("owner_id", authData.user.id)` and deliberately omits the status
filter, which is correct for an own-scoped read.

### Test harnesses and seed scripts

`scripts/verify-rls-matrix.mjs`, `scripts/verify-commerce-rls.mjs:63`,
`scripts/verify-moderation-phase4.mjs:203,207` all assert the two parties' ids actually DIFFER
before trusting an isolation result, which is the AT-62 discipline CLAUDE.md requires.
`scripts/verify-discovery.mjs:160,161,183,201` scope by `.in("coach_id", ids)` from
`coach_profiles_public`.

**Conclusion for step 2: `venues` was the known example and there are no others. The rule is
being held, in code, at every call site, with the reasoning written down at most of them.**

---

## 3. The restrictive suspend policies from 0096

Built dynamically at `supabase/migrations/0096_suspend_enforcement_and_kpis.sql:207-274` via
`v_policy_name := r.tablename || '_active_insert'`, so grep cannot find the names. Queried
`pg_policy` with `polpermissive = false` instead.

**Live count: 98 restrictive policies across 44 tables**, with
`count(*) filter (where polcmd not in ('a','w','d')) = 0`. All are INSERT, UPDATE or DELETE; none
is SELECT or ALL, so 0096's own safety invariant (a restrictive SELECT would blank reads platform
wide) holds on the live catalog, not only in the migration's self-check.

### Coverage gap check: ZERO gaps

Re-ran 0096's own selection rule against the live catalog and diffed it against the restrictive
policies that exist:

```sql
with want as (
  select tablename,
         bool_or(cmd in ('INSERT','ALL')) as w_ins,
         bool_or(cmd in ('UPDATE','ALL')) as w_upd,
         bool_or(cmd in ('DELETE','ALL')) as w_del
  from pg_policies
  where schemaname='public' and permissive='PERMISSIVE'
    and 'authenticated' = any(roles::text[])
    and cmd in ('INSERT','UPDATE','DELETE','ALL')
  group by tablename
), have as (
  select tablename,
    bool_or(policyname = tablename||'_active_insert') as h_ins,
    bool_or(policyname = tablename||'_active_update') as h_upd,
    bool_or(policyname = tablename||'_active_delete') as h_del
  from pg_policies where schemaname='public' and permissive='RESTRICTIVE'
  group by tablename
)
select ... where (w_ins and not h_ins) or (w_upd and not h_upd) or (w_del and not h_del);
-- 0 rows
```

**The check was negative-tested before its green was believed.** Re-running it with
`and policyname <> 'clips_active_insert'` added to the `have` CTE returns exactly one row,
`clips | w_ins=true | h_ins=false`. So the check can fail, and its empty result is a real green
rather than a query that cannot detect anything.

### The forward-looking gap (Finding 5, P3)

The loop at 0096:207 ran ONCE at migration time. Nothing re-runs it, and nothing fails a future
migration that adds a permissive write policy without its `_active_*` companion. Coverage is
complete today only because the applied ceiling is 0097 and nothing since has added a permissive
write policy. `0101_clip_comments_enabled.sql:60-62` drops and recreates `clip_comments_insert_own`
without touching `clip_comments_active_insert`, so that one survives when 0101 is applied. But the
invariant is unguarded, and there is no check anywhere in the repo that would catch the drift (see
Finding 1: the script that would hold it does not exist).

---

## 4. Money tables refuse client writes, on BOTH legs

`payment_intents`, `ledger_entries`, `payout_accounts`, `transfers`, plus `refunds`, `orders`,
`order_items`, `order_timeline`, `sessions`, `court_bookings`, `donations`, `session_participants`,
`group_memberships`:

- **Policy leg:** zero INSERT/UPDATE/DELETE/ALL policies of any kind. Query over `pg_policy` with
  `polcmd in ('a','w','d','*')` restricted to those tables returns 0 rows.
- **Grant leg:** zero INSERT/UPDATE/DELETE grants to `anon` or `authenticated`.
  `information_schema.role_table_grants` restricted to those tables and those privileges returns
  0 rows.

**Negative-tested:** adding `users` to the same two queries returns 8 rows
(`users | anon:INSERT`, `anon:UPDATE`, `anon:DELETE`, the same three for `authenticated`, plus
policies `users_update_own` and `users_active_update`). The check fires, so the money-table green
is real and not a query that returns empty by construction.

Both legs present on all four named tables. **No finding.**

Residual, informational: the money tables do retain `REFERENCES`, `TRIGGER` and `TRUNCATE` grants
to `anon` and `authenticated`, left over from Supabase's default `grant all on all tables`. None is
reachable through PostgREST, which only issues SELECT/INSERT/UPDATE/DELETE and `rpc`. Noted so the
next reader is not surprised by them, not raised as a finding.

---

## 5. SECURITY DEFINER functions and the anon EXECUTE grant

`pg_proc` where `prosecdef`, joined with `has_function_privilege`.

**Twelve SECURITY DEFINER functions are anon-executable**, and all twelve are exactly the ones
`0089_security_lockdown_phase1.sql:89-93` lists as reviewed and deliberately kept guest-facing:
`get_coach_busy_slots`, `get_court_available_slots`, `get_court_busy_slots`,
`get_court_rating_summary`, `is_verified_coach`, `general_fund_balance`, `get_empower_stats`,
`public_upa_profile`, `upa_fund_balance`, `upa_money_summary`, `variant_available_stock`,
`get_group_member_counts`. **0089's revoke held: no function outside that keep-list is
anon-executable, and nothing since has re-granted.** Every definer function in `public` also
carries `set search_path = public`, so none is search-path hijackable.

### Finding 4 (P3): five of them still carry the PUBLIC grant

`pg_proc.proacl` shows a leading `=X/postgres` entry, which is the PUBLIC grant, on:

- `get_coach_busy_slots(uuid, date, date)`
- `get_court_available_slots(uuid, date)`
- `get_court_busy_slots(uuid, date, date)`
- `get_court_rating_summary(uuid)`
- `upa_money_summary(uuid)`

0089's own docblock at lines 45 to 49 states the principle: "both the named grant and the PUBLIC
grant must be revoked to actually close" the hole. For the keep-list it revoked neither, which is
consistent for `anon` but leaves EXECUTE granted to PUBLIC, meaning every present and future role
in the database, not just `anon`, `authenticated` and `service_role`. Low impact today because
these five are intended to be world-readable aggregates. It is a deviation from the repo's own
stated rule and it is a one-line fix per function.

### Finding 2 (P2): suspension does not reach the RPCs

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prosecdef and p.prosrc ilike '%is_actor_active%';
-- 0 rows
```

**No SECURITY DEFINER function anywhere calls `is_actor_active()`.** Meanwhile 27 mutating
(`provolatile = 'v'`, non-trigger, non-`admin_*`) SECURITY DEFINER RPCs are executable by
`authenticated`:

`accept_venue_staff_invite`, `add_to_cart`, `complete_player_setup`, `court_booking_check_in`,
`court_booking_transition`, `create_group_session`, `create_training_group`,
`deactivate_upa_application`, `mark_attendance`, `mark_wishlist_item_delivered`, `moderate_clip`,
`rate_court_booking`, `rate_session`, `reapply_upa_application`, `resolve_report`,
`resubmit_upa_application`, `retry_failed_clip`, `session_transition`, `set_athlete_sports`,
`submit_coach_verification`, `submit_upa_application`, `submit_venue_verification`,
`toggle_clip_like`, `toggle_follow`, `toggle_product_wishlist`, `update_cart_item`,
`update_training_group`.

0096 at line 180 states the coverage goal as FR-36's "any mutating action platform wide". At lines
200 to 205 it documents an accepted gap for exactly TWO of them (`toggle_clip_like` via
`clip_likes`, `toggle_follow` via `follows`) on the grounds that those tables have no permissive
write policy to restrict. The reasoning is sound; the scope is not. The same argument applies to
all 27, because a restrictive RLS policy never runs for a definer RPC that writes as `postgres`.

Concretely: between the moment an admin calls `admin_suspend_user` and the moment the caller's
access token expires or the GoTrue ban is enforced on refresh, a suspended user can still book,
transition sessions, mark attendance, create and edit training groups, submit verifications and
UPA applications, and mutate their cart. The direct-table restrictive policies correctly refuse
them; the RPCs do not. The unapplied 0100 and 0101 add two more to the set
(`delete_my_clip`, `set_clip_comments_enabled`).

This is not a leak, and it is time-bounded by the token lifetime, hence P2 and not P1. But the
migration's claim of platform-wide coverage is currently false, and it is false for 25 functions
that nobody has written down.

---

## 6. Finding 3 (P2): single-leg enforcement on `user_roles` and `audit_log`

CLAUDE.md's financial invariant is enforced twice, revoke plus no policy. That double enforcement
is NOT present on two of the most sensitive tables in the schema:

| Table | anon INSERT/UPDATE/DELETE grant | authenticated grant | permissive write policies |
|---|---|---|---|
| `user_roles` | yes / yes / yes | yes / yes / yes | **0** |
| `audit_log` | yes / yes / yes | yes / yes / yes | **0** |

`user_roles` is the privilege-escalation table: `has_role('admin')` reads it, and every admin gate
in the schema depends on it. `audit_log` is the tamper-evidence table that `admin_suspend_user`,
`admin_reinstate_user` and the refund path all write to.

**Today these writes are refused**, because RLS is enabled on both and neither has a write policy,
so `USING`/`WITH CHECK` never passes. The grants are Supabase's default `grant all on all tables in
schema public to anon, authenticated`, which `0089` stripped from the money tables but not from
these. So the situation is: one leg holds, one leg is missing, on the two tables where a single
mistake is unrecoverable. Anyone who later adds a permissive write policy to `user_roles` for any
reason immediately hands `anon` the ability to grant itself `admin`, with no second barrier.

The same single-leg shape is present more broadly and at lower value: `anon` holds
INSERT/UPDATE/DELETE grants on `venues`, `courts`, `session_types`, `coach_availability_windows`,
`court_*`, `venue_photos`, `venue_staff`, `verification_requests`, `users`, `fee_config`,
`feature_flags`, `notifications`, `notification_prefs`, `push_tokens`, `addresses`,
`athlete_sports`, `coach_profiles`, `coach_certificates`, `drills`, `milestones`,
`roadmap_stages`, `support_tickets`. In every case the policies target `authenticated` only, so
`anon` has no policy and is denied by RLS. Fixing `user_roles` and `audit_log` is the high-value
half; the rest is a `revoke insert, update, delete ... from anon` sweep.

---

## 7. Finding 1 (P1): nothing enforces any of this

`.git/hooks/pre-push` is this repo's stand-in for a required status check (CLAUDE.md: "CI that
cannot block is not a gate"). It contains:

```
42: if [ -x scripts/dod.sh ]; then
55: if [ -x scripts/security-invariants.sh ]; then
```

**Neither file exists.** Not in `scripts/`, not anywhere in the working tree, and
`git log --all -- scripts/dod.sh scripts/security-invariants.sh` returns nothing, so neither has
ever existed in any commit on any branch. Because both call sites are guarded by `[ -x ... ]`, the
hook prints nothing, skips both checks, and **exits 0**. The gate does not fail loudly when its
check is missing; it passes silently.

There is also **no `.github/` directory at all** in the repo root, so there is no CI to fall back
on.

This is the fifth failure shape from CURRENT-STATE.md, in its exact form: "absence of a generated
artifact, and the absence PASSES". Every invariant in this document, the permissive-OR filter rule,
the money-table double enforcement, the restrictive suspend companion, the anon EXECUTE keep-list,
is currently held by nothing but reviewer attention. The `0096` coverage loop is one-shot and the
thing that should re-check it does not exist.

Note the pre-push hook DOES successfully block direct pushes to `main`/`master` (lines 30 to 38,
unguarded), so it is not entirely inert. It is the two security checks specifically that are
no-ops.

---

## 8. Ruled out, with the reason

- **"venues has other unfiltered siblings."** Traced all 17 danger-set tables to every call site in
  `apps/`, `packages/` and `scripts/`. Every one carries its own filter. This is not an absence
  argument from a stale tree: each call site was opened and read.
- **"0096's restrictive policies are missing somewhere."** Zero gaps against the live catalog, and
  the query was negative-tested by removing `clips_active_insert` from the `have` set, which made
  it return exactly the expected row.
- **"The money tables are only defended once."** Both legs present on all four. Negative-tested by
  adding `users`, which produced 8 rows.
- **"0089's revoke drifted."** It held. All 12 anon-executable definer functions are exactly the
  documented keep-list, nothing outside it is anon-executable, and nothing since has re-granted.
- **"`public_profiles` and `coach_profiles_public` are an RLS bypass defect."** They are definer
  views, which is the intended pattern for projecting a safe column subset over an RLS-locked base
  table. Read both definitions: no email, no phone, no dob, no money column. Recorded in the views
  table above so a future column addition is not made blind.
- **"A restrictive SELECT or FOR ALL policy slipped in."** Queried directly. All 98 restrictive
  policies are INSERT, UPDATE or DELETE. None is SELECT or ALL.
- **"Some table has RLS disabled."** All 76 tables in `public` have `relrowsecurity = true`.
- **"A policy applies to the PUBLIC pseudo-role."** Zero policies anywhere in `public` have
  `0 = any(polroles)`.

---

## 9. Unresolved

- **`scripts/verify-rls-matrix.mjs` was NOT run in this session.** It is the repo's own read-only
  live probe for exactly this lane, it needs `SUPABASE_ANON_KEY`, and reading
  `apps/portal-court/.env.local` was refused by the permission system here. Per this repo's rule,
  a check that should apply but cannot run is a failure and not a skip: its verdict for the current
  tree is unknown, and nothing in this document should be read as a substitute for it. Someone with
  the key should run it and record the output.
- **No live PostgREST probe was run** for any claim above. Everything is catalog truth (policies,
  grants, ACLs) plus source reading. Catalog truth is strong evidence for what the database will
  do, but it is not the same as watching `anon` be refused over HTTP. The two are consistent here,
  and `verify-rls-matrix.mjs` is the instrument that would close the gap.
- **Storage bucket policies were not audited.** `storage.objects` policies are out of this lane's
  scope but carry the same permissive-OR hazard, and migration `0014`/`0016` history shows this
  repo has already been bitten there once.
- **The unapplied migrations 0099 to 0106 were read for policy and grant changes only.** Their
  full RLS impact once applied has not been simulated, and cannot be without a preview branch,
  which migration `0027`'s committed tool-call XML currently prevents.
