# Athlete app test suite — full route coverage

Complete, re-runnable test case catalogue for `apps/mobile`, built from the actual route tree (80 screens under `apps/mobile/src/app`), not from guesswork. Every case has Steps, Expected and the Result from the 2026-09-05 execution.

**Nothing in this pass was committed, pushed or deployed.**

## Environment

| Item | Value |
|---|---|
| Build | debug dev build, iPhone 17 Pro simulator (iOS 26.6), Metro on `:8081` |
| Backend | live project `syzzfgaudpifwvbpycyi` |
| Account | `player@atlitos.dev` (committed demo fixture), signed in |
| Method | deep-link navigation (`xcrun simctl openurl "atlitos://<route>"`) plus screenshot capture, then contact-sheet review |
| Migrations 0088-0091 | not deployed, so suspension and payment-recovery cases stay BLOCKED |

**Deep linking works and is the fastest way to run this suite.** Every route below is reachable as `atlitos://<route>`.

```bash
xcrun simctl openurl <SIM_UDID> "atlitos://shop/cart"
```

Legend: **PASS** / **FAIL** / **BLOCKED** / **NOT RUN** / **N-A** (not applicable to this persona).

---

## 1. Launch, shell and navigation

| ID | Steps | Expected | Result |
|---|---|---|---|
| L-01 | Launch with Metro reachable | Home renders | PASS |
| L-02 | Launch with the JS bundle unreachable | Bounded wait then an actionable error with retry | **FAIL — BUG-01** |
| L-03 | Tap each of the 5 tabs | Each renders its own screen, selection updates | PASS |
| L-04 | Deep link to every route in this document | Correct screen, no crash | PASS, 27/27 |
| L-05 | Watch Metro across the session | No JS errors | PASS, zero errors |
| L-06 | Kill and relaunch while signed in | Reopens signed in (PRD-01 FR-10) | PASS |
| L-07 | Back gesture from a pushed screen | Returns to the previous screen | PASS |

## 2. Authentication and session

| ID | Steps | Expected | Result |
|---|---|---|---|
| A-01 | Guest taps You | Sign-in gate, no crash, no forced redirect (FR-1) | PASS |
| A-02 | Open `(auth)/login` | Password / code toggle, both fields, Log in, Forgot, Create account, Continue as guest | PASS |
| A-03 | Log in with empty fields | Submit disabled | PASS |
| A-04 | Toggle password reveal | Plaintext shown, icon flips | PASS |
| A-05 | Log in with valid credentials | Session established, profile loads | PASS |
| A-06 | Auth API for player/coach1/admin/partner | 200 and correct `app_metadata.roles` | PASS 4/4 |
| A-07 | Inspect issued JWT claims | player `[player]`, coach1 `[player,coach]`, admin `[player,admin]`, partner `[player,court_partner]` | PASS |
| A-08 | Google / Apple sign-in present | n/a, never specified in PRD-01 FR-5..FR-10 | **N-A, not a defect** |
| A-09 | Register screen renders and validates | Name, email, phone, DOB, password twice (FR-6) | NOT RUN, writes a live account |
| A-10 | Forgot password OTP flow | OTP required within expiry (FR-9) | NOT RUN, sends a real email |
| A-11 | Suspended user blocked on the same token | 403 `ACCOUNT_SUSPENDED` | **BLOCKED**, 0090 not deployed |
| A-12 | Logout returns to guest Home, not login (FR-65) | Guest Home | NOT RUN, would end the session mid-suite |

## 3. Home

| ID | Steps | Expected | Result |
|---|---|---|---|
| H-01 | Open Home | AppBar, search, location, sport row, carousel, Shop rail, Clutch preview | PASS |
| H-02 | Header avatar while signed in | The signed-in user's initials | **FAIL — BUG-08** |
| H-03 | Promo carousel renders | Banner art legible behind the copy | **FAIL — BUG-06** |
| H-04 | Shop rail shows priced products | Title and price per card, mono figures | PASS |
| H-05 | Notification bell unread dot | Dot when unread exist | PASS |
| H-06 | Location line | Shows the profile city | PASS, Hyderabad |

## 4. Search

| ID | Steps | Expected | Result |
|---|---|---|---|
| S-01 | Open `home/search` | Empty state, suggestion chips, "Searching near <city>" | PASS |
| S-02 | Query "badminton racket" via ai-search | Non-empty ranked results | PASS, 6 results |
| S-03 | Location basis | Consistent with the rest of the app | **FAIL — BUG-03**, search uses profile city, Courts uses GPS |

## 5. Shop and commerce

| ID | Steps | Expected | Result |
|---|---|---|---|
| SH-01 | Open `shop` | Search, category chips, Recommended rail, product grid | PASS |
| SH-02 | Product imagery | Product photos inside card bounds | **FAIL — BUG-06** |
| SH-03 | Open `shop/cart` | Line items, qty stepper, per-line total, subtotal | PASS |
| SH-04 | Cart arithmetic | line total = price x qty, subtotal = sum of lines | PASS, 950 x 2 = 1,900 |
| SH-05 | Open `shop/orders` | Order list with number, date, total, item count, status pill | PASS, 24 orders |
| SH-06 | Open `account/wishlist` | Wishlist items with stock and Move to cart | PASS |
| SH-07 | Open `account/addresses` | Address list, Edit, Set default, delete, Add new | PASS |
| SH-08 | Checkout end to end | Address, bill, Razorpay, order created | NOT RUN, moves money |
| SH-09 | Order detail and feedback | Timeline and rating form | NOT RUN, write path |

## 6. Courts

| ID | Steps | Expected | Result |
|---|---|---|---|
| C-01 | Open Courts | Venue cards with name, address, price/hour, Book | PASS |
| C-02 | Distance relevance | Far venues excluded or an explanatory empty state | **FAIL — BUG-03**, 13,486 km shown as bookable |
| C-03 | Sport filter chips render | Chips present, All sports selected | PASS |
| C-04 | Venue imagery | Venue photos | **FAIL — BUG-06** |
| C-05 | Open `courts/bookings` | Bookings with status pills and totals | PASS, 47 bookings |
| C-06 | Booking status vocabulary | Cancelled / Expired render distinctly | PASS |
| C-07 | Book a slot and pay | Slot held, bill re-verified, payment | NOT RUN, moves money |

## 7. Coaching and Trainings

| ID | Steps | Expected | Result |
|---|---|---|---|
| T-01 | Open Coaching | Coach cards with sport, experience, price-from, city, rating | PASS |
| T-02 | Rating display for an unrated coach | Something other than a bare 0.0 | **FAIL — BUG-09** |
| T-03 | Open `coaching/bookings` | Stat tiles plus session list | PASS |
| T-04 | Stat tile coherence | Tiles agree with their documented definitions | PASS, see Correction 2 |
| T-05 | Open Trainings shell | Stats, My sports, My groups, Upcoming | PASS |
| T-06 | Numeric typography across tiles | JetBrains Mono, tabular figures | PASS |
| T-07 | Open `trainings/upcoming` | List or a clear empty state | PASS, "No upcoming sessions" |
| T-08 | Open `trainings/requests` | List or a clear empty state | PASS, "No pending requests" |
| T-09 | Open `trainings/my-videos` | Coach review videos for this athlete | PASS, 6 videos |
| T-10 | Open `trainings/availability`, `verification` | Render without error | PASS |
| T-11 | Coach-only surfaces as a player (`earnings`, `trainees`, `payout-setup`) | Refused or hidden | PASS at API, `NOT_COACH` |
| T-12 | Join or renew a group | Seat held, fare re-priced, payment | NOT RUN, moves money |

## 8. Clutch

| ID | Steps | Expected | Result |
|---|---|---|---|
| CL-01 | Open Clutch | A clip renders and plays with author, age, caption, like, comment, share | PASS |
| CL-02 | Feed header layering | Header does not obscure clip content | **FAIL — BUG-04** |
| CL-03 | Own clip grid on Profile | Thumbnails per clip | **FAIL — BUG-02** |
| CL-04 | Clip status pills | Status describes the real moderation outcome | **FAIL — BUG-05** |
| CL-05 | Open `clutch/upload` | Picker, caption 0/140, sport chips, Post disabled until valid | PASS |
| CL-06 | Post a clip | Upload, finalize, enters moderation | NOT RUN, writes to shared bucket |
| CL-07 | Signed playback URL mint | Short-lived signed URL for a published clip | PASS |

## 9. Learn

| ID | Steps | Expected | Result |
|---|---|---|---|
| LN-01 | Open `learn` | Total XP, milestone count, current stage, drills rail | PASS |
| LN-02 | Open `learn/roadmap` | Stages with thresholds, current stage marked, later stages locked | PASS |
| LN-03 | XP arithmetic | Remaining XP = next threshold - total | PASS, 300 - 150 = 150 |
| LN-04 | Open `learn/milestones` | Earned count matches EARNED rows | PASS, 3 and 3 |
| LN-05 | Open `learn/drills` | Sport and level filters, drills with XP, completed marked | PASS, 31 drills |
| LN-06 | Complete a drill | XP increments, milestone may unlock | NOT RUN, write path |

## 10. Empower

| ID | Steps | Expected | Result |
|---|---|---|---|
| E-01 | Open `home/empower` | Raised total, athletes supported, filters, campaign cards with progress | PASS |
| E-02 | Campaign imagery | UPA photo renders | **FAIL — BUG-06** |
| E-03 | Open `account/impact` | Total given, athletes supported, items funded, donation history | PASS |
| E-04 | Impact figures are server-derived | Values come from a SECURITY DEFINER RPC scoped to `auth.uid()`, not client-summed | PASS, see Correction 3 |
| E-05 | Donate | Amount validated, payment, ledger group | NOT RUN, moves money |

## 11. Profile, notifications, settings

| ID | Steps | Expected | Result |
|---|---|---|---|
| P-01 | Open `profile` | Cover, avatar, name, handle, counts, 4 tabs | PASS |
| P-02 | Open `profile/edit` | Cover and photo change, handle, bio with 0/160 counter, Save | PASS |
| P-03 | Open `notifications` | List with type icons, timestamps, unread styling, Mark all read | PASS, 29 rows |
| P-04 | Open `notifications/preferences` | Per-type Push and Email toggles | PASS |
| P-05 | Open `settings` | Theme, preferred sports, location, notification toggles | PASS |
| P-06 | Settings location fields | City and State both populated for a complete profile | **FAIL — BUG-10**, State blank |
| P-07 | Open `chat` | Thread list with names, previews, timestamps | PASS, 32 threads |
| P-08 | Group thread naming | Threads show their group name | **FAIL — BUG-11**, generic "Group" |

## 12. Data layer

| ID | Steps | Expected | Result |
|---|---|---|---|
| D-01 | Read 23 feature surfaces as the signed-in player | Each returns rows | PASS 23/23 |
| D-02 | Coach-only RPC as a player | Refused | PASS, `NOT_COACH` |
| D-03 | `get_learn_home` RPC | Returns sport, XP, stages, milestones | PASS |
| D-04 | `ai-search` edge function | Ranked results | PASS |
| D-05 | `get-clip-playback-url` edge function | Signed URL | PASS |

Surfaces covered by D-01: shop categories, active products, promo banners, venues, courts, public coach profiles, published clips, roadmap stages, drills, verified UPAs, UPA wishlist items, fee config, own notifications, own orders, own court bookings, own sessions, own addresses, own cart, own group memberships, own chat threads, plus D-03 to D-05.

---

## Defects

Carried forward from the 2026-09-04 run: **BUG-01 to BUG-06, BUG-08** (details in `MANUAL-TEST-RUN-2026-09-04.md`). New in this pass:

### BUG-09 (P3) — unrated coaches advertise a 0.0 star rating

`Coaches` lists "Abishai ★0.0" and "Sana Iyer ★0.0". A coach with no ratings yet is not a zero-star coach, but the card is visually identical to one. It actively discourages booking a new coach and is unfair to them.

Expected: suppress the stars, or render "New" / "No ratings yet", until a first rating exists.

### BUG-10 (P2) — Settings shows City populated and State blank

`settings` renders City "Hyderabad" with an empty State field, for an account whose profile is otherwise complete. Either the profile genuinely lacks `state` and the onboarding that set `city` never required it, or the screen fails to bind the value. Both are defects: the Save location control sits under a half-filled required pair, and address-dependent flows read `state`.

Repro: sign in as `player@atlitos.dev`, open `atlitos://settings`, scroll to Location.

### BUG-11 (P3) — group chat threads are labelled "Group"

The Messages list shows one correctly named thread ("Cric Squad") and then six threads all titled **"Group"** with the preview "Start the conversation." A member cannot tell those threads apart. The thread list is not resolving the training group's name for group-context threads.

Repro: `atlitos://chat` as `player@atlitos.dev`.

---

## Corrections, filed against my own earlier findings

Recorded so nobody chases them.

**Correction 1 — there is no crash on `trainings/*`.** During the rapid deep-link sweep, `trainings/upcoming` captured as a fully black screen and `trainings/requests`, `trainings/my-videos` captured as the iOS springboard, which read as a hard crash. Re-tested individually with a clean relaunch and a process-liveness check before and after each navigation: **all four routes stayed ALIVE and rendered correctly** (`Post a clip`, `My review videos` with 6 rows, `No pending requests`, `No upcoming sessions`). No crash report was written by the simulator and Metro logged no error. The artifact was my own harness firing deep links every 3 seconds without letting the app settle. **Not a product defect.**

**Correction 2 — BUG-07 (Trainings stat coherence) is withdrawn.** "22 sessions / 5 hours trained / ₹5,000 payments" looked contradictory. The derivation at `(tabs)/trainings/(shell)/index.tsx:266-274` is deliberate and documented in the code: total counts every *live* session (paid, not declined or cancelled), while hours and payments count only sessions that actually *happened* (`completed` or `rated`), specifically so a pending request cannot inflate them. My own raw query returned 51 sessions because it counted cancelled ones too. **The tiles are correct; the labels could be clearer, nothing more.**

**Correction 3 — no money discrepancy on My Impact.** "Total given ₹8,996" against a visibly shorter history looked wrong. The value is not client-summed: `use-empower.ts:471` reads `total_given` from a server RPC that is SECURITY DEFINER and scoped to `auth.uid()`. My probe returned zero rows because the query itself was wrong, not because the figure is. **No discrepancy demonstrated; not filed.**

---

## Not tested, and why

| Area | Reason |
|---|---|
| Checkout, court booking, session booking, group join/renew, donate | All open Razorpay and write money rows to a shared live project. Needs explicit approval. |
| Register, forgot-password OTP | Creates a permanent account / sends real email on someone else's project. |
| Clip upload, drill completion, follow, comment, rating, logout | Write paths against shared demo data. |
| Coach, court-partner, admin personas | This pass was scoped to the athlete app as `player@`. |
| Suspension, payment recovery, trainee-video path lock | Migrations 0088-0091 not deployed. Covered locally by `scripts/verify-security-fixes.sql`. |
| Dark theme, tablet, accessibility, offline | Not attempted; worth a dedicated pass. |

## Fix order

1. **BUG-01** dead splash when the bundle cannot load. Hits real users on bad networks, not just developers.
2. **BUG-02** clip thumbnails can never render. A core surface looks permanently empty.
3. **BUG-03** location basis is inconsistent (GPS on Courts, profile city everywhere else) and unbounded by distance.
4. **BUG-08** hardcoded "A" avatar. One line, high visibility.
5. **BUG-10**, then the P3 polish: BUG-04, BUG-05, BUG-06, BUG-09, BUG-11.
