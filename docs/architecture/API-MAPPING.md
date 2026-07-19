# v1 to v2 API Mapping

Every function in v1's `services/api.ts` contract (`PLAN-2-3-api-contract-and-llm.md`) mapped to its real v2 implementation. Screens and components never change, per PLAN.md; only what backs `services/api.ts` changes, from a mock to one of four lanes:

- **PostgREST** — a direct `packages/api` typed hook calling `supabase.from(...)`, secured entirely by an RLS policy in `RLS.md`. Used for reads and simple own-row writes that touch no money and no state machine.
- **RPC** — a `SECURITY DEFINER` Postgres function called via `supabase.rpc(...)`. Used for state-machine transitions, atomic multi-row writes, and any read that must hide other users' rows while exposing a derived value (busy slots, balances). Raises a Postgres exception with a code the client maps to the v1 error shape (`INVALID_TRANSITION`, `SLOT_TAKEN`, etc).
- **Edge Function** — a Deno function running with the `service_role` key. Used for anything touching Razorpay, anything writing `ledger_entries` or `payment_intents`, and Cloudflare Stream calls. This is the only lane allowed to move money, matching PLAN.md's financial invariant.
- **Supabase Auth** — the GoTrue client SDK directly (`supabase.auth.*`), not PostgREST or an edge function. v1's `auth` and part of `profile` map here; it is a fourth lane the v1 three-bucket description didn't need to name because v1 had no real backend.

`packages/api` wraps every row below in a typed hook with the same function name v1 used, so screens do not change when the mock swaps for the real call.

## auth

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `login` | POST `/auth/login` | Supabase Auth | `signInWithPassword` | email or phone, native GoTrue error maps to `401 INVALID_CREDENTIALS` |
| `register` | POST `/auth/register` | Supabase Auth + trigger | `signUp` then DB trigger `handle_new_user()` | trigger inserts the `public.users` row; role stays unset until Role select calls `setupPlayer`/`setupCoach` |
| `requestOtp` | POST `/auth/otp/request` | Supabase Auth | `signInWithOtp` | phone or email OTP, GoTrue owns rate limiting (`429 RATE_LIMITED`) |
| `verifyOtp` | POST `/auth/otp/verify` | Supabase Auth | `verifyOtp` | returns a session; client treats it as the v1 `resetToken` |
| `resetPassword` | POST `/auth/password/reset` | Supabase Auth | `updateUser({ password })` | called on the session `verifyOtp` established |
| `continueAsGuest` | POST `/auth/guest` | Supabase Auth | `signInAnonymously` | anonymous auth user with zero `user_roles` rows is the guest state everywhere else in this doc |

## profile

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `getMe` | GET `/me` | PostgREST | `users` select, left join `coach_profiles` | RLS `id = auth.uid()` |
| `updateMe` | PATCH `/me` | PostgREST | `users` update | sport-immutable-once-verified rule enforced by a `BEFORE UPDATE` trigger on `coach_profiles`, not this call |
| `setupPlayer` | POST `/me/setup/player` | RPC | `complete_player_setup(sports, avatar_url, city, state)` | writes `users` fields and the `player` `user_roles` row in one transaction; raises `ALREADY_SETUP` if the role already exists |
| `setupCoach` | POST `/me/setup/coach` | RPC | `submit_coach_verification(payload jsonb)` | writes `coach_profiles`, `coach_certificates`, `session_types`, `coach_availability_windows`, and the `verification_requests` row atomically; raises `ALREADY_SETUP` if a `pending_review` or `verified` profile exists |

## search

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `aiSearch` | POST `/search` | Edge Function | `ai-search` | v1 heuristic (keyword to entityTypes, weighted distance/price/rating score) ported verbatim behind the same request/response contract; LLM re-rank is a drop-in swap inside this one function, per PLAN.md |

## coaches

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `list` | GET `/coaches` | PostgREST | `coach_profiles` select, filters as query params | RLS restricts to `status = 'verified'` for non-owner readers |
| `get` | GET `/coaches/:id` | PostgREST + RPC | `coach_profiles` select + `get_coach_busy_slots(coach_id, from, to)` | busy slots must hide other players' session details, so it is a `SECURITY DEFINER` RPC returning only occupied `(date, slot_start)` pairs, never the session rows themselves |

## sessions

State machine: `requested` to (`accepted` or `declined`); `accepted` to (`completed` or `cancelled` or `rescheduled`); `completed` to `rated`. Every transition below is one `SECURITY DEFINER` RPC, `session_transition(session_id, action, ...)`, that checks caller identity and current status before writing, raising `INVALID_TRANSITION` (409) otherwise. `SLOT_TAKEN` on reschedule comes from the same partial unique index described in `SCHEMA.md`.

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `book` | POST `/sessions/book` | Edge Function | `book-session` | creates `payment_intents` + `sessions` (`requested`), re-prices server side (`PRICE_MISMATCH`), returns a Razorpay order for the client to open |
| `list` | GET `/sessions` | PostgREST | `sessions` select, joined to `users`/`coach_profiles` for hydrated names | RLS `coach_id = auth.uid() OR player_id = auth.uid()` |
| `get` | GET `/sessions/:id` | PostgREST | `sessions` select single | same RLS as `list` |
| `accept` | POST `/sessions/:id/accept` | RPC | `session_transition(id, 'accept')` | caller must be `coach_id`; `requested` to `accepted` only |
| `decline` | POST `/sessions/:id/decline` | RPC | `session_transition(id, 'decline', reason)` | caller must be `coach_id` |
| `complete` | POST `/sessions/:id/complete` | RPC | `session_transition(id, 'complete')` | caller must be `coach_id`; only from `accepted`, and only once the scheduled end time has passed, else `TOO_EARLY` (PRD-02 FR-15, server gated) |
| `cancel` | POST `/sessions/:id/cancel` | RPC | `session_transition(id, 'cancel', reason)` | caller must be `coach_id` or `player_id`; only from `accepted`; reason required (`REASON_REQUIRED`); rejected once the session has started (`SESSION_STARTED`) |
| `reschedule` | POST `/sessions/:id/reschedule` | RPC | `session_transition(id, 'reschedule', null, date, slot)` | re-checks the unique index, raises `SLOT_TAKEN` on conflict |
| `rate` | POST `/sessions/:id/rate` | RPC | `rate_session(id, rating, remarks)` | caller must be `player_id`; only from `completed`; second call raises `ALREADY_RATED` |

Shipped in `0021_session_state_machine.sql`. Exact signatures:

- `session_transition(p_session_id uuid, p_action text, p_reason text default null, p_new_date date default null, p_new_slot_start time default null) returns public.sessions`
- `rate_session(p_session_id uuid, p_rating smallint, p_remarks text default null) returns public.sessions`

Error codes `packages/api` maps: `UNAUTHENTICATED`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `VALIDATION`, `REASON_REQUIRED`, `TOO_EARLY`, `SESSION_STARTED`, `SLOT_TAKEN`, `ALREADY_RATED`.

Two behaviours the tables above do not make obvious. **Reschedule inserts a new row** at the new date/slot in `accepted`, carrying the original's money columns and `payment_intent_id`, and marks the original `rescheduled` as a tombstone; the RPC returns the NEW row, so a caller must not assume the id it passed in is the id it gets back. This mirrors `court_booking_transition`. **`rate_session` also refreshes `coach_profiles.rating`/`rating_count`** in the same transaction, recomputed from `sessions` rather than incremented, so a replay cannot double count; it does this through a transaction-local `app.rating_pipeline` GUC that `lock_coach_profile_admin_fields` now honours alongside `has_role('admin')`.

**No ledger write happens in these RPCs**, despite PRD-02 FR-15 describing completion as triggering the earnings accrual. Per CLAUDE.md, ledger writes live only in edge functions under the service role; AT-41's function calls `session_transition(id, 'complete')` and writes the balanced group itself. Same resolution `0009_courts.sql` already made for courts.

### `book-session`, as built (AT-40)

`POST` with the athlete's own JWT, `verify_jwt` true.

Request `{ session_type_id, frequency, date, slot_start, focus_area?, location?, expected_total }`. `slot_end` is not accepted from the client; it is derived from `session_types.duration_minutes`, so a client cannot buy a two hour slot at a one hour price.

Response `{ session_id, status, razorpay_order_id, key_id, amount (paise), currency, bill: { price, platform_fee, total } }`. `status` is always `requested`; nothing in this response means the payment succeeded.

Error codes: `VALIDATION` 400, `UNAUTHENTICATED` 401, `NOT_FOUND` 404 (session type missing, inactive, or its coach not `verified`), `SLOT_TAKEN` 409, `PRICE_MISMATCH` 409, `RAZORPAY_ERROR` 502, `INTERNAL` 500.

`SLOT_TAKEN` covers three distinct rejections deliberately, because they are one thing to the athlete ("you cannot have this slot"): the slot falls outside every `coach_availability_windows` row for that weekday, the slot is already held per `get_coach_busy_slots`, or the insert lost the race on `sessions_coach_date_slot_unique` (`23505`). Only the third is authoritative; the first two are optimistic pre-checks that narrow the window without closing it.

`PRICE_MISMATCH` compares `expected_total` against the server derived `total`, which is `session_types.price` (the fee is carved out of it, see SCHEMA.md). The client's number is never charged, and no session row or Razorpay order exists when this fires.

**Capture is finalized by `_shared/finalize-payment.ts`, not here.** That module is the single gate both `razorpay-webhook` and `verify-payment` call; it owns the `update payment_intents ... where status = 'created'` idempotency check and then dispatches on `payment_intents.domain` to `finalize-court-booking-payment.ts` or `finalize-session-payment.ts`. Neither entry point knows which domain it is finalizing. Adding `commerce`/`donation` later means one new branch plus one new file, never a second copy of the gate.

`verify-payment` responds `{ domain, entity_id, booking_id, session_id, status, outcome }`, where `booking_id` and `session_id` are domain-named aliases of `entity_id` (the other is null) so a court-only or session-only caller need not switch on `domain`. `outcome` is `captured` or `already_processed`.

## courts

Identical pattern to sessions, per PLAN.md's "Courts lifecycle = Sessions lifecycle verbatim" rule. State machine: `confirmed` to (`completed` or `cancelled` or `rescheduled` or `no_show`); rating is a column write, not a further status.

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `list` | GET `/courts` | PostgREST | `courts` select joined to `venues`, filters as query params | RLS restricts to `venues.status = 'verified'` |
| `get` | GET `/courts/:id` | PostgREST + RPC | `courts` select + `get_court_busy_slots(court_id, from, to)` + `get_court_rating_summary(court_id)` | mirrors `coaches.get`, hides other athletes' booking detail; the rating summary call is required because `court_bookings`' own RLS scopes row reads to the booking's own athlete or the venue's partner/staff, so the aggregate star rating cannot come from a direct `court_bookings` select (`0015_court_rating_summary.sql`) |
| `book` | POST `/courts/:id/book` | Edge Function | `book-court` | creates `payment_intents` + `court_bookings` (`confirmed`), re-prices server side, also the path `portal-court`'s walk-in form calls (partner-scoped variant, same function, service-role bypasses payment for a walk-in flagged `booking_source='walk_in'`) |
| `cancel` | POST `/court-bookings/:id/cancel` | RPC | `court_booking_transition(id, 'cancel', reason)` | releases the slot (unique index) unless the start time has passed, in which case it becomes `no_show` per PRD-03 FR-18 |
| `reschedule` | POST `/court-bookings/:id/reschedule` | RPC | `court_booking_transition(id, 'reschedule', date, slot)` | `SLOT_TAKEN` on conflict |
| `rate` | POST `/court-bookings/:id/rate` | RPC | `rate_court_booking(id, rating, remarks)` | only from `completed`, once |

## portal-court (v2-only, no v1 mock)

`apps/portal-court` has no v1 mock to map from (v1 had no partner-facing surface at all); these ship in `0009_courts.sql` alongside the courts domain tables, same pattern as "Edge functions not in the v1 contract" below.

| Function | Called by | Note |
|---|---|---|
| `submit_venue_verification(payload)` (RPC) | Venue onboarding wizard, Review and submit step (PRD-03 FR-1 through FR-6) | `SECURITY DEFINER`, mirrors `submit_coach_verification`: grants `court_partner`, creates the `venues` row (`status='pending'`), its `courts`, optional `venue_photos`, and a `verification_requests` row (`applicant_type='venue'`), atomically. The only path that can ever create a venue; the plain `venues` RLS insert policy requires `has_role('court_partner')` already true and exists only for a partner's later, already-verified additional venue |
| `accept_venue_staff_invite(venue_staff_id)` (RPC) | Staff invite acceptance link (PRD-03 FR-28) | `SECURITY DEFINER`, sets `accepted_at`; a trigger on that same update grants the `court_staff` role, matching `SCHEMA.md`'s `venue_staff` note |
| `court_booking_check_in(booking_id)` (RPC) | Today dashboard check-in action (PRD-03 FR-16) | Not a status transition (`court_bookings.status` stays `confirmed`), sets `checked_in_at`; venue partner/staff only |
| `get_court_available_slots(court_id, date)` (RPC) | Consumer app `SlotPicker`, portal-court walk-in form's slot picker | Read only, `SECURITY DEFINER`. Availability windows minus blackouts minus non-cancelled bookings for one date, with the peak-adjusted price per slot; complements `get_court_busy_slots` above (that one returns occupied pairs over a range for the court detail/calendar read, this one returns the actual bookable list for one date) |

### `apps/portal-court/src/app/onboarding/*` (PRD-03 FR-1 through FR-7)

Client wiring lives in `apps/portal-court/src/lib/onboarding.ts`, one typed module per FR rather than `.rpc()`/`.from()` calls scattered across the wizard's step pages (`venue-details`, `courts`, `photos`, `review`, `pending`).

| Screen | Call | Note |
|---|---|---|
| `venue-details`, `courts` steps | `submit_venue_verification(payload)` (RPC), called at the end of the **Courts** step, not "Review and submit" | The wizard's prose order in PRD-03 3.1 puts Photos before Courts before Review; the actual call order here is Venue details -> Courts (submits) -> Photos -> Review (read only), because the Photos step (FR-3) uploads to the `venue-media` bucket, whose RLS (`0014_venue_media_bucket.sql`) requires an already-existing, partner-owned venue at `{venue_id}/...`. There is no draft-venue storage path, so the venue must exist before any photo can upload. The end state matches PRD-03's acceptance criterion (venue + >=1 court + >=3 photos + one `verification_requests` row) regardless of call order |
| `photos` step | `venue_photos` insert (PostgREST), `venue-media` storage upload | Both already RLS-scoped to the caller's own venue (`venue_photos_insert_own`, `venue_media_partner_insert`); no new policy needed |
| `pending` step (FR-6, status + rejection reason) | `venues` select (PostgREST), latest row by `created_at` | Reads `venues.status`/`venues.rejection_reason` directly, not `verification_requests`: `0003_moderation_audit.sql` ships no authenticated select/insert policy for `applicant_type = 'venue'` (only a `'coach'`-scoped one), so a non-admin caller cannot read that table for their own venue at all. `venues_select_own` already carries everything FR-6 needs |
| `pending` step, "Edit and resubmit" (FR-6) | `submit_venue_verification(payload)` again, with the draft prefilled from the rejected venue's current fields/courts | **Known gap, not a new migration**: there is no RPC that updates a rejected venue in place or flips its `status` back to `pending_review` for a non-admin caller (`status`/`rejection_reason` are locked to the admin verification RPCs by `lock_venue_admin_fields`, and `submit_venue_verification` always inserts a brand new `venues` row, it has no "existing venue id" input). "Edit and resubmit" therefore creates a second, fresh venue + verification request; the original rejected venue row is left in place, unreferenced by any onboarding route going forward. If the founder wants true same-row resubmission, that needs a new `resubmit_venue_verification(venue_id, payload)` RPC, flagged here rather than added speculatively |
| `dashboard/layout.tsx` gate (FR-7) | `venues` select (`status = 'verified'`), `venue_staff` select (`accepted_at is not null`) | Not part of `onboarding/*` itself, but the enforcement point for FR-7: any authenticated partner with zero verified venues and no accepted staff membership is redirected to `/onboarding` before any `/dashboard/*` page renders |

## shop

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `products` | GET `/products` | PostgREST | `products` select joined `product_variants`, `recommended_rank` field for the rail | RLS public read, `active = true` |
| `product` | GET `/products/:id` | PostgREST | `products` select single | `404` from PostgREST's `.single()` no-row error |
| `getCart` | GET `/cart` | PostgREST | `cart_items` select joined `product_variants` | RLS `user_id = auth.uid()` |
| `addToCart` | POST `/cart/items` | RPC | `add_to_cart(variant_id, qty)` | server re-checks live stock before upsert, raises `OUT_OF_STOCK` and caps rather than silently rounding, per PRD-07 FR-9 |
| `updateCartItem` | PATCH `/cart/items/:productId` | RPC | `update_cart_item(variant_id, qty)` | same stock re-check as `addToCart` |
| `removeCartItem` | DELETE `/cart/items/:productId` | PostgREST | `cart_items` delete | own-row RLS, no stock check needed on removal |
| `checkout` | POST `/orders/checkout` | Edge Function | `checkout` | re-fetches prices and stock for every line, recomputes the bill, rejects `PRICE_MISMATCH` or `OUT_OF_STOCK`, decrements stock and creates the `orders`/`order_items` rows atomically on Razorpay success (via `razorpay-webhook`) |
| `orders` | GET `/orders` | PostgREST | `orders` select | RLS `user_id = auth.uid()` |
| `order` | GET `/orders/:id` | PostgREST | `orders` select single joined `order_items`, `order_timeline` | same RLS |
| addresses | GET/POST `/me/addresses` | PostgREST | `addresses` select / insert | `PINCODE_INVALID` raised by a `BEFORE INSERT` trigger validating the `CHECK` pattern, caught and mapped client side |

## wishlist (gear)

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `toggle` | PUT `/wishlist/:productId` | RPC | `toggle_product_wishlist(product_id)` | atomic toggle (insert-or-delete in one statement), avoids a read-then-write race the client could otherwise introduce |
| `list` | GET `/wishlist` | PostgREST | `product_wishlist_items` select joined `products` | RLS `user_id = auth.uid()` |

## clutch

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `feed` | GET `/clutch/feed` | PostgREST | `clips` select, `status = 'published'`, keyset pagination on `created_at` | RLS public read restricted to `published`; owner can additionally read their own clip in any status |
| `get` | GET `/clutch/:id` | PostgREST | `clips` select single | same RLS |
| `comments` | GET `/clutch/:id/comments` | PostgREST | `clip_comments` select, keyset pagination | RLS public read |
| `addComment` | POST `/clutch/:id/comments` | PostgREST | `clip_comments` insert | RLS requires a non-anonymous `auth.uid()`, guest insert rejected, mapped to `403 GUEST` |
| `upload` | POST `/clutch` (multipart) | Edge Function + PostgREST | `stream-upload-url` then `clips` insert (`status='uploading'`) | see `VIDEO.md` for the full tus handoff; the edge function only mints the one-time upload URL, the row insert is a normal own-row PostgREST write |
| `creator` | GET `/clutch/creators/:id` | PostgREST | `users` select joined aggregate `clips`/`follows` counts (a Postgres view `creator_stats`) | public read |
| `like` | PUT `/clutch/:id/like` | RPC | `toggle_clip_like(clip_id)` | atomic toggle, maintains `clips.likes_count` via the same transaction; `403 GUEST` if anonymous |
| `follow` | PUT `/clutch/creators/:id/follow` | RPC | `toggle_follow(followee_id)` | atomic toggle; `403 GUEST` if anonymous |

## empower

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `upas` | GET `/empower/upas` | PostgREST + RPC | `upa_applications` select (`status='verified'`) + `get_empower_stats()` | stats RPC sums `ledger_entries` for `account_type='upa_fund'`, never a cached counter, per PRD-06 FR-3 |
| `upa` | GET `/empower/upas/:id` | PostgREST | `upa_applications` select single, `status='verified'` only | RLS makes an unverified id unresolvable regardless of how it was obtained (PRD-06 requirement) |
| `donate` | POST `/empower/donate` | Edge Function | `donate` | validates the target UPA is still verified and the item not already funded at request time (independent of client cache), re-prices, writes `payment_intents` + `donations` + `ledger_entries` + `upa_wishlist_items.funded_amount` atomically |
| `myImpact` | GET `/empower/impact` | PostgREST + RPC | `donations` select (own) + `get_my_impact_summary()` | summary RPC reads `ledger_entries`/`donations` scoped to `auth.uid()`, never a client-side sum of a possibly-stale local list |

## wallet / notifs / help

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `coachWallet` | GET `/wallet` | RPC | `get_coach_wallet_balance()` | sums `ledger_entries` for `account_type='coach', account_ref=auth.uid()`; `403 NOT_COACH` if no coach role |
| `transactions` | GET `/transactions` | RPC | `get_my_transactions(kind?)` | unions sessions, court_bookings, orders, and donations into one reverse-chronological feed shaped like v1's `Transaction`; a plain PostgREST select cannot do this because it spans four source tables |
| `notifs.list` | GET `/notifications` | PostgREST | `notifications` select | RLS `user_id = auth.uid()` |
| `notifs.markRead` | POST `/notifications/:id/read` | PostgREST | `notifications` update, sets `read_at` | own-row RLS |
| `help.submitTicket` | POST `/support/tickets` | PostgREST | `support_tickets` insert | own-row RLS, returned row id is the v1 `ticketId` |

## Edge functions not in the v1 contract

PLAN.md's edge function roster includes several functions v1 never had a mock for, because v1 had no real payments or video pipeline. They exist to back the coach, court partner, and admin surfaces (PRD-02, PRD-03, PRD-04) and the payment/video internals every v1 endpoint above ultimately calls into.

| Function | Called by | Note |
|---|---|---|
| `razorpay-create-order` | `book-session`, `book-court`, `checkout`, `donate` (each calls this internally, not exposed as its own client-facing endpoint) | single shared helper that creates the Razorpay order with `notes: {domain, entity_id}`, see `PAYMENTS.md` |
| `razorpay-webhook` | Razorpay servers, not a client | confirms payment/capture, writes `ledger_entries`, advances the domain entity out of its "awaiting payment" implicit state |
| `razorpay-route-onboard` | coach Payout Account Setup, `portal-court` Payout Account | starts Route linked-account KYC hand-off. Built AT-42. `POST { owner_type: 'coach' \| 'court_partner', venue_id? }` with the caller's own JWT (`verify_jwt` true), `venue_id` required for `court_partner`. Returns `{ payout_account_id, owner_type, owner_id, razorpay_account_id, status, onboarding_url, created }`. Errors `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `RAZORPAY_ERROR` 502, `ROUTE_UNAVAILABLE` 503, `INTERNAL` 500. Idempotent on `(owner_type, owner_id)`: an existing `razorpay_account_id` makes the call a status poll (`created: false`), never a second sub-merchant. Sole writer of `payout_accounts`, service role only. Route is not yet enabled on the test merchant account, see `PAYMENTS.md` |
| `razorpay-route-transfer` | coach Transfer screen, admin never | creates a Route transfer, writes `transfers` + a balancing `ledger_entries` group |
| `stream-webhook` | Cloudflare Stream, not a client | flips a clip from `processing` to `ready` when transcode completes, see `VIDEO.md` |
| `notify-dispatch` | every RPC/edge function that writes a `notifications` row, fan-out to device push | PRD-07's surface, consumed as a given elsewhere |
| `admin-order-advance` | `apps/admin` Order Detail | the only path that can move `orders.status` forward, writes `order_timeline` + `audit_log` |
| `admin-order-refund` | `apps/admin` Order Detail refund action | new function beyond PLAN.md's original list (see PRD-04 open question 2), calls Razorpay refund API, writes `ledger_entries` |
| `admin_approve_verification_request` (RPC, not an edge function) | `apps/admin` Verification Detail approve action | `SECURITY DEFINER` RPC (`supabase/migrations/0007_admin_verification_rpcs.sql`), not an edge function, since it needs no third-party call, just an atomic multi-table write under elevated privilege: admin/moderator only (`has_role`), sets `verification_requests.status='approved'`, mirrors onto `coach_profiles.status` for `applicant_type='coach'` (venue/upa branches are no-ops until those tables exist), writes exactly one `audit_log` row. Exists because `audit_log` carries no `authenticated` write policy at all (`RLS.md`), so the admin client cannot write it directly; PRD-04 FR-9/FR-53 |
| `admin_reject_verification_request` (RPC) | `apps/admin` Verification Detail reject action | same shape as above, requires a non-empty `p_reason`, sets `status='rejected'` + `rejection_reason`, mirrors `coach_profiles.status='rejected'`; PRD-04 FR-10/FR-53. Applicant notification (FR-10) is deferred to when `notify-dispatch` exists, the reason is still recorded in `audit_log` |
