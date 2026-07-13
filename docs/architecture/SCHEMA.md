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
| `app_role` | `player`, `coach`, `court_partner`, `court_staff`, `upa`, `admin` | `guest` is never persisted, it is the absence of a session (or a Supabase anonymous auth session with zero `user_roles` rows) |
| `sport` | `football`, `cricket`, `badminton`, `tennis` | extend by adding a value, never a second enum |
| `session_status` | `requested`, `accepted`, `declined`, `completed`, `cancelled`, `rescheduled`, `rated` | machine: `requested` to (`accepted` or `declined`); `accepted` to (`completed` or `cancelled` or `rescheduled`); `completed` to `rated` |
| `session_frequency` | `one_time`, `weekly`, `monthly` | |
| `coach_status` | `pending_review`, `verified`, `rejected` | mirrors the linked `verification_requests` row, updated only by the approval RPC |
| `venue_status` | `pending`, `verified`, `rejected` | same pattern as `coach_status` |
| `court_booking_status` | `confirmed`, `completed`, `cancelled`, `rescheduled`, `no_show` | machine: `confirmed` to (`completed` or `cancelled` or `rescheduled` or `no_show`); `completed` to `rated` is tracked by a non-null `rating` column, not a further status value, matching the athlete-only-rates-once rule |
| `order_status` | `placed`, `shipped`, `in_transit`, `delivered`, `cancelled` | machine: strictly forward through `placed` to `shipped` to `in_transit` to `delivered`; `cancelled` reachable only from `placed` |
| `clip_status` | `uploading`, `processing`, `ready`, `published`, `rejected`, `removed` | machine: `uploading` to `processing`; `processing` to (`ready` or `rejected`, the latter on a Cloudflare Stream transcode error per `VIDEO.md`); `ready` to (`published` or `rejected`); `published` to `removed` (moderation takedown only) |
| `upa_status` | `submitted`, `under_review`, `needs_info`, `verified`, `rejected` | machine: `submitted` to `under_review`; `under_review` to (`needs_info` or `verified` or `rejected`); `needs_info` back to `under_review` on resubmit; `rejected` to `submitted` on reapply (new row, see `upa_applications`) |
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

Constraints: no two windows for the same `coach_id` and `day_of_week` may overlap, enforced with a `btree_gist` `EXCLUDE` constraint on `(coach_id WITH =, day_of_week WITH =, tsrange(start_time, end_time) WITH &&)`.
Indexes: `idx_coach_availability_coach_id` on `coach_id`.

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

Constraints: `UNIQUE (coach_id, date, slot_start) WHERE status NOT IN ('declined', 'cancelled')` — the same concurrency guard PLAN.md specifies for courts, applied to coaching per PRD-02 FR-24; a partial index so a declined or cancelled session frees the slot for a new request.
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
| `address_id` | `uuid` | not null, references `addresses(id)` |
| `subtotal`, `delivery_charges`, `gst_and_others`, `donation_roundup`, `total` | `numeric(12,2)` | not null |
| `status` | `order_status` | not null default `placed` |
| `payment_intent_id` | `uuid` | nullable, references `payment_intents(id)` |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_orders_user_id` on `user_id`, `idx_orders_status` on `status`.

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

---

## Domain: clutch

### `clips`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `owner_id` | `uuid` | not null, references `users(id)` |
| `cf_stream_uid` | `text` | nullable, Cloudflare Stream video id, see `VIDEO.md` |
| `video_url`, `thumb_url` | `text` | nullable until Stream processing completes |
| `caption` | `text` | not null |
| `sport` | `sport` | not null |
| `status` | `clip_status` | not null default `uploading` |
| `rejection_reason` | `text` | nullable |
| `likes_count`, `comment_count` | `int` | not null default `0`, maintained by trigger from `clip_likes`/`clip_comments`, never client-written |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `idx_clips_status_created_at` on `(status, created_at desc)` (feed query, `published` only), `idx_clips_owner_id` on `owner_id`.

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

Constraints: at most one row with `status IN ('submitted','under_review','needs_info','verified')` per `applicant_user_id`, enforced by a partial unique index `UNIQUE (applicant_user_id) WHERE status <> 'rejected'`.
Indexes: `idx_upa_applications_status` on `status` (public browse filters to `verified` only).

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

Constraints: `UNIQUE(wishlist_item_id)` enforces at most one gratitude post per funded item (FR-19).

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

### `device_tokens`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null, references `users(id)` |
| `token` | `text` | not null, unique |
| `platform` | `text` | not null, `CHECK (platform IN ('ios','android'))` |
| `created_at` | `timestamptz` | |

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

`ledger_entries` is insert-only and every economic event writes a balanced group (see the worked example above). This gives three properties the product requires: a coach's or partner's balance is always `sum(credits) - sum(debits)` computed live, never a value that can drift from reality; a refund or a payout failure is a new reversing group, never a mutation of history, so `audit_log` and `ledger_entries` together form a complete replayable record; and every screen that shows money (`Earnings`, `My Impact`, admin's `Order Detail` refund panel) reads the same table through a different filter, so there is exactly one place a money bug could live.
