# Atlitos QA Test Catalog (FROZEN)

Frozen, numbered test-case catalog for the full-stack QA audit. This catalog is the single source of truth for
case IDs consumed by the Playwright spec builders (Phase B), the Chrome-extension judgment walkers (Phase C), and
the refute-fix-regress loop (Phase D). IDs are permanent once frozen: new cases extend a domain's numbering, they
never renumber or replace an existing ID.

Source: `.claude/plans/iterative-herding-dragon.md` (~120 pre-derived cases) folded together with every
`catalog_case_delta` returned by the Phase-A surface/backend readers (A1 athlete-web-social, A2 athlete-web-money,
A3 portal-court, A4 portal-life, A5 admin, A6 backend). No pre-derived case was dropped; reader deltas were appended
as new IDs continuing each domain's numbering.

## ID scheme

`DOMAIN-NN`, zero-padded two-digit sequence per domain, stable once frozen.

| Domain | Meaning |
|---|---|
| AUTH | Auth, onboarding, session, cross-portal role gates |
| CL | Clutch (short-video social feed) |
| FO | Follows |
| CH | Chat + realtime messaging |
| CT | Courts (booking, partner ops, money) |
| CO | Coaching + training groups (booking, money, ratings) |
| SH | Shop (cart, checkout, orders, money) |
| EM | Empower + UPA (donations, verification, UPA Life portal) |
| AD | Admin console |
| XP | Cross-cutting (RLS matrix, house style, script suites, invariants) |

## Lane routing

| Lane | What it means | Where it runs |
|---|---|---|
| PW | Deterministic UI pass/fail | `apps/e2e/` Playwright, headless, parallel, permanent regression asset |
| SQL | Truth lives in the database, not the UI | `apps/e2e/helpers/sql.mjs` (service-role, TEST-DB guarded) or `scripts/verify-*.mjs` |
| EXT | Needs taste/comprehension, not deterministic | Chrome-extension judgment walk, one walker alive at a time (browser mutex) |
| MAESTRO | Native-only interaction | `.maestro/` flows against the Expo iOS simulator |

Routing rule: deterministic pass/fail goes to PW; truth that lives in the DB goes to SQL even if it's reachable through
the UI (UI green is not proof, especially for money); anything needing taste or comprehension goes to EXT only; native-only
gestures/behavior go to MAESTRO. Every reproducible EXT finding gets a PW regression case ID before it is fixed (Gate C).

## Priority

P0 money + auth + RLS/isolation invariants. P1 core journey. P2 secondary/supporting. P3 cosmetic/polish.

## Status column

All cases default to `TODO`. As Phase B/C/D execute, update in place to `PASS` / `FAIL` / `FLAKY` / `DEFERRED` /
`MISSING-FEATURE` (case describes a capability that does not exist in code as of this freeze; see `expected` for the
specific gap) / `BLOCKED` (execution blocked by an environment issue, e.g. the 3 Empower-persona login failures or the
athlete-web font-404s recorded by the B1a scaffold run). Never delete a row; a case that becomes permanently obsolete is
marked `RETIRED` with a one-line reason, not removed, so IDs stay stable for historical cross-links.

## Known environment blockers at freeze time (from the B1a scaffold smoke run)

- `upa.verified@`, `upa.tennis@`, `donor@atlitos.dev` return `invalid_credentials` against the live DB with both
  `EmpowerDemo!2026` and `AtlitosDemo!2026`; `scripts/seed-empower-upa-users.mjs` appears never to have been run against
  `syzzfgaudpifwvbpycyi`. Every EM case above and any AUTH/XP case touching these 3 personas is `BLOCKED` until reseeded.
- athlete-web (`atlitos-app.vercel.app`) serves six 404s for `@expo-google-fonts` TTFs (Inter 400/500/600/700,
  JetBrains Mono 500/600), silently falling back to system fonts, including for numeric readouts. This trips the
  consoleGuard fixture (XP-01) and is a house-rule violation (money/numeric readouts must render in JetBrains Mono);
  do not allowlist, fix and re-run.

## Totals: 141 cases

By lane: EXT 16, MAESTRO 7, PW 58, SQL 60

By priority: P0 55, P1 64, P2 17, P3 5

By domain: AUTH 12, CL 19, FO 10, CH 13, CT 20, CO 13, SH 11, EM 21, AD 9, XP 13

## AUTH — Auth, onboarding, session, cross-portal role gates (12 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| AUTH-01 | Athlete web (atlitos-app.vercel.app) | guest | cold start, no stored session | Open atlitos-app.vercel.app with cleared storage | Lands on Home in guest mode; no forced login redirect, no modal | PW | P1 | TODO |
| AUTH-02 | Cross-surface | all 9 personas | seed users exist in syzzfgaudpifwvbpycyi | For each persona sign in via password grant; capture storage state (doubles as e2e setup project / storage-state generator) | Each persona routes to its correct home surface/screen; storage state written for reuse by all specs | PW | P0 | TODO |
| AUTH-03 | Athlete web (atlitos-app.vercel.app) | new player | fresh email/phone | Register with name/email/phone/DOB/password x2 -> submit | Account created -> routes to role-select -> Player setup wizard | PW | P1 | TODO |
| AUTH-04 | Athlete web (atlitos-app.vercel.app) | new coach | fresh email/phone | Register, choose Coach role -> submit | Routes to role-select -> Coach setup wizard | PW | P1 | TODO |
| AUTH-05 | Athlete web (atlitos-app.vercel.app) | guest | existing seed email/phone in use | Register with an already-used email or phone | Inline field error shown, no account created, no generic crash | PW | P2 | TODO |
| AUTH-06 | Athlete web (atlitos-app.vercel.app) | guest | valid seed account exists | Attempt login with wrong password, then unknown email | Generic error shown both times; no user-enumeration signal (same message for both cases) | PW | P1 | TODO |
| AUTH-07 | Athlete web (atlitos-app.vercel.app) | new player | mid player-setup wizard | Advance 2 steps, reload app | Wizard resumes at the same step with prior answers intact, not reset to step 1 | PW | P2 | TODO |
| AUTH-08 | Athlete web (atlitos-app.vercel.app) | new player | player-setup wizard open | Try Continue on a required step with blank fields, then skip an optional step | Required step blocks Continue until filled; optional step's Skip advances without data | PW | P2 | TODO |
| AUTH-09 | Athlete web (atlitos-app.vercel.app) | guest -> player@ | guest session, on Clutch feed | Tap Like as guest -> LoginGateModal opens -> sign in as player@ | After login, returns to the exact clip/screen and the originally-intended like action can be completed (no lost intent) | PW | P1 | TODO |
| AUTH-10 | Athlete web (atlitos-app.vercel.app) | player@ | valid account, forgot-password flow reachable | Request OTP, complete reset with it once, then reuse the same OTP for a second reset attempt | Second reset attempt with the already-used OTP is rejected (single-use enforced) | PW | P0 | TODO |
| AUTH-11 | Cross-surface | player@ / partner@ / admin@ | cross-portal login pages reachable | Attempt to sign in to portal-court with player@ creds; portal-life with partner@ creds; admin with player@ creds | Each cross-role login attempt is rejected or, if auth succeeds, is immediately gated out by role-check with no data exposure | PW | P0 | TODO |
| AUTH-12 | Athlete native (Expo sim) | player@ | Expo simulator running app | Cold start splash screen -> login -> land on Home | Native login smoke completes without crash; lands on correct Home | MAESTRO | P1 | TODO |

## CL — Clutch (short-video social feed) (19 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| CL-01 | Athlete web (atlitos-app.vercel.app) | guest | feed reachable, at least one published clip seeded | Open Clutch feed | First clip's video element reaches readyState>=3 and fires a timeupdate event (not a pixel-diff check); feed renders one clip per viewport | PW | P1 | TODO |
| CL-02 | Athlete web (atlitos-app.vercel.app) | guest | feed has more clips than one page | Scroll to near the end of the loaded feed | loadMore fires with cursor param; next page appends with no duplicate clip ids | PW | P2 | TODO |
| CL-03 | Athlete web (atlitos-app.vercel.app) | guest | published clips + at least one post detail exist | Browse feed and open a post detail as guest | Feed and post detail both fully browsable with no login gate on read-only viewing | PW | P1 | TODO |
| CL-04 | Athlete web (atlitos-app.vercel.app) | guest | on feed as guest | Tap Like on a clip | LoginGateModal opens; like is NOT applied (count unchanged) until login completes | PW | P1 | TODO |
| CL-05 | Athlete web (atlitos-app.vercel.app) | player@ | authenticated, viewing feed and a post detail | Tap Like on feed, then again to unlike; repeat on post detail | Count increments/decrements immediately (optimistic), reconciles after toggle_clip_like RPC confirms; both directions idempotent | PW | P1 | TODO |
| CL-06 | Backend/SQL | player@ / coach1@ | toggle_clip_like RPC reachable via two distinct auth users | Fire rapid concurrent like/unlike calls from two sessions on the same clip | clip_likes/likeCount never goes negative under any interleaving | SQL | P0 | TODO |
| CL-07 | Athlete web (atlitos-app.vercel.app) | player@ | post detail open | Submit a comment via composer | Own-row insert succeeds; commentCount on the header increments by 1 | PW | P1 | TODO |
| CL-08 | Athlete web (atlitos-app.vercel.app) | guest | post detail open as guest | Attempt to comment | Composer area replaced by a sign-in prompt; no TextInput is rendered for guests | PW | P2 | TODO |
| CL-09 | Backend/SQL | player@ vs coach1@ | player@ has posted a comment; coach1@ authenticated, ids differ | coach1@ attempts to delete player@'s comment via direct API/RPC call, not via UI | Deletion is rejected server-side; comment row unchanged | SQL | P0 | TODO |
| CL-10 | Athlete web (atlitos-app.vercel.app) | player@ | Upload/Post entry point reachable | Pick an asset, submit without caption, then submit with caption+sport tag | Submit without caption is blocked; valid submit enters uploading->processing state and does not appear in the public feed yet | PW | P1 | TODO |
| CL-11 | Backend/SQL | n/a | clips table has recent uploads | Query clips stuck in uploading/processing past the pipeline SLA and orphaned storage objects with no matching clips row | Zero stuck rows past SLA; zero orphaned storage rows | SQL | P1 | TODO |
| CL-12 | Athlete web (atlitos-app.vercel.app) | player@ | creator profile with published clips exists | Open a creator's profile, review header stats + grid, tap Follow | Header stats correct, grid shows published clips only, Follow toggle reflects true state and updates on tap | PW | P1 | TODO |
| CL-13 | Cross-surface | admin@ + player@ | player@ has a live clip; admin@ can moderate it | admin@ takes the clip down in /moderation; player@ (a different viewer, e.g. coach1@) reloads the feed/profile | Clip disappears from other viewers' feed and creator-profile grid immediately, remains visible only to the uploader's own posts grid with a status pill | EXT | P1 | TODO |
| CL-14 | Backend/SQL | n/a | a clip has been taken down by admin | Run the feed query used by the app directly against the DB for a non-owner user | Taken-down clip is excluded at the data layer, not just hidden client-side | SQL | P0 | TODO |
| CL-15 | Athlete native (Expo sim) | player@ | Expo simulator, feed seeded | Scroll the native Clutch feed, observe autoplay-on-viewport and paging-snap swipe | Video autoplays only when in viewport; swipe paging snaps correctly between clips | MAESTRO | P1 | TODO |
| CL-16 | Athlete native (Expo sim) | player@ | Expo simulator | Complete an upload end to end natively | Upload flow (asset pick -> caption/sport tag -> submit -> processing) works natively without crash | MAESTRO | P1 | TODO |
| CL-17 | Athlete web (atlitos-app.vercel.app) | player@ | feed, post detail, upload, gating all reachable | Judgment walk: feel of scroll smoothness, playback responsiveness, gating friction | Findings JSON: works / confusing / broken per surface area touched, with evidence | EXT | P2 | TODO |
| CL-18 | Backend/SQL | player@ | burst of like/comment/follow activity generated in a short window | Compare client-displayed counts against SQL aggregates immediately after a burst | Displayed counts match SQL aggregates exactly (no drift, no double-count) | SQL | P1 | TODO |
| CL-19 | Backend/SQL | player@ vs coach1@ | player@ has a rejected/removed clip | coach1@ queries clips_select-equivalent data directly, ids explicitly asserted different from player@'s | Rejected/removed clip is visible ONLY to the uploader (player@'s own query), confirmed by direct query as a second user, not just UI absence | SQL | P0 | TODO |

## FO — Follows (10 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| FO-01 | Athlete web (atlitos-app.vercel.app) | player@ | viewing a creator profile not yet followed | Tap Follow | followerCount increments immediately in the actor's own view; button flips to Following | PW | P1 | TODO |
| FO-02 | Athlete web (atlitos-app.vercel.app) | player@ | already following a creator | Tap Follow again (unfollow) | followerCount decrements; toggling twice more is idempotent both directions | PW | P1 | TODO |
| FO-03 | Backend/SQL | player@ | player@ has a mix of follows/followers | Compare the app's Follows/Followers list rendering against SQL row counts for follows table | Lists match SQL exactly, no phantom or missing rows | SQL | P1 | TODO |
| FO-04 | Backend/SQL | player@ vs coach1@ | player@ has a private-ish follow list; coach1@ authenticated, ids differ | coach1@ attempts to read player@'s full follow list beyond public counts | Access is scoped correctly per the app's stated privacy model (no unintended full-list leak) | SQL | P1 | TODO |
| FO-05 | Backend/SQL | player@ vs coach1@ | ids differ, asserted explicitly | coach1@ attempts to call toggle_follow with follower_id set to player@'s id (acting on player@'s behalf) | Call rejected; actor id must equal auth.uid(), coach1@ cannot follow on player@'s behalf | SQL | P0 | TODO |
| FO-06 | Backend/SQL | player@ | authenticated | player@ calls toggle_follow with follower_id==followee_id==self | RPC rejects self-follow | SQL | P1 | TODO |
| FO-07 | Backend/SQL | player@ | burst of follow/unfollow activity | Compare displayed follower/following counts against SQL aggregate after the burst | No drift between displayed counts and SQL aggregate | SQL | P1 | TODO |
| FO-08 | Athlete web (atlitos-app.vercel.app) | player@ | coach discovery reachable | Browse coach/creator discovery list | Follow state (following/not) renders correctly per viewer for each listed creator | PW | P2 | TODO |
| FO-09 | Athlete web (atlitos-app.vercel.app) | guest | viewing a creator profile as guest | Tap Follow | LoginGateModal opens; follow is NOT toggled | PW | P1 | TODO |
| FO-10 | Cross-surface | player@ + coach1@ | player@ follows coach1@ while coach1@ has the profile open in a second authenticated session | player@ follows coach1@; observe coach1@'s own concurrently-open session | Follower count updates correctly for the second logged-in user's view, not just the actor's optimistic UI | SQL | P1 | TODO |

## CH — Chat + realtime messaging (13 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| CH-01 | Athlete web (atlitos-app.vercel.app) | player@ + coach1@ | an existing 1:1 thread between them (session-derived) | Two browser contexts: player@ sends a message, assert coach1@'s context receives it via expect.poll | Optimistic append on sender side; receiver sees the message arrive in real time; no duplicate on reconcile | PW | P1 | TODO |
| CH-02 | Athlete web (atlitos-app.vercel.app) | 3 personas (group thread) | an existing training-group thread with 3+ members | A third member sends a message | Message received by all members with correct sender-name attribution above the bubble | PW | P1 | TODO |
| CH-03 | Athlete web (atlitos-app.vercel.app) | player@ + coach1@ | two contexts, existing thread | coach1@ sends a message while player@'s thread-list is open in a separate context | player@'s unread badge increments without a manual reload | PW | P1 | TODO |
| CH-04 | Athlete web (atlitos-app.vercel.app) | player@ | a thread with long history | Scroll up to load older messages | Older pages load correctly, no duplicate or gapped messages | PW | P2 | TODO |
| CH-05 | Backend/SQL | player@ vs coach2@ | player@ is not a member of a given thread; ids differ | player@ attempts to SELECT a thread they do not belong to | Query returns zero rows / access denied, not another member's data | SQL | P0 | TODO |
| CH-06 | Backend/SQL | player@ vs coach2@ | player@ is not a member of a given thread; ids differ | player@ attempts to INSERT a message into a thread they do not belong to | Insert rejected server-side | SQL | P0 | TODO |
| CH-07 | Athlete web (atlitos-app.vercel.app) | player@ | active thread, network can be throttled | Go offline mid-send, then reconnect | Pending message is not lost; resends or clearly shows a retry affordance on reconnect | PW | P1 | TODO |
| CH-08 | Backend/SQL | n/a | chat_messages in supabase_realtime publication | Run scripts/verify-realtime.mjs chat portions | Script exits green: publication + isolation checks pass | SQL | P0 | TODO |
| CH-09 | Athlete web (atlitos-app.vercel.app) | player@ | no threads / an empty opened thread | View chat thread list with zero threads, and an opened thread with zero messages | Both render a clear empty state, not a blank screen or error | PW | P3 | TODO |
| CH-10 | Athlete native (Expo sim) | player@ + coach1@ | Expo simulator | Send and receive a 1:1 message natively | Native 1:1 chat send/receive works without crash | MAESTRO | P1 | TODO |
| CH-11 | Athlete native (Expo sim) | 3 personas | Expo simulator, group thread exists | Open group thread, open roster sheet via member-count row | Roster sheet opens with correct members; sender names show above bubbles | MAESTRO | P2 | TODO |
| CH-12 | Athlete web (atlitos-app.vercel.app) | player@ | blocked-user feature status unknown | Attempt to locate a block/unblock affordance in chat UI | MISSING if unspecced: no block-user feature found in code as of this catalog freeze; case is a placeholder pending confirmation, catalog as gap not executable pass/fail | EXT | P3 | TODO |
| CH-13 | Backend/SQL | player@ vs coach2@ | player@ has no session with coach2@ (no thread should exist) | player@ attempts to open/list a thread with coach2@ directly via API, bypassing the UI's lack of a link | Server-side gate (not just missing UI link) blocks access; no thread data returned | SQL | P0 | TODO |

## CT — Courts (booking, partner ops, money) (20 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| CT-01 | Athlete native (Expo sim) | player@ | courts list seeded with sport chips | Browse court list, filter by sport chip, open a court detail | List/detail load from real data; BillSummary price readouts render in the house mono font | MAESTRO | P2 | TODO |
| CT-02 | Athlete web (atlitos-app.vercel.app) | player@ | TEST_DB guard active, E2E=1 | Full booking flow: pick slot -> Book:Pay -> BillSummary -> Razorpay test checkout -> verify-payment | Booking confirmed; SQL-side booking + ledger rows consistent with what the UI showed | PW | P0 | TODO |
| CT-03 | Backend/SQL | player@ + coach1@ (as two bookers) | same slot targeted by two concurrent booking calls | Fire two concurrent book-court calls for the identical slot | Exactly one booking succeeds; the other is rejected (no double-booked slot) | SQL | P0 | TODO |
| CT-04 | Backend/SQL | player@ | an existing booking | Attempt to update a booking's status directly (bypassing the RPC state machine) | Rejected; only the RPC/edge-fn state machine may transition booking status | SQL | P0 | TODO |
| CT-05 | Backend/SQL | player@ | an existing court with a known price | Call book-court with a client-forged (mismatched) amount | Rejected with PRICE_MISMATCH; server re-validates against the authoritative price | SQL | P0 | TODO |
| CT-06 | Backend/SQL | player@ | one active booking, one completed booking | Cancel the active booking (legal transition); attempt to cancel the completed booking | Active-booking cancel succeeds with correct refund policy; completed-booking cancel rejected INVALID_TRANSITION | SQL | P0 | TODO |
| CT-07 | Cross-surface | partner@ vs p2-verify-partner@ | two partners, each with own venue(s); ids explicitly differ | Load Live Today as partner@, then as p2-verify-partner@ | Each partner's board shows only their own venue's bookings, never the other's (ids diffed) | SQL | P0 | TODO |
| CT-08 | Backend/SQL | partner@ | a confirmed booking not yet checked in | Call the check-in RPC twice in succession | Second call is a no-op / idempotent, does not create a duplicate check-in record | SQL | P1 | TODO |
| CT-09 | Cross-surface | partner@ vs p2-verify-partner@ | each owns disjoint venues (incident 2/3 regression class) | Run the venue picker/switcher as BOTH partner@ and p2-verify-partner@, diff the results | Each sees only their own venues; zero cross-tenant leakage (regression guard for the fixed incident) | EXT | P0 | TODO |
| CT-10 | Backend/SQL | n/a | portal-court source + live DB | Grep every Supabase query in apps/portal-court for an explicit owner filter; separately probe as p2-verify-partner@ for any unscoped venue read | Every query carries an explicit .eq/.in/.or owner filter; live probe returns zero rows outside p2's own venues | SQL | P0 | TODO |
| CT-11 | Backend/SQL | partner@ | completed bookings + ledger entries exist | Compare the Earnings page's displayed figures against a direct ledger_entries aggregate | Displayed earnings equal the ledger aggregate exactly, no client-side drift | SQL | P0 | TODO |
| CT-12 | Athlete web (atlitos-app.vercel.app) | player@ | full court journey reachable | Judgment walk: browse -> book -> pay -> view booking -> cancel or rate | Findings JSON on friction/broken points across the player court journey | EXT | P1 | TODO |
| CT-13 | Court Partner Portal | partner@ | full partner ops journey reachable | Judgment walk: venues -> slots/pricing -> live today -> walk-in -> check-in -> earnings | Findings JSON on friction/broken points across the partner ops journey | EXT | P1 | TODO |
| CT-14 | Athlete native (Expo sim) | player@ | Expo simulator | Browse and book a court slot natively | Native courts smoke completes without crash | MAESTRO | P2 | TODO |
| CT-15 | Court Partner Portal | partner@ | slots-pricing page, one peak rule already exists | Add a second peak-pricing rule that time-overlaps the first | Postgres 23P01 exclusion-constraint collision surfaces as a friendly error message, not a raw Postgres error | PW | P2 | TODO |
| CT-16 | Court Partner Portal | partner@ | Live Today -> Record a walk-in dialog open | Toggle price override ON, leave reason blank, attempt Confirm; then fill reason | Confirm is blocked client-side with an empty reason; enabling requires a non-empty reason before the book-court call fires | PW | P1 | TODO |
| CT-17 | Court Partner Portal | partner@ | a confirmed booking on Live Today | Open Cancel dialog, attempt submit with empty reason, then with a reason | Submission is blocked until a non-empty reason is entered | PW | P1 | TODO |
| CT-18 | Court Partner Portal | partner@ | Live Today open, realtime channel subscribed | Throttle/kill the websocket connection, then restore it | WifiOff disconnect banner with manual Refresh link appears; clears automatically on reconnect | EXT | P2 | TODO |
| CT-19 | Court Partner Portal | unverified/logged-out partner | an account with an unverified venue, and a logged-out session | Direct hard-navigate to /dashboard in both states | Both the layout.tsx server-side gate and middleware.ts session refresh redirect away from /dashboard; neither path leaks dashboard data | PW | P1 | TODO |
| CT-20 | Backend/SQL | n/a | dashboard/layout.tsx venue_staff membership check | Static review + probe: confirm the venue_staff membership existence check carries an explicit user_id filter | Currently relies on RLS only (no explicit .eq('user_id', user.id)); flag as a house-rule deviation, not currently exploitable given venue_staff's non-public RLS shape | SQL | P2 | TODO |

## CO — Coaching + training groups (booking, money, ratings) (13 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| CO-01 | Athlete web (atlitos-app.vercel.app) | player@ + coach1@ | TEST_DB guard active | Full session lifecycle: request -> coach accepts (TEST RAILS) -> session completes -> player rates | Each transition succeeds in order; rating is recorded exactly once | PW | P0 | TODO |
| CO-02 | Backend/SQL | coach1@ | a just-completed session | Compare coach earnings balance/pending figures against ledger_entries aggregate for that session | Earnings equal the ledger aggregate, no client-side sum drift | SQL | P0 | TODO |
| CO-03 | Backend/SQL | coach1@ | a requested session | Attempt to transition requested->completed directly, skipping accepted/in_progress | Rejected with INVALID_TRANSITION; zero rows written | SQL | P0 | TODO |
| CO-04 | Backend/SQL | player@ + coach1@ | a requested session, payment intent exists | coach1@ declines the request | Money nets to zero for the declined session (no charge retained, no orphaned ledger entry) | SQL | P0 | TODO |
| CO-05 | Athlete web (atlitos-app.vercel.app) | player@ | an accepted or unanswered session | Cancel the session | Correct refund policy applies automatically; no admin step is required or surfaced | PW | P0 | TODO |
| CO-06 | Athlete web (atlitos-app.vercel.app) | player@ | a training group with open enrollment | Join group -> subscription created -> let renewal come due -> renew -> let membership lapse | Each state transition (join/renew/lapse) behaves correctly; lapse blocks access to group content until renewed | PW | P0 | TODO |
| CO-07 | Backend/SQL | n/a | training group fixtures seeded | Run scripts/verify-groups-probes.mjs | Script exits green | SQL | P0 | TODO |
| CO-08 | Backend/SQL | player@ vs a non-member | a training-group session/chat exists; ids differ | Non-member attempts to read the group's session/chat data directly | Access denied; zero rows returned to the non-member | SQL | P0 | TODO |
| CO-09 | Backend/SQL | player@ | a completed session eligible for rating | Attempt to rate twice, and attempt a rating outside 1-5 | Second rating attempt rejected (exactly-once); out-of-range rating rejected; coach average recalculates correctly after a valid rating | SQL | P1 | TODO |
| CO-10 | Backend/SQL | coach1@ | several completed sessions with ledger entries | Compare displayed balance/pending/this-month figures against SQL ledger aggregate | No drift between displayed figures and SQL aggregate | SQL | P1 | TODO |
| CO-11 | Athlete web (atlitos-app.vercel.app) | coach1@ | an already-accepted future session exists | Edit availability windows to remove that slot's window | Already-accepted session is unaffected; only future (not-yet-booked) slot generation changes | PW | P1 | TODO |
| CO-12 | Athlete web (atlitos-app.vercel.app) | player@ | full coaching journey reachable | Judgment walk: discover coach -> filter -> book -> request -> await acceptance -> rate | Findings JSON on friction/broken points across the player coaching journey | EXT | P1 | TODO |
| CO-13 | Athlete web (atlitos-app.vercel.app) | coach1@ | full coach ops journey reachable | Judgment walk: requests queue -> accept -> complete -> earnings -> transfer -> availability | Findings JSON on friction/broken points across the coach ops journey | EXT | P1 | TODO |

## SH — Shop (cart, checkout, orders, money) (11 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| SH-01 | Athlete web (atlitos-app.vercel.app) | player@ | at least one product in stock | Add item to cart, update quantity | BillSummary reflects subtotal/GST/delivery/total correctly as quantity changes | PW | P1 | TODO |
| SH-02 | Athlete web (atlitos-app.vercel.app) | player@ | TEST_DB guard active, cart populated | Checkout: pick address -> BillSummary -> pay (test rails) -> order placed | Order confirmed; SQL-side order + ledger rows consistent with what checkout showed | PW | P0 | TODO |
| SH-03 | Backend/SQL | player@ | checkout with roundup toggle available | Toggle donation roundup on, complete checkout, then compare against SQL | BillSummary delta matches the roundup amount exactly; a linked donation record exists tied to the order | SQL | P1 | TODO |
| SH-04 | Backend/SQL | player@ | an order already placed with a saved address | Edit the saved address after the order was placed, then re-fetch the order's snapshot | Order's address snapshot is unchanged (immutable), does not retroactively reflect the address edit | SQL | P1 | TODO |
| SH-05 | Backend/SQL | admin@ | an order in a known status | Advance through legal status transitions; attempt an illegal/skip transition | Legal advances succeed; illegal/skip transition rejected INVALID_TRANSITION | SQL | P0 | TODO |
| SH-06 | Backend/SQL | player@ vs coach1@ | player@ has an order; ids differ | coach1@ attempts to read player@'s order by id | Access denied; zero rows returned to coach1@ | SQL | P0 | TODO |
| SH-07 | Backend/SQL | player@ | a product with a known catalog price | Submit checkout with a client-forged item price | Rejected with PRICE_MISMATCH; server re-validates against the catalog price | SQL | P0 | TODO |
| SH-08 | Backend/SQL | n/a | a product with exactly one unit of stock | Run scripts/verify-oversell-probe.mjs (concurrent checkouts on the last unit) | Exactly one checkout succeeds; no oversell | SQL | P0 | TODO |
| SH-09 | Backend/SQL | player@ | several past orders | Compare Order History list against SQL order rows for that user | List matches SQL exactly, no stale or client-only entries | SQL | P1 | TODO |
| SH-10 | Athlete web (atlitos-app.vercel.app) | player@ | full shop journey reachable | Judgment walk: browse -> PDP -> wishlist -> cart -> checkout -> order detail -> feedback | Findings JSON on friction/broken points across the shop journey | EXT | P1 | TODO |
| SH-11 | Backend/SQL | admin@ | a placed/paid order eligible for refund | Admin initiates a refund for the order | Ledger nets to zero for the reversed order; no orphaned partial entries remain | SQL | P0 | TODO |

## EM — Empower + UPA (donations, verification, UPA Life portal) (21 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| EM-01 | Athlete web (atlitos-app.vercel.app) | donor@ | TEST_DB guard active, a fundable UPA wishlist item exists | Donate on TEST RAILS: pick item -> DonationSheet -> pay -> confirm | Full trail (donation_drafts -> donations -> ledger) is SQL-consistent with what the UI showed | PW | P0 | TODO |
| EM-02 | Backend/SQL | donor@ / player@ | a checkout with roundup completed | Compare roundup accrual total against SQL ledger/donations aggregate | No client-summed drift; roundup accrual equals the SQL aggregate | SQL | P0 | TODO |
| EM-03 | Backend/SQL | n/a | empower fixtures seeded | Run scripts/verify-f-donation.mjs, verify-f-rls.mjs, verify-empower-p6.mjs | All three scripts exit green | SQL | P0 | TODO |
| EM-04 | Backend/SQL | donor@ vs upa.verified@ | ids explicitly differ | donor@ attempts to read upa.verified@'s private application fields; upa.verified@ attempts to read donor@'s PII beyond what's needed for a public donation | Each is blocked from the other's private fields; only appropriately public data crosses the boundary | SQL | P0 | TODO |
| EM-05 | Life/UPA Portal | upa.tennis@ | apply wizard reachable, no existing application | Complete Story/Sport-Region/Certificates/Video steps -> submit_upa_application | Application status becomes pending/submitted | PW | P1 | TODO |
| EM-06 | Cross-surface | admin@ + upa.tennis@ | upa.tennis@ has a pending application; linked-row topology captured before | admin@ approves upa.tennis@'s application | Status flips to verified; ORPHAN-GUARD REGRESSION check: exact linked-row topology (wishlist/fund/profile rows) diffed before/after shows no orphaned or duplicated rows | SQL | P0 | TODO |
| EM-07 | Life/UPA Portal | upa.tennis@ | a rejected application | Reapply via reapply_upa_application with corrected info | New submission clears the rejected state and re-enters the review pipeline | PW | P1 | TODO |
| EM-08 | Life/UPA Portal | upa.tennis@ (pending) | not yet verified | Direct URL nav to /home, /wishlist, /wishlist/[itemId], /gratitude, /profile/preview | All redirect to /status via requireVerifiedApplication; zero data leak from any verified-only route | PW | P0 | TODO |
| EM-09 | Life/UPA Portal | upa.verified@ | verified account, full nav available | Enumerate every action available in code, check each live against the PRD-05 FR list | Capability sweep findings JSON: each capability marked WORKS / EXISTS-BUT-CONFUSING / MISSING against PRD-05 | EXT | P1 | TODO |
| EM-10 | Backend/SQL | upa.verified@ | fund balance displayed on /home | Compare displayed total-raised figure against upa_fund_balance RPC / ledger | Figure is ledger-derived, not client-summed; no client-writable path exists to alter it | SQL | P0 | TODO |
| EM-11 | Athlete web (atlitos-app.vercel.app) | donor@ / player@ | a mix of verified, pending, and rejected UPAs exist | Browse the Empower Hub discovery rail | Only verified UPAs are listed; pending/rejected never appear | PW | P0 | TODO |
| EM-12 | Life/UPA Portal | upa.verified@ | verified seat, fixed interview script | Run the fixed seat-interview script (what first, tell supporters, money in/what usable, weekly return hook) | Each prompt answered WORKS / EXISTS-BUT-CONFUSING / MISSING with evidence, feeding the UPA gap matrix | EXT | P1 | TODO |
| EM-13 | Life/UPA Portal | upa.tennis@ | pending seat, fixed interview script | Run the fixed seat-interview script for a pending UPA (what while pending, how to ask for a non-money need) | Each prompt answered WORKS / EXISTS-BUT-CONFUSING / MISSING with evidence, feeding the UPA gap matrix | EXT | P1 | TODO |
| EM-14 | Athlete web (atlitos-app.vercel.app) | donor@ | Empower Hub reachable | Discover a UPA, review evidence/verification signal, decide whether to donate | Donor-trust findings JSON: is the verification signal convincing, is anything confusing or missing before the donate step | EXT | P1 | TODO |
| EM-15 | Backend/SQL | upa.tennis@ | a rejected application | Attempt to move status directly from rejected to verified via RPC/API, bypassing an explicit admin approval action | Rejected without an explicit admin action; no client-side or direct-RPC bypass to verified exists | SQL | P0 | TODO |
| EM-16 | Cross-surface | upa.verified@ + donor@ | verified profile with editable fields | upa.verified@ edits profile fields; donor@ views the same UPA's public profile | Edit persists and is reflected in the donor-facing public profile | PW | P1 | TODO |
| EM-17 | Cross-surface | upa.verified@ | verified account, account page reachable | Open the Deactivate my profile dialog (do not confirm, since this is destructive) | Flag as PRD-05 FR-27 deviation: PRD text requires contacting support to deactivate once verified, but code allows full self-service deactivate via RPC with only a confirm dialog | PW | P1 | TODO |
| EM-18 | Life/UPA Portal | upa.verified@ (deactivated state) | an account with status='deactivated' | Navigate to /apply | Reapply mode triggers for status='deactivated' same as 'rejected', though PRD-05 FR-10 only names 'rejected' explicitly; confirm this extra trigger is intentional | PW | P2 | TODO |
| EM-19 | Life/UPA Portal | donor@ | no upa_applications row exists for donor@ | Sign in to portal-life as donor@ | Lands on a graceful empty/no-application state at /status, not a crash or wrong redirect (donor@ has no business being verified here by design) | PW | P2 | TODO |
| EM-20 | Life/UPA Portal | upa.verified@ | a wishlist item with status=open and funded_amount=0, realtime channel subscribed | Concurrently (from SQL) push funded_amount from 0 to >0 while the wishlist page is open | Edit/remove buttons disappear live without a manual refresh the instant the boundary is crossed | PW | P1 | TODO |
| EM-21 | Backend/SQL | upa.verified@ | a wishlist item with status != 'funded' | Call mark_wishlist_item_delivered directly out of band (bypassing the UI, which only renders the button when status='funded') | RPC rejects the out-of-band call; server-side enforcement matches the client-side gate, not just a hidden button | SQL | P0 | TODO |

## AD — Admin console (9 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| AD-01 | Admin (Refine.dev) | admin@ vs player@ | admin@ has admin role; player@ does not | Sign in as admin@ (expect success, routes to /verification); sign in as player@ on the admin login (expect rejection) | admin@ succeeds and lands on the verification queue; player@ is rejected with a generic error, no role hint leaked | PW | P0 | TODO |
| AD-02 | Admin (Refine.dev) | admin@ | a ready clip in the moderation queue | Approve one clip with a signed preview URL; reject a second clip, first with a blank reason then with a reason | Approve publishes the clip; reject is blocked on a blank reason, succeeds with a reason and notifies | PW | P1 | TODO |
| AD-03 | Admin (Refine.dev) | admin@ | a pending coach/venue/UPA verification request | Review evidence, approve one, reject another (blank reason first, then with reason) | Approve flips status to verified with exactly one audit_log row; reject blocked without a reason, writes audit_log with reason | PW | P0 | TODO |
| AD-04 | Admin (Refine.dev) | admin@ | a placed/paid order eligible for refund (TEST RAILS) | Look for a full/partial refund action with BillSummary confirmation on Order Detail | MISSING: no refund action exists anywhere in apps/admin (PRD-04 FR-24/25 unimplemented); catalog as a gap, not an executable pass | SQL | P0 | TODO |
| AD-05 | Admin (Refine.dev) | admin@ | an order in a known status | Advance via the UI's next-legal-step button; separately attempt an illegal/skip transition via direct RPC/edge-fn call | UI-driven advance goes only through admin-order-advance edge function; illegal/skip transition rejected server-side even though the UI never offers it | SQL | P0 | TODO |
| AD-06 | Admin (Refine.dev) | admin@ | user records exist | Search the User List by name/phone | MISSING: search works as a read-only list, but there is no User Detail route and no suspend/reinstate action anywhere (PRD-04 FR-35..38 unimplemented); catalog as a gap | PW | P1 | TODO |
| AD-07 | Backend/SQL | n/a | apps/admin source + live DB | Grep every admin mutation path for a direct table write; separately probe live that each mutation only succeeds via its RPC/edge-fn | Every admin mutation routes through a SECURITY DEFINER RPC or service-role edge function; zero direct table writes found | SQL | P0 | TODO |
| AD-08 | Admin (Refine.dev) | admin@ | full admin surface reachable | Judgment walk: exercise every real queue (verification, moderation, reports, products, orders, drills, fee-config) end to end | Findings JSON explicitly naming which PRD-04 queues/screens are absent (Dashboard, Feature Flags, Support Tickets, Audit Log Viewer) | EXT | P1 | TODO |
| AD-09 | Admin (Refine.dev) | admin@ | dashboard KPI tiles expected per PRD-04 FR-4..6 | Look for a Dashboard Overview route with KPI tiles | MISSING: no Dashboard Overview route exists anywhere in the app's route table or nav shell; catalog as a gap, verify GMV/pending-count ground truth via direct SQL instead | SQL | P2 | TODO |

## XP — Cross-cutting (RLS matrix, house style, script suites, invariants) (13 cases)

| ID | Surface | Persona | Preconditions | Steps | Expected | Lane | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| XP-01 | Cross-surface | n/a | full PW suite configured with consoleGuard fixture | Run the full Playwright suite | Zero uncaught console errors across every spec (known font-404 finding on athlete-web must be fixed, not allowlisted) | PW | P1 | TODO |
| XP-02 | Cross-surface | n/a | surfaces that support theming | Toggle light/dark on each themed surface | No layout breakage or unreadable contrast in either theme | PW | P3 | TODO |
| XP-03 | Cross-surface | n/a | portal-court, portal-life reachable | Resize to mobile viewport on both web portals | Responsive layout holds, no horizontal scroll or clipped controls | PW | P3 | TODO |
| XP-04 | Backend/SQL | n/a | scripts/seed-*.mjs suite | Run the full seed/reset sequence twice in a row | Second run produces identical state to the first; no duplicate rows | SQL | P1 | TODO |
| XP-05 | Backend/SQL | n/a | all sensitive tables enumerated | Generate a persona x sensitive-table access grid, unifying the fragmented verify-*-rls scripts into one scripts/verify-rls-matrix.mjs | Matrix matches expected_access for every persona x table cell; no unexpected grant | SQL | P0 | TODO |
| XP-06 | Cross-surface | n/a | copy across all 4 web surfaces + native | Sweep visible copy for em-dashes/hyphen-bullets, and confirm numeric readouts use the house JetBrains Mono style | No house-style violations found; all numeric readouts use the Money component / mono font | EXT | P3 | TODO |
| XP-07 | Backend/SQL | n/a | scripts/verify-*.mjs full set | Run every remaining verify-*.mjs script not already covered by a domain-specific case | All scripts exit green as a full suite run | SQL | P1 | TODO |
| XP-08 | Backend/SQL | all personas | fee_config table populated | Each persona attempts SELECT on fee_config; each attempts a direct write | All personas can read fee_config (intentional public reference table); no persona can write it directly (only via admin_update_fee_config RPC) | SQL | P1 | TODO |
| XP-09 | Backend/SQL | n/a | user_roles table, auth-hook consumer | Review columns selected app-side from user_roles under its using(true) policy | Public read is confirmed intentional (auth-hook role lookup); no PII columns beyond role are exposed by the policy | SQL | P1 | TODO |
| XP-10 | Backend/SQL | coach1@, partner@, player@, upa.verified@, donor@, admin@ | ledger_entries populated across account types | Each persona queries ledger_entries for their own scope | coach1@ sees only own coach rows; partner@ sees only own venue's rows (via venues join); player@/upa.verified@/donor@ see none; admin@ sees all | SQL | P0 | TODO |
| XP-11 | Backend/SQL | n/a | training-group chat threads (0078) exist | Non-member attempts SELECT/INSERT on a training-group thread's messages; ids explicitly differ from members | Non-member blocked from both SELECT and INSERT on the group thread, matching the existing 1:1 isolation guarantee | SQL | P0 | TODO |
| XP-12 | Backend/SQL | n/a | one example of each state machine (session, order, clip, upa_application) | Attempt every documented illegal edge (session accepted->abandoned, order placed->delivered direct, clip uploading->published, upa_application terminal->under_review) | Every illegal edge is rejected with the correct exception code; zero rows written in each case | SQL | P0 | TODO |
| XP-13 | Backend/SQL | n/a | a single payment/webhook event | Replay the verify-payment / webhook call for the same payment (simulating a race/duplicate delivery) | Exactly one donations row results; record_donation_rpc raises INVALID_TRANSITION on the duplicate fire | SQL | P0 | TODO |

