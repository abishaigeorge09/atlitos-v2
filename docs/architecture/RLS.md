# Row Level Security Strategy

Every table in `SCHEMA.md` has `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with no default-permissive policy. If a table has zero matching policies for a role, that role gets zero rows, not an error. This document is the policy inventory RLS advisors are checked against at every phase gate per PLAN.md's verification section.

## Roles Postgres sees

Supabase maps every request to one of two Postgres roles regardless of the app-level `app_role` enum in `user_roles`:

- `anon` — no session, or a Supabase anonymous auth session (this is the v1 "guest"). `auth.uid()` returns the anonymous user's own uuid, not null, so anon and a signed-in-but-roleless user are the same thing from RLS's point of view; policies key off `user_roles` membership, not off whether a session exists.
- `authenticated` — any session, anonymous or not, that holds a valid JWT. Policies below say "authenticated" to mean "has passed Supabase Auth," and layer `app_role` checks on top via `has_role()`.
- `service_role` — used only inside edge functions, bypasses RLS entirely by design. Never present in client bundle code (PRD-04 FR-2 makes this an explicit acceptance criterion for `apps/admin`, and it holds for every app).

## JWT custom claims hook

Supabase Auth's "Customize Access Token (JWT) Claims" hook runs at token mint (sign in, refresh, and anonymous sign-in) and lets a Postgres function inject claims without a round trip on every request.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  user_roles_arr jsonb;
begin
  select coalesce(jsonb_agg(role), '[]'::jsonb)
    into user_roles_arr
    from public.user_roles
    where user_id = (event->>'user_id')::uuid;

  claims := event->'claims';
  claims := jsonb_set(claims, '{app_metadata,roles}', user_roles_arr);
  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;
```

Registered in the Supabase dashboard (Auth > Hooks > Customize Access Token Claims) pointing at this function, granted `EXECUTE` only to `supabase_auth_admin`. The JWT's `app_metadata.roles` is then a plain string array every RLS policy reads via `auth.jwt()`, with no extra query per policy check.

**Hook execution context (0017, learned the hard way)**: GoTrue executes the hook as `supabase_auth_admin`, and that role is subject to RLS on `public.user_roles` like any other non-owner. Registering the hook alone therefore produced `roles: []` in every JWT (P2 finding 4's true root cause). `0017_auth_hook_user_roles_grant.sql` adds the required `grant usage on schema public` + `grant select on public.user_roles` to `supabase_auth_admin` and a permissive select policy scoped to it. If a future migration recreates `user_roles` or flips its policies, this grant and policy must survive or every newly issued token silently loses its roles again.

**Storage policy scoping (0016)**: inside a `storage.objects` policy whose subquery joins another table, an unqualified `name` binds to the joined table's `name` column, not the object path. `0014`'s venue-media partner policies hit exactly this (`storage.foldername(name)` captured `venues.name`, denying every partner upload); `0016_fix_venue_media_rls.sql` re-creates them with `objects.name` qualified. Qualify `objects.name` in any future storage policy that joins a table owning a `name` column.

**Staleness note**: a role granted or revoked mid-session does not appear until the client's next token refresh. `apps/admin` explicitly relies on this for FR-3 (a revoked admin's next session refresh fails); mutating role changes elsewhere (coach verification approval, user suspension) either wait for the natural refresh cycle or the affected app forces one via `supabase.auth.refreshSession()` after a realtime notification, never by trusting a cached client-side role flag.

## `has_role()` and friends

```sql
create or replace function public.has_role(_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' -> 'roles') @> to_jsonb(_role),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable
as $$ select public.has_role('admin'); $$;

create or replace function public.is_moderator()
returns boolean
language sql stable
as $$ select public.has_role('moderator'); $$;

create or replace function public.is_guest()
returns boolean
language sql stable
as $$
  select not exists (
    select 1 from public.user_roles where user_id = auth.uid()
  );
$$;
```

As shipped in `0001_identity.sql`, `has_role()` takes `text` rather than `public.app_role`: it compares the literal string directly against the JWT's `app_metadata.roles` array, so callers pass a string without an enum cast. `is_moderator()` was added alongside `is_admin()` for the `moderator` role introduced in the same migration (see `SCHEMA.md`'s `app_role` enum).

`has_role()` is `SECURITY DEFINER` only so it can be called from any policy without each caller needing `EXECUTE` re-granted per table; it touches no table, only the JWT already in the request, so it carries no elevation risk. Every policy below is written in terms of `has_role()`, `auth.uid()`, and ownership columns, never a raw role string comparison, so a future role rename is a one-function change.

## The financial write prohibition

No table listed under payments in `SCHEMA.md` (`payment_intents`, `ledger_entries`, `payout_accounts`, `transfers`, `fee_config`) and no money or state-machine column on a domain table (`sessions.status`, `sessions.price/platform_fee/total`, `court_bookings.status` and its money columns, `orders.status` and its money columns, `upa_wishlist_items.funded_amount`, `donations.*`) ever receives an `INSERT`, `UPDATE`, or `DELETE` grant for `anon` or `authenticated`. Concretely:

- `payment_intents`, `ledger_entries`, `payout_accounts`, `transfers`: **no** `INSERT`/`UPDATE`/`DELETE` policy exists for `authenticated` at all, on any of these four tables. The only writers are edge functions running as `service_role` (bypasses RLS) and, for `ledger_entries` specifically, not even `service_role` gets `UPDATE`/`DELETE` — the table's grants omit those verbs for every role, full stop, enforcing insert-only at the grant level, not just by policy convention.
- `fee_config`: `INSERT`/`UPDATE` restricted to `has_role('admin')`, no `DELETE` policy for anyone (versioned rows are superseded by a new row with a later `effective_from`, never deleted, per `SCHEMA.md`).
- `sessions`, `court_bookings`, `orders`: `UPDATE` policies exist for `authenticated` but their `WITH CHECK` clause blocks every column PostgREST could otherwise touch by requiring the row to be unchanged except through the RPC path (see below); in practice the client never calls `PATCH` on these tables at all, `packages/api` only exposes the RPC/edge function wrapper for anything beyond a `SELECT`, so this is enforced twice: by RLS and by there being no client code path that attempts it.
- State machine RPCs (`session_transition`, `court_booking_transition`, `rate_session`, `rate_court_booking`) are `SECURITY DEFINER`, owned by a role with table-level write access the calling `authenticated` role does not have directly. This is the actual mechanism: RLS on `sessions`/`court_bookings` grants **zero** direct `UPDATE` to `authenticated`; the only way a status or money column changes is through one of these functions, which re-check caller identity and current state themselves (that is where `INVALID_TRANSITION` and `SLOT_TAKEN` are raised) before performing a write the function's own elevated privilege allows. Being `SECURITY DEFINER` is necessary but **not sufficient** for a transition that carries a money consequence: see the next bullet.

- **Money-consequential transitions are `service_role` only** (`0027_session_transition_service_role_gate.sql`, AT-61). A `SECURITY DEFINER` RPC that only moves a status is safe to grant to `authenticated`; one whose *money half lives in an edge function* is not, because a client calling it directly performs half the money event and drops the other half. Two `session_transition` actions were in that category and were reachable from client code until AT-61: `complete` (the coach earnings accrual is written by `complete-session`, so a bare RPC call completed the session and never credited the coach) and `cancel` while the session is still `requested` (the refund is issued by `cancel-session-refund`, so a bare RPC call cancelled the session and never repaid the athlete, breaking the promise PRD-02 FR-35 makes). The machine now lives in `session_transition_internal`, granted to `service_role` only, alongside `settle_refund` and `court_booking_confirm_payment`/`court_booking_expire_payment`; `session_transition` keeps its `authenticated` grant, refuses those two cases with `USE_EDGE_FUNCTION`, and delegates the rest unchanged. Enforcement is a **grant**, not a check on `request.jwt.claims`: a `SECURITY DEFINER` function is the wrong place to trust a GUC string.
  - Still client callable, because none of them moves money: `accept`, `decline`, `reschedule`, and `cancel` from `accepted` (an accepted-session cancellation issues no automatic refund by design, PRD-02 section 8).
  - `court_bookings` was checked for the same exposure and does **not** have it: courts write their ledger group at booking time (`_shared/finalize-court-booking-payment.ts`), not on completion, and there is no court cancellation refund, so `court_booking_transition`'s `complete`/`cancel` have no edge-function half to skip. Its money RPCs were already `service_role` only. **If a courts completion accrual or cancellation refund is ever added, `court_booking_transition` must get this same gate in the same change.**

The general rule this generalises to, for any future state machine RPC: if the transition has a money consequence that is not written inside the same function, the transition does not belong to `authenticated`.

This is the schema-level expression of PLAN.md's invariant: "clients never write money rows or state transitions."

## Guest/anon read surface

The guest experience (PRD-01 section 3, FR-1 through FR-5) needs `anon` to read real content with zero writes. The following is the complete set of tables with an `anon`-inclusive `SELECT` policy; anything not listed here is invisible to a guest, no exceptions:

| Table | Guest read scope |
|---|---|
| `coach_profiles` | `status = 'verified'` rows only, and only through the `coach_profiles_public` view; the base table itself is never `anon`-readable |
| `session_types`, `coach_availability_windows` | rows whose owning coach is `status = 'verified'`, via `is_verified_coach()` (`0030`) |
| `venues`, `courts`, `court_availability_windows`, `court_pricing_rules` | `venues.status = 'verified'` rows only |
| `products`, `product_media`, `product_variants`, `categories` | `products.active = true` |
| `clips` | `status = 'published'` |
| `clip_comments` | comments on a `published` clip |
| `upa_applications`, `upa_wishlist_items`, `gratitude_posts` | `upa_applications.status = 'verified'` rows only |
| `drills`, `roadmap_stages`, `milestones` | all rows (public reference content, no per-user data) |
| `promo_banners` | `active = true` (0071, Home promo carousel, PRD-01 3.2; public reference content, no per-user data) |
| `affiliate_products` | `active = true` (0086, WS4 affiliate marketplace; public reference content, no per-user data) |
| `product_offers` | rows whose owning `affiliate_products` row is `active = true`, via an `EXISTS` in the policy (0086) |

Everything else, `users` beyond the caller's own row, `sessions`, `court_bookings`, `orders`, `cart_items`, `donations`, `payment_intents`, `ledger_entries`, `notifications`, `chat_threads`/`chat_messages`, `verification_requests`, `audit_log`, requires `authenticated` at minimum and is further scoped by ownership or role below. Any mutating action a guest attempts against a write-guarded table returns a Postgres/PostgREST permission error, which the client intercepts and renders as `LoginGateSheet` per PRD-01 FR-3, never a raw 403 shown to the user.

## Policy strategy per domain

Each row states the policy in plain terms; the actual SQL is one `create policy` per verb per table in the migration, following this table exactly. "Own row" means the policy's `USING`/`WITH CHECK` compares a `user_id`-shaped column to `auth.uid()`.

### identity/roles

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `users` | own row; any authenticated user may also read the public-facing subset (name, avatar_url, channel_name, and since `0072` handle, bio, cover_url) of a coach/creator/UPA's row via the view `public_profiles`, never the base table cross-user | own row only, `INSERT` is trigger-only (on `auth.users` insert, `handle_new_user()` also seeds a default `player` `user_roles` row). `0072` adds `bio`/`cover_url`/`handle` with NO policy change: `users_update_own` is a whole-row own-row policy (no column list), so the owner already writes the three new columns; the only column locks stay the `0065` trigger's `status`/`suspended_reason`. Handle uniqueness is enforced by the unique index `idx_users_handle_lower` on `lower(handle)`, surfaced to the client as a friendly duplicate-handle error |
| `user_roles` | own rows; admin reads all | no `authenticated` write at all; every role grant happens through a `SECURITY DEFINER` path (the signup trigger for the initial `player` role, a future verification-approval RPC, venue staff acceptance) so a user can never grant themselves `admin` or `coach` by a direct insert |
| `addresses` | own rows | own rows, `DELETE` blocked by a trigger if referenced by a non-`delivered`/non-`cancelled` order (PRD-07 FR-30). **Shipped in `0036_address_delete_guard.sql` (AT-70)**, as this row anticipated, now that `orders` exists. The trigger raises `ADDRESS_IN_USE` for an in-flight order (FR-30, AC-F3, rendered inline by the Address Book) and `ADDRESS_ON_PAST_ORDER` when only delivered/cancelled orders reference it. The second case is not in FR-30 and is blocked only because `orders.address_id` is `NOT NULL` with no snapshot, so the delete would fail on the foreign key anyway; the trigger turns a raw Postgres error into an explainable one. See SCHEMA.md's "known gap" note for the proper fix |
| `athlete_sports` (new, `0001_identity.sql`) | own rows; admin reads all | own rows, full CRUD |

### coaching

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `coach_profiles` | own row always (any status); admin reads all; the base table has **no** public `SELECT` policy, public discovery of verified coaches reads the view `coach_profiles_public` instead (as shipped in `0001_identity.sql`, a definer-style view filtered to `status = 'verified'` that bypasses the base table's owner/admin-only RLS by design) | own row `INSERT`/`UPDATE`, `WITH CHECK` requires `has_role('coach')`; `status`, `rating`, `rating_count`, `players_coached_count` locked by the `lock_coach_profile_admin_fields` trigger to `has_role('admin')` or a server-side pipeline (sport immutability enforced by a separate trigger once `verification_requests` exists, not by RLS). `0021_session_state_machine.sql` re-declares that trigger to also accept a transaction-local `app.rating_pipeline = 'on'` GUC, which is how `rate_session` refreshes the aggregate rating; the GUC alone grants nothing, since a client still has no `UPDATE` policy on `coach_profiles`' locked columns |
| `coach_certificates`, `session_types`, `coach_availability_windows` | own coach's rows; verified coach's `session_types`/`availability_windows` also public (discovery needs them), gated by `public.is_verified_coach(coach_id)` since `0030` and NOT by an inline subquery, see below | own coach only (`has_role('coach') AND coach_id = auth.uid()`) |
| `sessions` | `has_role('coach') AND coach_id = auth.uid()` OR `player_id = auth.uid()`; admin or moderator reads all | **no** direct `authenticated` write; all writes via `book-session` edge function (insert) or `session_transition`/`rate_session` RPCs (status/rating). `0019_coaching_rls.sql` additionally `revoke insert, update, delete on public.sessions from anon, authenticated` at the grant level, the same belt-and-braces `ledger_entries` uses, so a future careless policy still cannot open a client write path |

Shipped in `0019_coaching_rls.sql` (`session_types`, `coach_availability_windows`, `sessions`) and `0018_coaching.sql` (which enables RLS on all three at creation time, so there is no window where they exist unprotected).

**Permissive-OR in coaching, stated explicitly (0019).** All three coaching tables have the leaky-by-construction shape this doc warns about, and it is unavoidable: `sessions` must be readable by both its coach and its player, and `session_types`/`coach_availability_windows` must be readable both by their owning coach and publicly for discovery. Policies combine with OR, so an unscoped `select * from sessions` returns both sides of a coach-and-player user's rows, and an unscoped `select * from session_types` returns every verified coach's rows, not the caller's. Every UI query against these three tables must carry its own owner filter (`.eq('coach_id', user.id)` or `.eq('player_id', user.id)`); RLS here is an authorization ceiling, not scoping. This is the P2 venues defect restated in a new domain, per PHASE-3-STATUS.md durable lesson 1.

**Discovery policies must not subquery a table the caller cannot read (0030, AT-63).** `0019` wrote both public discovery policies as an inline `exists (select 1 from public.coach_profiles cp where cp.user_id = <table>.coach_id and cp.status = 'verified')`. That looks right and is wrong, because **a subquery inside an RLS policy is evaluated under the calling role's own privileges, RLS included**. `coach_profiles` has exactly two `SELECT` policies, own-row and admin, and deliberately no public one (see its row above). So for every guest and every athlete that `EXISTS` was false on every row, and both policies denied everything.

Measured against the live project before the fix, as `set role anon` and as a non-owner `authenticated` athlete: `session_types` 0 rows, `coach_availability_windows` 0 rows. Coach discovery *itself* was unaffected, because `listCoaches` reads the `coach_profiles_public` view (`security_invoker = false`, so it runs as its owner and bypasses the base table's RLS), as were `public_profiles` and the `get_coach_busy_slots` definer RPC. The dead surface was therefore precisely the coach **detail** screen and everything downstream: a coach with no pricing tiers (PRD-01 FR-21) and no availability, so the slot engine generated zero bookable slots (FR-22) and booking was unreachable. A catalogue you could browse and could not buy from. Nothing errored; the policies returned zero rows, which is the silent failure mode this document's opening paragraph describes.

`0030_verified_coach_discovery_rls.sql` replaces the inline subquery in both policies with `public.is_verified_coach(coach_id)`, a `SECURITY DEFINER STABLE` boolean (`search_path = public`, granted to `anon` and `authenticated` only). Two things were deliberately NOT done:

- **No public `SELECT` policy was added to `coach_profiles`.** That is the obvious fix and it is the wrong one twice over: it re-grants the whole row when the public column surface is already defined, deliberately and column-by-column, by the `coach_profiles_public` view (which omits `status` and `updated_at`), leaving two definitions of "public coach profile" to drift apart; and it would give `coach_profiles` the permissive-OR shape CLAUDE.md records three incidents for, making every existing and future read of that base table capable of returning other coaches' rows. The three current reads (`packages/api/src/hooks.ts`, two in `use-coach.ts`) were each checked and are all already `.eq("user_id", ...)` owner-scoped, so nothing would have leaked today; the objection is that it spends a permanent repo-wide correctness constraint to buy what the view already provides. **No existing query needed new owner-scoping as a result of this fix**, precisely because the base table gained no reader.
- **The policies were not widened.** `session_types` and `coach_availability_windows` are readable for `status = 'verified'` coaches only, exactly as the guest read surface table above has always claimed and as `0019` intended.

Note what this means for the permissive-OR warning immediately below: it was until now *vacuous* for these two tables, since the public disjunct matched nothing. `0030` makes it live. An unscoped `select * from session_types` now really does return every verified coach's rows, so UI queries must keep carrying their own `.eq('coach_id', ...)` filter.

`scripts/verify-discovery.mjs` (AT-63) is the regression guard: it drives the full discovery-to-booking read path as a real athlete session and as a real guest, asserting on non-zero **row counts** rather than on the absence of an error, because an error-only check would have passed throughout the entire outage. It also asserts negatively that `coach_profiles`, `coach_certificates`, `sessions`, and `payment_intents` stay invisible, so a future migration that "fixes" discovery the blunt way by opening the base table fails the script instead of passing it.

`session_exists_between(user_a, user_b)` also ships in `0019_coaching_rls.sql`: a `SECURITY DEFINER` boolean over `sessions`, granted to `authenticated` only, used by the `chat_threads` insert policy to enforce PRD-02 FR-30 without giving the chat layer any read of session rows.

### courts

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `venues`, `courts`, `court_availability_windows`, `court_blackouts`, `court_pricing_rules` | verified public; own venue's rows always | `has_role('court_partner') AND partner_user_id = auth.uid()` (courts/windows/blackouts/pricing scoped through their `venue_id` join); `court_staff` gets none of these |
| `venue_staff` | own venue (partner) or own membership row (staff) | insert (invite) by the owning partner only; `accepted_at` set by the invited staff member accepting, via a narrow RPC, not a direct update |
| `court_bookings` | `has_role('court_partner') AND court_id IN (partner's courts)` OR `has_role('court_staff') AND court_id IN (assigned venue's courts)` OR `user_id = auth.uid()` | **no** direct `authenticated` write; `book-court` edge function inserts, `court_booking_transition`/`rate_court_booking` RPCs handle status/rating. Partner/staff check-in and walk-in also go through RPCs/edge functions scoped by `has_role('court_partner')`/`has_role('court_staff')`, never a raw `UPDATE` grant. `0029` adds the grant-level `revoke insert, update, delete ... from anon, authenticated` that `0009` omitted (see below) |

**`court_bookings` write revoke (0029, AT-62).** `0009_courts.sql` gave `court_bookings` no write policy for `authenticated`, so client writes were already denied, but it never revoked the underlying table grants the way `0019` does for `sessions` and `0022` does for `chat_messages`. The grants were inert (a grant without a policy still yields zero rows), so this was not a live hole, but it left this money-bearing table one careless future policy away from a direct client write, without the second layer every comparable table has. `0029_realtime_courts_sessions.sql` closes it. It was closed in that migration specifically because that is the migration that publishes the table: on a published table a stray client `UPDATE` is no longer a silent local corruption, it fans out to every subscribed partner socket as an authoritative-looking event.

**`court_bookings` and `sessions` SELECT policies were reviewed before publishing (0029, AT-62), and both passed unchanged.** The review mattered because both have the permissive-OR shape this document warns about, and the warning is not "an OR is present" but "is any disjunct unanchored from the row's owner":

- `court_bookings_select`'s `is_court_partner_or_staff(court_id)` joins `courts` to `venues` and requires `v.partner_user_id = auth.uid()` (partner branch) or an `accepted_at is not null` `venue_staff` row on that same venue (staff branch). Every branch is anchored to the row's own venue; the remaining `OR user_id = auth.uid()` is the booking's own athlete. Both disjuncts sit inside one policy's `USING`, and neither is a public discovery policy, so this is the safe `chat_threads` shape, not the leaky `venues` shape. `court_bookings_select_admin` widens only for admins/moderators, by role rather than by row.
- `sessions`' three policies are two ownership comparisons (`coach_id = auth.uid()`, `player_id = auth.uid()`) plus a role-gated admin policy. The 0019 permissive-OR caveat above applies to query authors (a coach-and-player user sees both sets from one unscoped query, so UI queries carry their own owner filter) but is not a cross-user leak and does not widen the Realtime audience past the two parties.

Neither policy was rewritten. Re-creating a correct policy to demonstrate that it was reviewed adds risk and obscures intent; the review is recorded in `0029`'s header and here instead.

**Realtime respects these policies, now proven for courts too.** AT-59 proved empirically that Supabase Realtime evaluates the `SELECT` policy per subscriber for `chat_messages`. AT-62 proved the same for `court_bookings` and `sessions` against the live project, and this was worth proving separately rather than generalising from chat: chat's policies use only `auth.uid()`, whereas `court_bookings` depends on `has_role('court_partner')`, which reads `app_metadata.roles` out of the JWT. Realtime evaluates policies in its own connection context, so a `has_role()` returning false there would have failed closed and looked exactly like another dead publication. It does not. `scripts/verify-realtime.mjs` Parts 3 and 4: a second partner subscribed both to the owning partner's exact channel and filter and to an unfiltered project-wide `court_bookings` stream, and received zero events across both; a non-party did the same for `sessions` with the same result.

### commerce

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `products`, `product_media`, `product_variants`, `categories` | `active = true` public; admin reads all | `has_role('admin')` only |
| `affiliate_products` | `active = true` public browse | **no client write** (grants revoked from `anon`/`authenticated`); service-role only (ingest worker / admin). Prices and offers are ingested, never user-set: a client that could write an offer price could rewrite the price it is about to be shown. Same lock shape as `promo_banners`. `0086` |
| `product_offers` | public browse of offers whose product is `active` (an `EXISTS` re-derives the product's `active` in the policy, so a delisted product's offers never leak) | **no client write**; service-role only. `0086` |
| `product_wishlist_items`, `cart_items` | own rows | own rows (`cart_items` writes for add/update go through `add_to_cart`/`update_cart_item` RPCs for the stock re-check, `DELETE` is a direct own-row policy since removal needs no stock check) |
| `orders`, `order_items`, `order_timeline` | own orders (`user_id = auth.uid()`); admin reads all | **no** `authenticated` write on any of the three; `checkout` edge function inserts, `admin-order-advance`/`admin-order-refund` edge functions and RPCs (admin-only) write timeline/status |
| `order_feedback` | own row | own row `INSERT` only, once (`UNIQUE(order_id)` plus a policy requiring the order's `status = 'delivered'`), no `UPDATE`/`DELETE` |
| `stock_reservations` | **nobody**; RLS enabled with zero policies and grants revoked from `anon`/`authenticated` outright | `service_role` only, and only through the three RPCs in `SCHEMA.md` |

**As built in `0032_commerce_rls.sql` (AT-66), with three clarifications to the rows above.**

1. **`categories` has no `active` column**, so "active = true" has no referent there. `SCHEMA.md` gives that table three columns and no flag. Categories are public reference content with no per-user data, the same class as `drills` and `roadmap_stages` in the guest read surface, so `categories_select_public` is a plain `using (true)`. `product_media` and `product_variants` do gate on `active`, via an `EXISTS` through `products`.

2. **`cart_items` gets no `INSERT` or `UPDATE` policy at all, and those verbs are revoked.** The row above says "own rows"; as built, only `SELECT` and `DELETE` are own-row policies. If a client could reach the table with a PostgREST upsert, PRD-07 FR-9's stock revalidation would be decorative, since the cap would live in the UI and nowhere else. `add_to_cart` and `update_cart_item` are therefore the only write paths, which is also what PHASE-4-STATUS.md trap 3 requires. `DELETE` stays direct because removal needs no stock check (FR-10).

3. **`orders`, `order_items` and `order_timeline` are enforced twice**: no write policy for `authenticated`, *and* `INSERT`/`UPDATE`/`DELETE` revoked from `anon` and `authenticated` at the grant level, following the `0010_payments_core.sql` pattern. A future migration that accidentally adds a permissive policy still cannot produce a client write.

**`product_variants` write, and the one distinction that matters.** Admin stock adjustment (PRD-04 FR-17) writes `product_variants.stock` directly and that is legitimate: raw stock is an inventory fact an admin owns, not a money column and not a state machine. What nothing client-side may do is decrement it *as part of a sale*; that is `consume_reservation`'s job under `service_role`. `authenticated` keeps its catalog DML grants because the admin app authenticates as `authenticated` with an admin role claim, and the `*_write_admin` policies are what gate it. `anon` has catalog DML revoked outright.

**`order_transition` is `service_role` only** (`0035_order_state_machine.sql`), applying AT-61's rule: a transition whose money half lives in an edge function does not belong to `authenticated`. Advancement must also write an `audit_log` row (PRD-04 FR-23) that `authenticated` cannot write, and cancellation is refund adjacent. Unlike sessions there is no `authenticated`-facing wrapper at all, because no order transition is both non-money and client initiated. The shopper app only reads the timeline (PRD-07 FR-24).

#### Permissive-OR in commerce: the highest risk configuration so far

This is the fourth domain to carry the shape CLAUDE.md records incidents for, and the first where a **public** table and an **owner scoped** table sit inside the same joined query on the same screen.

- Public browse, returns everyone's rows by design: `categories`, `products`, `product_media`, `product_variants`
- Owner scoped, must return only the caller's: `cart_items`, `product_wishlist_items`, `orders`, `order_items`, `order_timeline`, `order_feedback`, `addresses`

The failure mode is not that the catalog is public; that is intended. It is a cart or checkout query joining the two families that carries a filter on the **catalog** side only, leaving the owner scoped side unfiltered. It does not error. It silently returns other shoppers' rows.

**App code contract, required not advisory.** Every read of an owner scoped table above carries its own explicit `.eq("user_id", user.id)` in the query itself, regardless of what RLS would have done, in `apps/*`, in `packages/api`, in `supabase/seed`, and in every test harness. Reach `order_items` and `order_timeline` **through** an owner-filtered order id, never by a bare select on the child table. RLS here is an authorization ceiling, not a scoping mechanism.

**Verified as built, non-vacuously (AT-66).** Two distinct real users were asserted to have different ids *before* the assertion was trusted, per P2's corollary and the AT-62 lesson. Each then ran the same unscoped `select` as `authenticated`: shopper A saw only A's cart line, order, order item and timeline row; shopper B saw only B's, and the row ids returned differed between them. Both saw the public catalog, and neither saw the deactivated product. `anon` browses the catalog and the availability view and is refused `cart_items` and `stock_reservations` at the grant level, which surfaces as a hard permission error rather than a silently empty result.

#### The commerce entries in the P4 advisor diff, and which are deliberate

`security_definer_view` **ERROR on `product_variant_availability`** is intentional. The view must read `stock_reservations`, which no client may read. With `security_invoker = true` the caller's own RLS would apply to that join, the reservation side would return zero rows for every client, `held_qty` would silently compute as 0, and the view would report **raw** stock while claiming to report available. That failure is invisible and it oversells. The definer view is the safe choice, and it reproduces the catalog's `products.active` predicate itself so bypassing RLS widens nothing. It joins `public_profiles` and `coach_profiles_public`, which carry the same lint for the same reason.

`rls_enabled_no_policy` **INFO on `stock_reservations`** is intentional and is the fail-closed end state, matching `webhook_events` since `0010`.

The `*_security_definer_function_executable` **WARN**s on `add_to_cart`, `update_cart_item`, `toggle_product_wishlist` and `variant_available_stock` are intentional: these are the client-facing commerce RPCs, being callable over `/rest/v1/rpc` is the point, and each re-checks `auth.uid()` internally.

Two findings in the diff were **not** intentional and were closed by `0037_commerce_advisor_fixes.sql`: `block_delete_address_in_use()` was RPC-callable by `anon`/`authenticated` despite being a trigger function (execute revoked), and `stock_reservation_ttl()` had a mutable `search_path` (pinned).

### clutch

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `clips` | `published` public; own clip any status; admin/moderation reads all | own row `INSERT` (`status` forced to `uploading` by column default, not client-settable to anything else); `UPDATE` of `status` is **not** granted to `authenticated`, only edge functions (`stream-webhook`) and admin moderation RPCs move it forward |
| `clip_likes`, `follows` | public (needed for counts) | own row via `toggle_clip_like`/`toggle_follow` RPCs only, no direct `INSERT`/`DELETE` grant (keeps the `likes_count`/follower count trigger authoritative and race-free) |
| `clip_comments` | comments on visible clips | `INSERT` requires `NOT is_guest()`; own row `DELETE`, no `UPDATE` (comments are immutable once posted) |

Shipped in `0041`/`0042` (grants corrected in `0046`). Notes:

- **Permissive-OR on `clips`**: `clips_select_published` (public) sits beside `clips_select_own` and `clips_select_admin` in the same table, so an unscoped `select` returns the caller's own non-published clips alongside the published feed. Every feed query carries its own `.eq('status','published')` and every profile query its own `.eq('owner_id', user.id)`; RLS is a ceiling, not scoping. Verified non-vacuously with two distinct users (owner sees own rejected/removed/uploading, a non-owner never does).
- **anon KEEPS `SELECT`** on `clips`, `clip_likes`, `follows`, `clip_comments` (the published feed and `creator_stats` are guest browsable, FR-42/FR-3; guest gating is on actions, not viewing). Only the write verbs are withdrawn from anon. `0042` originally over-revoked (`revoke all ... from anon` stripped SELECT and broke the guest feed and the `security_invoker` `creator_stats` view); `0046` restores it. A second, distinct break: `0041` built `creator_stats` `FROM public.users`, and under invoker RLS the own-row `users` policies filtered the view to zero rows for anon and to only the caller's own row for members. `0074` rebuilds the view over `public_profiles` (the definer cross-user surface), keeping `security_invoker = on` for the public-read clips/follows subqueries.
- **No client `clips.status` write**, by policy (no UPDATE policy) and by grant (`revoke update, delete`). Forward moves are the `stream-webhook` finalizer (`service_role`) and `moderate_clip`/`resolve_report` (admin/moderator, SECURITY DEFINER). Insert forces `uploading` via the policy `WITH CHECK`.
- **FB-004 owner-playback widening (phase-9, 2026-07-29): NO clips policy change.** The `clips_select_own` policy already lets the owner SELECT their own row in ANY status, so the RLS floor was already correct. The FB-004 fix (owner can watch their own clip back regardless of moderation status, so a `rejected`/pending own clip on the profile no longer refuses playback) lives entirely in the `get-clip-playback-url` edge function, which runs under the service role and mints the signed URL, so its authz is fn code, not RLS. See VIDEO.md's `get_clip_playback_url` contract. Proven non-vacuously against the live project (owner sees own `processing`/`rejected`; non-owner sees neither but sees a published control; two distinct ids asserted first).
- **Likes/follows have no client write grant**; `toggle_clip_like`/`toggle_follow` are the only write path, keeping the count triggers authoritative. The two count trigger functions have `EXECUTE` revoked from all client roles (they fire as the table owner; `0041`/`0047`, the `0037` precedent).

### empower

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `upa_applications` | `status = 'verified'` public; own row (any status) for the applicant; admin/staff reads all | **no** client write grant at all: the row is created only by `submit_upa_application`/`reapply_upa_application` (`0050`, `SECURITY DEFINER`, `applicant_user_id` forced to `auth.uid()`), story fields edited only by `resubmit_upa_application`, status moved only by the `0050` machine and the admin verify branch; status column never client-writable |
| `upa_evidence` | own application's rows; admin reads all | own application `INSERT` only, no `UPDATE`/`DELETE` after submission |
| `upa_wishlist_items` | verified UPA's items public; own UPA's items always | own UPA `INSERT`/`DELETE` and `UPDATE`, `USING`/`WITH CHECK` additionally require `status = 'open' AND funded_amount = 0` (PRD-05 FR-12/FR-13). **`funded_amount`/`status` are excluded from the client's writable columns by GRANT, not by `WITH CHECK`**: a `WITH CHECK` alone cannot forbid setting a specific column, so the `UPDATE` grant to `authenticated` is column-scoped to `(title, cost, updated_at)` and neither money/status column carries an update privilege for `authenticated` (a client `UPDATE` of either fails 42501 before any policy runs). The `donate` finalize handler writes them under `service_role` |
| `donations` | own donations (donor); own UPA's attributed donations (UPA, via `upa_id`); admin reads all | **no** `authenticated` write at all, by absence of a write policy AND by grant revocation; `donate` finalize edge function only (`service_role`) |
| `gratitude_posts` | linked to a `verified` UPA (and `status = 'published'`), public; own UPA's posts always | own UPA `INSERT` (only for a `funded`/`delivered` item with no existing post, checked in `WITH CHECK` via subqueries, with `UNIQUE(wishlist_item_id)` as the hard backstop) and soft-delete `UPDATE` (grant column-scoped to `status`/`deleted_at`, so body/photo are immutable after posting), no hard `DELETE` |

Landed in `0048` (schema + the `general_fund_account_ref()` anchor + the `upa-evidence`/`upa-photos`/`gratitude-photos` buckets), `0049` (these policies, the storage.objects policies below, and the `verification_requests` `applicant_type = 'upa'` ownership `SELECT` branch left as a no-op in `0003` until `upa_applications` existed), and `0051` (revoke anon execute on the client empower RPCs, matching the `0005` baseline). All three permissive-OR tables (`upa_applications`, `upa_wishlist_items`, `gratitude_posts`) were verified non-vacuously: three distinct user ids, an observer never sees another owner's non-verified application (0 rows) while still seeing a verified one (positive control, 1 row); `donations` refuses a direct client `INSERT` (42501); a client `UPDATE` of `upa_wishlist_items.status` refuses (42501).

### learn

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `drills`, `roadmap_stages`, `milestones` | public, all rows | `has_role('admin')` only |
| `drill_completions` | own rows | own row `INSERT` only (the `UNIQUE(user_id, drill_id)` constraint makes a second insert fail, which is the idempotency guard, not application logic); no `UPDATE`/`DELETE` |
| `xp_events` | own rows | **no** `authenticated` write; written by the same transaction as `drill_completions` insert via a trigger, so XP cannot be granted without a real completion row |
| `user_milestones` | own rows | **no** `authenticated` write; a trigger on `xp_events`/`drill_completions` insert evaluates `milestones.criteria` and inserts here, so a milestone cannot be self-awarded |

**Shipped in `0058_learn_rls.sql` (AT-130).** Enforced exactly as above, twice (policy + grant, the `0049` house pattern):

- `drills`/`roadmap_stages`/`milestones` carry an `anon`-inclusive public `SELECT` (all rows) and an `has_role('admin')` `FOR ALL` write policy; admin CRUD actually flows through Track B's SECURITY DEFINER `admin_upsert_drill`/`admin_set_drill_active` RPCs (which bypass RLS and write `audit_log`), the admin policy being the belt to that braces. **Permissive-OR contract (gate clause 8):** an unscoped `select * from drills` returns every drill including inactive ones, so every consumer read carries its own `.eq('active', true)`; the admin Drill List sees all, by design. Verified non-vacuously: the public catalog is readable to a second user while that user sees zero of the first user's owner-scoped rows.
- `drill_completions`: own `SELECT` + own `INSERT` only; `update`/`delete` are revoked from `authenticated` at grant level, so no mutate path exists even if a future policy is careless. `UNIQUE(user_id, drill_id)` (`0057`) is the idempotency guard.
- `xp_events` and `user_milestones`: owner `SELECT`, and **no write grant of any kind** for `anon`/`authenticated` (revoked, no write policy). A direct client `INSERT` into either returns `42501` (verified). The `0059` SECURITY DEFINER trigger is the sole writer; its `execute` is revoked from `public`/`anon`/`authenticated` (a trigger fires as owner regardless, the `0037`/`0047` advisor fix).

### chat

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `chat_threads` | `participant_a = auth.uid() OR participant_b = auth.uid()` | `INSERT` only if a qualifying `sessions` row (any status) exists between the two participants (checked in `WITH CHECK` via subquery, enforces PRD-02 FR-30's "no cold outreach"), no `UPDATE`/`DELETE` from clients (`last_message_at` maintained by trigger) |
| `chat_messages` | via parent thread's participant check | `sender_id = auth.uid() AND sender_id IN (thread's two participants)`, no `UPDATE`/`DELETE` (messages are immutable) |

Realtime broadcast on `chat_messages` respects the same `SELECT` policy: Supabase Realtime authorizes each subscriber's channel against RLS, so a thread's messages never reach a socket that is not one of the two participants.

Shipped in `0022_chat.sql`. Specifics worth knowing:

- The FR-30 gate is `session_links_pair(context_id, participant_a, participant_b)` inside the thread `INSERT` policy's `WITH CHECK`, a `SECURITY DEFINER` boolean over `sessions`. It is stricter than "a session exists between them": `context_id` must itself be one of their sessions. A hand-rolled PostgREST insert from a modified client fails with 42501 exactly as the UI would have prevented, verified against the remote database.
- `INSERT` is restricted to `context_type = 'coaching'`. The `clutch_creator` branch is added when the Clutch domain lands; leaving it out means the failure mode is locked shut rather than "any authenticated user opens a thread with any stranger by sending a different `context_type`".
- Neither chat table is permissive-OR in the leaky sense: each has a single `SELECT` policy whose `USING` contains the participant `OR` internally, and there is no public policy to be combined with. An unscoped `select * from chat_threads` correctly returns only the caller's own threads. This is the exception to the coaching-domain warning above, not a contradiction of it.
- `UPDATE` and `DELETE` are revoked at the grant level on both tables, on top of having no policy: messages are immutable and `last_message_at` belongs to the `chat_messages_touch_thread` trigger.

### notifications

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `notifications` | own rows | **no** `authenticated` `INSERT` (written by `notify-dispatch` and various RPCs/edge functions as `service_role`); `UPDATE` limited to `read_at` on own rows, enforced by a trigger that rejects a change to any other column |
| `push_tokens` (renamed from `device_tokens`, `0002_notifications.sql`) | own rows | own rows, full CRUD |
| `notification_prefs` (new, `0002_notifications.sql`) | own rows | own rows, full CRUD |

### payments

Covered in full under "The financial write prohibition" above. Read policies:

| Table | `SELECT` |
|---|---|
| `payment_intents` | own rows (`user_id = auth.uid()`) |
| `ledger_entries` | rows where `account_type='coach' AND account_ref=auth.uid()`, or `account_type='court_partner' AND account_ref IN (own venues)`, or `account_type='user' AND account_ref=auth.uid()` (if ever used for a user-facing wallet); admin reads all; no `anon` access ever |
| `payout_accounts`, `transfers` | own (`owner_id = auth.uid()` matching `owner_type`), or the partner's own venue's rows; admin reads all |
| `fee_config` | authenticated read-only, all rows (needed for client-side bill preview before server re-pricing); no `anon` |

### moderation/audit

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `verification_requests` | own linked applicant rows (coach reads own, venue partner reads own, UPA reads own); admin or moderator reads all | own row `INSERT` on submit/resubmit (coach applicant type ships in `0003_moderation_audit.sql` as a direct `WITH CHECK (applicant_id = auth.uid() AND has_role('coach'))` policy; venue/UPA applicant types are added once `venues`/`upa_applications` exist); `UPDATE` (approve/reject) restricted to `has_role('admin') OR has_role('moderator')` |
| `reports` | own submitted reports; `has_role('admin') OR has_role('moderator')` reads all (aligned to the Moderation/Reports Queue surface in `0042`, was "admin" only) | own row `INSERT` (`reporter_id = auth.uid()`, `NOT is_guest()`); no client `UPDATE` at all, resolution goes through `resolve_report` (`0043`, admin/moderator, SECURITY DEFINER) so a client can never hand-set a report's status |
| `feature_flags` | `has_role('admin') OR has_role('moderator')`; **not** publicly readable, flag checks happen server side (RPC/edge function) so a disabled feature's existence is not discoverable client side | `has_role('admin')` only (moderators can read flags but not flip them; ships this way in `0003_moderation_audit.sql`) |
| `audit_log` | `has_role('admin') OR has_role('moderator')` | **no** `authenticated`/`anon` write at all, ever; `service_role` `INSERT` only, and even `service_role`'s grants exclude `UPDATE`/`DELETE` at the table level (PRD-04 FR-54, enforced identically to `ledger_entries`) |
| `support_tickets` | own rows; admin or moderator reads all | own row `INSERT`; `UPDATE` (resolve) restricted to `has_role('admin') OR has_role('moderator')` |

### training groups (0076, 0078, 0081)

SELECT-only for clients on all five tables; every write path is a SECURITY DEFINER RPC or a service-role edge function, and the write verbs are revoked at the grant level too (the ledger_entries precedent).

- `training_groups`: PUBLIC browse (anon + authenticated) of `active` groups owned by verified coaches, the founder-wanted discovery surface; coach reads own rows in any state; a live (non-lapsed) member keeps reading their group; admin reads all. **This is a permissive-OR table exactly like venues: an unscoped select returns every active group in the product. Every app read must carry `.eq('coach_id', me)` or an explicit group id.**
- `group_memberships`: coach reads every membership of their own groups; a player reads only their own rows; admin reads all. No cross-member visibility, so a members list is complete only on coach screens (member counts for discovery come from the definer RPC `get_group_member_counts`, counts only, no identities).
- `session_participants`: the session's coach reads all rows, a player reads their own, admin all.
- `sessions` gained `sessions_select_group_participant` (participant reads the group session rows they are part of; group rows match neither of the old party policies since player_id is null).
- `coach_trainee_notes`: coach-only select/insert/delete of own rows; insert additionally gated by `coach_has_trainee`; the player has NO policy at all in v1 (zero rows, not an error); no UPDATE policy or grant.
- `coach_trainee_videos` (0082, Track F, WRITTEN NOT APPLIED): coach select/insert/delete own, player select own, no update, no anon. Uses the existing `clips` bucket under a `coach-videos/{coach_id}/{player_id}/` prefix, no new bucket or storage.objects policy; see the `clips` row below.
- Group chat: `chat_threads` 'group' rows and their `chat_messages` are readable/writable via `is_chat_thread_member` (per-subscriber SELECT is what Realtime enforces, so a lapsed member's socket goes silent the moment the membership trigger unseats them). `chat_thread_members` is readable by fellow members only and client-writable by nobody. The 0022 coaching-thread INSERT policy is untouched and still refuses `context_type = 'group'`, so group threads exist only via the training_groups trigger.

**The 0081 lesson, now a rule for this domain: a subquery inside a policy runs under the referenced table's own RLS.** The naive 0076 policies cross-referenced training_groups and group_memberships and recursed (42P17, every non-owner read failed), and the public policy's `exists (coach_profiles ...)` was silently false for anon because coach_profiles has no anon SELECT on the base table. All five relationship predicates therefore live in SECURITY DEFINER boolean helpers (`is_verified_coach`, `is_group_member_live`, `is_group_coach`, `is_session_coach`, `is_session_participant`), the session_links_pair shape from 0022. Any future policy on these tables must go through a definer predicate, not an inline subquery.

## Storage

Supabase Storage buckets get their own RLS-style policies on `storage.objects`, keyed by path prefix, following the same ownership pattern:

| Bucket | Path convention | Read | Write |
|---|---|---|---|
| `coach-certificates` | `{coach_id}/...` | owner + admin | owner (insert only) |
| `venue-photos` | `{venue_id}/...` | public (matches verified venue visibility) | owning partner |
| `upa-evidence` | `{application_id}/...` | owner + admin, **never public**, per PRD-05 FR-3 | owner (insert only) |
| `clips` | `{clip_id}/...` | **PRIVATE (`public = false`), NO policy on `storage.objects` at all**: no anon, public, or authenticated direct read. This is the Supabase Storage equivalent of Cloudflare Stream's `requireSignedURLs: true`; no clip object is resolvable by a guessed or scraped path in any status. Playback is a short-lived (TTL 300s) signed URL minted by an edge function against the live clip row (`get_clip_playback_url` / `get_clip_moderation_url`, AT-96) | `stream-upload-url` edge function only, via a service-role-minted signed UPLOAD url (`0042`) |
| `avatars`, `product-media`, `upa-photos`, `gratitude-photos` | `{owner_id}/...` or admin-managed | public | owner or `has_role('admin')` depending on bucket |

`product-media` was listed here from P4 but its bucket and `storage.objects` policies were never actually created (AT-81's admin catalog provisioning did not land), so product images had nowhere to live and `product_media` stayed empty. `0070_product_media_bucket.sql` finally provisions it to match this row: public read (`product_media_public_read`, guest browsable shop) and admin-scoped insert/update/delete (`has_role('admin')`, path `{product_id}/{filename}`).

## What the advisor checks at every gate

Per PLAN.md's verification section, the Supabase RLS advisor runs at every phase gate and must be clean before the biased approver reviews the phase. Clean means: every table in `SCHEMA.md` has RLS enabled, no table has a policy granting `USING (true)` on a write verb, no `SECURITY DEFINER` function is callable by a role broader than it needs (checked by function `GRANT` review alongside the advisor's own output), and the guest/anon read surface table above is the complete list, nothing else leaks to `anon`.

## P8 advisor burn-down disposition (AT-140 / AT-141 / AT-142)

The P8 hardening pass burned down the fixable advisor debt without changing any access set, and signs off the by-design residual here. Live baseline `syzzfgaudpifwvbpycyi`, 2026-07-22. Migrations `0062`, `0063`, `0064`.

| Advisor class | Level | Before | After | Disposition |
|---|---|---|---|---|
| `auth_rls_initplan` | WARN | 100 | 0 | FIXED, `0062` (subselect wrap) |
| `multiple_permissive_policies` | WARN | 43 | 21 | 22 FIXED `0063`; 21 KEEP (public+owner / FOR ALL, cross-role-set merge would risk widening anon) |
| `function_search_path_mutable` | WARN | 14 | 5 | 9 FIXED `0064`; 5 KEEP (supabase_admin-owned range constructors, not app-alterable, inert) |
| `security_definer_view` | ERROR | 3 | 3 | KEEP by design (deliberate column/reservation surface) |
| `authenticated_security_definer_function_executable` | WARN | 55 | 55 | KEEP by design (RPC state-machine gate) |
| `anon_security_definer_function_executable` | WARN | 13 | 13 | KEEP by design (audited anon-callable subset) |
| `auth_allow_anonymous_sign_ins` | WARN | 61 | 61 | KEEP by design (guest mode is a product requirement) |
| `auth_leaked_password_protection` | WARN | 1 | 1 | FOUNDER/config (dashboard toggle) |
| `public_bucket_allows_listing` | WARN | 4 | 4 | FOUNDER/config (public buckets by design; tighten listing if safe) |
| `rls_enabled_no_policy` | INFO | 4 | 4 | KEEP (fail-closed: `stock_reservations`, `webhook_events`, etc.) |

No new ERROR was introduced. The residual accepted count the biased approver signs against: 3 ERROR (all KEEP `security_definer_view`) and the WARN residual above, every item dispositioned below.

### What was fixed

- **`auth_rls_initplan`, 100 WARN -> 0 (`0062`, AT-140).** Every RLS policy that called `auth.uid()` directly re-evaluated it per row. `0062` wraps each call in a scalar subselect `(select auth.uid())` via `ALTER POLICY` (expression-only; roles, command, and permissive/restrictive flags are preserved verbatim, so the access set cannot change). Performance-only, the documented Supabase remediation for lint 0003.
- **`multiple_permissive_policies`, 43 WARN -> 21 (`0063`, AT-141).** Postgres OR-combines permissive policies, so several permissive SELECT policies for the *same role set* are exactly equivalent to one policy whose `USING` is their OR. `0063` merges, per table, only the policies whose role set is exactly `{authenticated}` and whose command is `SELECT` (no `FOR ALL`), on the 22 owner-scoped tables that carry no public/guest SELECT policy: `athlete_sports, coach_certificates, coach_profiles, court_bookings, donations, ledger_entries, order_feedback, order_items, order_timeline, orders, payment_intents, payout_accounts, refunds, reports, sessions, support_tickets, transfers, upa_evidence, user_roles, users, venue_staff, verification_requests`. Each becomes one `<table>_select_merged`. The union of visible rows is unchanged by construction; proven non-vacuously (below).
- **`function_search_path_mutable`, 14 WARN -> 5 (`0064`, AT-140).** `0064` pins `search_path = ''` on the 9 app functions owned by `postgres` (`audit_changed_fields, custom_access_token_hook, is_admin, is_guest, is_moderator, lock_coach_sport_after_submission, lock_notification_fields, set_updated_at, unpaid_hold_ttl`). Each references its objects fully schema-qualified or not at all, so behaviour is unchanged; the JWT hook was re-verified injecting `roles` correctly under the pinned path.

### KEEP by design (not fixed, dispositioned here)

- **`multiple_permissive_policies`, 21 residual WARN — KEEP.** These 21 tables each carry a **public/guest** SELECT policy (role set `{anon, authenticated}`, e.g. `*_select_public` / `*_select_published` / `*_select_verified`) and/or a `FOR ALL` write policy (`*_write_own` / `*_write_admin`) alongside their owner/admin SELECT policies: `categories, clip_comments, clips, coach_availability_windows, court_availability_windows, court_blackouts, court_pricing_rules, courts, drills, gratitude_posts, milestones, product_media, product_variants, product_wishlist_items, products, roadmap_stages, session_types, upa_applications, upa_wishlist_items, venue_photos, venues`. They cannot be collapsed to a single policy without a **cross-role-set merge** that folds an owner disjunct (`owner_id = auth.uid()`) into the anon-reachable expression, or splitting a `FOR ALL` policy. Either move risks widening the guest access set, which is precisely the permissive-OR bug class CLAUDE.md records three incidents for. The performance cost of a second permissive policy is negligible next to that risk, so they are left intact. The app-code contract still stands: every read of these tables carries its own owner filter; RLS is a ceiling, not scoping.
- **`function_search_path_mutable`, 5 residual WARN — KEEP.** `timerange` (2 signatures) and `timemultirange` (3 signatures) are the constructor functions auto-generated by the `timerange` custom range type. They are owned by `supabase_admin` (the app migration role cannot `ALTER` them) and are `internal` C constructors with no SQL body and no search_path-sensitive name resolution, so the finding is inert for them.
- **`security_definer_view`, 3 ERROR — KEEP.** `public_profiles`, `coach_profiles_public`, and `product_variant_availability` are deliberately definer views (`security_invoker = false`). Each exposes a narrow, column-by-column public surface over a base table whose RLS is intentionally owner/admin-only, or reads reservation data no client may read: `product_variant_availability` must read `stock_reservations` (client-invisible) to compute `held_qty`; with `security_invoker` the reservation join would silently return zero and the view would over-sell while reporting raw stock as available. `public_profiles` and `coach_profiles_public` reproduce the base predicate (`status = 'verified'`, published subset) themselves, so bypassing RLS widens nothing. Fixing these would either leak or over-sell. See the commerce and coaching sections above.
- **`authenticated_security_definer_function_executable` (55 WARN) and `anon_security_definer_function_executable` (13 WARN) — KEEP.** This is the deliberate RPC state-machine gate pattern: the client-facing RPCs (`add_to_cart`, `toggle_clip_like`, `session_transition`, `submit_upa_application`, `has_role`/`is_verified_coach` policy helpers, etc.) are `SECURITY DEFINER` on purpose so they can perform a guarded write the calling role has no direct grant for, and each re-checks `auth.uid()` / current state internally. Grants were tightened in `0005`/`0037`/`0047`/`0051` and the anon-callable subset is audited. Being callable over `/rest/v1/rpc` is the point.
- **`auth_allow_anonymous_sign_ins`, 61 WARN — KEEP.** Anonymous (guest) sign-in is a product requirement (PLAN.md guest mode, PRD-01 section 3). The guest surface is deliberately scoped (see "Guest/anon read surface" above); the warning fires once per anon-reachable object and is expected.

### FOUNDER / config (flagged, cannot self-serve in P8)

- **`auth_leaked_password_protection` disabled, 1 WARN** — a dashboard Auth toggle; cheap win, flagged to the founder.
- **`public_bucket_allows_listing`, 4 WARN** — `avatars`, `product-media`, `upa-photos`, `gratitude-photos` are public-read by design (see Storage table). The finding is bucket *listing*, not object read. Objects are namespaced by `{owner_id}/...` so a guessed path is required to fetch, but listing enumerates keys; tightening listing (leaving object read public) is a dashboard bucket setting, flagged to the founder. `upa-evidence` and `clips` are already private and unaffected.

### Isolation proof (non-vacuous, the AT-62 lesson)

Every migration was proven not to change any role's visible-row set, using two real users whose ids were asserted to **differ first**: `A` = `58756043…` (player; owns 5 orders, 35 payment_intents, 11 sessions as player, 6 donations, 4 clips, 2 drill_completions) and `B` = `b290a0c8…` (roleless guest; owns 3 clips), plus `C` = coach `5b262cf1…`, two court partners, and the true `anon` role. For each of `orders, order_items, sessions, payment_intents, ledger_entries, refunds, transfers, donations, upa_applications, drill_completions, xp_events, user_milestones, cart_items, addresses, product_wishlist_items, clips, clip_likes, follows, coach_profiles, venues` a fingerprint (`md5` of the ordered `row::text` of the full visible set) plus row count and cross-owner counts were captured under each user's simulated JWT before any change and after each of `0062`, `0063`, `0064`. **The before-vs-after diff was 0 rows every time** — the visible-row set was byte-identical for all six viewers across all twenty tables. On the strictly-private money tables (`orders`, `payment_intents`, `order_items`, `refunds`, `transfers`, `ledger_entries`) the non-owner `B` and the unrelated coach `C` saw **zero** of `A`'s rows; the only nonzero cross-user counts were the by-design dual-key surfaces (a coach sees the sessions they coach; a UPA sees donations attributed to it), and those too were identical before and after. No non-owner gained visibility. The catastrophic case "user B sees user A's orders" was tested directly and returned 0.
