# PRD-03: Court Partner Web Portal

**App:** `apps/portal-court` (Next.js + shadcn/ui)
**Status:** Draft for P0 founder review
**Depends on:** courts schema domain, payments schema domain, identity/roles schema domain, moderation/audit schema domain

---

## 1. Purpose and stakeholder definition

Court partners are venue owners who list one or more sports venues (box cricket grounds, badminton courts, turf, tennis courts) on Atlitos and take bookings from athletes through the consumer app. Today these owners run their business on WhatsApp, phone calls, and a paper or Excel register. The portal replaces that register with a single web dashboard they can run from a laptop at the front desk or a phone browser while standing at the gate.

**Primary persona:** a Hyderabad box cricket or badminton venue owner or manager, moderate technical comfort, needs the day to run itself without calling a developer. Cares about three things: does today's schedule match what is actually happening at the gate, is the money right, and can a new customer be turned away or let in fast.

**Secondary persona:** venue staff at the front desk who only need check in and walk in tools, not the business setup screens.

**Out of persona:** athletes booking courts (that is the consumer app, PRD-02), Atlitos admin staff who verify venues (that is the admin portal, PRD-06).

The portal is the only place venue data, slot inventory, pricing rules, and payout details are authored. The consumer app only reads what the portal publishes.

## 2. Jobs to be done

1. When I want to start taking bookings on Atlitos, I want to list my venue and courts with accurate details so athletes can find and trust it.
2. When I set my pricing and hours, I want control over when courts are open and what they cost at different times so my inventory matches reality and peak hours earn more.
3. When today happens, I want a live view of who is booked, who has shown up, and who has not, so I can run the gate without checking my phone constantly.
4. When someone walks in without a booking, I want to record that booking on the spot so my inventory and earnings stay accurate.
5. When a booking falls through, I want to cancel or note a no show quickly so the slot and the record are both correct.
6. When the week or month ends, I want to see what I earned and confirm the payout landed so I know the business is healthy.
7. When athletes rate their visit, I want to see the ratings so I know if service is slipping.

## 3. Surfaces and screens

Every screen ships four states: loading, empty, populated, error. Money surfaces additionally always render `BillSummary`.

### 3.1 Auth and onboarding
- **Sign up / Sign in** (`/signin`, `/signup`): email or phone plus password, Supabase Auth. States: form, submitting, error (invalid credentials, account exists).
- **Venue onboarding wizard** (`/onboarding/[step]`): steps are Venue details (name, address, city, pincode, geolocation), Photos (upload, min 3 max 12), Courts (add one or more courts, each with sport, surface, capacity), Sports offered, Bank and payout details, Review and submit. States: step form, validation error, submitting, submitted (pending verification).
- **Pending verification** (`/onboarding/pending`): shown after submit until admin approves. States: pending, rejected (with admin's reason and a re-edit path), approved (redirects to dashboard).

### 3.2 Dashboard shell
- **Sidebar dashboard** (all authenticated routes): venue switcher if the partner owns more than one venue, nav to Today, Inventory, Bookings, Earnings, Ratings, Settings.

### 3.3 Today (live day-of operations)
- **Today dashboard** (`/today`): default landing screen once verified. Live list of today's bookings across all courts at the venue, grouped by court then time, updating via Supabase Realtime as new bookings, cancellations, or check ins occur. Each booking row shows athlete name, sport, time slot, court, status (upcoming, checked in, completed, cancelled, no show, walk in). States: loading skeleton, empty ("No bookings today yet"), populated, error (with retry, and a manual refresh fallback if realtime disconnects).
- **Check in a booking**: inline action on a booking row, one tap or click, confirms and timestamps arrival.
- **Record a walk in** (`/today/walk-in`): quick form, pick court, pick an available slot right now or the next available, enter athlete name and phone (optional), price defaults to the current pricing rule and is editable only with a reason logged. Confirms and adds to today's list as a walk in booking. Shows `BillSummary` before confirming.
- **Cancel a booking** (inline action, confirmation dialog): requires a reason (athlete no show, venue issue, weather, other), releases the slot back to inventory, records the cancellation in the audit log.
- **Booking detail** (`/today/booking/[id]`): full detail, athlete contact, payment status, court, price breakdown via `BillSummary`, action buttons appropriate to current state.

### 3.4 Inventory management
- **Venue and courts** (`/inventory/venue`): edit venue details and photos, add or remove courts, mark a court active or inactive. States: view, edit, saving, error.
- **Availability windows** (`/inventory/availability`): set weekly recurring open hours per court (day of week, open time, close time), and slot duration (default 60 minutes). States: view, edit, saving, conflict error (overlapping windows).
- **Blackouts** (`/inventory/blackouts`): block specific dates or date ranges per court (maintenance, private event, holiday), with a reason. List of upcoming blackouts, add and remove.
- **Pricing rules** (`/inventory/pricing`): base price per hour per court, plus peak pricing rules (day of week and time range multiplier or fixed override, e.g. weekend evenings). List of active rules, add, edit, deactivate. States: view, edit, saving, validation error (overlapping peak rules on same court).

### 3.5 Bookings (history and search)
- **All bookings** (`/bookings`): searchable, filterable (by court, date range, status) table of past and future bookings, beyond just today. States: loading, empty, populated with pagination, error.

### 3.6 Earnings and payouts
- **Earnings overview** (`/earnings`): this month total, last payout amount and date, pending balance, chart of earnings over time (JetBrains Mono numerics, tabular figures). `BillSummary` style breakdown of gross bookings, platform fee, net payable.
- **Payout account** (`/earnings/payout-account`): view and edit the linked payout account (bank details via Razorpay Route sub-merchant), verification status of the account. States: not linked (CTA to link), pending verification, verified, error.
- **Transfer history** (`/earnings/transfers`): list of past transfers (payout runs) with date, amount, status (processing, paid, failed), reference id. States: loading, empty, populated, error.

### 3.7 Ratings
- **Ratings** (`/ratings`): average rating, rating distribution, list of recent reviews with athlete first name, star rating, remarks, date and which booking it is tied to. Read only. States: loading, empty ("No ratings yet"), populated, error.

### 3.8 Settings
- **Account settings** (`/settings`): partner profile, staff access (invite a staff member with a restricted role limited to Today and check in/walk in only), notification preferences, logout.

## 4. Functional requirements

**Onboarding and verification**
- FR-1: A new partner can create an account with email or phone and password via Supabase Auth.
- FR-2: A partner can submit venue details (name, address, city, pincode, latitude and longitude, description) as a draft before verification.
- FR-3: A partner can upload a minimum of 3 and maximum of 12 venue photos during onboarding, stored in Supabase Storage.
- FR-4: A partner can add one or more courts to a venue, each with a sport, name or label, and capacity, before submitting for verification.
- FR-5: A partner can submit venue and court details for admin verification; the venue enters `pending` status and is not visible to athletes until an admin approves it.
- FR-6: A partner sees their venue's current verification status (pending, verified, rejected) at all times; if rejected, the admin's reason is shown and the partner can edit and resubmit.
- FR-7: A partner cannot access Today, Inventory (beyond the draft they are editing), Earnings, or Bookings screens until their venue is verified.

**Inventory: availability, blackouts, pricing**
- FR-8: A partner can define recurring weekly availability windows per court (day of week, open time, close time, slot duration).
- FR-9: A partner can add and remove blackout dates or date ranges per court with a reason; blackout dates are excluded from bookable slot generation.
- FR-10: A partner can set a base hourly price per court.
- FR-11: A partner can define one or more peak pricing rules per court (day of week range, time range, and either a multiplier or a fixed override price); overlapping peak rules on the same court and overlapping time window are rejected with a validation error at save time.
- FR-12: A partner can mark a court active or inactive; inactive courts stop generating new bookable slots but keep existing bookings intact.
- FR-13: Slot inventory is derived, never hand entered per date; changing an availability window or pricing rule only affects future, not-yet-booked slots.

**Today, day-of operations**
- FR-14: The Today dashboard shows all bookings for the venue's courts for the current date, grouped by court, ordered by time.
- FR-15: The Today dashboard updates in real time (Supabase Realtime) when a new booking, cancellation, check in, or walk in occurs, without a manual page refresh.
- FR-16: A partner or staff member can check in a booking with one action; check in records a timestamp and changes booking status to checked in.
- FR-17: A partner or staff member can record a walk in booking for an available slot on any active court, entering at minimum the sport, court, time slot, and price (defaulting to the current pricing rule); the walk in immediately occupies that slot and blocks it from further booking.
- FR-18: A partner or staff member can cancel a booking from the Today view or booking detail; cancellation requires selecting a reason and immediately releases the slot back to bookable inventory (unless the slot's start time has already passed, in which case it becomes a no show record instead).
- FR-19: A partner or staff member can mark a past, un-checked-in booking as a no show; a no show does not release the slot for the current date (it has passed) but is recorded distinctly from a partner cancellation for reporting.
- FR-20: Booking detail shows the full price breakdown via `BillSummary` and current payment status (paid, refunded, pending) sourced from the payments ledger.

**Bookings history**
- FR-21: A partner can search and filter all bookings (past and future) for their venue by court, date range, and status.

**Earnings and payouts**
- FR-22: A partner can view an earnings summary: gross booking value, platform fee deducted, net payable, for the current month and prior months.
- FR-23: A partner can link a payout account (bank account details submitted through the Razorpay Route sub-merchant onboarding flow, launched from the portal but completed on Razorpay's hosted pages).
- FR-24: A partner can view their payout account's verification status (not linked, pending, verified, failed) and re-attempt linking if failed.
- FR-25: A partner can view a history of transfers (payout runs) including amount, status, and reference id; transfer records are written only by the `razorpay-route-transfer` edge function, never by the client.
- FR-26: A partner cannot edit or create any ledger entry, payment intent, or transfer record directly; all money state is read only in the portal.

**Ratings**
- FR-27: A partner can view their venue's average rating and a list of individual ratings and remarks left by athletes after completed bookings.

**Staff access**
- FR-28: A partner can invite a staff member by email who, once accepted, can access only Today (view, check in, walk in, cancel) and cannot access Inventory, Earnings, Settings, or payout details.

## 5. Data touched

Table names reference the schema domains defined in PLAN.md; exact table names are finalized in the migration but domains and read/write intent are locked here.

| Domain | Tables (representative) | Read | Write |
|---|---|---|---|
| identity/roles | users, user_roles | Read | Write (self profile only, staff invite creates a scoped user_role) |
| courts | venues, courts, court_availability_windows, court_blackouts, court_pricing_rules, court_bookings | Read | Write (venue, courts, availability, blackouts, pricing rules all owned by the partner; bookable slots are read only, derived at read time per SCHEMA.md, not a separate table; check in is a `checked_in_at` write on `court_bookings`, not a separate checkins table) |
| courts (bookings) | court_bookings | Read | Write limited to status transitions (checked_in, cancelled, no_show via RPC, never a direct row update) |
| payments | payment_intents, ledger_entries, payout_accounts, transfers, fee_config | Read | Write limited to payout_accounts creation request (the actual verification write is server side via edge function); ledger_entries and transfers are read only |
| moderation/audit | verification_requests, audit_log | Read (own venue's verification_requests) | Write (submit a verification_request on onboarding submit and resubmit; audit_log entries written server side on every cancellation, walk in, and no show) |
| ratings (part of courts or a shared ratings table per SCHEMA.md) | court_ratings | Read | none (ratings are athlete-authored only) |

## 6. Payment touchpoints

The court partner portal never collects money directly from athletes; athlete payment happens in the consumer app via Razorpay checkout and the `book-court` edge function. The portal's payment touchpoints are entirely about the partner receiving money and are all read paths except the payout account link action:

- Every screen that shows a price (Today booking rows, booking detail, walk in form, earnings overview) renders the shared `BillSummary` pattern showing subtotal, platform fee, and net or total as applicable.
- Walk in booking creation calls the `book-court` edge function (or a partner scoped equivalent) so the same server side re-pricing and ledger write path is used for walk ins as for athlete self service bookings; the portal never writes a payment_intent or ledger_entries row directly.
- Payout account linking calls `razorpay-route-onboard`; the portal only stores the returned account reference and status, never bank credentials.
- Transfers are written exclusively by `razorpay-route-transfer`; the portal is read only on the transfers table.
- All money writes are server side (edge functions with service role); client side Supabase calls from the portal are read only or RPC calls to non-money state machines (check in, cancel with reason, no show).

## 7. Acceptance criteria per journey

**Journey: Partner onboarding and verification**
- Given a new partner with no account, when they sign up and complete the onboarding wizard with venue details, at least 3 photos, and at least 1 court, then a verification_request is created and the venue status shows pending.
- Given a venue in pending status, when an admin approves it, then the partner's dashboard unlocks Today, Inventory, Earnings, Bookings, and Ratings, and the venue becomes visible in the consumer app.
- Given a venue in pending status, when an admin rejects it with a reason, then the partner sees the rejection reason on `/onboarding/pending` and can edit and resubmit.

**Journey: Setting up inventory**
- Given a verified venue with one court, when the partner sets a weekly availability window (e.g. Monday to Sunday, 6am to 11pm, 60 minute slots) and a base price, then bookable slots for that court appear correctly windowed in the consumer app for future dates.
- Given an existing availability window, when the partner adds a peak pricing rule for Saturday and Sunday 6pm to 10pm at 1.5x, then a slot booked in that window shows the peak price in `BillSummary`, and a slot outside that window shows the base price.
- Given an availability window, when the partner adds a blackout for a specific date, then no bookable slots exist for that court on that date, and any existing confirmed booking on that date is unaffected but flagged for the partner to handle manually.

**Journey: Live day-of operations**
- Given a venue with 3 bookings today across 2 courts, when the partner opens Today, then all 3 bookings appear grouped by court and ordered by time within 2 seconds of page load.
- Given the Today dashboard is open, when an athlete completes a new booking from the consumer app, then the new booking appears on the partner's Today dashboard without a manual refresh, within 5 seconds.
- Given a booking scheduled for the current time, when the partner taps check in, then the booking status changes to checked in and shows a check in timestamp, visible immediately without refresh.
- Given an available slot on an active court today, when the partner records a walk in with sport, court, time, and price, then the walk in appears on Today marked as a walk in, the slot is no longer available for booking in the consumer app, and a ledger entry is created via the booking edge function.
- Given a confirmed upcoming booking today, when the partner cancels it with a reason, then the booking status changes to cancelled, the slot becomes bookable again in the consumer app, and the cancellation with reason appears in the audit log.
- Given a booking whose time has passed with no check in, when the partner marks it a no show, then the booking status changes to no_show and it is excluded from future available slot counts for that date (already past) and reported separately from cancellations in Bookings history.

**Journey: Earnings and payout**
- Given a venue with completed bookings this month, when the partner opens Earnings, then gross value, platform fee, and net payable reconcile against the sum of ledger_entries for that venue and month.
- Given no payout account linked, when the partner starts the payout account link flow, then they are redirected to the Razorpay Route onboarding pages and, on return, the portal shows pending verification status.
- Given a completed transfer run, when the partner opens Transfer history, then the transfer appears with correct amount, status, and reference id matching the transfers table, and the row cannot be edited or deleted from the portal.

**Journey: Ratings**
- Given a completed and rated booking, when the partner opens Ratings, then the rating and remarks appear attributed to the correct booking and date, and the venue average recalculates to include it.

**Journey: Staff access**
- Given a partner invites a staff member, when the staff member accepts and signs in, then they see only the Today screen and check in and walk in actions, with no access to Inventory, Earnings, Settings, or payout account screens (verified by direct URL attempt returning a forbidden state, not just hidden navigation).

## 8. Explicitly out of scope

- Multi-venue analytics or cross-venue comparison dashboards (single venue at a time; venue switcher exists but no aggregate rollup view in v2).
- Dynamic or automated pricing (surge pricing based on demand) beyond partner-authored peak rules; no machine-driven pricing.
- Partner-initiated refunds outside a cancellation reason flow; refund amounts and eligibility rules are server side policy, not a portal action.
- Partner messaging or chat with athletes from the portal (chat exists in the consumer app between athlete and coach only, per PLAN.md schema domains; no court partner chat surface in v2).
- Court partner matchmaking or lead generation to acquire new venues (explicitly out of scope per v1 SPEC section 2, carried forward).
- QR entry or passbook check in (explicitly out of scope per v1 SPEC section 2, carried forward); check in in v2 is a manual tap by staff, not a scan.
- Native mobile app for partners; the portal is a responsive web app usable in a phone browser, not a packaged app.
- Partner-side coupon, discount code, or promotional pricing tools.
- Bulk import of historical bookings or a data migration tool for partners switching from spreadsheets.
- Automated no show detection (no show is a manual staff action in v2, not a timer-based auto transition).
- Partner analytics beyond earnings and ratings (no funnel, no repeat customer rate, no demand heatmap in v2).

## 9. Open questions for the founder

1. Should staff invites support more than one restricted role (e.g. a manager role with Inventory access but not Earnings), or is the single Today-only staff role sufficient for v2.
2. When a blackout is added over a date with an existing confirmed booking, should the portal block the blackout entirely, or allow it and require the partner to manually cancel the conflicting booking (current draft assumes the latter, flagged for partner action).
3. What is the cancellation window policy for partner-initiated cancellations relative to athlete refund eligibility (does a partner cancellation always trigger a full athlete refund, or does fee_config define partial refund tiers).
4. Should the portal show athlete contact details (phone) on bookings by default, or only after check in, for privacy reasons.
5. Is a minimum photo count of 3 and max of 12 correct for the Hyderabad box cricket and badminton segment, or should this be lower for a fast v2 launch given many venues will onboard with a phone camera on site.
6. Should multi-venue partners (one owner, several grounds) be common enough in the initial partner cohort to prioritize the venue switcher polish, or is single venue per partner account the realistic P2 demo scenario.
