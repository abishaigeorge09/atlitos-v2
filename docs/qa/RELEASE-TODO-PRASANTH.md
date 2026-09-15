# Release TODO, Prasanth

Source: Product release sheet (release date Oct 08), pulled 2026-09-14.
Scope: every task in tab 1 owned by Prasanth, plus everything in tab 2 (Tech Schedule) and tab 3 (test result log).

Status legend: [ ] not started, [~] in progress, [x] done, [!] blocked.

## 1. Tab 1 tasks owned by Prasanth (ordered by start date, then priority)

| # | Task | Window | Pri | Status | What done looks like |
|---|------|--------|-----|--------|----------------------|
| 25 | Push the code | Sept 9 | P0 | [~] | 275 local commits are on the remote; remote is no longer five weeks behind |
| 6 | Build a data entry path | Sept 9 to 11 | P0 | [ ] | Either admin create screens for coaches and products, or a CSV import an engineer runs. Unblocks tab 1 rows 1 to 4 (Kushlu, Amma, Amaeya data entry) |
| 19 | Analytics (PostHog) | Sept 9 to 11 | P2 | [x] | Decision recorded: wired, or explicitly deferred |
| 5 | Build courts as an affiliate click out | Sept 9 to 12 | P0 | [ ] | Outbound link field on courts, entry path to fill it, click out screen modelled on the shop affiliate screen. In-app booking flow and its deep link routes hidden |
| 11 | Account and infra verification | Sept 9 to 13 | P0 | [ ] | Leaked password protection on; MFA on Apple, Supabase, Razorpay, GitHub; prepaid credits topped up; backup restore proven; Apple agreements current |
| 13 | Fix bugs and polish | Sept 9 to 13 | P0 | [~] | Everything the profile days (section 2) turn up is fixed or logged in BUG-LEDGER.md |
| 8 | Deploy what is already built | Sept 9 to 14 | P0 | [!] | 8 pending migrations applied, 2 missing edge functions deployed, each money path smoke tested |
| 7 | Switch Razorpay to a live key | Sept 9 to 15 | P0 | [ ] | eas.json no longer pins EXPO_PUBLIC_RAZORPAY_KEY_ID to a test key for store builds. Depends on decision row 22 (Zaakpay or Razorpay) |
| 10 | Legal and support live | Sept 10 to 13 | P0 | [~] | Privacy, terms, support and delete account pages load; support points at an atlitos.com address |
| 12 | Functional testing by profile | Sept 10 to 13 | P0 | [ ] | Four days, one profile per day, all scenarios in section 3 executed and logged per section 4 |
| 9 | Push notifications | Sept 10 to 15 | P1 | [ ] | pg_net enabled, two vault secrets created, push sweep scheduled |
| 14 | App Store submission pack | Sept 15 to 23 | P0 | [ ] | Listing copy, privacy label matching the app manifest, age rating for UGC, screenshots, 1024 icon, working demo account, review notes. See APP-STORE-SUBMISSION-PACK.md |
| 21 | Production data cleanup | Sept 15 to 22 | P1 | [ ] | No test fixtures in the live feed before a reviewer sees it |
| 17 | Launch ops and moderation | Sept 15 to Oct 8 | P1 | [ ] | Named moderation owner with 24 hour response, payment finalisation backlog watcher, rate limit monitoring, rehearsed rollback |
| 15 | Replace the stale TestFlight build | Sept 22 to 30 | P0 | [ ] | Build cut from current code, internal first, then external (triggers Beta App Review) |
| 16 | Submit and release | Sept 30 to Oct 8 | P0 | [ ] | Submitted with manual release, room for two rejection cycles |

### Status notes, 2026-09-15

- **19, PostHog: DEFERRED.** No analytics SDK is wired anywhere in the repo (no `posthog` reference in apps, packages or docs). The Oct 8 build ships without product analytics; Sentry (already wired) covers crashes. Revisit after launch, when there is traffic worth measuring.
- **25, Push:** `integration/p6-reconciled` (2541742) and `fix/qa-round-2026-09-15` are on origin. What remains is the uncommitted UI work in the main checkout, which Prasanth commits himself when it is finished.
- **13, Bugs:** external tester round of 2026-09-15 fixed as BUG-045 to BUG-049 (`docs/qa/BUG-LEDGER.md`), branch `fix/qa-round-2026-09-15`.
- **10, Legal:** `/`, `/privacy`, `/terms`, `/support`, `/delete-account` return 200 on www.atlitos.com. Still open: `/support` points at support@elsheph.com, not an atlitos.com address, and `/content-policy` is 404 on the deployed site.
- **8, Deploy: BLOCKED on three reconciliation calls, checked against the live ledger (109 rows, top `0117`) on 2026-09-15.** Two unapplied sets now exist: main's renumbered `0118` to `0125` (see `docs/architecture/DEPLOY-RUNBOOK.md`) and this branch's own `0110`, `0112` to `0115`, `0118`, `0119`, which collide on number with main's `0118`/`0119`. Findings:
  - `chat_thread_previews`: main's `0124` and this branch's `0113` both create it but return different columns. The deployed app parses this branch's shape (`sender_id`, `removed_at`, name from `public_profiles`). Apply `0113`, never `0124`.
  - main's `0121` (`order_transition` audit row): body is production's plus the audit insert, so it is safe on its own, BUT the deployed `admin-order-advance` edge function still writes its own audit row, so applying it alone double-writes. Ship the RPC and the edge function change together.
  - main's `0119` (coach video policy lock): security tightening with no counterpart here. Before applying, confirm the deployed upload flow inserts `coach_trainee_videos` with `storage_path` null first, or the tightened policy blocks every upload.
  - The 2 missing edge functions are `delete-account` (waits on `0120`/`0123`) and `notify-push-sweep` (task 9, inert until pg_net + vault secrets).
  - None of this blocks tasks 5 and 6, so those went first.

Founder decisions Prasanth is waiting on (tab 1 rows 22 to 24, all Open):
- [ ] Row 22: Zaakpay or Razorpay (only Razorpay is integrated). Blocks task 7.
- [ ] Row 23: iPad support (supportsTablet true forces 12.9 inch screenshots). Blocks task 14.
- [ ] Row 24: Apple commission on donations (Empower donations go through an Atlitos held fund, not a registered charity). Blocks task 14 and 16.

Tab 1 rows 2 and 3 (Amaeya, both Blocked, P0) are the affiliate data entry for courts and equipment. They cannot start until tasks 5 and 6 above land, so they are tracked here as downstream:
- [ ] Row 2: Add courts (affiliate links). Unblocked by task 5 and task 6.
- [ ] Row 3: Add equipment (affiliate links). Unblocked by task 6.

## 2. Tab 2, Tech Schedule (day plan)

| Day | Date | Track | Profile / Owner | Status |
|-----|------|-------|-----------------|--------|
| Day 0 | Tue Sept 9 | Engineering | Prasanth (3 slots, unfilled in sheet) | [ ] |
| Day 1 | Wed Sept 10 | Engineering | Guest and Athlete | [ ] |
| Day 2 | Thu Sept 11 | Engineering | Coach | [ ] |
| Day 3 | Fri Sept 12 | Engineering | Shopper and Donor | [ ] |
| Day 4 | Sat Sept 13 | Engineering | Admin | [ ] |
| Data | Sept 9 to 13 | Data entry | Kushlu + Amma (2 slots), Amaeya (2 slots) | [ ] |
| Decisions | By Sept 11 | Founder | Rows 22, 23 | [ ] |
| Decisions | By Sept 15 | Founder | Row 24 | [ ] |

The Task, What good looks like and Done columns for the day rows are empty in the sheet. Fill them from section 1 before Day 0 starts.

## 3. Tab 2, functional test scenarios (188)

Sheet starts at G-11; G-01 to G-10 are not in the sheet. Check whether they exist elsewhere or were never written.

### Guest (Day 1), G-11 to G-30
- [ ] G-11 Clutch: open the Clutch tab and scroll through several clips
- [ ] G-12 Clutch: tap the like heart on a clip
- [ ] G-13 Clutch: open a clip's comments
- [ ] G-14 Clutch: tap Follow on a creator profile
- [ ] G-15 Clutch: sign in from the gate raised by liking a clip, then let the app settle
- [ ] G-16 Clutch: tap the upload button in Clutch
- [ ] G-17 Courts: open the Courts tab and scroll the court list
- [ ] G-18 Courts: open one court's detail screen
- [ ] G-19 Courts: tap the booking action on a court detail screen as a guest
- [ ] G-20 Courts: return to the app from the external booking site using the back gesture
- [ ] G-21 Courts: open a court whose booking link is missing or no longer valid
- [ ] G-22 Courts: read the court detail screen for any wording about booking or payment
- [ ] G-23 Shop: browse a Shop category and open a product detail page
- [ ] G-24 Shop: tap Add to cart on an owned product as a guest
- [ ] G-25 Affiliate: open an affiliate product detail page as a guest
- [ ] G-26 Affiliate: tap Buy on a retailer from an affiliate product as a guest
- [ ] G-27 Empower: open Empower from Home and browse the listed athletes
- [ ] G-28 Empower: tap a donation amount on an athlete's donate screen as a guest
- [ ] G-29 Trainings: open the Trainings tab as a guest
- [ ] G-30 Profile: open the Profile screen as a guest

### Athlete (Day 1), A-01 to A-43
- [ ] A-01 Auth: register a new account with name, email, phone, date of birth and matching passwords
- [ ] A-02 Auth: submit the register form with a password and confirmation that do not match
- [ ] A-03 Auth: register with an email address that already has an account
- [ ] A-04 Auth: request a password reset for a real account and then for an address that has none
- [ ] A-05 Auth: complete a password reset with an OTP, then try to reuse that same OTP
- [ ] A-06 Auth: enter an OTP after waiting past its stated expiry
- [ ] A-07 Auth: sign in on the iOS build and reach Home
- [ ] A-08 Auth: sign in, close the app fully, reopen a minute later
- [ ] A-09 Onboarding: choose Player at role select and walk the setup wizard to the end
- [ ] A-10 Onboarding: on a required wizard step, leave the field empty and try to continue
- [ ] A-11 Onboarding: quit the app halfway through the setup wizard and reopen
- [ ] A-12 Onboarding: try to complete player setup without selecting any sport or city
- [ ] A-13 Home: sign in on an account with unread notifications and look at Home
- [ ] A-14 Home: open Notifications from Home, then go back to Home
- [ ] A-15 Clutch: like a clip, then like it again to remove the like
- [ ] A-16 Clutch: post a comment on a clip
- [ ] A-17 Clutch: try to submit a clip upload with no caption
- [ ] A-18 Clutch: upload a clip with a caption and sport tag, then check the public feed from another account
- [ ] A-19 Clutch: run the clip upload flow on a device or simulator from picking the file to submit
- [ ] A-20 Clutch: swipe through the feed on a device and watch which video plays
- [ ] A-21 Clutch: follow a creator, then reopen that profile from a fresh navigation
- [ ] A-22 Clutch: unfollow the same creator, then follow and unfollow twice more
- [ ] A-23 Clutch: open your own social profile
- [ ] A-24 Learn: open Learn on a player with no roadmap assigned
- [ ] A-25 Learn: mark a drill complete and watch the XP total on Learn
- [ ] A-26 Learn: mark the same drill complete a second time
- [ ] A-27 Trainings: check the Trainings stat tiles against actual session history
- [ ] A-28 Trainings: open a coach profile from coach discovery
- [ ] A-29 Trainings: read the price breakdown on a coaching booking pay step
- [ ] A-30 Trainings: open a completed session and look for a rate action, then open a requested one
- [ ] A-31 Trainings: cancel a session still in requested state
- [ ] A-32 Courts: open Courts as a signed in player and tap through to a partner booking link
- [ ] A-33 Courts: look through the app for any My Bookings or court booking history entry point
- [ ] A-34 Notifications: open Notifications with several unread items
- [ ] A-35 Notifications: tap a notification about a specific order or session
- [ ] A-36 Profile: open Profile edit, change city, save, reopen
- [ ] A-37 Settings: open Settings from the You tab, the Profile page and the Trainings shell
- [ ] A-38 Settings: sign out from Settings
- [ ] A-39 Account deletion: find the delete account option starting from Settings
- [ ] A-40 Account deletion: open the delete account screen and read it before confirming
- [ ] A-41 Account deletion: try to delete an account that has an in flight order or session
- [ ] A-42 Account deletion: start the delete flow and back out at the confirmation step
- [ ] A-43 Account deletion: confirm deletion, then try to sign in again with the same credentials

### Coach (Day 2), C-01 to C-36
- [ ] C-01 Onboarding: sign up a brand new account and pick Coach at role select
- [ ] C-02 Onboarding: tap Next on the Sport step without selecting a sport
- [ ] C-03 Onboarding: pick a profile photo on the Photo step
- [ ] C-04 Onboarding: on the Availability step, type 25:00 as a start time
- [ ] C-05 Onboarding: complete all seven steps and submit
- [ ] C-06 Verification: open the Trainings tab immediately after submitting the wizard
- [ ] C-07 Verification: from a second device signed in as an athlete, search for the pending coach by name
- [ ] C-08 Verification: have an admin approve the request, then pull to refresh the Trainings tab
- [ ] C-09 Verification: sign in as a coach whose request was rejected
- [ ] C-10 Session types: create a session type named Batting fundamentals, 60 minutes, 800 rupees
- [ ] C-11 Session types: try to save a session type with a blank name or a price of 0
- [ ] C-12 Session types: toggle an existing session type to hidden
- [ ] C-13 Session types: hide every session type so the active count reaches zero
- [ ] C-14 Availability: add a Monday window from 06:00 to 08:00
- [ ] C-15 Availability: add a window whose To time is earlier than its From time
- [ ] C-16 Availability: delete an availability window that overlaps an already accepted session
- [ ] C-17 Requests: accept a pending booking request from the Requests screen
- [ ] C-18 Requests: decline a pending booking request
- [ ] C-19 Session lifecycle: open an accepted session, tap Start session, then Mark complete
- [ ] C-20 Session lifecycle: tap Cancel session, enter a reason, confirm
- [ ] C-21 Session lifecycle: tap Reschedule and pick a date with no availability window
- [ ] C-22 Groups: create a training group with name, sport, skill level, capacity and monthly fee
- [ ] C-23 Groups: open an existing group and try to change its sport
- [ ] C-24 Groups: schedule a group session with date, start and end time, focus area and location
- [ ] C-25 Trainees: open a trainee and walk the Overview, Sessions, Payments, Notes and Videos tabs
- [ ] C-26 Trainees: add a note on a trainee, reopen the screen, then delete it
- [ ] C-27 Trainees: tap Message on a trainee detail screen
- [ ] C-28 Chat: with coach and athlete on two devices, send a message from the coach
- [ ] C-29 Chat: leave the coach on the thread list while the athlete sends a message
- [ ] C-30 Chat: signed in as a coach, try to open a chat thread between two other people by deep link
- [ ] C-31 Earnings: open Earnings and add up the listed session income entries by hand
- [ ] C-32 Earnings: tap the payout setup action from the Earnings header
- [ ] C-33 Earnings: tap Transfer with no payout account set up
- [ ] C-34 Earnings: enter a transfer amount larger than the available balance
- [ ] C-35 Analytics: open Analytics as a coach with fewer than three completed sessions
- [ ] C-36 Analytics: open Analytics as a coach with several completed and rated sessions

### Shopper (Day 3), S-01 to S-27
- [ ] S-01 Shop: open a Shop category and scroll the product grid
- [ ] S-02 Shop: open a product that has several sizes
- [ ] S-03 Shop: select an out of stock variant on a product page
- [ ] S-04 Shop: add a product to cart, force quit the app, reopen the cart
- [ ] S-05 Shop: increase the quantity of a cart line and watch the subtotal
- [ ] S-06 Shop: set a cart quantity higher than the available stock
- [ ] S-07 Shop: leave a cart line flagged out of stock and try to proceed to buy
- [ ] S-08 Shop: open checkout with no saved address
- [ ] S-09 Shop: enter an invalid pincode on the address form and save
- [ ] S-10 Shop: read the checkout bill summary carefully
- [ ] S-11 Shop: reach checkout twice in a row without touching the donation checkbox
- [ ] S-12 Shop: complete a test checkout through to payment success
- [ ] S-13 Shop: cancel or fail the payment at the payment sheet
- [ ] S-14 Shop: try to reach the order success screen by navigating directly without an order
- [ ] S-15 Shop: open an order from My Orders and compare its bill to what checkout showed
- [ ] S-16 Shop: open My Orders on an account with orders in several states
- [ ] S-17 Shop: look for a Write feedback action on an undelivered order, then on a delivered one
- [ ] S-18 Shop: save a product to the wishlist, then open My Wishlist
- [ ] S-19 Shop: use Move to cart on a wishlist item that has several sizes
- [ ] S-20 Shop: add an address, edit it, set it as default, then delete a different one
- [ ] S-21 Shop: try to delete an address that an in flight order is shipping to
- [ ] S-22 Affiliate: open an affiliate product detail page
- [ ] S-23 Affiliate: compare the offers listed on an affiliate product
- [ ] S-24 Affiliate: find an out of stock offer on an affiliate product and try to tap its buy button
- [ ] S-25 Affiliate: read the affiliate product page for its disclosure wording
- [ ] S-26 Affiliate: tap Buy on retailer and check where the browser lands
- [ ] S-27 Affiliate: return to the app after a click out and open the cart

### Donor (Day 3), D-01 to D-20
- [ ] D-01 Empower: open the Empower hub and read the athlete list
- [ ] D-02 Empower: apply a sport filter and then a region filter
- [ ] D-03 Empower: compare the total raised figure against the donations listed beneath it
- [ ] D-04 Empower: open a verified athlete's public profile
- [ ] D-05 Empower: find a wishlist item that has reached its funding target
- [ ] D-06 Empower: open an athlete profile with an empty wishlist or no sponsors yet
- [ ] D-07 Empower: open an athlete id that does not exist or is no longer verified
- [ ] D-08 Empower: read the donation bill summary on the review step of a standalone donation
- [ ] D-09 Empower: enter a donation amount below the stated minimum
- [ ] D-10 Empower: tap a preset donation amount and read the confirmation overlay
- [ ] D-11 Empower: dismiss the donation confirmation overlay without confirming
- [ ] D-12 Empower: complete a test donation to a specific wishlist item
- [ ] D-13 Empower: open My Impact immediately after donating, without restarting the app
- [ ] D-14 Empower: open My Impact on an account that has never donated
- [ ] D-15 Empower: look for any edit or delete action on a past donation in My Impact
- [ ] D-16 Empower: sign in as a second, different account and open My Impact
- [ ] D-17 Empower: turn on airplane mode on the Empower hub and reload
- [ ] D-18 Shop: tick the support a rising athlete checkbox during checkout and watch the total
- [ ] D-19 Shop: complete a checkout with the roundup ticked, then open My Impact
- [ ] D-20 Notifications: complete a donation, then open Notifications

### Admin (Day 4), AD-01 to AD-42
- [ ] AD-01 Auth: sign in at /login with the admin account
- [ ] AD-02 Auth: sign in at /login with an athlete account
- [ ] AD-03 Auth: sign in with a correct email and a wrong password
- [ ] AD-04 Auth: while signed out, paste /users directly into the address bar
- [ ] AD-05 Dashboard: type /dashboard into the address bar and load it
- [ ] AD-06 Dashboard: watch the dashboard load with a network throttle
- [ ] AD-07 Verification: open the Verification queue, Coach tab, approve a pending coach request
- [ ] AD-08 Verification: try to reject a pending request with the reason field blank
- [ ] AD-09 Verification: open a request that has already been approved or rejected
- [ ] AD-10 Venues: open a venue detail page
- [ ] AD-11 Venues: click Approve on a seeded venue never submitted for verification
- [ ] AD-12 Moderation: open the Moderation queue and approve a clip whose status is ready
- [ ] AD-13 Moderation: reject a clip with a reason
- [ ] AD-14 Moderation: open a clip detail page and look at the preview player
- [ ] AD-15 Reports: open a report against a published clip and resolve it as a takedown with a reason
- [ ] AD-16 Reports: dismiss a report with a reason
- [ ] AD-17 Reports: try to resolve any report with the reason field blank
- [ ] AD-18 Reports: open a report whose target is a chat message
- [ ] AD-19 Users: search for a known account by name, then phone number, then email
- [ ] AD-20 Users: open a user detail page, enter a reason, suspend the account
- [ ] AD-21 Users: reinstate the suspended user, then check their bookings and orders
- [ ] AD-22 Users: try to suspend with the reason field empty
- [ ] AD-23 Users: compare the activity summary against that user only
- [ ] AD-24 Orders: advance an order one status at a time through the fulfilment sequence
- [ ] AD-25 Orders: issue a refund on an order with a reason
- [ ] AD-26 Orders: compare the money breakdown on an old order against the current catalog price
- [ ] AD-27 Orders: look for a Cancel action on an order detail page
- [ ] AD-28 Fee config: edit a percentage fee row to 12, enter a reason, save
- [ ] AD-29 Fee config: try to save a percentage fee of 150
- [ ] AD-30 Fee config: try to save a fee change with the reason field empty
- [ ] AD-31 Catalog: read the stock columns on a product with items in live carts
- [ ] AD-32 Catalog: try to change stock without entering a reason
- [ ] AD-33 Catalog: toggle a product inactive and check the consumer shop
- [ ] AD-34 Drills: create a drill with title, sport, skill category, difficulty and XP value
- [ ] AD-35 Drills: deactivate an existing drill, then open the consumer Learn surface
- [ ] AD-36 Bookings: search by venue, court and player name
- [ ] AD-37 Not built: look for a way to create a new product in Catalog
- [ ] AD-38 Not built: look for a feature flags screen
- [ ] AD-39 Not built: look for a support tickets queue
- [ ] AD-40 Not built: look for an audit log viewer
- [ ] AD-41 Not built: look for a recent activity feed on the dashboard
- [ ] AD-42 Not built: look for coach video analytics on the coach Analytics tab

## 4. Tab 3, test result log

Tab 3 is a template with one example row. Log every scenario from section 3 in this shape as it is run, either in the sheet or in BUG-LEDGER.md:

| ID | Area | Scenario | Expected | Result | Notes |
|----|------|----------|----------|--------|-------|
| T-01 (example) | Home | Scroll the whole Home screen top to bottom | Search bar, location bar, category chips, banner carousel, Clutch preview, Empower rail, Shop and Learn entry points all render | Pass | All good |

- [ ] Fill Expected for every scenario in section 3 before its profile day
- [ ] Record Result and Notes for all 188 scenarios
- [ ] Anything that fails becomes a row in BUG-LEDGER.md and feeds task 13
