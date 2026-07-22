# ATLITOS v2 Database Schema

Source of truth for every table in the Supabase Postgres schema. One domain per migration file under `supabase/migrations/`, in the order listed here (later domains reference earlier ones by foreign key). Column names are final; RLS policies live in `RLS.md`, edge function and RPC names are cross-referenced from `API-MAPPING.md` and `PAYMENTS.md`.

## Conventions

- Primary keys: `id uuid primary key default gen_random_uuid()` unless the table's identity is a foreign key to `auth.users` (then `id uuid primary key references auth.users(id)`).
- Every table has `created_at timestamptz not null default now()`; tables with a mutable lifecycle also have `updated_at timestamptz not null default now()` maintained by a shared `set_updated_at()` trigger.
- Money columns are `numeric(12,2)`, always representing whole rupees with paise as the decimal part (never a float). Razorpay's API takes paise (integer, amount x 100); the conversion happens only at the edge function boundary when calling Razorpay, never in the database.
- All enums are Postgres `create type ... as enum (...)`, named `<thing>_status` or `<thing>_type`. Application code consumes these through `packages/types`, never hardcodes the string list a second time.
- Foreign keys to `auth.users(id)` are written as `user_id uuid not null references auth.users(id)` and are what RLS `auth.uid()` checks bind to.
- Every table that a client can read gets at least one index supporting its RLS predicate (usually the owner column) plus its natural query pattern. Indexes are listed per table; assume `id` (primary key) is always indexed and is not repeated below.
- No table is ever hand-edited by a client for money or state-machine columns; those move only through the RPCs and edge functions named in `API-MAPPING.md`.

## Enums (state machines and fixed vocabularies)

| Enum | Values | Notes |
|---|---|---|
| `app_role` | `player`, `coach`, `court_partner`, `court_staff`, `upa`, `admin`, `moderator` | `guest` is never persisted, it is the absence of a session (or a Supabase anonymous auth session with zero `user_roles` rows); `moderator` added in `0001_identity.sql` for moderation/audit RLS (audit log, feature flags, verification review, support tickets), distinct from `admin` |
| `sport` | `football`, `cricket`, `badminton`, `tennis` | extend by adding a value, never a second enum |
| `session_status` | `requested`, `accepted`, `declined`, `completed`, `cancelled`, `rescheduled`, `rated` | machine: `requested` to (`accepted` or `declined` or `cancelled`); `accepted` to (`completed` or `cancelled` or `rescheduled`); `completed` to `rated`. The `requested` to `cancelled` edge (added 2026-07-19, `0026`) is athlete only and auto-refunds; a coach disposing of an unanswered request uses `declined`, which stays distinct |
| `refund_status` | `pending`, `processed`, `failed` | `refunds.status`. Added 2026-07-19 (`0026`) |
| `session_frequency` | `one_time`, `weekly`, `monthly` | |
| `coach_status` | `pending_review`, `verified`, `rejected` | mirrors the linked `verification_requests` row, updated only by the approval RPC |
| `venue_status` | `pending`, `verified`, `rejected` | same pattern as `coach_status` |
| `court_booking_status` | `confirmed`, `completed`, `cancelled`, `rescheduled`, `no_show` | machine: `confirmed` to (`completed` or `cancelled` or `rescheduled` or `no_show`); `completed` to `rated` is tracked by a non-null `rating` column, not a further status value, matching the athlete-only-rates-once rule |
| `order_status` | `placed`, `shipped`, `in_transit`, `delivered`, `cancelled` | machine: strictly forward through `placed` to `shipped` to `in_transit` to `delivered`; `cancelled` reachable only from `placed` |
| `clip_status` | `uploading`, `processing`, `ready`, `published`, `rejected`, `removed` | machine (RPC enforced by `clip_transition_internal`, `0043`): `uploading` to (`processing` or `rejected`); `processing` to (`ready` or `rejected`); `ready` to (`published` or `rejected`); `published` to `removed` (moderation takedown only); `rejected`/`removed` terminal. The `uploading` to `rejected` edge is the abandoned-upload / reconcile-absent-object case (AT-93, `0045`); in v1 there is no Cloudflare transcode, so `processing` to `rejected` is driven by the reconcile arm, not a Stream error |
| `report_status` | `pending`, `actioned`, `dismissed` | `pending` until a moderator resolves via `resolve_report` (`0043`): takedown moves it to `actioned`, dismissal to `dismissed` |
| `upa_status` | `submitted`, `under_review`, `needs_info`, `verified`, `rejected`, `deactivated` | machine (owned by `upa_application_transition_internal`, `0050`, raises `INVALID_TRANSITION`): `submitted` to (`under_review` or `needs_info` or `verified` or `rejected`); `under_review` to (`needs_info` or `verified` or `rejected`); `needs_info` back to `under_review` on resubmit; `verified` to `deactivated` (owner self-withdraw); `rejected` and `deactivated` terminal; reapply creates a NEW row (see `upa_applications`). `deactivated` is an addition beyond the original five (`0048`), driven by AT-110's deactivate RPC; the public browse policy filters `status = 'verified'` so a deactivated UPA disappears from the consumer app without a delete |
| `upa_wishlist_item_status` | `open`, `funded`, `delivered` | machine: `open` to `funded` (server, on funding target reached) to `delivered` (server, on fulfillment) |
| `donation_method` | `standalone`, `checkout_roundup` | |
| `payment_intent_status` | `created`, `authorized`, `captured`, `failed`, `refunded`, `partially_refunded` | mirrors Razorpay order/payment lifecycle, see `PAYMENTS.md` |
| `payment_domain` | `session`, `court`, `commerce`, `donation` | the `domain` half of every Razorpay order's `notes: {domain, entity_id}` |
| `payout_account_status` | `not_started`, `pending`, `active`, `needs_attention`, `failed` | Razorpay Route linked account status |
| `transfer_status` | `processing`, `paid`, `failed` | Razorpay Route transfer status |
| `verification_status` | `pending_review`, `approved`, `rejected` | generic status for `verification_requests`, distinct from the entity-specific status it drives |
| `applicant_type` | `coach`, `venue`, `upa` | which entity a `verification_requests` row is about |
| `report_status` | `pending`, `dismissed`, `removed` | |
| `ticket_status` | `open`, `resolved` | |
| `drill_difficulty` | `beginner`, `intermediate`, `advanced` | |
| `xp_source` | `drill_complete`, `milestone`, `other` | |
| `booking_source` | `self_service`, `walk_in` | court bookings only |
| `ledger_account_type` | `platform`, `coach`, `court_partner`, `upa_fund`, `user` | double-entry account family, see `ledger_entries` below |
| `ledger_direction` | `debit`, `credit` | |
| `fee_value_type` | `percentage`, `flat` | |
| `notification_type` | `booking`, `order`, `chat`, `clip_moderation`, `donation`, `verification`, `transfer`, `support` | |
| `user_status` | `active`, `suspended` | |

---

## Domain: identity/roles

### `users`
Extends `auth.users` with app profile fields. One row per Supabase Auth user, created by a trigger on `auth.users` insert.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, references `auth.users(id)` |
| `name` | `text` | not null |
| `phone` | `text` | unique, nullable (email-only signup allowed) |
| `dob` | `date` | nullable |
| `avatar_url` | `text` | nullable |
| `channel_name` | `text` | nullable, Clutch creator display name |
| `city` | `text` | nullable |
| `state` | `text` | nullable |
| `sports` | `sport[]` | not null default `{}` |
| `status` | `user_status` | not null default `active` |
| `suspended_reason` | `text` | nullable |
| `show_donor_name` | `boolean` | not null default `false`, sponsor name opt-in read by `portal-life` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_users_phone` on `phone`.

### `user_roles`
Multi-role membership. A user can hold several roles at once (for example `player` and `coach`).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `role` | `app_role` | not null |
| `created_at` | `timestamptz` | |

Constraints: `UNIQUE(user_id, role)`.
Indexes: `idx_user_roles_user_id` on `user_id`.

### `addresses`
Shopper shipping addresses (commerce domain, kept here as it is an identity-adjacent concern shared by checkout).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `line1`, `line2` | `text` | `line1` not null |
| `city`, `state` | `text` | not null |
| `pincode` | `text` | not null, `CHECK (pincode ~ '^[0-9]{6}$')` |
| `is_default` | `boolean` | not null default `false` |
| `created_at` | `timestamptz` | |

Indexes: `idx_addresses_user_id` on `user_id`.

### `athlete_sports`
Added in `0001_identity.sql`, not originally in this doc. Normalizes an athlete's per-sport detail (skill level, which sport is primary) alongside the denormalized `users.sports sport[]` cache column, which remains the fast-path summary array; reconciling the two is an application-layer concern, not enforced by a trigger in Phase 1.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `sport` | `sport` | not null |
| `skill_level` | `text` | nullable |
| `is_primary` | `boolean` | not null default `false` |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `UNIQUE(user_id, sport)`.
Indexes: `idx_athlete_sports_user_id` on `user_id`.

**JWT custom claims**: see `RLS.md` for the `custom_access_token_hook` that reads `user_roles` at token mint time and injects `app_metadata.roles: string[]` into the JWT, which `has_role()` reads without a query on every RLS check.

---

## Domain: coaching

### `coach_profiles`

| Column | Type | Constraints |
|---|---|---|
| `user_id` | `uuid` | PK, references `users(id)` |
| `sport` | `sport` | not null, immutable after first `verification_requests` submission (enforced by trigger, not just app logic) |
| `experience_years` | `int` | not null |
| `coaching_style` | `text` | nullable |
| `specialization` | `text[]` | not null default `{}` |
| `bio` | `text` | nullable |
| `city`, `state` | `text` | not null |
| `status` | `coach_status` | not null default `pending_review` |
| `rating` | `numeric(3,2)` | not null default `0` |
| `rating_count` | `int` | not null default `0` |
| `players_coached_count` | `int` | not null default `0` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_coach_profiles_status_sport` on `(status, sport)` (discovery query), `idx_coach_profiles_city` on `city`.

### `coach_certificates`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `coach_id` | `uuid` | not null, references `coach_profiles(user_id)` |
| `name` | `text` | not null |
| `storage_path` | `text` | not null, Supabase Storage object path |
| `verified` | `boolean` | not null default `false` |
| `created_at` | `timestamptz` | |

Indexes: `idx_coach_certificates_coach_id` on `coach_id`.

### `session_types`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `coach_id` | `uuid` | not null, references `coach_profiles(user_id)` |
| `name` | `text` | not null, e.g. "one on one", "group", "online" |
| `duration_minutes` | `int` | not null, `CHECK (duration_minutes > 0)` |
| `price` | `numeric(12,2)` | not null, `CHECK (price > 0)` |
| `active` | `boolean` | not null default `true` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_session_types_coach_id` on `coach_id`.

### `coach_availability_windows`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `coach_id` | `uuid` | not null, references `coach_profiles(user_id)` |
| `day_of_week` | `smallint` | not null, `CHECK (day_of_week BETWEEN 0 AND 6)` |
| `start_time`, `end_time` | `time` | not null, `CHECK (end_time > start_time)` |
| `effective_from` | `date` | not null default current_date |
| `created_at` | `timestamptz` | |

Constraints: no two windows for the same `coach_id` and `day_of_week` may overlap, enforced with a `btree_gist` `EXCLUDE` constraint on `(coach_id WITH =, day_of_week WITH =, public.timerange(start_time, end_time, '[)') WITH &&)` (`0018_coaching.sql`). This doc previously said `tsrange`; that does not type-check over `time` columns, and `public.timerange` is the custom range type `0009_courts.sql` already defined for exactly this reason. `effective_from` is deliberately not part of the exclusion key, so editing availability (PRD-02 FR-23) is an `UPDATE` in place, not a second superseding row.
Indexes: `idx_coach_availability_coach_id` on `coach_id`.

### `is_verified_coach(uuid)` (`0030_verified_coach_discovery_rls.sql`, AT-63)

`is_verified_coach(_coach_id uuid) returns boolean`, `security definer`, `stable`, `search_path = public`, granted to `anon` and `authenticated`. Returns whether that user has a `coach_profiles` row with `status = 'verified'`.

It exists because the public discovery policies on `session_types` and `coach_availability_windows` need to ask that question, and a subquery inside an RLS policy is evaluated under the **caller's** privileges: `0019_coaching_rls.sql` wrote the check as an inline `EXISTS` over `coach_profiles`, which is itself RLS-protected with no policy for `anon` or for a non-owner `authenticated` user, so the check was false for every athlete and both policies denied every row. See RLS.md's "Discovery policies must not subquery a table the caller cannot read" for the full account.

This is the same pattern as `session_exists_between` and `session_links_pair`: a definer boolean that lets a policy ask about a table the caller has no read on, without granting that read. `coach_profiles` itself deliberately gains no public `SELECT` policy; its public column surface remains the `coach_profiles_public` view.

### `sessions`
The booking record and the state machine PLAN.md calls out for RPC enforcement.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `coach_id` | `uuid` | not null, references `coach_profiles(user_id)` |
| `player_id` | `uuid` | not null, references `users(id)` |
| `session_type_id` | `uuid` | not null, references `session_types(id)` |
| `frequency` | `session_frequency` | not null |
| `date` | `date` | not null |
| `slot_start`, `slot_end` | `time` | not null |
| `focus_area` | `text` | nullable |
| `location` | `text` | nullable |
| `status` | `session_status` | not null default `requested` |
| `price` | `numeric(12,2)` | not null, locked at booking time, never recomputed on `session_types` price change |
| `platform_fee` | `numeric(12,2)` | not null |
| `total` | `numeric(12,2)` | not null |
| `payment_intent_id` | `uuid` | nullable, references `payment_intents(id)` |
| `rating` | `smallint` | nullable, `CHECK (rating BETWEEN 1 AND 5)` |
| `remarks` | `text` | nullable |
| `decline_reason`, `cancellation_reason` | `text` | nullable |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `UNIQUE (coach_id, date, slot_start) WHERE status NOT IN ('declined', 'cancelled')` — the same concurrency guard PLAN.md specifies for courts, applied to coaching per PRD-02 FR-24; a partial index so a declined or cancelled session frees the slot for a new request. Shipped as `sessions_coach_date_slot_unique` in `0018_coaching.sql`.

Unlike `court_bookings` after `0011_courts_payment_state.sql`, `session_status` has no `pending_payment`/`expired` pair: a session's first persisted state is `requested` (PRD-01 FR-24), so `book-session` inserts the row already holding its slot through the partial index above.

**Money columns, as built by AT-40.** The platform fee is carved OUT of the coach's list price, it is not added on top of it, so `total` (what the athlete is charged) equals `price`, and `platform_fee` is the platform's cut of that same amount. This follows the worked ledger example below ("a session priced at 1000 with a 100 platform fee" debits `platform` 1000 and credits `coach` 900), and PRD-01 FR-31 asks for a separate platform fee row in the `BillSummary` only for courts, never for sessions. Courts are the other convention: there `total = subtotal + gst + platform_fee`, the fee is genuinely additive, and the athlete sees all three rows. The two domains differ deliberately; do not "fix" one to match the other.

Because a session has no `pending_payment` state, a `requested` session whose Razorpay order could never be created would squat its slot forever. `session_abandon_unpaid(p_session_id uuid)` (`0024_session_abandon_unpaid.sql`, `security definer`, granted to `service_role` only) is the release valve `book-court` gets from `court_booking_expire_payment`: it moves `requested` to `cancelled` with a fixed reason, refuses if any `captured` payment_intent exists for that session, and frees the slot because `cancelled` is excluded from the partial unique index.
Indexes: `idx_sessions_coach_id_status` on `(coach_id, status)`, `idx_sessions_player_id` on `player_id`.

---

## Domain: courts

### `venues`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `partner_user_id` | `uuid` | not null, references `users(id)` |
| `name` | `text` | not null |
| `address` | `text` | not null |
| `city` | `text` | not null |
| `pincode` | `text` | not null |
| `lat`, `lng` | `double precision` | nullable |
| `description` | `text` | nullable |
| `status` | `venue_status` | not null default `pending` |
| `rejection_reason` | `text` | nullable |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_venues_partner_user_id` on `partner_user_id`, `idx_venues_status_city` on `(status, city)`.

### `venue_photos`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `venue_id` | `uuid` | not null, references `venues(id)` |
| `storage_path` | `text` | not null |
| `position` | `smallint` | not null default `0` |
| `created_at` | `timestamptz` | |

Constraints: `CHECK`, enforced at application level, of 3 to 12 photos per venue at submission time (a count check does not belong in a row-level constraint).
Indexes: `idx_venue_photos_venue_id` on `venue_id`.

### `venue_staff`
Staff invited by a partner, scoped to Today-only access (PRD-03 FR-28).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `venue_id` | `uuid` | not null, references `venues(id)` |
| `user_id` | `uuid` | not null, references `users(id)` |
| `invited_at`, `accepted_at` | `timestamptz` | `accepted_at` nullable until accepted |

Constraints: `UNIQUE(venue_id, user_id)`. Granting `venue_staff` membership also grants the `court_staff` `user_roles` row via trigger.

### `courts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `venue_id` | `uuid` | not null, references `venues(id)` |
| `sport` | `sport` | not null |
| `name` | `text` | not null |
| `capacity` | `int` | nullable |
| `base_price_per_hour` | `numeric(12,2)` | not null |
| `active` | `boolean` | not null default `true` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_courts_venue_id` on `venue_id`, `idx_courts_sport_active` on `(sport, active)`.

### `court_availability_windows`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `court_id` | `uuid` | not null, references `courts(id)` |
| `day_of_week` | `smallint` | not null, `CHECK (day_of_week BETWEEN 0 AND 6)` |
| `open_time`, `close_time` | `time` | not null |
| `slot_duration_minutes` | `int` | not null default `60` |
| `created_at` | `timestamptz` | |

Indexes: `idx_court_availability_court_id` on `court_id`.

### `court_blackouts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `court_id` | `uuid` | not null, references `courts(id)` |
| `start_date`, `end_date` | `date` | not null, `CHECK (end_date >= start_date)` |
| `reason` | `text` | not null |
| `created_at` | `timestamptz` | |

Indexes: `idx_court_blackouts_court_id` on `court_id`.

### `court_pricing_rules`
Peak overrides only; the base rate lives on `courts.base_price_per_hour`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `court_id` | `uuid` | not null, references `courts(id)` |
| `day_of_week_start`, `day_of_week_end` | `smallint` | not null |
| `time_start`, `time_end` | `time` | not null |
| `multiplier` | `numeric(4,2)` | nullable |
| `fixed_price` | `numeric(12,2)` | nullable |
| `active` | `boolean` | not null default `true` |
| `created_at` | `timestamptz` | |

Constraints: `CHECK (multiplier IS NOT NULL OR fixed_price IS NOT NULL)`; overlapping active rules on the same court and overlapping window rejected at write time by a `btree_gist EXCLUDE` constraint (same pattern as coach availability).
Indexes: `idx_court_pricing_rules_court_id` on `court_id`.

### `court_bookings`
No separate materialized `slots` table. Bookable slots are computed at read time from `court_availability_windows` minus `court_blackouts` minus existing non-cancelled `court_bookings`; the only persisted concurrency guard is the unique index below, which is the actual mechanism PLAN.md's "`UNIQUE(court_id, date, slot_start)`" note refers to.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `court_id` | `uuid` | not null, references `courts(id)` |
| `user_id` | `uuid` | nullable, references `users(id)` (null for a walk-in with no app account) |
| `booking_source` | `booking_source` | not null default `self_service` |
| `walk_in_name`, `walk_in_phone` | `text` | nullable, set only when `booking_source = 'walk_in'` and `user_id` is null |
| `created_by_staff_id` | `uuid` | nullable, references `users(id)`, the partner/staff user who recorded a walk-in |
| `date` | `date` | not null |
| `slot_start`, `slot_end` | `time` | not null |
| `subtotal` | `numeric(12,2)` | not null |
| `gst` | `numeric(12,2)` | not null |
| `platform_fee` | `numeric(12,2)` | not null |
| `total` | `numeric(12,2)` | not null |
| `status` | `court_booking_status` | not null default `confirmed` |
| `checked_in_at` | `timestamptz` | nullable |
| `cancellation_reason` | `text` | nullable |
| `rating` | `smallint` | nullable, `CHECK (rating BETWEEN 1 AND 5)` |
| `remarks` | `text` | nullable |
| `payment_intent_id` | `uuid` | nullable, references `payment_intents(id)`, null for walk-ins recorded as cash/offline in v1 test mode |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `UNIQUE (court_id, date, slot_start) WHERE status NOT IN ('cancelled')` — the exact guard named in PLAN.md; a cancelled booking frees the row for a new booking on the same slot, everything else (including `no_show`) keeps the slot permanently held since its time has already passed.
Indexes: `idx_court_bookings_court_date` on `(court_id, date)`, `idx_court_bookings_user_id` on `user_id`, `idx_court_bookings_venue_date` via a join view (partner Today dashboard reads by venue, joins through `courts`).

Rating is embedded on the booking row itself (matches the v1 `CourtBooking.rating` shape and PRD-03's "ratings" surface); there is no separate `court_ratings` table.

`get_court_rating_summary(p_court_id)` (`0015_court_rating_summary.sql`, `security definer`, granted to `anon`/`authenticated`) returns the aggregate `(rating, rating_count)` for one court. This exists because `court_bookings`' own RLS (`court_bookings_select`, above) correctly restricts row-level reads to the booking's own athlete or the venue's partner/staff, which means a browsing athlete/guest cannot aggregate other athletes' rating values directly to render the courts list/detail star rating; this function is the aggregate-only read path, mirroring `get_court_busy_slots`' "expose the aggregate/shape, never the underlying booking rows" pattern.

---

## Domain: commerce

### `categories`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `text` | not null |
| `slug` | `text` | not null, unique |

### `products`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `title` | `text` | not null |
| `description` | `text` | nullable |
| `category_id` | `uuid` | nullable, references `categories(id)` |
| `sport` | `sport` | nullable |
| `base_price` | `numeric(12,2)` | not null |
| `active` | `boolean` | not null default `true` |
| `recommended_rank` | `numeric` | nullable, heuristic v1 recommendation score, LLM-ready per PLAN.md `ai-search` note |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_products_category_active` on `(category_id, active)`, `idx_products_sport` on `sport`, GIN trigram index `idx_products_title_trgm` on `title` for search.

### `product_media`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `product_id` | `uuid` | not null, references `products(id)` |
| `storage_path` | `text` | not null |
| `position` | `smallint` | not null default `0` |
| `is_primary` | `boolean` | not null default `false` |

Constraints: at most one `is_primary = true` row per `product_id`, enforced by a partial unique index `UNIQUE (product_id) WHERE is_primary`.
Indexes: `idx_product_media_product_id` on `product_id`.

### `product_variants`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `product_id` | `uuid` | not null, references `products(id)` |
| `size`, `color` | `text` | nullable |
| `sku` | `text` | not null, unique |
| `price_override` | `numeric(12,2)` | nullable |
| `stock` | `int` | not null default `0`, `CHECK (stock >= 0)` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_product_variants_product_id` on `product_id`.

### `product_wishlist_items`
Shopper gear wishlist. Distinct from `upa_wishlist_items` (empower domain) which is an UPA's funding wishlist; the two are unrelated tables despite the similar name.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `product_id` | `uuid` | not null, references `products(id)` |
| `created_at` | `timestamptz` | |

Constraints: `UNIQUE(user_id, product_id)`.
Indexes: `idx_product_wishlist_user_id` on `user_id`.

### `cart_items`
Persisted cart, not a draft order (PRD-07 leaves the choice open; a dedicated table is simpler to RLS-scope and does not need order-lifecycle columns).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `product_variant_id` | `uuid` | not null, references `product_variants(id)` |
| `qty` | `int` | not null, `CHECK (qty > 0)` |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `UNIQUE(user_id, product_variant_id)`.
Indexes: `idx_cart_items_user_id` on `user_id`.

### `orders`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `order_number` | `text` | not null, unique, generated as `'#ATL' || lpad(nextval('order_number_seq')::text, 5, '0')` |
| `user_id` | `uuid` | not null, references `users(id)` |
| `address_id` | `uuid` | nullable since `0038`, references `addresses(id)` `ON DELETE SET NULL` |
| `ship_to_line1` | `text` | not null (`0038`) |
| `ship_to_line2` | `text` | nullable (`0038`) |
| `ship_to_city` | `text` | not null (`0038`) |
| `ship_to_state` | `text` | not null (`0038`) |
| `ship_to_pincode` | `text` | not null, `CHECK (~ '^[0-9]{6}$')` (`0038`) |
| `subtotal`, `delivery_charges`, `gst_and_others`, `donation_roundup`, `total` | `numeric(12,2)` | not null |
| `status` | `order_status` | not null default `placed` |
| `payment_intent_id` | `uuid` | nullable, references `payment_intents(id)` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_orders_user_id` on `user_id`, `idx_orders_status` on `status`.

**The `ship_to_*` columns are the delivery address, not the `address_id` join.** `0038_order_placement_and_expiry_sweep.sql` (AT-72) added them because a live foreign key made the shipping address the one part of an order that a later edit could silently rewrite, which is the same bug class D4 already forbids for prices. They are written once by `place_order_from_draft` and never updated. Order Detail renders these; `address_id` survives only as "which saved address was picked", for a Reorder affordance and for support, and nothing may render from it.

Verified 2026-07-20: with orders `#ATL00006` and `#ATL00007` placed, the saved address was edited to a different street, city and pincode; both orders continued to report the address they actually shipped to while the address book reported the new one.

Consequence for `0036`'s delete guard, updated in the same migration: `ADDRESS_ON_PAST_ORDER` is no longer raised. Deleting an address a `delivered` or `cancelled` order used now succeeds and nulls the FK, because the order keeps its own snapshot and loses nothing. `ADDRESS_IN_USE` is unchanged for orders still on the way (PRD-07 FR-30, AC-F3).

### `order_items`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `order_id` | `uuid` | not null, references `orders(id)` |
| `product_variant_id` | `uuid` | not null, references `product_variants(id)` |
| `product_title_snapshot`, `variant_label_snapshot` | `text` | not null, frozen at order time so later product edits do not rewrite history |
| `qty` | `int` | not null |
| `unit_price` | `numeric(12,2)` | not null |
| `created_at` | `timestamptz` | |

Indexes: `idx_order_items_order_id` on `order_id`.

### `order_timeline`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `order_id` | `uuid` | not null, references `orders(id)` |
| `status` | `order_status` | not null |
| `note`, `location` | `text` | nullable |
| `actor_id` | `uuid` | nullable, references `users(id)`, the admin who advanced it |
| `created_at` | `timestamptz` | |

Indexes: `idx_order_timeline_order_id` on `order_id`.

### `order_feedback`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `order_id` | `uuid` | not null, unique, references `orders(id)` |
| `rating` | `smallint` | not null, `CHECK (rating BETWEEN 1 AND 5)` |
| `remarks` | `text` | nullable |
| `created_at` | `timestamptz` | |

### `stock_reservations`

Added by `0033_stock_reservations.sql` (AT-67), implementing `PHASE-4-STATUS.md` decision D2. Not in this doc's original commerce set, because the oversell hazard it closes only became concrete when commerce was planned.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `payment_intent_id` | `uuid` | not null, references `payment_intents(id)` on delete cascade |
| `product_variant_id` | `uuid` | not null, references `product_variants(id)` |
| `qty` | `int` | not null, `CHECK (qty > 0)` |
| `status` | `stock_reservation_status` | not null default `held` |
| `expires_at` | `timestamptz` | not null, set to `now() + stock_reservation_ttl()` (15 minutes) |
| `release_reason` | `text` | nullable, why the hold ended without a sale |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `UNIQUE(payment_intent_id, product_variant_id)`.
Indexes: partial `idx_stock_reservations_held_by_variant` on `(product_variant_id, expires_at) WHERE status = 'held'` (the hot path is summing live holds per variant), `idx_stock_reservations_payment_intent` on `payment_intent_id`.

**Why a table and not a `reserved` counter column on `product_variants`.** A counter cannot expire. Releasing one correctly requires knowing which in-flight intent owns how much, which is a table with a TTL wearing a disguise. The table also makes the abandonment sweep trivially correct and gives the phase approver something to count.

**`product_variants.stock` is RAW inventory and stays that way.** It is the number of units Atlitos physically has, and it is decremented exactly once, at capture, inside `consume_reservation`. It is deliberately not touched while a checkout is in flight, so every admin stock readout (PRD-04 FR-13, FR-17) stays truthful under traffic.

Written only by three `security definer` RPCs, all granted to `service_role` **only** (`0033`):

| RPC | Exit | What it does |
|---|---|---|
| `reserve_stock_for_checkout(p_payment_intent_id, p_lines jsonb)` | (entry) | Locks every `product_variants` row in the order `FOR UPDATE` in ascending id order so a lock-order deadlock is impossible, re-derives available per line through the shared view, raises `OUT_OF_STOCK` naming every offending line, inserts the `held` rows. All lines or none. Called by `checkout` before Razorpay. |
| `consume_reservation(p_payment_intent_id)` | paid | Applies the guarded `UPDATE product_variants SET stock = stock - qty WHERE stock >= qty` and flips `held` to `consumed`, in the SAME transaction as the `orders`/`order_items` inserts (PRD-07 FR-21). Idempotent on redelivery. Accepts already-`released` rows so a late capture can re-attempt the decrement per D2. |
| `release_reservation(p_payment_intent_id, p_reason)` | failed | Flips `held` to `released` and touches `product_variants` not at all, because nothing was decremented. Idempotent. |
| `release_expired_stock_reservations()` | abandoned | Set-based sweep of every `held` row past its TTL. This is the seam AT-26's unified `pg_cron` job calls; it is not scheduled by `0033`. |

**The guarded decrement is safe under concurrency, and this was proven rather than assumed.** Under READ COMMITTED, a second transaction whose `UPDATE` meets a row the first has locked blocks, then re-fetches the committed row and re-evaluates the `WHERE` against the new version (EvalPlanQual). With stock 1 and two captures each wanting 1, the winner writes 0 and the loser's re-evaluated `stock >= qty` is false, so its row is not updated, the row count check fails, and it raises `OUT_OF_STOCK` with its whole transaction rolled back (no order row, and the caller issues an automatic refund via AT-60's machinery). A two-connection probe against the live project confirmed exactly this: final stock 0, never -1, `CHECK (stock >= 0)` never fired. See PHASE-4-STATUS.md.

### `product_variant_availability` (view)

**The one definition of available stock in the system.** Added by `0033`.

```
available_stock = product_variants.stock
                - sum(stock_reservations.qty) where status = 'held' and expires_at > now()
```

Columns: `product_variant_id`, `product_id`, `sku`, `size`, `color`, `effective_price` (`coalesce(price_override, base_price)`), `stock` (raw), `held_qty`, `available_stock`.

Every shopper-facing stock read (PDP, cart, checkout) and every reservation RPC reads **through this view**, and `variant_available_stock(uuid)` is its scalar form, itself a select from the view. Nothing re-derives the subtraction. This is deliberate: if the PDP and the checkout each carried their own copy, they would drift, and the shopper-visible symptom would be a checkout failing on a line the product page called in stock. If you need available stock somewhere new, read the view.

The view joins `products` on `active` and so contains no rows for a deactivated product's variants, which every consumer reads as zero available. It is intentionally `security definer`; the reasoning, and why `security_invoker = true` would silently oversell, is in `RLS.md`.

---

## The commerce bill is a third pricing shape (PHASE-4-STATUS.md D1)

Recorded here because it is why `orders` has the money columns it has.

| Domain | Shape | Platform fee row |
|---|---|---|
| courts | additive: subtotal + GST + platform fee | yes, shown |
| sessions | carve-out: the fee comes out of the coach's price | no row at all |
| **commerce** | **additive: subtotal + delivery + GST + optional donation roundup** | **none, and no fee is taken** |

There is no platform fee on a commerce bill because **Atlitos is the seller of record for v1 gear**. There is no counterparty to split with, so a platform fee would be a fee the platform charges itself. That is why `orders` carries five money columns and no `platform_fee`, unlike `sessions` and `court_bookings`.

`orders` enforces `CHECK (total = subtotal + delivery_charges + gst_and_others + donation_roundup)`, so a bad edge-function computation is a write failure rather than a wrong number a shopper is charged. The three configurable rows derive from `fee_config` keys `commerce.delivery_flat`, `commerce.gst_percent` and `commerce.donation_roundup_multiple`, all seeded by `0038` (50.00 flat, 0.18, 10.00).

**`donation_roundup` is DERIVED, not a flat config figure**, per the founder decision of 2026-07-20 recorded in PHASE-4-STATUS.md. It replaces the planned `commerce.donation_roundup_flat`. The `checkout` edge function computes `ceil(preRoundupTotal / m) * m - preRoundupTotal` where `m` is `commerce.donation_roundup_multiple`, on the total AFTER delivery and GST, in integer paise so the rounding cannot drift. Two consequences that are easy to get wrong:

- Delivery is added BEFORE the roundup is derived. Rounding first and then adding delivery produces a total that is not a multiple of anything.
- **The roundup is ZERO whenever the total already lands on a multiple**, and in that case NO donation ledger leg is written at all. A `0.00` leg would balance while recording a donation that did not happen, and every later query looking for roundup rupees would have to filter it back out. Verified 2026-07-20: order `#ATL00006` (1000 + 50 + 180 = 1230, already a multiple of 10) has a two leg group with zero donation legs and imbalance `0.00`; order `#ATL00007` (999 + 50 + 179.82 = 1228.82, roundup 1.18, total 1230.00) has the three leg group with one donation leg, also imbalance `0.00`.

**Closed in `0038` (AT-72): `orders.address_id` had no snapshot.** Track A flagged it and could not take it; Track B did, because Track B owns the order insert. See the `ship_to_*` note under the `orders` table above for the columns and the proof. The gap was the same bug class D4 already forbids for prices, so leaving it open would have meant `order_items` freezing the price while the address it shipped to stayed editable.

### `order_drafts`

Added by `0038` (AT-72). The server priced bill, parked between `checkout` and capture.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `payment_intent_id` | `uuid` | not null, unique, references `payment_intents(id)` `ON DELETE CASCADE` |
| `user_id` | `uuid` | not null, references `users(id)` |
| `address_id` | `uuid` | nullable, references `addresses(id)` `ON DELETE SET NULL` |
| `ship_to_line1`, `ship_to_line2`, `ship_to_city`, `ship_to_state`, `ship_to_pincode` | `text` | the address snapshot, copied onto the order |
| `subtotal`, `delivery_charges`, `gst_and_others`, `donation_roundup`, `total` | `numeric(12,2)` | not null, same `total = sum of rows` CHECK the orders table carries |
| `lines` | `jsonb` | `[{product_variant_id, qty, unit_price, product_title_snapshot, variant_label_snapshot}]` |
| `created_at` | `timestamptz` | |

**Why it exists.** PAYMENTS.md keeps the `orders` row until capture on purpose, "so `placed` never exists without a paid intent behind it". But the bill is priced at checkout time and D4 forbids recomputing it later: a price edit between the checkout sheet opening and the webhook arriving must not change what the shopper is charged, and the roundup in particular is derived from a cart that no longer exists by then. So the priced bill has to be parked somewhere between the two moments, and this is that somewhere. Rejected alternatives: stashing it on `payment_intents` (one amount column, no room for lines), and recomputing at capture (D4 forbids it, and it would reintroduce `PRICE_MISMATCH`'s failure mode after the money landed).

RLS enabled, no policies, grants withdrawn from `anon` and `authenticated`: the same two lock pattern as `stock_reservations` and `webhook_events`. A client that could edit a draft could edit the price it is about to be charged.

| RPC | Grant | What it does |
|---|---|---|
| `place_order_from_draft(p_payment_intent_id)` | `service_role` only | Calls `consume_reservation`, inserts `orders` (with the address snapshot), `order_items` from `lines`, the first `order_timeline` row, clears the purchased lines from the shopper's cart, and sets `payment_intents.entity_id` to the new order. ONE transaction, which is PRD-07 FR-21 literally. Idempotent: an intent that already has an order returns it untouched. Raises `NO_DRAFT` if the charge was not created by `checkout`, and propagates `consume_reservation`'s `OUT_OF_STOCK` on a late capture, which rolls the whole thing back so no order row is created. Writes no ledger row; the balanced group is written by `_shared/finalize-order-payment.ts` under the service role, matching the court handler. |

### The unified expiry sweep (AT-26, `0038`)

| Function | Grant | What it does |
|---|---|---|
| `unpaid_hold_ttl()` | public | How long an unpaid hold survives, defined as `stock_reservation_ttl()` so all three domains cannot drift apart. |
| `expire_stale_holds()` | `service_role` only | Courts (`pending_payment` past the TTL, via `court_booking_expire_payment`), sessions (`requested` whose payment intent is still `created` past the TTL and which have no captured intent, via `session_abandon_unpaid`), commerce (`release_expired_stock_reservations`, Track A's seam), and **clutch** (`reconcile_stranded_clips`, the fourth arm, AT-93/`0045`). Returns a per domain count so a sweep that ran and did nothing is distinguishable from one that never ran. Per row failures are counted, not fatal, so one refusing row cannot stop the other domains being swept. |
| `reconcile_stranded_clips()` | `service_role` only | The v1 form of VIDEO.md's `stream-reconcile` poll fallback, folded into `expire_stale_holds()` rather than a separate cron. Reclaims clips stranded in `uploading`/`processing` past a 30 minute TTL: if the storage object is present in the private `clips` bucket, drives the clip forward to `ready` (through the legal edges); if absent, `rejected`. Per-row failures counted. |

Scheduled with `pg_cron` as job `expire-stale-holds`, `*/5 * * * *`. A session in `requested` is deliberately NOT stale on age alone: a paid session sits there legitimately for days waiting for a coach to answer, so the query keys on the payment intent instead. Verified 2026-07-20: the first scheduled run at 10:45:00 cancelled sessions `4a64c535` and `4ee5bca9`, the two live stale rows P3 left behind, by running rather than by hand (`cron.job_run_details` runid 1, `sessions.updated_at` 10:45:00.041626).

---

## Domain: clutch

### `clips`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `owner_id` | `uuid` | not null, references `users(id)` |
| `cf_stream_uid` | `text` | nullable, the future Cloudflare Stream video id slot, **NULL in v1** (Supabase Storage adapter, VIDEO.md DECISION UPDATE) |
| `storage_path` | `text` | nullable, the object **KEY** in the private `clips` bucket. A PATH, never a resolved URL |
| `playback_id` | `text` | nullable, Stream-shaped alias, `= storage_path` in v1 (VIDEO.md "playback_id = storage path for now") |
| `thumb_path` | `text` | nullable, the thumbnail object **KEY**. A PATH, never a resolved URL |
| `caption` | `text` | not null |
| `sport` | `sport` | not null |
| `status` | `clip_status` | not null default `uploading` |
| `rejection_reason` | `text` | nullable |
| `likes_count`, `comment_count` | `int` | not null default `0`, maintained by trigger from `clip_likes`/`clip_comments`, never client-written |
| `created_at`, `updated_at` | `timestamptz` | |

**No column stores a resolved URL.** The earlier `video_url`/`thumb_url` draft is replaced by PATH columns (`storage_path`, `thumb_path`, `playback_id`), because a stored public or long-lived signed URL would silently defeat takedown: a `removed` clip would stay fetchable at the stored URL. Every view of a clip video or thumbnail is a freshly minted, short-lived (TTL 300s) signed URL produced by an edge function (`get_clip_playback_url` / `get_clip_moderation_url`, AT-96) against the **live** clip row (`0041`, `0042`, PHASE-5-STATUS.md trap 1).

Indexes: `idx_clips_status_created_at` on `(status, created_at desc)` (feed query, `published` only), `idx_clips_owner_id` on `owner_id`.

**`creator_stats` view** (`0041`): a display-only per-creator aggregate the Clutch profile reads (FR-47), `security_invoker = on`, exposing `published_clips_count`, `followers_count`, `following_count`, `total_likes` (over published clips only). Deterministic for every viewer because only `published` clips and public `follows` contribute; no private clip leaks. Tapping a count to browse the list is not built in v1.

### `clip_likes`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `clip_id` | `uuid` | not null, references `clips(id)` |
| `user_id` | `uuid` | not null, references `users(id)` |
| `created_at` | `timestamptz` | |

Constraints: `UNIQUE(clip_id, user_id)`.

### `clip_comments`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `clip_id` | `uuid` | not null, references `clips(id)` |
| `user_id` | `uuid` | not null, references `users(id)` |
| `text` | `text` | not null |
| `created_at` | `timestamptz` | |

Indexes: `idx_clip_comments_clip_id` on `(clip_id, created_at)`.

### `follows`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `follower_id` | `uuid` | not null, references `users(id)` |
| `followee_id` | `uuid` | not null, references `users(id)`, `CHECK (follower_id <> followee_id)` |
| `created_at` | `timestamptz` | |

Constraints: `UNIQUE(follower_id, followee_id)`.

### Clutch RPCs (`0043`, `0044`, `0045`)

| RPC | Grant | What it does |
|---|---|---|
| `clip_transition_internal(clip_id, to_status, reason)` | `service_role` only | The low-level state machine. Raises `INVALID_TRANSITION` on an illegal edge, requires a non-empty reason to move to `rejected`. Called by the webhook finalizer (AT-95), the reconcile arm, and the moderation RPCs. No client calls it. |
| `moderate_clip(clip_id, action, reason)` | `authenticated` (has_role admin/moderator inside), `service_role` | `approve` (`ready` to `published`), `reject` (`ready` to `rejected`, reason required, FR-30), `remove` (`published` to `removed` takedown, reason required). Writes exactly one `audit_log` row per accepted transition and a `clip_moderation` notification to the creator. Zero rows on a rejected transition. |
| `resolve_report(report_id, action, reason)` | `authenticated` (has_role admin/moderator inside), `service_role` | Reports Queue action. `remove` takes down the reported clip (reuses `moderate_clip`) or deletes the reported comment; `dismiss` leaves the entity untouched. Reason required (FR-33). One `report.<action>` audit row. `ALREADY_RESOLVED` if not `pending`. |
| `toggle_clip_like(clip_id)` | `authenticated`, `service_role` | Idempotent like/unlike of a `published` clip. Refuses guests (`is_guest`). Returns `{liked, likes_count}` (trigger-maintained count). |
| `toggle_follow(followee_id)` | `authenticated`, `service_role` | Idempotent follow/unfollow. Refuses guests and self-follow. Returns `{following, followers_count}`. |

`clip_likes`/`clip_comments`/`follows` carry no direct client write grant; the toggle RPCs and RLS-gated comment insert are the only write paths, so the count triggers stay authoritative. Clients never set `clips.status`.

---

## Domain: empower

### `upa_applications`
Combined application and verified profile row; there is one row per UPA for the whole lifecycle (a rejected applicant reapplying creates a new row, not a resurrected old one, per PRD-05 FR and the reapply-cooldown rule).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `applicant_user_id` | `uuid` | not null, references `users(id)` |
| `story_headline`, `story_body` | `text` | not null |
| `sport` | `sport` | not null |
| `region`, `state` | `text` | not null |
| `photo_url` | `text` | nullable |
| `status` | `upa_status` | not null default `submitted` |
| `needs_info_field` | `text` | nullable, which step/field staff flagged |
| `rejection_reason` | `text` | nullable |
| `reapply_after` | `date` | nullable, cooldown per PRD-05 open question, admin-set on rejection |
| `verified_at` | `timestamptz` | nullable |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: at most one active row per `applicant_user_id`, enforced by the partial unique index `uq_upa_applications_active_per_user` on `(applicant_user_id) WHERE status NOT IN ('rejected','deactivated')` (`0048`). Both terminal states are excluded so a rejected or deactivated applicant can start a fresh row via `reapply_upa_application` without tripping it.
Created and transitioned only by the `0050` RPCs (`submit_upa_application`, `resubmit_upa_application`, `reapply_upa_application`, `deactivate_upa_application`) and the admin verify branch (`admin_approve`/`admin_reject`/`admin_request_upa_info`); no client `INSERT`/`UPDATE`/`DELETE` grant (`0049`). `submit` also creates the linked `verification_requests` row (`applicant_type='upa'`, `applicant_id = upa_applications.id`) atomically, mirroring the coach flow.
Indexes: `idx_upa_applications_status` on `status` (public browse filters to `verified` only), `idx_upa_applications_applicant` on `applicant_user_id`.

### `upa_evidence`
Certificates, ID proof, guardian consent, and video links, one table with a `kind` discriminator instead of three near-identical tables.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `application_id` | `uuid` | not null, references `upa_applications(id)` |
| `kind` | `text` | not null, `CHECK (kind IN ('certificate','id_proof','guardian_consent','video_link'))` |
| `storage_path` | `text` | nullable, set for uploaded file kinds |
| `url` | `text` | nullable, set for `video_link` (external, no upload/transcode) |
| `created_at` | `timestamptz` | |

Indexes: `idx_upa_evidence_application_id` on `application_id`.

### `upa_wishlist_items`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `upa_id` | `uuid` | not null, references `upa_applications(id)` |
| `title` | `text` | not null |
| `cost` | `numeric(12,2)` | not null, `CHECK (cost > 0)` |
| `funded_amount` | `numeric(12,2)` | not null default `0`, written only by the `donate` edge function |
| `status` | `upa_wishlist_item_status` | not null default `open` |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: editable/deletable by the owning UPA only while `status = 'open'` and `funded_amount = 0` (enforced in RLS `WITH CHECK`, see `RLS.md`).
Indexes: `idx_upa_wishlist_items_upa_id` on `upa_id`.

### `donations`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `donor_id` | `uuid` | not null, references `users(id)` |
| `upa_id` | `uuid` | nullable, references `upa_applications(id)`, null means the platform general fund |
| `item_id` | `uuid` | nullable, references `upa_wishlist_items(id)` |
| `amount` | `numeric(12,2)` | not null |
| `method` | `donation_method` | not null |
| `order_id` | `uuid` | nullable, references `orders(id)`, set when `method = 'checkout_roundup'` |
| `payment_intent_id` | `uuid` | not null, references `payment_intents(id)` |
| `created_at` | `timestamptz` | |

Indexes: `idx_donations_donor_id` on `donor_id`, `idx_donations_upa_id` on `upa_id`.

### `gratitude_posts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `upa_id` | `uuid` | not null, references `upa_applications(id)` |
| `wishlist_item_id` | `uuid` | not null, unique, references `upa_wishlist_items(id)` |
| `body` | `text` | not null |
| `photo_url` | `text` | nullable |
| `status` | `text` | not null default `published`, `CHECK (status IN ('published','removed'))` |
| `deleted_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | |

Constraints: `UNIQUE(wishlist_item_id)` enforces at most one gratitude post per funded item (FR-19). `INSERT` gated (`0049`) to a `funded`/`delivered` item of the caller's own verified UPA with no existing post; immutable except an own-UPA soft-delete `UPDATE` to `status = 'removed'` (the client `UPDATE` grant is column-scoped to `status`/`deleted_at`, so body/photo cannot be rewritten after posting).

### The General Fund ledger anchor (`0048`)
`ledger_entries.account_ref` carries no FK, so the reserved platform General Fund is a pure ledger anchor, a fixed sentinel UUID `00000000-0000-4000-a000-0000000f0000`, exposed as the immutable SQL function `public.general_fund_account_ref()` as the single source of truth (Track B's edge functions mirror it as a TS constant `GENERAL_FUND_ACCOUNT_REF`). Checkout roundups (which target no specific UPA, PRD-06 FR-11) are credited to `account_type = 'upa_fund'` at this `account_ref`. Fund balances derive uniformly from the ledger with no denormalized balance column: a specific UPA's total raised is `sum(credit) - sum(debit) WHERE account_type='upa_fund' AND account_ref = <upa_application_id>`; the general fund balance is the same with `account_ref = general_fund_account_ref()`.

### State-machine and admin RPCs (`0050`)
The empower machines follow the orders/sessions/clips pattern: `upa_application_transition_internal` and `upa_wishlist_item_transition_internal` (both `service_role`-only, raise `INVALID_TRANSITION`) own the two machines; the client-facing `submit`/`resubmit`/`reapply`/`deactivate_upa_application` and `mark_wishlist_item_delivered` RPCs (granted to `authenticated`, revoke anon in `0051`) and Track B's donate finalize handler are the only things that move an empower row's state. The wishlist `open -> funded` edge is called by the finalize handler under the service role; `funded -> delivered` by the owning UPA via `mark_wishlist_item_delivered`. `admin_approve_verification_request` / `admin_reject_verification_request` (`0009`) gained their `applicant_type = 'upa'` branch: approve transitions the application to `verified`, grants the `upa` `user_roles` row, and writes exactly one `audit_log` row; `admin_request_upa_info` moves a pending application to `needs_info` with a flagged field and its own audit row.

`users.show_donor_name` (`0048`, boolean, default false): donor name visibility opt-in (PRD-05 FR-17 / PRD-06 anonymization); donations render as "A Sponsor" unless the donor opts in. Resolved-by-assumption 3 in PHASE-6-STATUS.md.

---

## Domain: learn

### `drills`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `title`, `description` | `text` | not null |
| `sport` | `sport` | not null |
| `skill_category` | `text` | not null |
| `difficulty` | `drill_difficulty` | not null |
| `xp_value` | `int` | not null, `CHECK (xp_value > 0)` |
| `media_url` | `text` | nullable |
| `active` | `boolean` | not null default `true` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_drills_sport_active` on `(sport, active)`.

### `drill_completions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `drill_id` | `uuid` | not null, references `drills(id)` |
| `completed_at` | `timestamptz` | not null default now() |

Constraints: `UNIQUE(user_id, drill_id)` — one completion per user per drill in v1, the idempotency guard FR-49 requires; a future "redo" affordance would need a distinct schema change, not a relaxation of this constraint.

### `roadmap_stages`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `sport` | `sport` | not null |
| `stage_order` | `smallint` | not null |
| `name` | `text` | not null |
| `xp_threshold` | `int` | not null |

Constraints: `UNIQUE(sport, stage_order)`.

### `xp_events`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `drill_id` | `uuid` | nullable, references `drills(id)` |
| `source` | `xp_source` | not null |
| `xp_amount` | `int` | not null |
| `created_at` | `timestamptz` | |

Indexes: `idx_xp_events_user_id` on `user_id` (roadmap stage is `sum(xp_amount)` against `roadmap_stages.xp_threshold`, computed at read time, never denormalized).

### `milestones`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `key` | `text` | not null, unique |
| `name`, `description` | `text` | not null |
| `icon_name` | `text` | not null, a lucide icon name, never an emoji |
| `criteria` | `jsonb` | not null, e.g. `{"type": "xp_threshold", "value": 500}` or `{"type": "drill_count", "value": 10}` |

### `user_milestones`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `milestone_id` | `uuid` | not null, references `milestones(id)` |
| `earned_at` | `timestamptz` | not null default now() |

Constraints: `UNIQUE(user_id, milestone_id)`.

---

## Domain: chat

### `chat_threads`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `participant_a` | `uuid` | not null, references `users(id)` |
| `participant_b` | `uuid` | not null, references `users(id)` |
| `context_type` | `text` | not null, `CHECK (context_type IN ('coaching','clutch_creator'))` |
| `context_id` | `uuid` | not null, the `sessions.id` (any status ever existing, per PRD-02 FR-30) or the creator relationship anchor |
| `last_message_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | |

Constraints: `CHECK (participant_a < participant_b)` so the pair is always stored in one canonical order (application code sorts the two ids before insert); `UNIQUE(participant_a, participant_b, context_type, context_id)`.
Indexes: `idx_chat_threads_participant_a` on `participant_a`, `idx_chat_threads_participant_b` on `participant_b`.

### `chat_messages`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `thread_id` | `uuid` | not null, references `chat_threads(id)` |
| `sender_id` | `uuid` | not null, references `users(id)` |
| `text` | `text` | not null |
| `created_at` | `timestamptz` | |

Indexes: `idx_chat_messages_thread_id` on `(thread_id, created_at)`. Realtime is enabled on this table via `supabase_realtime` publication.

### Realtime publication membership

The `supabase_realtime` publication contains exactly three tables, and membership is deliberate rather than incidental:

| Table | Added by | Consumer |
|---|---|---|
| `chat_messages` | `0022_chat.sql` | `packages/api/src/use-chat.ts` (`subscribeToThread`, `subscribeToInbox`) |
| `court_bookings` | `0029_realtime_courts_sessions.sql` | `apps/portal-court` Live Today board (PRD-03 FR-15) |
| `sessions` | `0029_realtime_courts_sessions.sql` | coach accept/decline push (PRD-02 FR-12) |

`court_bookings` and `sessions` were missing until 0029, which is the root cause of advisory AT-32: the Live Today board subscribed correctly to a table that was never replicated, so no event could ever arrive. Adding a table here is a security decision, not a performance one, because Realtime evaluates each table's `SELECT` policy per subscriber before delivering a row; publish nothing without the RLS review 0029's header performs.

Both new tables are left at `REPLICA IDENTITY DEFAULT`. Check ins and cancellations are `UPDATE`s and DEFAULT ships the full new tuple, which is all the client filters and RLS policies need; there is no hard-delete path on either table, and `FULL` would push old-row money columns and walk-in PII into the WAL for no consumer. If a hard delete is ever added, revisit this: `DELETE` events on a DEFAULT-identity table carry only the primary key, cannot be RLS-checked, and are silently dropped.

Both chat tables ship in `0022_chat.sql`, which also adds `text` a non-empty `CHECK`, the `chat_messages_touch_thread` trigger maintaining `chat_threads.last_message_at`, and the publication entry. `chat_threads` is deliberately not published: the thread list gets its liveness from an unfiltered `chat_messages` subscription, which RLS already scopes to the caller's own threads. `context_type` accepts `clutch_creator` at the constraint level per this doc, but the INSERT policy accepts only `coaching` until the Clutch domain exists, so the second value is currently reachable only by `service_role`.

---

## Domain: notifications

### `notifications`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `type` | `notification_type` | not null |
| `title`, `body` | `text` | not null |
| `deep_link` | `text` | not null |
| `read_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | |

Indexes: `idx_notifications_user_id_read_at` on `(user_id, read_at)`.

### `push_tokens`
Named `push_tokens` (renamed from this doc's earlier `device_tokens`) as of `0002_notifications.sql`; same shape.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `token` | `text` | not null, unique |
| `platform` | `text` | not null, `CHECK (platform IN ('ios','android'))` |
| `created_at` | `timestamptz` | |

Indexes: `idx_push_tokens_user_id` on `user_id`.

### `notification_prefs`
Added in `0002_notifications.sql`, not originally in this doc. Per notification_type push/email opt-out, finer grained than a single device token.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `notification_type` | `notification_type` | not null |
| `push_enabled` | `boolean` | not null default `true` |
| `email_enabled` | `boolean` | not null default `true` |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `UNIQUE(user_id, notification_type)`.
Indexes: `idx_notification_prefs_user_id` on `user_id`.

---

## Domain: payments

### `payment_intents`
One row per Razorpay order, created before the domain entity in most flows (an order/session/booking/donation references a `payment_intent_id`, not the other way around, so the intent always exists first).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `domain` | `payment_domain` | not null |
| `entity_id` | `uuid` | nullable, populated once the domain row is created; this is the `entity_id` half of the Razorpay `notes: {domain, entity_id}` pair described in `PAYMENTS.md` |
| `razorpay_order_id` | `text` | not null, unique |
| `razorpay_payment_id` | `text` | nullable |
| `amount` | `numeric(12,2)` | not null |
| `currency` | `text` | not null default `'INR'` |
| `status` | `payment_intent_status` | not null default `created` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_payment_intents_user_id` on `user_id`, `idx_payment_intents_razorpay_order_id` on `razorpay_order_id` (webhook lookup), `idx_payment_intents_domain_entity` on `(domain, entity_id)`.

### `ledger_entries`
Double-entry. Every money event writes two or more rows whose `amount` sum, respecting `direction`, is zero within one `entry_group_id`. This table is the single source of truth for every balance the app displays (coach earnings, court partner earnings, UPA totals raised, platform revenue); no balance is ever a denormalized mutable column.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `entry_group_id` | `uuid` | not null, ties the debit and credit legs of one economic event together |
| `payment_intent_id` | `uuid` | nullable, references `payment_intents(id)` |
| `account_type` | `ledger_account_type` | not null |
| `account_ref` | `uuid` | nullable, the coach id / court partner (venue) id / UPA id / user id the row belongs to; null only for `account_type = 'platform'` |
| `direction` | `ledger_direction` | not null |
| `amount` | `numeric(12,2)` | not null, `CHECK (amount > 0)`, sign comes from `direction`, never a negative number stored directly |
| `domain` | `payment_domain` | not null |
| `entity_id` | `uuid` | not null, the session/booking/order/donation id this entry is about |
| `description` | `text` | not null |
| `created_at` | `timestamptz` | not null default now() |

Constraints: a database function `assert_ledger_group_balanced(entry_group_id)` runs as a deferred `AFTER` constraint trigger on insert, rejecting the transaction if `sum(amount) FILTER (WHERE direction='debit') <> sum(amount) FILTER (WHERE direction='credit')` for that group. Rows are insert-only; no `UPDATE` or `DELETE` grant exists for any role, including `service_role` policies (corrections are new reversing entries, never edits).

Indexes: `idx_ledger_entries_account` on `(account_type, account_ref)` (every balance query is `sum(amount) WHERE account_type=... AND account_ref=... GROUP BY direction`), `idx_ledger_entries_entity` on `(domain, entity_id)`, `idx_ledger_entries_entry_group` on `entry_group_id`.

**Worked example, a coaching session marked complete for a session priced at 1000 with a 100 platform fee:**

| `entry_group_id` | `account_type` | `account_ref` | `direction` | `amount` | `description` |
|---|---|---|---|---|---|
| `g1` | `platform` | null | `debit` | 1000.00 | clearing: session payment captured |
| `g1` | `coach` | `<coach_id>` | `credit` | 900.00 | session earnings, session `<id>` |
| `g1` | `platform` | null | `credit` | 100.00 | platform fee, session `<id>` |

Debits (1000.00) equal credits (900.00 + 100.00). A coach's balance is `sum(credit) - sum(debit) WHERE account_type='coach' AND account_ref=<coach_id>`. A later transfer of 900 to the coach's bank writes a second group: debit `coach` 900.00, credit `platform` 900.00 (money left the platform's clearing float), alongside the `transfers` row.

### `payout_accounts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `owner_type` | `text` | not null, `CHECK (owner_type IN ('coach','court_partner'))` |
| `owner_id` | `uuid` | not null, the `coach_profiles.user_id` or `venues.id` |
| `razorpay_account_id` | `text` | nullable, the Route linked account id |
| `status` | `payout_account_status` | not null default `not_started` |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `UNIQUE(owner_type, owner_id)`.

### `transfers`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `payout_account_id` | `uuid` | not null, references `payout_accounts(id)` |
| `amount` | `numeric(12,2)` | not null |
| `razorpay_transfer_id` | `text` | nullable |
| `status` | `transfer_status` | not null default `processing` |
| `ledger_entry_group_id` | `uuid` | not null, the `entry_group_id` this transfer's ledger legs belong to |
| `created_at` | `timestamptz` | |

Indexes: `idx_transfers_payout_account_id` on `payout_account_id`.

### `refunds`
One refund attempt against one captured charge. Added 2026-07-19 in `0026_session_request_cancel_refund.sql` for PRD-02 FR-35. Deliberately shaped like `transfers`: an outbound money movement with a provider id, a status that starts optimistic and is confirmed by webhook, and a pointer to the ledger group written when it settles.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `payment_intent_id` | `uuid` | not null, references `payment_intents(id)` on delete restrict |
| `domain` | `payment_domain` | not null |
| `entity_id` | `uuid` | not null, the session/booking/order this refund reverses |
| `amount` | `numeric(12,2)` | not null, `> 0` |
| `razorpay_refund_id` | `text` | nullable until the provider call succeeds |
| `status` | `refund_status` | not null default `pending` |
| `failure_reason` | `text` | nullable, why the last attempt failed; cleared on success |
| `attempts` | `integer` | not null default 0 |
| `ledger_entry_group_id` | `uuid` | nullable, set only when the refund settles |
| `created_at` / `updated_at` | `timestamptz` | not null default now() |

Indexes: `refunds_one_per_entity` UNIQUE on `(domain, entity_id)`, which is the idempotency gate (one refund per session in this flow); `refunds_razorpay_refund_id_key` UNIQUE partial on `razorpay_refund_id WHERE not null`, the webhook's dedupe key; `idx_refunds_status_created` partial on `(status, created_at) WHERE status <> 'processed'`, the admin queue of outstanding refunds; `idx_refunds_payment_intent_id`.

RLS: no client writes at all (money row, per CLAUDE.md's financial invariant). Select for `has_role('admin')`, and for the payer of the underlying `payment_intents` row so the app can show "refund on its way".

**A pending refund lives here, not in `payment_intents.status` and not in `ledger_entries`.** `payment_intents.status` describes one charge's lifecycle and has nowhere to record a failure reason or an attempt count; `ledger_entries` records money that has already moved, and a refund that has not been issued has not moved, so writing one there would create the second balance representation `PAYMENTS.md` forbids, in a table that is INSERT-only and cannot be corrected. `payment_intents.status` still flips to `refunded`, set by `settle_refund` only when the refund actually settles.

### `webhook_events`
Idempotency ledger for `razorpay-webhook`, detailed in `PAYMENTS.md`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `text` | PK, the Razorpay event id (`event.id` from the webhook payload) |
| `event_type` | `text` | not null |
| `payload` | `jsonb` | not null, raw event body for replay/audit |
| `processed_at` | `timestamptz` | not null default now() |

No RLS-relevant access, `service_role` only, never selected by a client.

### `fee_config`
Versioned, never mutated in place, so a bill computed before an edit is unaffected by it (PRD-04 FR-40).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `domain` | `text` | not null, `CHECK (domain IN ('courts','sessions','commerce','donations'))` |
| `key` | `text` | not null, e.g. `platform_fee_percent`, `gst_percent`, `delivery_flat`, `min_amount`, `route_transfer_fee_flat` |
| `value_type` | `fee_value_type` | not null |
| `value` | `numeric(12,4)` | not null |
| `effective_from` | `timestamptz` | not null default now() |
| `created_at` | `timestamptz` | |

Constraints: `UNIQUE(domain, key, effective_from)`. The active value for `(domain, key)` at time T is the row with the greatest `effective_from <= T`; an edge function reads this with `ORDER BY effective_from DESC LIMIT 1`, never a naive "latest row" without the time filter (so a bill computed at booking time re-derives the fee that was active then, if ever audited).

---

## Domain: moderation/audit

### `verification_requests`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `applicant_type` | `applicant_type` | not null |
| `applicant_id` | `uuid` | not null, the `coach_profiles.user_id`, `venues.id`, or `upa_applications.id` depending on `applicant_type` |
| `status` | `verification_status` | not null default `pending_review` |
| `payload` | `jsonb` | not null, snapshot of the submitted evidence at submission time, so history survives later profile edits |
| `reviewer_id` | `uuid` | nullable, references `users(id)` |
| `rejection_reason` | `text` | nullable |
| `reviewed_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | |

Indexes: `idx_verification_requests_status_type` on `(status, applicant_type)`, `idx_verification_requests_applicant` on `(applicant_type, applicant_id)`.

### `reports`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `entity_type` | `text` | not null, `CHECK (entity_type IN ('clip','comment'))` |
| `entity_id` | `uuid` | not null |
| `reporter_id` | `uuid` | not null, references `users(id)` |
| `reason` | `text` | not null |
| `status` | `report_status` | not null default `pending` |
| `resolved_by` | `uuid` | nullable, references `users(id)` |
| `resolved_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | |

Indexes: `idx_reports_status` on `status`.

### `feature_flags`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `key` | `text` | not null, unique |
| `description` | `text` | not null |
| `enabled` | `boolean` | not null default `false` |
| `created_at`, `updated_at` | `timestamptz` | |

### `audit_log`
Append-only. No role, including `service_role` via RLS, is ever granted `UPDATE` or `DELETE` on this table (PRD-04 FR-54); the only writes are `INSERT`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `actor_id` | `uuid` | nullable, references `users(id)` (null for a system/edge-function write) |
| `action` | `text` | not null, e.g. `verification.approve`, `order.advance`, `fee_config.edit` |
| `entity_type` | `text` | not null |
| `entity_id` | `uuid` | not null |
| `before`, `after` | `jsonb` | nullable |
| `note` | `text` | nullable |
| `created_at` | `timestamptz` | not null default now() |

Indexes: `idx_audit_log_actor_created_at` on `(actor_id, created_at desc)`, `idx_audit_log_entity` on `(entity_type, entity_id)`.

### `support_tickets`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `submitter_id` | `uuid` | not null, references `users(id)` |
| `subject` | `text` | not null |
| `description` | `text` | not null |
| `status` | `ticket_status` | not null default `open` |
| `resolution_note` | `text` | nullable |
| `resolved_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | |

Indexes: `idx_support_tickets_status` on `status`.

---

## The booking concurrency guard, summarized

PLAN.md calls out `UNIQUE(court_id, date, slot_start)` as the mechanism that resolves a race between two athletes booking the same slot. In this schema it is a partial unique index on `court_bookings`, `UNIQUE (court_id, date, slot_start) WHERE status NOT IN ('cancelled')`, and the identical pattern is applied to `sessions` as `UNIQUE (coach_id, date, slot_start) WHERE status NOT IN ('declined', 'cancelled')` per PRD-02 FR-24. Both `book-court` and `book-session` edge functions insert the booking row inside the same transaction that creates the `payment_intents` row; if the unique index rejects the insert, the edge function catches the Postgres `23505` error and returns `SLOT_TAKEN` to the client without ever calling Razorpay. No application-level locking, advisory lock, or optimistic version column is needed, the database is the single arbiter.

## The double-entry ledger, summarized

The read path is `get_coach_wallet_balance()` and `get_my_transactions(kind?, limit?, offset?)` (`0025_wallet_and_transactions_rpcs.sql`, AT-44), both `security definer`, both scoped by `auth.uid()`, both deriving every figure at call time from `ledger_entries` and `payment_intents`. No screen sums money client side and no table anywhere gained a balance column.

`ledger_entries` is insert-only and every economic event writes a balanced group (see the worked example above). This gives three properties the product requires: a coach's or partner's balance is always `sum(credits) - sum(debits)` computed live, never a value that can drift from reality; a refund or a payout failure is a new reversing group, never a mutation of history, so `audit_log` and `ledger_entries` together form a complete replayable record; and every screen that shows money (`Earnings`, `My Impact`, admin's `Order Detail` refund panel) reads the same table through a different filter, so there is exactly one place a money bug could live.
