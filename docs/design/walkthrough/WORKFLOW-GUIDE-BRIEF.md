# Visual workflow guide, builder brief

Status: brief ready, capture not started. Written 2026-09-15 from a verified source read of every screen. The audit is done; this brief exists so a fresh agent can build the guide without re-auditing.

Give a builder agent this one line:

> Read `docs/design/walkthrough/WORKFLOW-GUIDE-BRIEF.md` and build the guide it describes. Do not re-audit the codebase; the map in `docs/design/walkthrough/map/` is the audit.

What is in this folder:

| Path | What it is |
|---|---|
| `WORKFLOW-GUIDE-BRIEF.md` | This file. Sections A to D are the repo specific rules. Section E is the presentation brief, verbatim. |
| `map/README.md` and `map/*.md` | The verified workflow map: 127 workflows, 306 screens, every route, source file, tap target label and state, one file per surface. |
| `guide/` | Where the built guide's source goes (created by the builder, see D). |

Read order: this file top to bottom, then `map/README.md`, then the map file for whichever section you are building. Sections A to D override the generic wording in E wherever they disagree.

---

## A. SOURCE ARTIFACTS

### A1. Product truth documents

Read these for scope and behaviour. Do not read the whole codebase; open a source file only to confirm a label or a state the map cites.

| Document | Use it for |
|---|---|
| `docs/qa/RELEASE-TODO-PRASANTH.md` section 3 | The 188 release test scenarios by profile (Guest, Athlete, Coach, Shopper, Donor, Admin). This is the founder approved list of what a user does; every guide workflow traces to one or more scenario ids. Section 1 task 5 is the courts click out decision. |
| `docs/qa/TEST-SUITE-ATHLETE-APP.md` | The 80 route tree of the athlete app with what each screen shows and which defects were seen on it. |
| `docs/qa/UX-AND-BUG-REPORT-2026-09-05.md` | Information architecture and navigation review; the IA diagram for the master visual map starts here. |
| `docs/qa/TEST-CATALOG.md` and `docs/qa/test-catalog.json` | The 141 case catalog by domain (AUTH, CL, FO, CH, CT, CO, SH, EM, AD, XP). Case ids are the second traceability key. |
| `docs/qa/PHASE-A-GAP-INVENTORY.md` | What the PRDs promise that the code does not have. Anything listed there is not shown as a working flow. |
| `docs/qa/BUG-LEDGER.md` and `docs/qa/FOUNDER-REVIEW.md` | Open defects. A screen with an open P0 or P1 defect visible in frame is not captured until it is fixed (see B9). |
| `docs/design/UI-UPLIFT-PROPOSAL.md` | The 90 uplift moves. P0 items are the capture gate (B1). |
| `docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/README.md` | The last native walkthrough: what it proved and the seven blockers it found. |
| `docs/design/TASTE.md` and `docs/design/DESIGN-LANGUAGE.md` | The brand the guide must respect: Urbanist, JetBrains Mono numerals, one orange accent, lucide icons, no emojis, no em dashes or hyphens in visible copy. |
| `docs/qa/EMULATOR-TEST-SESSION.md` | The durable simulator driving pattern (one owner, checkpoint before slow steps). |
| `docs/qa/APP-STORE-SUBMISSION-PACK.md` | Store screenshot constraints; the guide is not the store pack, but it is the closest thing to one. |
| `docs/prd/PRD-01` to `PRD-07` | Scope ceiling per persona. Cite `PRD-0X FR-y` in the guide's source comments, not in the visible guide. |
| `docs/architecture/PAYMENTS.md` | The money path every payment screen follows (intent, native sheet, verify, ledger). |

### A2. The verified workflow map

`docs/design/walkthrough/map/` holds the audit output, one file per surface:

| File | Covers |
|---|---|
| `mobile-account-home.md` | Launch, splash, login, register, forgot password, onboarding, Home, AI search, You tab, edit profile, settings, notifications, blocked, delete account, sign out, guest gate. |
| `mobile-clutch-chat.md` | Clutch feed, post viewer, creator profile, post a clip, own clips, report and block, Messages, group threads. |
| `mobile-courts-coaching.md` | Courts, coach browse, coach profile, session booking and pay, sessions, cancel, reschedule, rate, groups join and renew, athlete Trainings. |
| `mobile-shop-empower-learn.md` | Shop, product, cart, checkout, address, orders, wishlist, affiliate, Razorpay sheet, Empower hub, athlete profile, donate, My Impact, Learn. |
| `mobile-coach.md` | Coach onboarding, verification, Stats, availability, requests, session lifecycle, trainees, groups and attendance, earnings, payout, transfer, coach chat, analytics. |
| `web-surfaces.md` | Atlitos Partners (court portal), Atlitos Life (UPA portal), Atlitos Admin. |

For every screen the map gives: the route (deep link or URL path), the source file, what you see, what to do, the exact tap target labels or lucide icon names, what happens next, and every loading, empty, error, gate, processing, success and failed state with the file that renders it. Use it as the script for each workflow. Where a caption needs a label, take it from the map, then grep the cited file once to confirm it survived the uplift.

Caveat: the map was read against a mid uplift working tree (2026-09-15). Labels can move. Routes and files are stable.

### A3. Master workflow index

This is the guide's table of contents and its numbering. Tier 1 gets the full step by step treatment (every screen, pinpoints, action, result, end card). Tier 2 gets the compact treatment (one or two framed screens with pinpoints, one line each for see, do, happens). Tier 3 is a single reference card in the appendix, no screenshots, stating what is hidden or not built and why.

Release ids in brackets are the `RELEASE-TODO-PRASANTH.md` section 3 scenarios the workflow proves.

**A. First open and account** (mobile, guest then player)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| A-01 | 1 | App launch and splash, silent guest session | guest |
| A-02 | 1 | Home tour: AppBar, AI search, sport circles, promo carousel, rails, brand footer, bottom nav pill | guest |
| A-03 | 1 | Guest experience of each tab and the login gate sheet (Want to hit the spotlight?) [G-30] | guest |
| A-04 | 1 | AI search across coaches, courts, gear, athletes and clips | guest |
| A-05 | 1 | Register (Create your account) and the Check your email state [A-01 to A-03] | guest |
| A-06 | 1 | Log in: password, one time code, Google, Apple, Continue on this device [A-07, A-08] | guest |
| A-07 | 1 | Forgot password: Send code, Enter the code, Set a new password, ends signed in on Home [A-04 to A-06] | guest |
| A-08 | 1 | Finish setting up card, role select and player onboarding (Sports, Photo, Location) [A-09 to A-12] | player |
| A-09 | 2 | You tab (Profile): cover, handle, Following and Followers, My posts, Liked posts, Follows, My wishlist [A-23] | player |
| A-10 | 2 | Edit profile: cover photo, profile photo, handle availability, bio | player |
| A-11 | 1 | Settings: Appearance, Preferred sports, Location, Notification switches, Account rows, Legal and support [A-36, A-37] | player |
| A-12 | 1 | Notifications list, Mark all read, and Preferences (Push and Email per type) [A-13, A-14, A-34, A-35] | player |
| A-13 | 1 | Sign out from Settings and Log out from the Home footer, lands on Home as guest [A-38] | player |
| A-14 | 2 | Delete account: two native alerts from Settings [A-39 to A-43] | player |

**B. Clutch (clips)** (mobile)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| B-01 | 1 | Browse the Clutch feed: swipe, autoplay, right rail [G-11, A-20] | guest |
| B-02 | 2 | Clutch preview on Home and Open Clutch | guest |
| B-03 | 1 | Open a clip (Post viewer): like, comments sheet, mute [G-12, G-13, A-15, A-16] | guest |
| B-04 | 2 | Find a clip through AI search (Clips segment) | guest |
| B-05 | 1 | View a creator profile, Follow and Following [G-14, A-21, A-22] | guest |
| B-06 | 2 | Share a clip (OS share sheet, caption text only) | player |
| B-07 | 1 | Post a clip: Select a clip, caption, sport chip, Post clip, Clip in review [G-16, A-17 to A-19] | player |
| B-08 | 1 | Own clips on the profile grid (Pending, Under review, Rejected, Removed pills), My clips, Liked posts, Follows | player |
| B-09 | 2 | Moderation outcome notification (Your clip is live, not approved, removed) | player |
| B-10 | 1 | Report a post, Block an account, Blocked accounts with Unblock | player |

**C. Coaches and sessions** (mobile, player)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| C-01 | 1 | Find a coach: Trainings Find a coach card, Coaches sub tab, sport chips [A-28] | guest |
| C-02 | 1 | Coach profile: session type, frequency, date, time, details, Continue | guest |
| C-03 | 1 | Pay for a coaching session: Reserving, Confirm and pay (Session fee), Razorpay, Session requested [A-29] | player |
| C-04 | 1 | My sessions: stat tiles, upcoming and history with status pills [A-27, A-30] | player |
| C-05 | 1 | Session detail: Cancel request (full refund), Cancel session, refund card, declined reason [A-31] | player |
| C-06 | 2 | Message coach from a session (opens the chat thread) | player |
| C-07 | 2 | Reschedule a coaching session (new session id) | player |
| C-08 | 2 | What attendance means for a player: Requested, Accepted, Completed, Rated pills | player |
| C-09 | 1 | Rate a coach after the coach marks the session complete | player |
| C-10 | 1 | Join a training group (Join, month 1, Monthly fee, You are in) | player |
| C-11 | 2 | Renew a lapsed group membership (Renew, Membership renewed) | player |

**D. Trainings tab** (mobile, player)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| D-01 | 1 | Trainings Stats dashboard: tiles, My sports, My groups, Upcoming sessions, Session requests, Milestones and rewards, My review videos [A-27] | player |
| D-02 | 2 | Open a session detail from inside Trainings (Stats card or Payments row) | player |
| D-03 | 1 | Payments tab: Paid for sessions held, Booked ahead, Transactions | player |
| D-04 | 2 | Analytics tab: monthly sessions and hours, XP tile, Not enough sessions yet | player |
| D-05 | 2 | My review videos (coach posted, full screen playback) | player |

**E. Chat** (mobile)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| E-01 | 1 | Messages thread list and a 1:1 thread (optimistic send, realtime pill) [C-28, C-29] | player |
| E-02 | 2 | Trainings Chat tab and chat thread inside the Trainings stack | player |
| E-03 | 1 | Group thread: sender names, N members row, Group members sheet | player |

**F. Learn** (mobile, player)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| F-01 | 1 | Learn home: Total XP, Milestones, roadmap card, Drills preview (via Trainings Open Learn) [A-24] | player |
| F-02 | 2 | Roadmap: stage ladder with You are here | player |
| F-03 | 1 | Drills library with sport and difficulty filters | player |
| F-04 | 1 | Drill detail and Mark complete (confirm sheet, Completed banner, XP) [A-25, A-26] | player |
| F-05 | 2 | Milestones: Earned and Locked | player |

**G. Courts, release shape** (mobile)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| G-01 | 1 | Find a court: Courts tab near your city, sport chips, court cards [G-17] | guest |
| G-02 | 1 | Court detail: photos, sport, address, rating, base price, read only [G-18, G-22] | guest |
| G-03 | 1 | Court affiliate click out: Book on {partner}, disclosure line, missing link state, back gesture returns [G-19 to G-21, A-32] | guest |
| G-04 | 2 | Find a court through AI search (Courts segment lands on the detail) | guest |

**H. Shop (gear)** (mobile)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| H-01 | 1 | Browse gear: Home sport circles, All gear grid, Search gear, category chips, Recommended gears [G-23, S-01] | guest |
| H-02 | 2 | Find gear or an athlete through AI search (Gear and Athletes segments) | guest |
| H-03 | 1 | Product detail: Select a size, out of stock notice, Add to cart (guest gate), Go to cart [G-24, S-02, S-03] | shopper |
| H-04 | 1 | Save gear to the wishlist, My wishlist, Move to cart, Pick a size [S-18, S-19] | shopper |
| H-05 | 1 | Your cart: stepper with stock cap, Remove confirm sheet, blocked lines, Proceed to buy [S-04 to S-07] | shopper |
| H-06 | 1 | Shipping address at checkout: pick a saved address or add one (6 digit pincode) [S-08, S-09] | shopper |
| H-07 | 1 | Checkout: Your order, BillSummary, Support a Rising Athlete in Need, Continue to pay, Razorpay, Order successfully placed [S-10 to S-14, D-18] | shopper |
| H-08 | 1 | Razorpay pay sheet, shared pattern: processing, success, failed, retry, PRICE_MISMATCH reconfirm [S-13] | shopper |
| H-09 | 1 | My orders, Order tracking timeline (Placed to Delivered), refund card, Order feedback [S-15 to S-17] | shopper |
| H-10 | 2 | Address book: add, edit, set default, delete with order guard (deep link only) [S-20, S-21] | shopper |
| H-11 | 2 | Affiliate product: Compare prices, Cheapest, Buy on {retailer} click out (deep link only) [G-25, G-26, S-22 to S-27] | guest |

**I. Empower (donor)** (mobile)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| I-01 | 1 | Donate to Empower rail on Home and the Empower hub with sport and region filters [G-27, D-01 to D-03] | guest |
| I-02 | 1 | Athlete (UPA) profile: Verified athlete, Raised to date, Wishlist Fund this, supporters, thank you notes [D-04 to D-07] | guest |
| I-03 | 1 | Donate: presets, custom amount, minimum, Confirm your donation, processing, Thank you for giving, failed and item funded states [G-28, D-08 to D-12] | donor |
| I-04 | 1 | My Impact: Total given, Athletes supported, Items funded, Donation history, Gratitude received [D-13 to D-16] | donor |
| I-05 | 2 | Checkout roundup (Support a Rising Athlete in Need) shows as General Fund in My Impact [D-18, D-19] | donor |

**J. Coach mode** (mobile, coach)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| J-01 | 1 | Coach onboarding wizard: Sport, Photo, Experience, Certificates, Pricing (session types), Availability, About, Submitted for review [C-01 to C-05] | coach |
| J-02 | 1 | Verification status on the Trainings tab: pending, rejected with Edit and resubmit, verified after relaunch [C-06 to C-09] | coach |
| J-03 | 1 | Coach Stats dashboard: six tiles, Upcoming sessions preview, Session requests with Accept and Decline, Milestones rail | coach |
| J-04 | 1 | Availability: add and delete weekly windows per day [C-14 to C-16] | coach |
| J-05 | 3 | Session types: created only in the onboarding Pricing step, no post onboarding management [C-10 to C-13] | coach |
| J-06 | 1 | Requests: filter chips, Accept, Decline (auto refund) [C-17, C-18] | coach |
| J-07 | 2 | Requested session detail is read only (You earn, no actions) | coach |
| J-08 | 2 | Upcoming sessions list (1:1 and group, filter chips) | coach |
| J-09 | 1 | 1:1 session lifecycle: Mark complete, Cancel session with reason, Reschedule [C-19 to C-21] | coach |
| J-10 | 1 | Trainees tab: roster filters, trainee cards, group cards | coach |
| J-11 | 1 | Trainee profile: Overview, Sessions, Payments, Notes (Add note, long press delete), Video Analytics placeholder, Message [C-25 to C-27] | coach |
| J-12 | 2 | Training group profile, view only: attributes, Team members, Sessions [C-22 to C-24 are not built] | coach |
| J-13 | 1 | Group session attendance: Start session, Present / Absent, Mark attendance, End session | coach |
| J-14 | 1 | Earnings tab, Payout account setup (Send), Transfer to bank with BillSummary [C-31 to C-34] | coach |
| J-15 | 2 | Coach chat: Trainings Chat tab, 1:1 and group threads, send message [C-28 to C-30] | coach |
| J-16 | 2 | Coach analytics (tab labelled Video Analytics, numeric monthly trends) [C-35, C-36] | coach |
| J-17 | 3 | Coach video review upload is not reachable; athlete My review videos is the read side | coach |
| J-18 | 2 | Settings from the Trainings shell gear (Become a coach visibility rules) | coach |
| J-19 | 3 | Coach only drill ins a player can deep link into and their error states | coach |

**K. Court partner portal, Atlitos Partners** (web)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| K-01 | 1 | Court partner sign up | court partner |
| K-02 | 1 | Sign in, dashboard shell, theme toggle, sign out | court partner |
| K-03 | 1 | Onboarding: Venue details, Courts, Photos (3 to 12), Review, Verification status, Edit and resubmit | court partner |
| K-04 | 1 | Overview: Bookings today, Revenue this week, Occupancy today, venue switcher | court partner |
| K-05 | 1 | Venues and courts: status pills, court active toggles, Add a court, photos, Add another venue | court partner |
| K-06 | 1 | Slots and pricing: base price, weekly availability, blackout dates, peak pricing rules | court partner |
| K-07 | 1 | Live today: bookings by court, Check in, Cancel with reason, bill dialog, Record a walk in | court partner |
| K-08 | 1 | Earnings and payouts: Pending balance, Last payout, Payout account, This month BillSummary, 14 day chart, Transfer history, read only | court partner |

**L. UPA portal, Atlitos Life** (web)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| L-01 | 1 | UPA sign up and sign in | upa |
| L-02 | 2 | Life shell sidebar: role aware nav, sign out, theme toggle | upa |
| L-03 | 1 | Apply as a UPA: Your story, Sport and region, Certificates, Match videos, submit or resubmit | upa |
| L-04 | 1 | Application status roadmap: Submitted, Under review, Needs more info, Verified, Not approved, Reapply | upa |
| L-05 | 1 | Dashboard: Total raised, Supporters, Items funded, Money in (Payouts Arriving soon), thank you nudge | upa |
| L-06 | 1 | Wishlist items: add, edit, remove, Funding progress, Mark as delivered | upa |
| L-07 | 1 | Gratitude: Post thank you for a funded item, Remove post | upa |
| L-08 | 2 | Profile preview (What sponsors see) | upa |
| L-09 | 2 | Account: sign out, read only profile, Deactivate my profile (always errors for verified, see C2) | upa |

**M. Admin, Atlitos Admin** (web)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| M-01 | 1 | Admin login and logout, shell nav, no dashboard route [AD-01 to AD-05] | admin |
| M-02 | 1 | Verification queue: Coach, Venue, UPA tabs, Approve, Reject with reason [AD-07 to AD-09] | admin |
| M-03 | 2 | Venues: list, filter, search, detail, Approve venue, Reject venue [AD-10, AD-11] | admin |
| M-04 | 1 | Moderation queue: clip preview, Approve and publish, Reject with reason [AD-12 to AD-14] | admin |
| M-05 | 1 | Reports queue: Take down or Dismiss report with reason [AD-15 to AD-18] | admin |
| M-06 | 1 | Users: search by name or phone, inline Suspend and Reinstate [AD-19 to AD-23] | admin |
| M-07 | 1 | Orders: list, detail, BillSummary, Advance this order (shipped, in transit, delivered), Timeline [AD-24, AD-26, AD-27] | admin |
| M-08 | 2 | Catalog and stock: edit product, variants, Adjust stock with reason, images, no create [AD-31 to AD-33] | admin |
| M-09 | 1 | Drills: list, filter, New drill, edit, Activate or Deactivate [AD-34, AD-35] | admin |
| M-10 | 1 | Fee config: edit percent or flat rows with a change note [AD-28 to AD-30] | admin |
| M-11 | 2 | Bookings: read only support list with payment status, walk ins only after task 5 [AD-36] | admin |

**N. Hidden for release, reference cards only** (mobile)

| Id | Tier | Workflow | Persona |
|---|---|---|---|
| N-01 | 3 | Court detail slot picker and Book this slot, replaced by the click out | player |
| N-02 | 3 | Book and pay for a court slot: Reserving your slot, Confirm and pay, Razorpay, Court booked | player |
| N-03 | 3 | My bookings list and court booking detail | player |
| N-04 | 3 | Cancel a court booking | player |
| N-05 | 3 | Reschedule a court booking | player |
| N-06 | 3 | Rate a court after a completed booking | player |

End to end journeys for the final pages (E section 21), built from the ids above:

- New player: A-01, A-02, A-05, A-08, C-01, C-02, C-03, C-04, C-08, C-09
- Shopper: H-01, H-03, H-05, H-06, H-07, H-08, H-09
- Donor: I-01, I-02, I-03, I-04
- Creator: B-01, B-07, B-08, M-04, B-09, B-03
- Player and coach: C-01 to C-03 then J-06, J-09, then C-09; group: C-10, J-13, E-03
- Coach: J-01, J-02, M-02, J-04, J-06, J-09, J-14
- Court partner: K-01, K-03, M-03, K-06, K-07, K-08
- Verified athlete (UPA): L-01, L-03, M-02, L-06, I-03, L-05, L-07

### A4. Personas

Passwords are never written anywhere in this folder or in the guide. Read them from the environment variable named below (`scripts/lib/demo-credentials.mjs` exports the same names). The Empower rows exist on the live project only after `scripts/seed-empower-upa-users.mjs` has been run with the service role key.

| Persona | Email | Password env var | Use for |
|---|---|---|---|
| Demo Player | player@atlitos.dev | ATLITOS_DEMO_PASSWORD | Every signed in player, shopper and donor workflow (A to I). Richest data: 22 sessions with Ravi Kumar, Cric Squad membership, 24 orders, cart, wishlist, addresses, 8 own clips, Learn XP 150, 32 chat threads, 29 notifications. |
| Ravi Kumar, verified cricket coach | coach1@atlitos.dev | ATLITOS_DEMO_PASSWORD | Section J and the coach side of C and E. Owns Cric Squad, session types Batting Basics and Advanced Bowling, availability, earnings. |
| Sana Iyer, verified tennis coach, unrated | coach2@atlitos.dev | ATLITOS_DEMO_PASSWORD | Coach empty states (no trainees, no requests, no earnings) and the second card in coach browse. |
| Demo Court Partner | partner@atlitos.dev | ATLITOS_DEMO_PASSWORD | Section K with one venue (Onboarding Demo Turf). |
| P2 verify partner | p2-verify-partner@atlitos.dev | ATLITOS_DEMO_PASSWORD | Section K with eight Hyderabad venues, courts, pricing rules. |
| P2 verify athlete | p2-verify-athlete@atlitos.dev | ATLITOS_DEMO_PASSWORD | Empty Learn state, second member in the group thread, isolation frames. |
| Demo Admin | admin@atlitos.dev | ATLITOS_DEMO_PASSWORD | Section M. |
| Priya Cricket, verified UPA | upa.verified@atlitos.dev | EMPOWER_DEMO_PASSWORD | L-05 to L-08 and the athlete profile in I-02. |
| Rajesh Tennis, under review | upa.tennis@atlitos.dev | EMPOWER_DEMO_PASSWORD | L-04 pending branch. |
| Ananya Badminton, needs info | upa.badminton@atlitos.dev | EMPOWER_DEMO_PASSWORD | L-04 needs more info branch. |
| Vikram Football, rejected | upa.football@atlitos.dev | EMPOWER_DEMO_PASSWORD | L-04 not approved and reapply cooldown branch. |
| Demo Donor | donor@atlitos.dev | EMPOWER_DEMO_PASSWORD | I-03, I-04 donor history. |
| App Store review account | not created yet (release task 14) | | Never used for the guide. |

Guest frames: sign out first (Settings, Sign out), confirm the AppBar avatar shows the guest state, and close any open gate sheet before the next deep link. `launchApp: clearState` does not clear the Keychain session.

### A5. Existing screenshots

There are 143 image files under `docs/phases/evidence/`. Every one predates the September rebrand (logo orange, neutral surfaces, Urbanist, glass nav pill) and many show documented defects (BUG-06 flat colour imagery, the nav overlap, blank first paint). None may appear in the guide. Use them only to preview a screen's layout before you drive to it. Each map entry lists its prior captures under "Prior captures" for exactly that purpose.

The two per screen PDFs from the 2026-09-14 walkthrough were handed to the founder and are not in the repo.

### A6. Deep link rule

Scheme `atlitos` (`apps/mobile/app.json`). Take the file path under `apps/mobile/src/app`, drop `.tsx`, drop a trailing `/index`, drop every parenthesised group segment (`(auth)`, `(onboarding)`, `(tabs)`, `(shell)`), replace each `[param]` with a real id, prefix `atlitos://`. Including a group segment misroutes.

| File | Deep link |
|---|---|
| `(tabs)/courts/index.tsx` | `atlitos://courts` |
| `(tabs)/clutch/index.tsx` | `atlitos://clutch` |
| `(tabs)/trainings/(shell)/earnings.tsx` | `atlitos://trainings/earnings` |
| `(tabs)/trainings/upcoming.tsx` | `atlitos://trainings/upcoming` |
| `(auth)/login.tsx` | `atlitos://login` |
| `(onboarding)/coach-setup/[step].tsx` | `atlitos://coach-setup/0` |
| `shop/cart.tsx` | `atlitos://shop/cart` |
| `shop/product/[id].tsx` | `atlitos://shop/product/20000000-0000-0000-0000-000000000001` (Professional Cricket Bat) |
| `shop/affiliate/[id].tsx` | `atlitos://shop/affiliate/a0000000-0000-0000-0000-000000000001` (Babolat Pure Drive Team) |
| `(tabs)/coaching/coach/[id].tsx` | `atlitos://coaching/coach/5b262cf1-8f95-45df-b453-0802013f82a1` (Ravi Kumar) |
| `(tabs)/clutch/post/[id].tsx` | `atlitos://clutch/post/67bdf7a9-e431-44c7-a736-15be8d6ee29a` (real bytes clip owned by player@) |
| `(tabs)/courts/court/[id].tsx` | `atlitos://courts/court/a0000000-0000-0000-0000-000000000001` (Gachibowli Box Cricket Turf) |
| `home/search.tsx`, `settings.tsx`, `account/impact.tsx` | `atlitos://home/search`, `atlitos://settings`, `atlitos://account/impact` |

Special links: `atlitos://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081` points the dev client at Metro; `atlitos://login` is how every signed in Maestro flow reaches the auth screen.

Deep links are for getting to a screen. The guide must still show the in app path (which tab, which card, which button) because that is what the reader will do.

### A7. Driving helpers

- Maestro flows in `.maestro/` (appId `com.atlitos.app`, binary at `~/.maestro/bin`). Reusable as is: `smoke-guest-home`, `search-domains`, `shop-back`, `category-nav`, `courts-header`, `profile-gate`, `clutch-like-gate`, `gate-login-nav`, `auth-register-skip`, `groups-join-guard`, `groups-athlete`, `trainings-coach-browse`, `trainings-shell`. `groups-coach.yaml` MUTATES the seeded Cric Squad session to completed; reset with the two UPDATE statements in its header before shooting J-13 again.
- The iOS Simulator MCP tool (`attach`, `screenshot`, `inspect`, `tap`, `swipe`, `text`, `open_url`) needs no macOS grants and returns the accessibility tree with frames in points; use `inspect` to place pinpoints (B8).
- `cliclick` and `screencapture` need Accessibility and Screen Recording granted to the terminal and a terminal restart. Prefer the two options above.
- Native `ConfirmSheet` content is invisible to Maestro and VoiceOver (only Close is findable); tap it by coordinate.

### A8. Environments

Local:

| App | Command | URL |
|---|---|---|
| Mobile dev client | `export PATH="$HOME/.nvm/versions/node/v22.5.1/bin:$PATH"; cd apps/mobile; nohup npx expo start --dev-client --port 8081 > /tmp/atlitos-metro.log 2>&1 & disown` then `xcrun simctl launch <udid> com.atlitos.app` | Metro on 8081; app via `atlitos://` |
| Rebuild dev client (native deps changed) | `cd apps/mobile && npx expo run:ios` | |
| Atlitos Partners | `pnpm --filter @atlitos/portal-court dev` (needs `apps/portal-court/.env.local`) | http://localhost:3000 |
| Atlitos Life | `pnpm --filter @atlitos/portal-life dev -p 3002` (needs `apps/portal-life/.env.local`) | http://localhost:3002 |
| Atlitos Admin | `pnpm --filter @atlitos/admin dev` (needs `apps/admin/.env`) | http://localhost:5174 |
| Landing | `cd apps/landing && python3 -m http.server 8080` | http://localhost:8080 |

Live: https://atlitos-app.vercel.app (athlete web export, not a substitute for native), https://atlitos-portal-court.vercel.app, https://atlitos-portal-life.vercel.app, https://atlitos-admin.vercel.app, https://www.atlitos.com. Backend project `syzzfgaudpifwvbpycyi`. Web captures may be taken against the live aliases once the rebrand is deployed; until then run locally from the working tree.

### A9. Data quirks that corrupt a capture

- BUG-06: seeded venue, product, banner and Empower images render as flat colour blocks or blank boxes. Uplift Designer P0 items 3, 7 and P2 item 22 replace them. Do not capture a screen whose hero is a colour block.
- BUG-02: clip thumbnails never render; the profile grid tiles are blank until fixed.
- The feed clip is an ffmpeg test pattern (static noise) uploaded by `scripts/seed-clutch-clip-bytes.mjs`. A Clutch hero needs a real clip posted by player@ first (B-07 produces it; it must then be approved in M-04).
- Six "RLS matrix probe video" rows appear in My review videos; "TrackB Verify" appears as a shop chip; "Demo Player", "P2 Verify Athlete" and a coach named after the founder appear in lists. Release task 21 (data cleanup) removes them; until then they are acceptable in a draft and must be gone from the final.
- Courts uses GPS while search and Home use the profile city. The simulator defaults to San Francisco, so set a custom location to Hyderabad (17.4435, 78.3772) before shooting anything with distances.
- Coach availability windows cover only 7 days from the last `scripts/seed-coaching-fixtures.mjs` run; re-run it before C-02 or the slot list is empty. Seeded session dates are July to September 2026, so Upcoming lists read empty today.
- Shared variant `30000000-0000-0000-0000-000000000003` gets depleted by money specs; `apps/e2e/seed/reset.mjs` (with `E2E=1` and the service role key) restores stock.
- Migrations 0118 to 0125 are unapplied on the live project (last applied 0117). Until release task 8 lands, Messages, Blocked accounts, suspension and account deletion show raw Postgres errors.
- Razorpay is in test mode (Test Mode badge on the sheet) and Route is not enabled, so payout setup returns ROUTE_UNAVAILABLE and the Life dashboard says Arriving soon. Show those states; do not promise a completed transfer.
- A persona's stored `users.theme` overrides the simulator appearance once signed in. Keep player@ and coach1@ on System (Settings, Appearance) or every dark frame silently comes out light.

---

## B. SCREENSHOT RULES

### B1. When to capture

Hard gates. Do not capture a single mobile frame until all three hold:

1. The dev client is rebuilt from the current working tree (`npx expo run:ios`), because the new nav imports `expo-blur` and an older client cannot link it. Confirm by opening Home and seeing the glass pill nav.
2. Every P0 item in `docs/design/UI-UPLIFT-PROPOSAL.md` (Designer P0 1 to 8, Developer P0 1 to 5, Premium P0) is landed on the branch you capture from, or the founder has waived it by number in `PHASE` status or this file. The proposal defines P0 as "broken or embarrassing" and "ships before TestFlight screenshots"; the same bar applies here.
3. `pnpm turbo typecheck build lint` is green on that branch.

Soft gates. Capture anyway when unmet, stamp the affected workflow PRE-RELEASE in the guide, and list it on the guide's final "Known gaps" card so the frames get reshot:

4. Migrations 0118 to 0125 applied (release task 8). Affects E-01, E-03, B-10, A-14.
5. Courts click out built (release task 5). Until then G-03 is a placeholder frame drawn from the affiliate screen H-11 with a caption saying so, and G-02 is captured with the slot picker cropped out.
6. Data cleanup (release task 21). Fixture names are tolerated in a draft, not in the final.
7. Empower personas seeded on the project (A4). Affects L-04 branches and I-04.
8. Portal and admin rebrand files in the working tree (`globals.css`, `layout.tsx`, `tokens.css`) merged. Web frames wait for this the same way mobile frames wait for gate 2.

If a hard gate cannot be met, stop and report which one; do not substitute the pre-rebrand evidence.

### B2. Mobile device and environment

- Device: the booted `ONEDUE-Shots-17ProMax` simulator, iPhone 17 Pro Max, iOS 26.5, UDID `79D0580E-6FBD-40F0-B869-953C32BA02B0`, 1320 by 2868 px, 440 by 956 pt. Fallback `iPhone 17 Pro`, UDID `5B4A18B1-9D15-47CE-9BBB-C41AC77C77E6`. Two sims are booted, so always pass the UDID, never `booted`. Portrait only.
- One owner. Exactly one agent drives the simulator for the whole capture run (`docs/qa/EMULATOR-TEST-SESSION.md`). Checkpoint the file list after every workflow.
- Before the run, once: `xcrun simctl status_bar <udid> override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --operatorName '' --batteryState charged --batteryLevel 100`; Simulator, Features, Location, Custom Location 17.4435, 78.3772; `xcrun simctl ui <udid> appearance light`; dismiss the RN LogBox bar and never open the dev menu; decline the iOS Save Password prompt.
- Metro is started detached (A8) and checked with `lsof -iTCP:8081 -sTCP:LISTEN` before every workflow. "No script URL provided" means re-point the client with the expo-development-client link.
- Navigate with deep links, then perform the in app taps the workflow describes so that transient UI (sheets, toasts, pressed states) is real. Settle 3 seconds after every deep link and after every tap that loads data; the You, Courts and bookings screens paint blank for 3 to 8 seconds on first open.
- Capture with `xcrun simctl io <udid> screenshot <path>.png` (or the Simulator MCP `screenshot`). Never `screencapture` the Simulator window.

### B3. Web surfaces

- Viewport 1440 by 900, device scale factor 2, light theme, for Atlitos Partners, Atlitos Life and Atlitos Admin. Capture the viewport only (no browser chrome); the guide draws its own browser frame. Long pages get one viewport frame at the top plus one full page frame.
- Theme: the portals use next-themes with the class strategy; force with `localStorage.setItem('theme','light')` then reload and assert `document.documentElement.classList.contains('dark') === false` before every frame. Admin is light only; never fake a dark admin.
- Sign in through the real login form for the persona (A4); do not inject storage state for guide frames, because the guide shows the sign in screens.
- Capture with Playwright (`page.screenshot`) or the Browser pane after `resize_window` to 1440 by 900. The athlete web export is not a substitute for native mobile frames.
- Add one 390 wide frame per portal section only for the responsive spread on the cover page, nothing else.

### B4. Capture protocol per screen

For every screen in a Tier 1 or Tier 2 workflow, in order:

1. Reach it the way the reader will (previous screen, then the tap the map names). Deep link only to reset.
2. Wait for the loaded state: no skeleton, no spinner, no blank first paint. Verify by reading the accessibility tree (`inspect`) for the title the map cites.
3. Capture the default state.
4. Capture each state the map lists for that screen that can be reached without moving money or writing shared data: empty, error (airplane mode via Simulator, Features, or a bad id), guest gate, disabled CTA, confirm sheet open, success toast. One file per state.
5. Record the pinpoint coordinates for that frame from the accessibility tree (B8), not by eye.
6. Append a row to `guide/screens/manifest.csv`: workflow id, step, screen name, state, theme, persona, route, file, capture time, sim UDID or viewport, git commit.

A workflow is not done until its end card frame exists (the confirmation, success or destination screen the workflow ends on).

### B5. Money and shared data

- Never tap Pay for a screenshot on your own. The Razorpay sheet (Test Mode badge visible) is the last frame you capture unsupervised.
- Processing and success frames for the four live money paths (H-07 checkout, C-03 session pay, C-10 and C-11 group join and renew, I-03 donate) are captured in one founder supervised session: the founder enters the test card, the agent captures processing, success and the post action destination. Book that session once, do all four paths, reset stock and slots afterwards with `apps/e2e/seed/reset.mjs` and `scripts/seed-coaching-fixtures.mjs`.
- Failed and retry frames come from cancelling the sheet (S-13), never from a declined card.
- Admin actions that change shared state (approve a coach, publish a clip, advance an order, suspend a user) are captured on fixtures created for the guide by the same run (the clip posted in B-07, the coach request from J-01 on a throwaway account), and reversed or documented afterwards.
- Do not run `groups-coach.yaml` without resetting the session it mutates.
- Account deletion (A-14) is captured up to the second alert only. Never confirm it on a shared persona.

### B6. Theme

- Light is the canonical guide set. Every Tier 1 and Tier 2 frame is captured in light.
- Dark is captured for one hero frame per section (Home, Clutch feed, Trainings Stats, Courts, Shop grid, Empower hub, coach Stats, the three web dashboards) for a single "Light and dark" spread on the cover page. Clutch feed is always dark by design.
- Set the persona's theme to System in Settings, Appearance before the run, then switch with `xcrun simctl ui <udid> appearance light|dark` and re-navigate. Assert the resolved scheme from the status bar colour before saving a dark frame.

### B7. Files, format, size, where they live

- Capture originals as PNG at native resolution into `~/atlitos-shots/<date>/<workflow id>/`. Originals are not committed (the 2026-09-14 PDFs set that precedent for size).
- Publish frames are WebP, quality 82, mobile resized to 880 px wide (2x logical), web resized to 1440 px wide, each 150 KB or less, written to `docs/design/walkthrough/guide/screens/<section>/`.
- File name: `<workflow id>-<step two digits>-<screen slug>-<state>-<theme>.webp`, for example `H-07-03-checkout-bill-summary-default-light.webp`, `A-03-02-clutch-login-gate-gate-light.webp`. Slugs are lowercase, words separated by underscores, no other characters.
- What is committed: `guide/` source (HTML, CSS, JS, `pins.json`, `manifest.csv`), one contact sheet JPEG per section under `guide/contact-sheets/` (2400 px wide, 400 KB or less, 14 files) as evidence, and the publish WebPs only if the whole `guide/screens/` tree stays under 25 MB. If it does not, the WebPs are published as Artifact supporting files and archived in `~/Desktop/atlitos-walkthrough-screens-<date>.zip` for the founder, and only the contact sheets are committed.
- Artifact limits shape the split (D1): a page is 16 MB or less, 255 supporting files per publish, 64 MB per version.

### B8. Framing and pinpoints

- No overlays are ever baked into an image. Frames, shadows, pinpoints and connector lines are drawn by the guide's HTML and CSS over the raw capture, so they scale on a phone and print cleanly.
- Mobile frames sit inside a CSS device frame: 440 by 956 aspect, corner radius that matches the capture's own screen corners, a 1 px hairline border and a soft shadow, all from the portal HSL tokens or `packages/theme` values. Web frames sit inside a minimal browser frame with three dots and a URL bar showing the real path.
- Pinpoints are circled numerals in the brand accent (`accent` from `packages/theme/src/colors.ts`), white ink, 28 px on desktop, 24 px on mobile, placed at the centre of the target element with a 2 px white ring, and a hairline connector to the caption only when the target is small.
- Coordinates come from the accessibility tree: take the element's frame in points from `inspect` (or the Maestro hierarchy, or `getBoundingClientRect` on web), convert to percentages of the capture's logical size, and store them in `guide/pins.json` keyed by file name: `{ "H-07-03-...": [ { "n": 1, "x": 0.5, "y": 0.83, "label": "Continue to pay" } ] }`. Never estimate by eye.
- A pinpoint label is the exact visible label from the map (or the lucide icon name when the target is icon only, written as "cart icon", not "ShoppingCart").
- At most five pinpoints per frame. If a screen needs more, it is two steps.

### B9. Reject list

A capture is discarded, and the cause fixed or the screen re-driven, if it shows any of:

- The RN LogBox bar, the Expo dev menu, a red box, or the yellow warning strip.
- A blank first paint, a skeleton, or a spinner where the map says the screen is loaded.
- A stacked login gate sheet over the wrong screen (the gate persists across deep links until Developer P0 item 3 lands).
- A raw Postgres or PostgREST error string.
- San Francisco distances, "No courts near you" for Hyderabad venues, or a 13,486 km card.
- BUG-06 colour block imagery as the screen's hero.
- The iOS 26 captions control leak on the Home Clutch preview.
- The last row of a list hidden under the nav pill.
- The iOS Save Password prompt, a keyboard covering the CTA, or a system alert from the simulator.
- A dark frame that resolved light (or the reverse).
- Any real personal data. Fixture personas only.
- A coach only screen captured as player@ ("caller holds no coach profile").

### B10. Verification before the guide is assembled

- Build one contact sheet per workflow (all frames in order, file names under each) and read it. Every frame must show the state its file name claims.
- Cross check `manifest.csv` against A3: every Tier 1 workflow has every screen the map lists plus its end card; every Tier 2 workflow has at least one frame; no Tier 3 workflow has any.
- Cross check `pins.json`: every frame referenced by the guide has pins, every pin label exists verbatim in the map or the cited source file.
- Re-run the E section 23 quality test on the assembled guide, then publish.

---

## C. PRODUCT REALITY

The presentation brief in E was written generically. These tables say what the product actually calls things and which generic flows do not exist. The guide describes the product, not the brief.

### C1. Naming map

| Brief says | Product says | Note |
|---|---|---|
| Reels, shorts, stories | Clutch, clip, Post | Bottom tab Clutch (lucide Play). One video is a clip. The viewer screen is titled Post. |
| Upload a reel | Post a clip | Screen Post a clip, CTA Post clip, entry pill Post. Library pick only, no camera. |
| Hashtags, tags, location, privacy | Sport chip | One required sport chip and a 140 character caption. Nothing else exists. |
| Feed | Clutch feed | Full bleed vertical feed; Home carries one Clutch preview card. |
| Creator, channel | Creator profile | Route clutch/creator/[id], button Follow / Following. |
| My profile | You tab (Profile) | Fifth tab. Tabs My posts, Liked posts, Follows, My wishlist. |
| Book a court | Browse and Book on {partner} | Release shape is browse plus click out (release task 5). |
| Coach booking, lesson | Session, session request | Paid up front, then waits for the coach: Session requested, Waiting for the coach to accept. |
| Lesson type, package | Session type | Name, duration, session fee, set only in coach onboarding Pricing. |
| Class, squad | Training group | Monthly membership: Join, month 1; Renew membership. |
| Attendance, check in | Mark attendance (coach, group sessions); Mark complete (coach, 1:1) | Players never check in. |
| Athlete, student | Player (app), Trainee (coach view), Athlete (Empower) | Role select says I am a player. |
| Trainer, instructor | Coach | Coach mode lives inside the Trainings tab once verified. |
| Training hub | Trainings tab | Player sub nav Stats, Coaches, Payments, Chat, Analytics. Coach sub nav Stats, Trainees, Earnings, Chat, Video Analytics. |
| Store, marketplace | Shop, gear | Category browse titled All gear. |
| Cart | Your cart | Stepper, Remove, Proceed to buy. |
| Checkout, payment | Checkout, Continue to pay, Razorpay sheet | BillSummary rows Subtotal, Delivery charges, GST and others, optional Support a Rising Athlete in Need, Total. |
| Order tracking | My orders, Order, Tracking timeline | Placed, Shipped, In transit, Delivered, Cancelled. Advanced by admin only. |
| Product review | Order feedback | Once, after delivered. |
| Donate, sponsor, crowdfund | Empower, Donate to Empower, Fund this | Success screen Thank you for giving. |
| Beneficiary athlete | Verified athlete (UPA internally) | Managed in Atlitos Life. |
| Round up | Support a Rising Athlete in Need | Checkout checkbox; shows as General Fund in My Impact. |
| Donation history | My Impact | Reached only from the donate success screen. |
| Courses, lessons | Learn: Roadmap, Drills, Milestones, XP | Entered from Trainings, Milestones and rewards, Open Learn. |
| Messages, DM, inbox | Messages, Trainings Chat tab | Not a bottom tab; threads come from sessions and groups; no compose button. |
| Alerts | Notifications, Preferences | Bell in the Home AppBar. |
| Favourites | Wishlist | Gear only; clips use Like. |
| Withdraw, payout | Transfer (coach), Payout account (Send) | Court partner earnings are read only. |
| Sign up | Register, Create your account | CTA Create account. |
| Sign in | Log in | Also Use a one time code, Sign in with Google, Sign in with Apple, Continue on this device. |
| Guest mode | Continue on this device, login gate | Gate sheet title Want to hit the spotlight? with Login and Register. |
| Search | AI search | One box, segments Coaches, Courts, Gear, Athletes, Clips. |
| Venue owner | Court partner, Atlitos Partners | Web portal. |
| Sponsorship portal | Atlitos Life | Web portal. |
| Back office | Atlitos Admin | Web. |

### C2. Flows to show differently

| Brief assumes | Reality | Guide decision |
|---|---|---|
| In app court slot booking with payment, My bookings, cancel, reschedule, rate | Exists in source but is hidden for release (task 5). No click out field or screen exists yet. | Section G is browse, detail, click out. Section N holds the hidden flows as reference cards. Never capture the slot picker or the court pay screen as a release flow. |
| Athlete marks attendance | No athlete check in. 1:1: requested, accepted, completed (coach Mark complete), rated (player). Group: coach Start session, Present / Absent, Mark attendance, End session. | C-08 shows the player's status pills; J-13 is the attendance workflow. |
| Start session on a 1:1 | Only group sessions have Start session. | J-09 goes straight to Mark complete. |
| Trim, thumbnail, hashtags, tags, location, privacy on upload | Post a clip is one form: picker, inline preview, caption, sport chip, Post clip, spinner, Clip in review. | B-07 shows exactly those steps and states that nothing else exists. |
| Clip goes live immediately | Every clip is reviewed in the admin Moderation queue. The moderation notification deep links to a route that does not exist. | B-07 ends at Clip in review; B-08 shows Under review; M-04 publishes; B-09 shows the notification and notes the dead link. |
| Share a link | OS share sheet with caption text only, from the post viewer only. | B-06 says caption text, no link. |
| Report or delete a comment | No comment actions. Report and Block live on the feed card menu only. | B-10 shows the feed card menu. |
| Shopper tracks and cancels orders | Status advanced by admin only; no cancel, no refund UI. My orders has no Settings or You tab entry. | H-09 is a read only timeline reached from Track my order; note the missing entry point. |
| Sign up forces onboarding | Register lands on Home. Onboarding starts from the Home Finish setting up card, Settings Become a coach, or Edit and resubmit. | A-08 starts at the card and says onboarding is optional. |
| Sign out returns to login | Sign out recreates a guest session and lands on Home. | A-13 ends on guest Home. |
| Delete account is a screen | Two native alerts from Settings. | A-14 is two alert frames. |
| Edit profile changes city | City, State and sports live under Settings. | A-11 covers Location; A-10 is cover, photo, handle, bio. |
| Message a coach from the profile | Message coach exists only on the session detail. | C-06 starts from a booked session. |
| Chat is a tab | Standalone Messages is deep link only; Trainings Chat embeds the same list. | E-02 shows the in app path; E-01 uses the deep link and says so. |
| Cancel a session refunds | Only a requested session refunds automatically; cancelling an accepted session releases the slot with no refund; coach decline refunds. | C-05 splits Cancel request and Cancel session with the exact alert copy. |
| Coach manages session types and creates groups in the app | Session types only in onboarding Pricing; no create, edit or schedule group in mobile. | J-05 reference card; J-12 is view only. |
| Coach uploads review videos | No importer; the trainee Video Analytics tab is a placeholder. | J-17 reference card; D-05 is the read side. |
| Learn from Home | Home has no Learn tile. | F-01 enters from Trainings, Milestones and rewards, Open Learn. |
| Push notifications | Transport is stubbed (release task 9). | A-12 shows the in app list and switches; no lock screen frame. |
| Address book in settings | No Settings row; checkout has its own address screen. | H-06 is the checkout address; H-10 is deep link only. |
| Affiliate products in the shop grid | No screen lists them; search misroutes them. | H-11 by deep link, noted as the model for the courts click out. |
| Guest wishlist merges on sign in | Stored locally, never merged. | H-04 says saved gear as a guest stays on the device. |
| Password reset ends on login | Verifying the OTP signs the user in; Save password lands on Home. | A-07 ends on Home. |
| Pull to refresh shows coach approval | No RefreshControl on the pending state. | J-02 shows relaunch after approval. |
| Coach payout works end to end | Route not enabled; Start setup returns Payouts are not enabled yet. | J-14 shows that state. |
| Court partner links payout and transfers | Earnings is read only. | K-08 shows Not linked yet. |
| UPA deactivates their profile | Always returns INVALID_TRANSITION for verified UPAs. | L-09 captions it as a known dead path. |
| Admin dashboard, refunds, user detail, feature flags, tickets, audit log, create product | None exist. | Section M indexes only what exists. |

### C3. Hidden for release, never shown as working

Court detail slot picker and Book this slot; court book and pay; My bookings and court booking detail; cancel, reschedule and rate a court booking; the guest gate on those actions; deep links into any of them; court detail copy that promises in app booking or payment; athlete originated bookings appearing in the partner Live today or the admin Bookings list (after task 5 only Record a walk in produces bookings).

### C4. Not in the generic list, must be in the guide

Guest mode and the login gate sheet; Empower (hub, athlete profile, donate, roundup); My Impact; Learn; chat and group threads; training groups (join, renew, coach attendance); coach mode end to end; coach verification status; coach earnings, payout and transfer states; athlete session history surfaces (My sessions, Payments, Analytics, My review videos); AI search; notifications and preferences; report, block, blocked accounts; wishlist; affiliate click out; shipping address; settings; the four sign in paths; onboarding entry from the Finish setting up card; rate a coach; the shared Razorpay sheet pattern; Atlitos Partners; Atlitos Life; Atlitos Admin; the Home footer Log out.

---

## D. OUTPUT AND DEFINITION OF DONE

### D1. Format and where it lives

- An interactive web guide published as Artifacts, plus the same HTML committed under `docs/design/walkthrough/guide/` so it can be rebuilt and printed.
- Split to respect Artifact limits (16 MB page, 255 files per publish): a hub artifact (cover, light and dark spread, master visual map, workflow index with links, end to end journeys, known gaps card, appendix N) and one artifact per group: Player account, Clutch and chat (A, B, E); Player coaching, Trainings and Learn (C, D, F); Player courts, shop and Empower (G, H, I); Coach mode (J); Atlitos Partners (K); Atlitos Life (L); Atlitos Admin (M). Every artifact carries the same top nav back to the hub and a print stylesheet that yields a clean PDF per artifact.
- Screens are lazy loaded WebP supporting files; pinpoints are HTML over the image (B8). The page works at 400 px wide with the device frame scaling down and captions stacking beneath it.
- Typography: Urbanist for text (Google Fonts, with a system sans fallback), JetBrains Mono for step numbers, routes, prices and every numeral. Black titles, grey descriptions, white or off white ground, one accent for pinpoints and the active nav item. No emojis anywhere, lucide icons only (inline SVG), no em dashes or hyphens in the guide's own copy, sentence case microcopy. Colours come from the portal HSL tokens or `packages/theme`; nothing invented.
- The master visual map (E section 16) is built from the real IA: bottom tabs Home, Trainings, Clutch, Courts, You; Home fans out to AI search, Shop, Empower, Notifications; Trainings fans out to Coaches, Sessions, Groups, Payments, Chat, Analytics, Learn; Clutch to feed, Post, Creator, Post a clip; Courts to browse, detail, click out; You to Profile, Edit, Settings, Wishlist. A second band shows the three web surfaces and the approvals that connect them to the app: coach verification, venue verification, UPA verification, clip moderation, order advance.

### D2. Traceability

Every workflow page carries, in an HTML comment, its `PRD-0X FR-y` references, the release scenario ids from A3, and the test catalog case ids. Nothing traceable to no PRD requirement appears in the guide.

### D3. Done means

- Every Tier 1 workflow has every screen the map lists, captured after the gates in B1, with pins, action, result and an end card; every Tier 2 workflow has its compact card; every Tier 3 workflow has its reference card; the hub has the map, the index, the journeys and the known gaps card.
- `manifest.csv`, `pins.json` and the contact sheets pass B10.
- A reader who has never opened Atlitos can answer, for each workflow, where to start, what to tap, what happens next and where they end up, from the frames alone.
- The E section 23 checklist passes on a read through of every artifact at desktop and 400 px widths.
- `docs/design/walkthrough/WORKFLOW-GUIDE-BRIEF.md` status line updated with the capture date, the commit captured from, and the artifact URLs; `docs/phases/PHASE-N-STATUS.md` for the active phase gets one line pointing here.

---

## E. THE PRESENTATION BRIEF (verbatim)

CREATE A COMPLETE VISUAL WORKFLOW GUIDE

The application audit and feature identification have already been completed.
Do NOT spend significant time auditing the codebase again.
Your main task now is to take the already identified features, screens, and functionality and transform them into a beautiful, highly visual, step-by-step workflow guide.
The goal is:
A user should be able to look at the workflow and immediately understand WHERE to go, WHAT to click, WHAT happens next, and HOW the entire feature is completed from start to finish.
This should feel like a premium product UX walkthrough, not a technical document.

1. CORE WORKFLOW FORMAT
Every feature must follow this structure:
WORKFLOW 01
WORKFLOW TITLE
Short 1–2 line description explaining what the workflow accomplishes.
START: Home
END: Successful completion
Then show the complete visual flow:
Screen 01 → Screen 02 → Screen 03 → Screen 04 → Screen 05
Every screen must be represented visually.

2. EVERY WORKFLOW MUST HAVE
For every feature, include:
Workflow Number
Example:
WORKFLOW 06
Workflow Title
Example:
BOOK A COURT
Description
A short explanation in grey.
Find an available sports court, choose a date and time, complete payment, and receive your booking confirmation.
Flow Summary
Example:
`Home → Courts → Court Details → Select Slot → Checkout → Payment → Confirmation`
Screens
Show every screen involved in the workflow in the correct order.
User Action
Clearly state what the user does at each screen.
Pinpoints
Use numbered markers directly on the screen:
① ② ③ ④
Then explain those markers below/next to the screenshot.
Result
Explain what happens after the action.

3. VISUAL PRESENTATION IS THE PRIORITY
Do NOT make this look like conventional documentation.
Avoid long paragraphs.
The primary visual hierarchy should be:
SCREENSHOT → PINPOINT → ACTION → RESULT
not:
Paragraph → Paragraph → Paragraph
The screens should occupy most of the visual space.

4. DESIGN STYLE
Create a premium, minimal interface.
Background
Use a beautiful clean:
WHITE / OFF-WHITE BACKGROUND
Workflow Titles
Use:
BLACK
Large, bold, modern typography.
Example:
BOOK A SPORTS COURT
Descriptions
Use:
GREY
Small, clean, secondary typography.
Screenshots
Place application screens inside clean device/browser frames where appropriate.
Use:

* Rounded corners
* Very subtle shadows
* Thin borders
* Large screenshots
* Consistent sizing
* Lots of whitespace

Accent
Keep accent colors minimal.
The application UI itself can retain its original colors.

5. SCREEN + PINPOINT DESIGN
This is one of the most important parts.
Each workflow step should visually look approximately like:
STEP 01
OPEN COURTS
Short explanation.

```
          ┌─────────────────────┐
          │                     │
          │    APP SCREEN       │
          │                     │
          │       ①             │
          │                     │
          │              ②      │
          │                     │
          └─────────────────────┘
```

① COURTS
Tap here to open the Courts section.
② LOCATION
Choose or confirm your location.
USER ACTION
Tap Courts.
RESULT
The Courts discovery screen opens.
Then connect to the next screen with a clear visual arrow:
↓
STEP 02
SELECT A COURT
[SCREEN]
① Court card
② Rating
③ Availability
④ Book button
USER ACTION
Tap the court you want to book.
RESULT
Court details open.
Continue this pattern until the workflow is complete.

6. PINPOINT RULES
Pinpoints must be:

* Clearly visible
* Numbered
* Positioned close to the relevant UI element
* Connected with a subtle line if necessary
* Consistent throughout the entire guide

Use:
① ② ③ ④ ⑤
Do not use random icons for every explanation.
The same pinpoint system should be used throughout the entire document.

7. MAKE THE USER JOURNEY OBVIOUS
At the beginning of EVERY workflow, show a small journey bar.
Example:
USER JOURNEY
01 DISCOVER
↓
02 SELECT
↓
03 CONFIGURE
↓
04 PAY
↓
05 CONFIRM
Or:
`HOME → COURTS → DETAILS → SLOT → PAYMENT → CONFIRMATION`
This should allow someone to understand the entire workflow before reading the individual steps.

8. WORKFLOW CATEGORIES
Create workflows for every feature already identified in the audit.
Some important examples include:
ACCOUNT

* Sign up
* Login
* Onboarding
* Profile setup
* Edit profile
* Logout
* Account settings

SPORTS

* Discover sports
* Explore sports
* Find athletes
* Find coaches
* Find courts

COURTS

* Find a court
* Search court
* Filter court
* View court
* Book court
* Select date
* Select time
* Pay
* Booking confirmation
* View booking
* Cancel booking
* Reschedule if supported

COACHES

* Find coach
* Search/filter coach
* View coach
* View availability
* Select session
* Book coach
* Pay coach
* Booking confirmation
* Upcoming session
* Completed session
* Review coach
* Cancel/reschedule if supported

ATTENDANCE

* View upcoming session
* Check attendance
* Mark attendance
* View attendance history
* Coach attendance management

SPORTS GEAR

* Open Gear
* Browse categories
* Search product
* Filter
* Product details
* Select variant
* Add to cart
* Cart
* Checkout
* Address
* Payment
* Order confirmation
* Order history
* Order tracking

REELS / CONTENT
Create an especially detailed workflow here:
Open Create
↓
Select Reel
↓
Choose Video
↓
Preview
↓
Edit / Trim
↓
Choose Thumbnail
↓
Caption
↓
Hashtags
↓
Sport
↓
Tags
↓
Location
↓
Privacy / Visibility
↓
Post
↓
Upload Progress
↓
Published Reel
Show every actual screen.
Do not compress multiple screens into one step if the application has separate screens.

9. PAYMENT WORKFLOWS
Payment deserves a strong visual presentation.
Show:
SELECT → REVIEW → PAY → PROCESSING → SUCCESS
For example:
STEP 04 — REVIEW ORDER
[SCREEN]
① Items
② Price
③ Taxes/fees
④ Total
⑤ Continue
↓
STEP 05 — PAYMENT
[SCREEN]
① Payment method
② Amount
③ Pay
↓
STEP 06 — PROCESSING
[SCREEN]
Show actual loading/payment-processing UI.
↓
STEP 07 — SUCCESS
[SCREEN]
Show confirmation.
Use a clear visual distinction between:
Payment
and
Payment Successful
Also document failure states where they exist.

10. ORDER WORKFLOW
The gear purchase workflow should not end at payment.
Continue through:
Product → Cart → Checkout → Payment → Confirmation → Orders → Order Details → Tracking → Delivered
The user should understand what happens after buying something.

11. BOOKING WORKFLOW
The court/coach booking workflow should similarly continue beyond payment.
Example:
Discover
↓
Select
↓
Date
↓
Time
↓
Review
↓
Payment
↓
Confirmation
↓
Upcoming Booking
↓
Session
↓
Attendance
↓
Completed
This creates a proper end-to-end experience rather than documenting isolated screens.

12. DON'T FORGET "AFTER THE ACTION"
For every major feature, ask:
"Where does the user go after successfully completing this?"
Examples:
Court booking
Booking → Confirmation → My Bookings
Gear purchase
Payment → Order Confirmation → My Orders
Reel upload
Upload → Published Reel → Profile/Reels
Coach booking
Payment → Confirmation → Upcoming Sessions
Attendance
Mark Attendance → Attendance History
Always show the post-action destination.

13. SUCCESS / ERROR / EMPTY STATES
For major workflows, add small visual branches where applicable.
Example:

```
          PAYMENT
             │
    ┌────────┴────────┐
    ↓                 ↓
 SUCCESS            FAILED
    │                 │
    ↓                 ↓
```

CONFIRMATION RETRY
│
↓
PAYMENT
Similarly:
AVAILABLE COURT
vs.
NO COURTS AVAILABLE
And:
UPLOAD SUCCESS
vs.
UPLOAD FAILED
These should be visually represented rather than explained in huge paragraphs.

14. WORKFLOW END CARD
Every major workflow should end with a clean completion card.
Example:
━━━━━━━━━━━━━━━━━━━━━━
WORKFLOW COMPLETE
COURT BOOKED
Court: XYZ Sports Arena
Date: 24 September
Time: 6:00 PM
Next: View booking in My Bookings
━━━━━━━━━━━━━━━━━━━━━━
This gives the workflow a strong visual ending.

15. MASTER WORKFLOW INDEX
At the beginning, create a beautiful visual index.
Example:
ALL WORKFLOWS
GET STARTED
01 — Create Account
02 — Complete Profile
03 — Explore App
COURTS
04 — Find a Court
05 — Book a Court
06 — Manage Court Booking
COACHES
07 — Find a Coach
08 — Book a Coach
09 — Manage Coach Session
SHOP
10 — Find Gear
11 — Buy Gear
12 — Track Order
CONTENT
13 — Upload Reel
14 — Interact With Reel
ATTENDANCE
15 — Athlete Attendance
16 — Coach Attendance
etc.
Clicking a workflow should ideally take the user directly to that workflow if the format supports navigation.

16. MASTER VISUAL MAP
Create one overview page that visually connects the entire application.
For example:

```
                 APP
                  │
    ┌─────────────┼─────────────┐
    ↓             ↓             ↓
 DISCOVER       BOOK          SHOP
    │             │             │
  Sports        Courts         Gear
  Coaches       Coaches        Cart
  Athletes      Sessions       Orders
    │             │             │
    └─────────────┼─────────────┘
                  ↓
               CONTENT
                  │
                Reels
                  │
                  ↓
               PROFILE
```

Build the actual map according to the application's existing structure.

17. SCREEN TRANSITIONS
Make transitions visually obvious.
Use:
SCREEN → ACTION → SCREEN
Example:
`Home`
↓
Tap Courts
↓
`Court Listing`
↓
Tap Court
↓
`Court Details`
↓
Tap Book
↓
`Booking`
↓
Select Time
↓
`Payment`
Do not make users figure out the sequence themselves.

18. KEEP TEXT SHORT
Do NOT fill pages with unnecessary explanations.
For each screen:
WHAT YOU SEE
1 short sentence.
WHAT TO DO
1 short sentence.
WHAT HAPPENS
1 short sentence.
That's enough.
The screenshots should communicate the majority of the information.

19. CONSISTENCY
Every workflow must use the same visual system.
For example:
WORKFLOW NUMBER
↓
TITLE
↓
DESCRIPTION
↓
JOURNEY BAR
↓
STEP 01
SCREEN + PINPOINTS
↓
STEP 02
SCREEN + PINPOINTS
↓
STEP 03
SCREEN + PINPOINTS
↓
SUCCESS
This consistency is extremely important.

20. IDENTIFY MISSING WORKFLOWS
Do not perform another full audit.
However, while creating the presentation, if you notice that an important user journey is missing from the existing workflow list, add it.
Create a final section:
ADDITIONAL WORKFLOWS
Include any important flows that are necessary for a user to understand the product.
Examples:

* Cancellation
* Refund
* Failed payment
* Empty state
* Permission request
* Account recovery
* Notification interaction
* Booking management
* Order management

Only include these when relevant to the actual application.

21. FINAL PRESENTATION STRUCTURE
The final visual guide should look like a polished product handbook:
COVER
PRODUCT WORKFLOWS
Complete visual guide to using the application.
PAGE 01
MASTER WORKFLOW MAP
PAGE 02
WORKFLOW INDEX
PAGE 03+
Individual workflows.
Each workflow should be visually separated.
FINAL PAGES
END-TO-END USER JOURNEYS
Show the complete experiences.
Examples:
NEW USER
`Sign Up → Profile → Discover → Book → Pay → Attend`
SPORTS SHOPPER
`Gear → Product → Cart → Checkout → Payment → Order → Delivery`
ATHLETE + COACH
`Find Coach → Book → Pay → Session → Attendance → Review`

22. OUTPUT FORMAT
Prefer creating this as a beautiful interactive web-based presentation/document if possible.
It should feel like a:
UX workflow website / product handbook
with:

* Navigation
* Workflow index
* Sections
* Large screenshots
* Visual arrows
* Pinpoints
* Clear step numbering
* Responsive layout
* Clean typography

If producing a PDF/document as the final output, make it print-ready and presentation-quality.
The final result must NOT feel like raw technical documentation.

23. FINAL QUALITY TEST
Before finishing, visually inspect the entire presentation.
Ask:
Can a completely new user understand every feature?
Can they see where to start?
Can they see exactly what to click?
Can they see what happens next?
Can they understand the entire journey without reading large paragraphs?
Are all screens connected visually?
Are payment, booking, order, attendance, and upload flows shown end-to-end?
Are success states clearly shown?
Are important failure/empty states represented?
Does every workflow look consistent?
Does the whole thing look like a professional product created by a UX/product design team?
If not, improve the presentation.

MOST IMPORTANT REQUIREMENT
FOCUS ON PRESENTATION, NOT AUDITING.
The audit is already done.
Your job is to turn the existing product knowledge into:
A BEAUTIFUL VISUAL "HOW TO USE THE APP" GUIDE
The visual experience should communicate:
WHERE → CLICK → NEXT SCREEN → ACTION → RESULT
for EVERY FEATURE.
Prioritize:
Screenshots > Visual Flow > Pinpoints > Short Instructions > Supporting Text
The final guide should make the application feel simple even if the underlying product is complex.
