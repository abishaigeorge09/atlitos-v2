# PRD-01: Athlete (Player) Consumer App

Status: Draft for founder review at P0 gate
Owner surface: `apps/mobile` (Expo), athlete/player role and guest role
Depends on: identity/roles, coaching, courts, commerce, clutch, empower, learn, chat, notifications, payments, moderation/audit schema domains (PLAN.md)
Companion PRDs (out of scope here, referenced not duplicated): PRD-02 coach, PRD-03 court partner, PRD-04 admin, PRD-05 Atlitos Life (UPA applicant portal, verification and wishlist authoring), PRD-06 sponsor and donor surfaces (Empower, in this consumer app), PRD-07 shopper (native commerce, in this consumer app)

---

## 1. Purpose and stakeholder definition

Atlitos exists to give Indian athletes one place to get better, get seen, and get equipped: find and book a coach, book a court, buy gear, post and watch sports clips, track training progress, and fund another athlete who cannot afford to play. This PRD defines the primary stakeholder's experience end to end: the **athlete (player)**, including the **guest** who has not yet registered.

**Primary stakeholder: Athlete/player.** A student or amateur sportsperson, mobile-first, price-sensitive, motivated by visible progress (stats, milestones, XP) and by belonging to a sport community (Clutch, follows). Wants low-friction booking and buying, and trusts the platform to hold real money correctly.

**Secondary stakeholder inside this surface: Guest.** Anonymous visitor who can browse Home, Clutch, and Courts read-only, and hits a login gate the moment they try to act (book, buy, like, comment, follow, donate, upload). Guest exists to let curiosity convert to registration without a hard wall on first open.

**Adjacent stakeholders this app talks to but does not manage** (each has its own PRD and its own portal): the coach (receives session requests raised here, manages them in the coach experience), the court partner (manages inventory in `portal-court`), the UPA/donee (managed and verified in `portal-life` / admin), the platform admin (order lifecycle, moderation, verification in `admin`). Where this PRD's flows write data a coach, partner, or admin later reads, that boundary is called out explicitly in section 8.

**Roles in scope for this PRD's screens:** `guest`, `player`. A user with the `coach` role also has a player-facing account, but coach-mode screens (Trainees, Coach Earnings, Coach Stats) are PRD-02's ceiling, not this one's.

---

## 2. Jobs to be done

1. When I open the app for the first time, I want to see real content before I commit to signing up, so I can decide if this is for me.
2. When I want to get better at my sport, I want to find and book a coach who fits my sport, price, and schedule, so I can start training without back-and-forth calls.
3. When I want to play, I want to find and book a nearby court for a specific time slot, so I show up and it just works.
4. When I need gear, I want to search, compare, and buy it inside the app I already trust, so I do not leave for another store.
5. When I train or play, I want to post and watch short clips of the action, so I build a visible record of my game and my community sees it.
6. When I am mid-search and do not know exactly what I want, I want to describe it in plain language ("badminton racket under 1500 near me") and get ranked results across gear, coaches, and courts, so I do not have to know which tab to open.
7. When I train consistently, I want to see my progress as drills completed, a roadmap, and XP, so effort feels visible and worth continuing.
8. When I hear about an athlete who cannot afford to play, I want to fund their specific need directly or round up my own purchase, so my money has a visible destination and outcome.
9. When I have a question for my coach or need to coordinate a session, I want to message them in-app, so everything about my training stays in one place.
10. When something happens to my bookings, orders, or clips, I want to be notified, so I never miss a confirmation, a reschedule, or a reply.
11. When I am a guest and try to do something that requires an account, I want a clear, fast path to register without losing what I was doing, so the interruption feels earned, not punishing.
12. When I manage my account, I want to see my orders, bookings, wishlist, impact, and payment history in one place, so I do not have to hunt across the app to know where my money and time went.

---

## 3. Surfaces and screens

All screens ship exactly 4 states unless noted: **loading** (skeleton, never a bare spinner), **empty**, **populated**, **error**. Guest-visible screens additionally carry an implicit fifth state: **gated** (populated content shown, mutating control replaced or intercepted by `LoginGateSheet`).

Bottom tab bar (persistent, both guest and player): **Home, Trainings, Clutch, Courts**. Learn and Shop have no tab; both are entered from Home. Trainings tab is role-aware: guest sees a locked preview state ("Set up your profile to train"), player sees the full dashboard.

### 3.1 Auth and onboarding (player-facing slice)

| Screen | States | Notes |
|---|---|---|
| Splash | loading only (auto-route) | Routes by session: authenticated to Home, guest-continued to Home, neither to Login |
| Login | populated, error (invalid credentials), submitting | Email/phone + password, forgot-password link, register link, "Continue as guest" link |
| Register | populated, error (field validation, email/phone taken), submitting | Name, email, phone, DOB, password x2, on success opens Role select |
| Forgot password / OTP / Reset password | populated, error (OTP invalid/expired, rate limited), submitting | 6-box OTP, resend timer |
| Role select | populated | Player or Coach. This PRD only continues the Player branch |
| Player setup wizard | populated, error (validation per step), submitting | Sport(s) multi-select, avatar photo, city/state, on success routes to Home |

### 3.2 Home and discovery

| Screen | States | Notes |
|---|---|---|
| Home | loading, empty (new user, all sections show their own empty state, never a blank page), populated, error | AppBar (wordmark, notification bell with unread dot, avatar), SearchBar (AI variant), LocationBar, sport category chips, ad banner carousel, Clutch preview rail, "Support an athlete" empower rail (2 cards + View all), Shop entry, Learn entry. Identical layout for guest and player; mutating taps gate |
| Location / city picker | populated | Manual override of detected/default location |
| AI Search home | populated | NL input, recent searches (player only, empty for guest), trending chips |
| AI Search results | loading ("Finding the best match near you"), empty (broaden suggestion, e.g. "Try removing evening"), populated, error | Segmented Gear / Coaches / Courts when results are mixed; each result card carries a `rankReason` tag |

### 3.3 Trainings (player)

| Screen | States | Notes |
|---|---|---|
| Trainings dashboard (Stats) | loading, empty (0 sessions: CTA to find a coach), populated, error | StatTiles (total sessions, this month, hours, payments done), my sports + add sport, upcoming SessionCards, milestones row |
| Coach discovery list | loading, empty (no coaches match filters), populated, error | Filters: sport, price, rating, distance |
| Coach profile | loading, populated, error (not found) | Rating, experience, specialization, session types, tiered pricing, availability preview, Book session + Message coach |
| Book session: type + frequency | populated, error (nothing selected) | Session type, One time / Weekly / Monthly |
| Book session: date | populated | Calendar, past dates disabled |
| Book session: slot | loading (availability fetch), empty (no slots that day), populated, error | Respects coach's availability windows and existing bookings |
| Book session: pay | populated, error (price mismatch, payment failed) | BillSummary: price x frequency multiplier + platform fee = total |
| Book session: confirmation | populated | Success state, "View booking" / "Explore more" |
| Session detail | loading, populated, error | Cancel / Reschedule / Rate, mirrors Courts booking lifecycle exactly |
| Sessions list | loading, empty, populated, error | Filters: All, 1 on 1, Group, Online |
| Payments (player ledger) | loading, empty, populated, error | Total spent tiles, TransactionRows across sessions, gear, courts, donations |
| Chat (Trainings entry) | loading, empty (no threads), populated, error | Thread list scoped to coaches the player has booked or messaged |
| Analytics (player) | loading, empty (no sessions yet), populated, error | Token-styled progress views of session counts and hours from real data. No AI narrative in this PRD |

### 3.4 Clutch

| Screen | States | Notes |
|---|---|---|
| Feed | loading, empty (no clips available), populated, error | Vertical full-screen video feed, like/comment/share rail, follow affordance on creator tag |
| Post detail + comments | loading, empty (no comments), populated, error | Comments sheet, add comment (gated for guest) |
| Upload | populated, error (upload failed, unsupported format, too large), uploading (progress) | Camera or gallery pick, in/out trim (metadata only), caption + sport tag, post. Player only, hard-gated for guest |
| Creator profile | loading, populated, error | Avatar, bio, clip grid, follower count, Follow/Unfollow (gated for guest) |
| Own social profile | loading, empty (no clips/milestones yet), populated, error | Reuses Creator profile layout for self; edit entry point to Account |

### 3.5 Courts (flows locked from v1, visuals rebuilt, backend real)

| Screen | States | Notes |
|---|---|---|
| Sport select + court list | loading, empty (no courts near this location), populated, error | Sport chips, search by location |
| Court detail | loading, populated, error | Date + slot select, busy slots disabled |
| Book: pay | populated, error (price mismatch, slot taken, payment failed) | BillSummary: subtotal + GST + platform fee = total |
| Booking detail | loading, populated, error | Cancel to cancelled; Reschedule to rescheduled; Rate to review success. Identical machine to Sessions |

### 3.6 Shop (entered from Home)

| Screen | States | Notes |
|---|---|---|
| Category listing | loading, empty (out of stock category), populated, error | "Recommended" rail, in-category search |
| Product detail (PDP) | loading, populated, error (out of stock variant) | Gallery, variant/size select, Add to cart, wishlist heart |
| Cart | loading, empty, populated, error | Qty stepper per line, subtotal, "Proceed to buy" |
| Checkout: address | populated, error (no address, pincode invalid) | Add/select address |
| Checkout: order summary | populated, error (price mismatch, payment failed) | BillSummary: items + delivery + GST + donation roundup line (checkbox, defaults per section 6) + total |
| Order success | populated | "Order placed" with order id, Track order / Explore more |
| Order detail | loading, populated, error | OrderTimeline (placed to shipped to in transit to delivered), Write feedback once delivered |
| My orders | loading, empty, populated, error | Status per order |
| Wishlist (gear) | loading, empty, populated, error | Move to cart |

### 3.7 Learn (entered from Home)

| Screen | States | Notes |
|---|---|---|
| Learn home | loading, empty (no roadmap assigned yet), populated, error | Roadmap progress, XP total, drill categories |
| Drill library / list | loading, empty, populated, error | Filter by sport, difficulty |
| Drill detail | loading, populated, error | Instructions, mark complete (writes an XP event), completion state persists |
| Roadmap | loading, empty, populated, error | Milestone track, current stage highlighted, XP thresholds |
| Milestones | loading, empty, populated, error | Earned vs locked, lucide icon per milestone (no emoji) |

### 3.8 Empower and donations (donor side)

| Screen | States | Notes |
|---|---|---|
| Empower hub | loading, empty (no verified UPAs in filter), populated, error | Aggregate impact counter, sport/region filters, UPA cards with funding progress |
| UPA public profile | loading, populated, error (not found, not verified is never shown here) | Story, verified badge, wishlist with per-item funding progress, Donate |
| Donation sheet | populated, error (payment failed, minimum amount, item already fully funded) | Preset amounts, fund-a-specific-item, custom amount, BillSummary (donation + total only, no GST/fee), pay |
| Donation success | populated | Confirmation, prompt to view My Impact |
| My impact | loading, empty (no donations yet), populated, error | Total given, athletes supported, items funded, donation history |

### 3.9 Chat (shared component, player entry points)

| Screen | States | Notes |
|---|---|---|
| Thread list | loading, empty, populated, error | Entered from Trainings and from a coach/creator profile's Message action |
| Thread | loading, empty (no messages yet), populated, error | Realtime send/receive, gated for guest (read-only preview not offered; guest never opens a thread) |

### 3.10 Notifications and account

| Screen | States | Notes |
|---|---|---|
| Notifications | loading, empty, populated, error | Grouped Today / Earlier, tap deep-links to the source screen, mark-read on open |
| Account home | populated | Entry list: profile, settings, notifications, help, impact, wishlist, orders, payments |
| Profile view / edit | loading, populated, error (validation) | Reuses player setup wizard steps, prefilled |
| Settings | populated | Account, location, notification preferences, language, logout, delete account |
| Help | populated, error (ticket submit failed) | FAQ + RequestSupportForm |

**Guest coverage summary:** guest can reach every screen in 3.2, the Clutch feed and post detail in 3.4 (read only), and the Courts and Coach/Shop browse screens in 3.3/3.5/3.6 up to but not including any screen that writes data. Every mutating action a guest triggers opens `LoginGateSheet` instead of executing, preserving the intended destination so login/register returns the guest to it.

---

## 4. Functional requirements

Each FR is independently testable. Numbered `FR-1` through `FR-70` for stable Jira story references as `PRD-01 FR-n`.

### Guest mode and gating
- **FR-1**: A first-time app open with no session routes to Home in guest mode without forcing login or registration.
- **FR-2**: Guest can browse Home, Clutch feed and post detail, Courts list and detail, Coach discovery and profile, and Shop category/PDP without any gate.
- **FR-3**: Any guest tap on a mutating action (book, buy, like, comment, follow, donate, upload, send message, save to wishlist) opens `LoginGateSheet` instead of performing the action.
- **FR-4**: Completing login or register from a gate returns the user to the exact screen and, where feasible, the exact in-progress state (e.g. cart contents, selected slot) they were on.
- **FR-5**: Guest Trainings tab shows a locked preview state with a single CTA to set up a profile; it does not show another player's or a coach's data.

### Auth and onboarding
- **FR-6**: Register requires name, email, phone, DOB, and password (entered twice, must match) and rejects a duplicate email or phone with a field-level error.
- **FR-7**: Successful registration proceeds to Role select; choosing Player proceeds to the Player setup wizard.
- **FR-8**: Player setup wizard requires at least one sport and a city before it can be completed; completing it lands on Home in player mode.
- **FR-9**: Forgot password requires a valid OTP within its expiry window before allowing a password reset.
- **FR-10**: A returning user with a valid session opens directly to Home without re-authenticating.

### Home and discovery
- **FR-11**: Home renders AppBar, SearchBar, LocationBar, category chips, ad banner carousel, Clutch preview, empower rail, and Shop/Learn entry points for both guest and player without layout branching by role.
- **FR-12**: Location is requested at first Home load or first search, whichever occurs first, with a rationale shown before the OS permission prompt; declining falls back to manual city selection.
- **FR-13**: The notification bell shows an unread-count indicator that reflects the player's actual unread notification count and clears on visiting Notifications.
- **FR-14**: Tapping a category chip navigates to the matching Shop category listing filtered accordingly.

### AI search
- **FR-15**: Submitting a natural language query returns results spanning gear, coaches, and courts as applicable, each carrying a human-readable `rankReason`.
- **FR-16**: An empty result set shows a specific broaden suggestion derived from a removable constraint in the parsed query, not a generic "no results" message.
- **FR-17**: Mixed-entity result sets render as segmented Gear / Coaches / Courts sections; single-entity result sets render as one ranked list.
- **FR-18**: Search results reflect the player's current or manually selected location for distance-based ranking and `rankReason` text.
- **FR-19**: Guest can run AI search and view results; tapping a result's mutating action (book, add to cart) gates per FR-3.

### Coaching: discovery and booking
- **FR-20**: Coach discovery list supports filtering by sport, price, rating, and distance, and reflects the current location context.
- **FR-21**: Coach profile shows tiered pricing per session type and an availability preview sourced from that coach's real slot data, not a static fixture.
- **FR-22**: Booking a session requires, in order, session type and frequency, date, and slot; the slot step only shows availability the coach has not already sold or blocked.
- **FR-23**: The booking pay step's BillSummary total is computed client-side for display and re-verified server-side before payment is authorized; a mismatch blocks payment and surfaces a price-changed message rather than charging the client's number.
- **FR-24**: A successful session booking creates a session in `requested` status, visible immediately in the player's upcoming list and in the coach's request queue.
- **FR-25**: A session's status only ever transitions along: requested to accepted or declined; accepted to completed, cancelled, or rescheduled; completed to rated. Any other transition attempt from this app is rejected, not silently allowed.
- **FR-26**: Cancel, reschedule, and rate on a session are available only in the states the state machine permits (e.g. rate only after completed, only once).
- **FR-27**: The player's Trainings dashboard StatTiles (total sessions, this month, hours, payments) are computed from that player's real session and payment history, not cached client estimates.
- **FR-28**: Player analytics screen renders session-count and hours data with no AI-generated narrative, insight, or recommendation text anywhere on the screen.

### Courts
- **FR-29**: Court list and detail reflect real court, pricing, and slot-availability data for the selected sport and location.
- **FR-30**: Booking a court follows the identical lifecycle machine as a coaching session (confirmed to completed, cancelled, or rescheduled; completed to rated), reusing the same cancel/reschedule/rate components.
- **FR-31**: The court booking BillSummary shows subtotal, GST, and platform fee as separate rows before the total, and the total is server-reverified before payment exactly as in FR-23.
- **FR-32**: A slot already held by another confirmed booking cannot be selected or paid for; attempting it returns a slot-taken error without charging the player.

### Shop
- **FR-33**: Product detail requires a variant/size selection where the product defines variants before Add to cart is enabled.
- **FR-34**: Cart quantity changes and removals update the displayed subtotal immediately and persist across app restarts for a logged-in player.
- **FR-35**: Checkout requires a selected address before the order summary can be confirmed; a player with no saved address is routed to add one first.
- **FR-36**: Checkout order summary's BillSummary includes item lines, delivery charges, GST, and an optional donation roundup line with a visible on/off checkbox, followed by a bold total.
- **FR-37**: The order total is server-reverified before payment exactly as in FR-23, including when the donation roundup toggle changes the total.
- **FR-38**: A successful checkout creates an order in `placed` status with a human-readable order id shown on the success screen.
- **FR-39**: Order status in the app only ever reads as placed, shipped, in transit, or delivered, in that order, driven by data this app does not itself advance (order advancement is admin's surface, out of scope here per section 8).
- **FR-40**: Write feedback is only reachable once an order's status is delivered.
- **FR-41**: The wishlist heart on a product toggles saved state idempotently and the Wishlist screen reflects the player's current saved set.

### Clutch
- **FR-42**: The feed loads clips with cursor-based pagination and never blocks scroll on a still-processing clip; only clips in `published` status appear in the player-facing feed.
- **FR-43**: Like and comment are available to a logged-in player and gated for guest per FR-3; like state is idempotent (toggle).
- **FR-44**: Upload requires a caption and a sport tag before posting; a submitted clip enters `uploading` then `processing` status and is not visible in any feed until it reaches `published`.
- **FR-45**: A rejected clip (failed moderation) is visible to its uploader with a rejected status and is never visible in any other player's feed.
- **FR-46**: Follow/unfollow on a creator profile toggles idempotently and updates the follower count shown to all viewers, not just the acting player.
- **FR-47**: A player's own social profile shows their real clip grid, milestone set, and follower/following counts pulled from live data.

### Learn
- **FR-48**: Learn home shows the player's assigned roadmap stage and total XP; a player with no roadmap assigned yet sees an explicit empty state, not a zero-filled roadmap.
- **FR-49**: Marking a drill complete writes one XP event tied to that player and that drill, and is idempotent (completing the same drill twice does not double-award XP without an explicit "redo" affordance the drill defines).
- **FR-50**: The roadmap screen's current-stage indicator is derived from the player's accumulated XP against real threshold data, not a hardcoded stage.
- **FR-51**: Milestones render earned vs locked based on the player's real achievement data, each with a lucide icon, never an emoji glyph.

### Empower and donations
- **FR-52**: Empower hub only ever lists UPAs in `verified` status; an unverified or under-review UPA is never visible in this app.
- **FR-53**: The empower aggregate counter (total raised, athletes supported) reflects real donation totals, not a cached or rounded display value.
- **FR-54**: Donating to a specific wishlist item is blocked once that item's funding target is reached, with a clear already-funded message, before payment is attempted.
- **FR-55**: The donation BillSummary shows only a donation line and a total (no GST or platform fee rows), and the total is server-reverified before payment exactly as in FR-23.
- **FR-56**: A successful donation updates My Impact (total given, athletes supported, items funded) immediately, without requiring an app restart or manual refresh.
- **FR-57**: The checkout donation roundup (FR-36) and a standalone Empower donation write to the same underlying donation ledger and both appear in My Impact history.

### Chat
- **FR-58**: A player can only open a chat thread with a coach they have an existing session (booked, requested, or completed) with, or a creator whose profile explicitly exposes a Message action.
- **FR-59**: Messages send and receive in near-real time within an open thread without a manual refresh.
- **FR-60**: The thread list shows the most recent message preview and timestamp per thread, ordered most-recent-first.

### Notifications
- **FR-61**: A booking confirmation, cancellation, reschedule, order status change, chat message, clip moderation outcome, and donation confirmation each generate a notification visible in the Notifications screen.
- **FR-62**: Tapping a notification deep-links to the specific screen and record it references (e.g. the exact session, order, or thread), not a generic list.
- **FR-63**: Notifications are grouped Today / Earlier and opening the Notifications screen marks visible unread notifications as read.

### Account
- **FR-64**: Profile edit reuses the player setup wizard's step components prefilled with current data and enforces the same field validation as initial setup.
- **FR-65**: Settings logout clears the local session and returns the app to guest mode at Home, not to the login screen.
- **FR-66**: Settings delete account requires an explicit confirmation step and, once confirmed, the player can no longer authenticate with that credential.
- **FR-67**: The player payments ledger (Account > Payments) lists sessions, courts, gear orders, and donations as a single reverse-chronological transaction history with type and amount per row.
- **FR-68**: Help's RequestSupportForm requires a subject and description and shows a ticket id on successful submit.

### Cross-cutting
- **FR-69**: Every screen listed in section 3 ships all of its listed states; a screen shipped without its empty or error state fails acceptance regardless of how the populated state looks.
- **FR-70**: No screen or component in this app hardcodes a color, spacing, or radius value outside `packages/theme`; every numeric readout (prices, stats, XP, timers, counts) renders in the monospace numeric style.

---

## 5. Data touched

Schema domains per PLAN.md. "Write" means this app can create or transition rows directly (via RPC where a state machine governs) or trigger a write via an edge function; it never writes money or state-machine rows directly from the client.

| Domain | Read | Write |
|---|---|---|
| identity/roles | Own user record, own roles, public profile fields of coaches/creators/UPAs viewed | Own profile fields, own role selection (player), own player setup data |
| coaching | Coach profiles, availability/slots, own sessions | Session creation via `book-session` edge function; cancel/reschedule/rate via state-machine RPCs scoped to own sessions only |
| courts | Court/venue listings, slots, pricing rules | Booking creation via `book-court` edge function; cancel/reschedule/rate via state-machine RPCs scoped to own bookings only |
| commerce | Products, variants, stock, own cart, own orders, own addresses | Cart CRUD (direct, non-money); order creation via `checkout` edge function; own address CRUD; feedback text on own delivered orders |
| clutch | Published clips feed-wide; own clips in all statuses; comments; follows | Own clip upload metadata + video (via `stream-upload-url`), own likes, own comments, own follows |
| empower | Verified UPAs and their wishlists only; own donation history | Donation creation via `donate` edge function; no writes to UPA records themselves |
| learn | Own roadmap, own XP events, drill library, milestone definitions | Drill-complete events (own only); no writes to drill/roadmap/milestone definitions |
| chat | Own threads and messages | Send message (own threads only, via Realtime) |
| notifications | Own notifications | Mark-read on own notifications |
| payments | Own payment intents and ledger entries (read-only view for the player ledger) | Never written directly; all money rows come from edge functions (`razorpay-create-order`, `book-session`, `book-court`, `checkout`, `donate`) and the `razorpay-webhook` |
| moderation/audit | Own clip's moderation outcome (status only, not internal queue/reviewer detail) | None |

This app never writes to another user's row in any domain, never writes a `ledger_entries` row directly, and never advances an order past `placed` (order lifecycle advancement past that point is admin's write, read-only here).

---

## 6. Payment touchpoints

All money moves through edge functions with the client never writing a payment or ledger row directly, per PLAN.md's financial invariant. Every money surface in this app shows a `BillSummary` immediately before the pay action, no exceptions.

| Touchpoint | Edge function(s) | BillSummary rows |
|---|---|---|
| Book a coaching session | `book-session` then `razorpay-create-order`, confirmed via `razorpay-webhook` | Price x frequency multiplier, platform fee, total |
| Book a court | `book-court` then `razorpay-create-order`, confirmed via `razorpay-webhook` | Subtotal, GST, platform fee, total |
| Shop checkout | `checkout` then `razorpay-create-order`, confirmed via `razorpay-webhook` | Items subtotal, delivery charges, GST, donation roundup (optional, toggle), total |
| Donate (standalone or item-specific) | `donate` then `razorpay-create-order`, confirmed via `razorpay-webhook` | Donation amount, total (no GST or fee rows) |

Rules that apply to every row in this table:
- The client computes and displays a total for the player's benefit only; the edge function re-prices server-side from source data (price, stock, slot, GST rule, fee config) before creating the Razorpay order. A mismatch surfaces as a price-changed error and blocks the charge, never silently substitutes a number.
- Payment confirmation is driven by `razorpay-webhook`, not by the client's post-payment callback; the client polls or subscribes for the resulting status rather than assuming success on return from the payment sheet.
- A failed or abandoned payment leaves the underlying session/booking/order/donation in a state that does not appear as confirmed anywhere in this app.
- This app never calls `razorpay-route-onboard` or `razorpay-route-transfer` (coach/partner payout is PRD-02/PRD-03's surface); it only ever originates a charge, never a payout.

---

## 7. Acceptance criteria per journey

Journeys numbered to match SPEC.md's five demo journeys, restated for this PRD's ceiling and made checkable. Each criterion cites the FR it verifies.

### Journey 1: Onboard (guest to player)
- Guest opens the app and reaches Home with real, populated content, no forced login screen (FR-1, FR-11).
- Guest taps like on a Clutch clip and `LoginGateSheet` opens instead of the like registering (FR-3).
- Guest registers from the gate and lands back on the same clip's post detail with the like now available (FR-4, FR-6).
- Completing Player setup (sport + city minimum) lands on Home in player mode with the Trainings tab now showing the full dashboard instead of the guest-locked preview (FR-7, FR-8, FR-5).

### Journey 2: The engine (book a coach, manage the session)
- Player opens Trainings, browses coaches filtered by sport, opens a coach profile showing real tiered pricing and availability (FR-20, FR-21).
- Player books a session through type/frequency, date, slot, and the pay step's BillSummary total matches what is actually charged, or a price-changed error blocks the charge if the price moved (FR-22, FR-23).
- The booked session appears in the player's Upcoming list in `requested` status immediately (FR-24).
- Player opens chat with that coach and sends a message that the coach's side would receive in near-real time (FR-58, FR-59).
- After the coach accepts and the session is later marked completed, the player can rate it exactly once; a second rate attempt is rejected (FR-25, FR-26).
- Player can cancel or reschedule only while the session is in a state the machine allows; attempting it on a completed session is rejected (FR-25).

### Journey 3: Access and commerce (search, buy, book a court)
- Searching "size 8 football shoes under 1000" returns ranked gear results with a `rankReason` on each, filtered to the stated price ceiling and the player's location context (FR-15, FR-18).
- A search with no matches shows a specific broaden suggestion, not a blank empty state (FR-16).
- Player adds a shoe to cart, checks out with a saved address, sees a BillSummary with items, delivery, GST, and a donation roundup toggle, and the charged total is server-reverified (FR-33 to FR-37).
- Order appears with a real order id and moves through Order detail's timeline as its status updates from data the app reads but does not itself advance (FR-38, FR-39).
- Once delivered, Write feedback becomes available and not before (FR-40).
- Separately, player books a court: picks sport, location, date, and an available slot; a slot already taken by another confirmed booking cannot be selected (FR-29, FR-32). After the booking completes, player rates it once (FR-30, FR-31).

### Journey 4: Supply-side visibility check (player's view only)
- Player sees their own session correctly reflect coach-side actions (accept becomes visible as accepted in the player's Sessions list) without this app performing any coach-side write (data boundary per section 5).
- Player's Payments ledger (Account) lists that session's charge alongside any court, gear, or donation transactions in one reverse-chronological view (FR-67).

### Journey 5: Purpose (donate)
- Player opens the Empower rail from Home, browses only verified UPAs, and the aggregate counter reflects real totals (FR-52, FR-53).
- Player opens a UPA's public profile and funds a specific wishlist item that is not yet fully funded; attempting to fund an already-fully-funded item is blocked before payment (FR-54).
- Donation BillSummary shows only donation amount and total, and payment confirmation updates My Impact without a manual refresh (FR-55, FR-56).
- The same player's earlier checkout donation roundup (Journey 3) and this standalone donation both appear together in My Impact history (FR-57).

### Cross-journey: states and taste
- Every screen touched across Journeys 1 to 5 was seen in at least its loading, populated, and either empty or error state during acceptance testing; none showed a bare spinner in place of a skeleton (FR-69).
- No emoji appears anywhere in the app during any journey; milestones render as lucide icons (FR-51, FR-69).
- Every price, stat, XP value, and count observed during the journeys renders in the monospace numeric style (FR-70).

---

## 8. Explicitly out of scope

This PRD is a ceiling. Anything not listed in section 3 or 4 is not to be built under PRD-01, even if a builder judges it trivial to add alongside an in-scope screen.

- **Coach-mode experience**: Trainees roster, Coach earnings wallet, Coach stats dashboard, Coach analytics, session request accept/decline UI, coach setup wizard. PRD-02.
- **Court partner portal**: inventory management, pricing rules authoring, day-of Realtime ops, partner earnings. PRD-03 / `apps/portal-court`.
- **Admin back office**: order lifecycle advancement (placed to shipped to in transit to delivered), clip moderation queue, UPA verification, venue verification, catalog CRUD, feature flags, audit log viewing. PRD-04 / `apps/admin`.
- **Atlitos Life / UPA-side experience**: UPA application and verification flow, UPA's own wishlist authoring, gratitude/thank-you posting. PRD-05 / `apps/portal-life`. This PRD only covers the donor's read and donate experience of already-verified UPAs.
- **Coach and partner payouts**: Razorpay Route onboarding and transfers. This app only originates charges (section 6); it never triggers a payout.
- **Pro tier, subscriptions, or any paywall.** None exist in v2 at this phase.
- **AI features beyond AI search**: no video analytics, no AR gear try-on, no 3D avatar, no coach AI chatbot, no nutrition/workout plan generation, no gamified challenges beyond the Learn XP/milestone system already specified, no AI-personalized feed ranking, no AI-generated analytics narratives (FR-28 explicitly forbids this).
- **Group or team booking** for sessions or courts; every booking in this PRD is a single player booking a single coach or court.
- **QR entry / digital passbook, scouter dashboards, wearables integration.**
- **Push notification infrastructure build.** This PRD specifies the in-app Notifications screen and its triggers (FR-61 to FR-63); the delivery mechanism (`notify-dispatch`, device push registration) is PRD-07's surface, consumed here as a given.
- **Chat infrastructure build** (Realtime channel design, message persistence schema). This PRD specifies the player-facing thread list and thread screens only; the underlying chat system is PRD-07's surface.
- **Multi-currency, multi-language.** INR only, English only, at this phase.
- **Offline mode.** Screens assume connectivity; error states cover request failure, not offline-first sync.

---

## 9. Open questions for the founder

1. **Trainings tab role toggle**: if a single account holds both player and coach roles (per PLAN.md's multi-role identity model), does the Trainings tab need an explicit switcher in this PRD's scope, or is that entirely PRD-02's concern with PRD-01 only ever rendering the player view? This PRD currently assumes the latter.
2. **Guest recent searches and wishlist**: v1 kept these player-only (empty for guest). Confirm v2 should not locally persist a guest's search history or wishlist across a session before login, since that would imply local storage design this PRD does not currently scope.
3. **Donation minimum**: what is the minimum donation amount (FR-54's blocking condition needs a floor, `MIN_AMOUNT` in `packages/types`)? Still open, tracked identically in PRD-06's open question 2. The roundup checkbox default is resolved: off by default, per PRD-06 FR-10 and PRD-07 FR-13.
4. **Drill "redo" affordance** (FR-49): does Learn need a way to redo a completed drill for repeat XP (useful for recurring conditioning drills), or is XP strictly one-time per drill in v2's first cut?
5. **Analytics honesty threshold** (FR-28): with zero AI narrative permitted, is a session-count/hours chart alone enough value for this screen to ship in P7, or should it be cut entirely from P7 and only reconsidered once P8 (search, notifications, hardening phase per PLAN.md) reaches its own AI-adjacent scope discussion?
6. **Court tab lock semantics**: PLAN.md's task brief says "Courts (locked from v1)" for the bottom tab. This PRD has interpreted that as "flows frozen to v1's spec, visuals rebuilt, backend real" (section 3.5), not "tab visible but disabled." Confirm that reading before P2's flagship Courts demo is built against it.
7. **Follow graph visibility**: is a player's following/followers list itself browsable (tap follower count to see who), or is the count display-only in v2's first cut? Not specified in v1 and not assumed here beyond FR-47's count display.
