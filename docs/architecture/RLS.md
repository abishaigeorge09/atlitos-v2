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
- State machine RPCs (`session_transition`, `court_booking_transition`, `rate_session`, `rate_court_booking`) are `SECURITY DEFINER`, owned by a role with table-level write access the calling `authenticated` role does not have directly. This is the actual mechanism: RLS on `sessions`/`court_bookings` grants **zero** direct `UPDATE` to `authenticated`; the only way a status or money column changes is through one of these functions, which re-check caller identity and current state themselves (that is where `INVALID_TRANSITION` and `SLOT_TAKEN` are raised) before performing a write the function's own elevated privilege allows.

This is the schema-level expression of PLAN.md's invariant: "clients never write money rows or state transitions."

## Guest/anon read surface

The guest experience (PRD-01 section 3, FR-1 through FR-5) needs `anon` to read real content with zero writes. The following is the complete set of tables with an `anon`-inclusive `SELECT` policy; anything not listed here is invisible to a guest, no exceptions:

| Table | Guest read scope |
|---|---|
| `coach_profiles`, `session_types`, `coach_availability_windows` | `status = 'verified'` rows only |
| `venues`, `courts`, `court_availability_windows`, `court_pricing_rules` | `venues.status = 'verified'` rows only |
| `products`, `product_media`, `product_variants`, `categories` | `products.active = true` |
| `clips` | `status = 'published'` |
| `clip_comments` | comments on a `published` clip |
| `upa_applications`, `upa_wishlist_items`, `gratitude_posts` | `upa_applications.status = 'verified'` rows only |
| `drills`, `roadmap_stages`, `milestones` | all rows (public reference content, no per-user data) |

Everything else, `users` beyond the caller's own row, `sessions`, `court_bookings`, `orders`, `cart_items`, `donations`, `payment_intents`, `ledger_entries`, `notifications`, `chat_threads`/`chat_messages`, `verification_requests`, `audit_log`, requires `authenticated` at minimum and is further scoped by ownership or role below. Any mutating action a guest attempts against a write-guarded table returns a Postgres/PostgREST permission error, which the client intercepts and renders as `LoginGateSheet` per PRD-01 FR-3, never a raw 403 shown to the user.

## Policy strategy per domain

Each row states the policy in plain terms; the actual SQL is one `create policy` per verb per table in the migration, following this table exactly. "Own row" means the policy's `USING`/`WITH CHECK` compares a `user_id`-shaped column to `auth.uid()`.

### identity/roles

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `users` | own row; any authenticated user may also read the public-facing subset (name, avatar_url, channel_name) of a coach/creator/UPA's row via the view `public_profiles`, never the base table cross-user | own row only, `INSERT` is trigger-only (on `auth.users` insert, `handle_new_user()` also seeds a default `player` `user_roles` row) |
| `user_roles` | own rows; admin reads all | no `authenticated` write at all; every role grant happens through a `SECURITY DEFINER` path (the signup trigger for the initial `player` role, a future verification-approval RPC, venue staff acceptance) so a user can never grant themselves `admin` or `coach` by a direct insert |
| `addresses` | own rows | own rows, `DELETE` blocked by a trigger if referenced by a non-`delivered`/non-`cancelled` order (PRD-07 FR-30); that trigger ships with the commerce domain migration once `orders` exists, not in `0001_identity.sql` |
| `athlete_sports` (new, `0001_identity.sql`) | own rows; admin reads all | own rows, full CRUD |

### coaching

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `coach_profiles` | own row always (any status); admin reads all; the base table has **no** public `SELECT` policy, public discovery of verified coaches reads the view `coach_profiles_public` instead (as shipped in `0001_identity.sql`, a definer-style view filtered to `status = 'verified'` that bypasses the base table's owner/admin-only RLS by design) | own row `INSERT`/`UPDATE`, `WITH CHECK` requires `has_role('coach')`; `status`, `rating`, `rating_count`, `players_coached_count` locked to admin-only by a trigger (sport immutability enforced by a separate trigger once `verification_requests` exists, not by RLS) |
| `coach_certificates`, `session_types`, `coach_availability_windows` | own coach's rows; verified coach's `session_types`/`availability_windows` also public (discovery needs them) | own coach only (`has_role('coach') AND coach_id = auth.uid()`) |
| `sessions` | `has_role('coach') AND coach_id = auth.uid()` OR `player_id = auth.uid()` | **no** direct `authenticated` write; all writes via `book-session` edge function (insert) or `session_transition`/`rate_session` RPCs (status/rating) |

### courts

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `venues`, `courts`, `court_availability_windows`, `court_blackouts`, `court_pricing_rules` | verified public; own venue's rows always | `has_role('court_partner') AND partner_user_id = auth.uid()` (courts/windows/blackouts/pricing scoped through their `venue_id` join); `court_staff` gets none of these |
| `venue_staff` | own venue (partner) or own membership row (staff) | insert (invite) by the owning partner only; `accepted_at` set by the invited staff member accepting, via a narrow RPC, not a direct update |
| `court_bookings` | `has_role('court_partner') AND court_id IN (partner's courts)` OR `has_role('court_staff') AND court_id IN (assigned venue's courts)` OR `user_id = auth.uid()` | **no** direct `authenticated` write; `book-court` edge function inserts, `court_booking_transition`/`rate_court_booking` RPCs handle status/rating. Partner/staff check-in and walk-in also go through RPCs/edge functions scoped by `has_role('court_partner')`/`has_role('court_staff')`, never a raw `UPDATE` grant |

### commerce

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `products`, `product_media`, `product_variants`, `categories` | `active = true` public; admin reads all | `has_role('admin')` only |
| `product_wishlist_items`, `cart_items` | own rows | own rows (`cart_items` writes for add/update go through `add_to_cart`/`update_cart_item` RPCs for the stock re-check, `DELETE` is a direct own-row policy since removal needs no stock check) |
| `orders`, `order_items`, `order_timeline` | own orders (`user_id = auth.uid()`); admin reads all | **no** `authenticated` write on any of the three; `checkout` edge function inserts, `admin-order-advance`/`admin-order-refund` edge functions and RPCs (admin-only) write timeline/status |
| `order_feedback` | own row | own row `INSERT` only, once (`UNIQUE(order_id)` plus a policy requiring the order's `status = 'delivered'`), no `UPDATE`/`DELETE` |

### clutch

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `clips` | `published` public; own clip any status; admin/moderation reads all | own row `INSERT` (`status` forced to `uploading` by column default, not client-settable to anything else); `UPDATE` of `status` is **not** granted to `authenticated`, only edge functions (`stream-webhook`) and admin moderation RPCs move it forward |
| `clip_likes`, `follows` | public (needed for counts) | own row via `toggle_clip_like`/`toggle_follow` RPCs only, no direct `INSERT`/`DELETE` grant (keeps the `likes_count`/follower count trigger authoritative and race-free) |
| `clip_comments` | comments on visible clips | `INSERT` requires `NOT is_guest()`; own row `DELETE`, no `UPDATE` (comments are immutable once posted) |

### empower

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `upa_applications` | `status = 'verified'` public; own row (any status) for the applicant; admin/staff reads all | own row `INSERT` (create application) and `UPDATE` of story fields only while not `verified` without re-review flag, or via the Life portal's authorized edit path; status column never client-writable |
| `upa_evidence` | own application's rows; admin reads all | own application `INSERT` only, no `UPDATE`/`DELETE` after submission |
| `upa_wishlist_items` | verified UPA's items public; own UPA's items always | own UPA `INSERT`/`UPDATE`/`DELETE`, `WITH CHECK` additionally requires `status = 'open' AND funded_amount = 0` for `UPDATE`/`DELETE` (PRD-05 FR-12/FR-13); `funded_amount`/`status` themselves excluded from the `WITH CHECK` allowed column set, written only by the `donate` edge function |
| `donations` | own donations (donor); own UPA's attributed donations (UPA, via `upa_id`); admin reads all | **no** `authenticated` write at all; `donate` edge function only |
| `gratitude_posts` | linked to a `verified` UPA, public; own UPA's posts always | own UPA `INSERT` (only for a `funded`/`delivered` item with no existing post, checked in `WITH CHECK` via a subquery) and soft-delete `UPDATE` (`status='removed'`), no hard `DELETE` |

### learn

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `drills`, `roadmap_stages`, `milestones` | public, all rows | `has_role('admin')` only |
| `drill_completions` | own rows | own row `INSERT` only (the `UNIQUE(user_id, drill_id)` constraint makes a second insert fail, which is the idempotency guard, not application logic); no `UPDATE`/`DELETE` |
| `xp_events` | own rows | **no** `authenticated` write; written by the same transaction as `drill_completions` insert via a trigger, so XP cannot be granted without a real completion row |
| `user_milestones` | own rows | **no** `authenticated` write; a trigger on `xp_events`/`drill_completions` insert evaluates `milestones.criteria` and inserts here, so a milestone cannot be self-awarded |

### chat

| Table | `SELECT` | `INSERT`/`UPDATE`/`DELETE` |
|---|---|---|
| `chat_threads` | `participant_a = auth.uid() OR participant_b = auth.uid()` | `INSERT` only if a qualifying `sessions` row (any status) exists between the two participants (checked in `WITH CHECK` via subquery, enforces PRD-02 FR-30's "no cold outreach"), no `UPDATE`/`DELETE` from clients (`last_message_at` maintained by trigger) |
| `chat_messages` | via parent thread's participant check | `sender_id = auth.uid() AND sender_id IN (thread's two participants)`, no `UPDATE`/`DELETE` (messages are immutable) |

Realtime broadcast on `chat_messages` respects the same `SELECT` policy: Supabase Realtime authorizes each subscriber's channel against RLS, so a thread's messages never reach a socket that is not one of the two participants.

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
| `reports` | own submitted reports; admin reads all | own row `INSERT` (`reporter_id = auth.uid()`, `NOT is_guest()`); `UPDATE` (resolve) restricted to `has_role('admin')` |
| `feature_flags` | `has_role('admin') OR has_role('moderator')`; **not** publicly readable, flag checks happen server side (RPC/edge function) so a disabled feature's existence is not discoverable client side | `has_role('admin')` only (moderators can read flags but not flip them; ships this way in `0003_moderation_audit.sql`) |
| `audit_log` | `has_role('admin') OR has_role('moderator')` | **no** `authenticated`/`anon` write at all, ever; `service_role` `INSERT` only, and even `service_role`'s grants exclude `UPDATE`/`DELETE` at the table level (PRD-04 FR-54, enforced identically to `ledger_entries`) |
| `support_tickets` | own rows; admin or moderator reads all | own row `INSERT`; `UPDATE` (resolve) restricted to `has_role('admin') OR has_role('moderator')` |

## Storage

Supabase Storage buckets get their own RLS-style policies on `storage.objects`, keyed by path prefix, following the same ownership pattern:

| Bucket | Path convention | Read | Write |
|---|---|---|---|
| `coach-certificates` | `{coach_id}/...` | owner + admin | owner (insert only) |
| `venue-photos` | `{venue_id}/...` | public (matches verified venue visibility) | owning partner |
| `upa-evidence` | `{application_id}/...` | owner + admin, **never public**, per PRD-05 FR-3 | owner (insert only) |
| `clutch-video` | `{clip_id}/...` | governed by Cloudflare Stream signed URLs, not this bucket directly; see `VIDEO.md` | `stream-upload-url` edge function only |
| `avatars`, `product-media`, `upa-photos`, `gratitude-photos` | `{owner_id}/...` or admin-managed | public | owner or `has_role('admin')` depending on bucket |

## What the advisor checks at every gate

Per PLAN.md's verification section, the Supabase RLS advisor runs at every phase gate and must be clean before the biased approver reviews the phase. Clean means: every table in `SCHEMA.md` has RLS enabled, no table has a policy granting `USING (true)` on a write verb, no `SECURITY DEFINER` function is callable by a role broader than it needs (checked by function `GRANT` review alongside the advisor's own output), and the guest/anon read surface table above is the complete list, nothing else leaks to `anon`.
