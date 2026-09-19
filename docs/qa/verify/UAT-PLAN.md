# Atlitos UAT plan: what a person must walk before submission

Written 2026-08-14 against `integration/p6-audit-fixes` at `4793ce4`, and against the live
project `syzzfgaudpifwvbpycyi` by read only SQL. Every claim below carries a file and line, a
command output, or a query result. Where a previous audit was wrong, the correction is marked
CORRECTION and carries the evidence that overturned it.

This document has two jobs. Part 1 is the honest coverage position: what is actually tested
today. Part 2 is the plan a human follows, journey by journey, with the exact steps, the
expected result, and what counts as a failure.

---

## Part 0. STOP. Read this before walking a single journey.

**Production is nine migrations behind the repo, and three of this week's four merged features
have no database half applied at all.** If you walk the coach or clip journeys against
production today, you will hit errors that are not product bugs, and you will file them as if
they were. That has already happened here eight times, which is why this section is first.

Evidence, from the live catalog rather than from the repo:

| Check | Query result | Meaning |
|---|---|---|
| Applied migration ceiling | `0097_report_block`, applied 2026-08-07 | `0098` through `0106` are written and NOT applied |
| `sweep_group_memberships` | `0` rows in `pg_proc` | `0104` unapplied, membership expiry does not run |
| `clips.comments_enabled` | `0` rows in `information_schema.columns` | `0101` unapplied, comments toggle cannot work |
| clip delete policies on `public.clips` | `0` rows in `pg_policy` | `0100` unapplied, a user still cannot delete their own clip |
| `cron.job` | 1 row: `expire-stale-holds`, `*/5 * * * *`, active | `0105` unapplied, the membership sweep is not scheduled |
| Deployed edge functions | 25 active, no `delete-account` | account deletion is neither in this branch's `supabase/functions/` nor deployed |

CORRECTION to `CURRENT-STATE.md`: it states "No pg_cron jobs exist anywhere in the repo." One
pg_cron job is live in production right now (`expire-stale-holds`). The true statement is
narrower: no membership expiry job exists, because `0105` has not been applied.

**Gate 0, blocking. Do not start UAT until all four are true:**

1. `0098` through `0106` are applied to `syzzfgaudpifwvbpycyi`, and the applied ceiling read back
   from `supabase_migrations.schema_migrations` says `0106`, not `0097`.
2. `cron.job` holds the membership sweep job, and it is `active = true`.
3. The mobile build under test is rebuilt from `4793ce4` or later. The current TestFlight and
   internal track builds predate the three feature merges of 13 August.
4. The production Razorpay key is live, not `rzp_test_`. Every payment journey below is
   worthless on a test key, because a test key cannot prove a real customer can pay.

Two more preconditions that are not blocking but will waste your time if skipped:

5. **Production data is polluted and nobody has fixed the generator.** 16 of 22 clips in the live
   feed are e2e fixtures, 6 of 10 venues are test rows, and 38 of 39 `chat_threads` are orphaned
   and render as "Group". Expect to see junk. Do not file it as a product bug; it is already
   recorded as open in `CURRENT-STATE.md`.
6. **Do not run the automated suites concurrently with the manual walk.** The Playwright money
   specs write into the same `player@atlitos.dev` and `coach1@atlitos.dev` accounts you will be
   using, which is precisely how the `trainings-shell` and `groups-athlete` assertions went stale.

### Accounts

Verified present in `auth.users` joined to `public.user_roles` on 2026-08-14. Password for the
seeded set is `AtlitosDemo!2026`, confirmed working by the Maestro flows that logged in on
13 August.

| Email | Name | Roles | Use for |
|---|---|---|---|
| `player@atlitos.dev` | Demo Player | player | every athlete journey |
| `coach1@atlitos.dev` | Ravi Kumar | player, coach | the coach who already has data |
| `coach2@atlitos.dev` | Sana Iyer | player, coach | the second coach, has 2 types and 7 windows |
| `abi@gmail.com` | Abishai | coach | **the empty coach, see C1** |
| `admin@atlitos.dev` | Demo Admin | player, admin | admin refund and suspend checks |
| `upa.verified@atlitos.dev` | Priya Cricket | player | the UPA seat |
| `donor@atlitos.dev` | Demo Donor | player | the donation journey |

`abi@gmail.com` is worth calling out. It is a real coach profile, created by a real person going
through onboarding, and it has **0 session types, 0 availability windows, 0 training groups**.
It is living proof of the gap C1 exists to close, and it is the correct account to walk C1 on.

---

## Part 1. What is actually tested today, re-verified

The July audit's summary was broadly right and is mostly still true after this week's merges.
Four things have changed or were wrong. Each correction below is evidence led.

### Still true

- **No automated test drives a payment through the real Razorpay sheet.** Every money test
  completes capture with a locally HMAC signed synthetic payment id against the deployed
  `verify-payment`. `apps/e2e/helpers/money.mjs:97` builds `pay_E2E${tag}${Date.now()}` and signs
  it with `RAZORPAY_KEY_SECRET`. The file says so itself at lines 12 to 16: "It does not drive
  Razorpay's own checkout.js iframe with a live test card."
- **No unit test suite exists anywhere in the monorepo.** No jest, vitest, or component test
  config outside `.claude/worktrees/`. The only runner is Playwright at
  `apps/e2e/playwright.config.ts`, and it is an API and backend harness, not a unit suite.
- **The coaching, shop, and empower money specs never open a browser.**
  `specs/money/coaching.spec.ts`, `specs/money/shop.spec.ts` and `specs/money/empower.spec.ts`
  contain zero `goto(` calls across 34 tests. `coaching.spec.ts:9` states the reason outright.
- **Real refunds still cannot be tested on the synthetic rail.** `coaching.spec.ts:194` to `:216`
  documents the convergence workaround: a fabricated payment id cannot be settled by Razorpay, so
  the spec calls `settle_refund` directly rather than proving a real refund.
- **The main chat tab has no flow at all.** `apps/mobile/src/app/(tabs)/chat/` holds
  `index.tsx`, `[id].tsx` and `_layout.tsx`. No Maestro flow opens it. The three flows that tap
  something called "Chat" are tapping the Chat sub tab **inside the Trainings module shell**,
  which `trainings-shell.yaml:4` describes as embedding the thread list inline "instead of
  redirecting to /chat".

### CORRECTION 1: the Maestro result is stale, and it is the fifth disguise

`CURRENT-STATE.md:56` reports "13 pass, 1 fail, 1 not executed". That result is real, but it is
evidence about a build that no longer exists.

- Last commit touching `.maestro/`: `d0c755a`, 2026-08-13 14:35:35 +0530.
- Last commit touching `apps/mobile/`: `bb7c670`, 2026-08-13 23:45:01 +0530.
- `git diff --name-only d0c755a..HEAD -- apps/mobile/src` returns **28 files**, of which 18 are
  screens, including `(auth)/login.tsx` (the exact file holding the one documented failure),
  the whole `trainings/(shell)/` group, `clutch/post/[id].tsx`, and the three brand new coach
  screens `session-types.tsx`, `group/edit.tsx`, `group/schedule.tsx`.

The suite has not been run since. Treat 13/1/1 as a previous run's verdict, not this tree's.
Re-running it is item 6 in the missing tests list, and it is cheap.

### CORRECTION 2: the Razorpay sheet was driven nine times, not once, across four domains

`CURRENT-STATE.md:287` says "The Razorpay sheet has been driven once, by a human, on 20 July."
The live `payment_intents` table disagrees. Counting intents whose `razorpay_payment_id` matches
the genuine Razorpay shape `^pay_[A-Za-z0-9]{14}$`, as distinct from the `pay_E2E...`,
`pay_TBVERIFY...` and `pay_probe...` synthetic tags:

| Domain | intents total | driven through the real sheet by a human |
|---|---|---|
| court | 103 | **1** (18 July) |
| session (coaching) | 49 | **3** (20 July, one of which was refunded) |
| commerce (shop) | 61 | **1** (21 July) |
| membership (group join) | 76 | **4** (25 and 26 July) |
| donation | 35 | **0** |

This matters in both directions. It is better than recorded for four domains. It is worse than
recorded for one: **the donation checkout has never been paid for by a human, not once.** That
moves A5 up the priority list.

One real refund exists and is genuine: `refunds` row `8f330e1e`, `razorpay_refund_id`
`rfnd_TFhrCu5zWLRuzd`, amount `1000.00`, status `processed`, created 2026-07-20, against session
`43c52265`. `PAYMENTS.md:323` describes exactly this and is accurate. Every other refund id in
the table is `rfnd_CO04...` synthetic (6) or absent.

### CORRECTION 3: seven flows wrap taps in retry loops, not five

`repeat:` blocks that wrap a tap appear in **seven** flows, thirteen blocks in total:
`auth-register-skip` (3), `trainings-shell` (4), `shop-back` (2), `clutch-like-gate` (1),
`courts-header` (1), `profile-gate` (1), `search-domains` (1).

`courts-header.yaml:20` names the defect these hide: "tapping the Courts bottom tab from Home
intermittently does nothing ... The retry loop below is a test harness workaround for that
flakiness, not a fix."

One of the thirteen is worse than the others. `shop-back.yaml:63` has **no `while:` guard**:

```yaml
- repeat:
    times: 3
    commands:
      - tapOn: "Badminton"
```

It taps three times unconditionally. If the first tap works, taps two and three land on whatever
screen the first tap produced.

### CORRECTION 4: an automated script DOES open the athlete checkout UI, and it asserts nothing

This is the most important correction, because it inverts the shape of the finding. The July
audit said no automated test opens any athlete checkout UI. One does.

`scripts/verify-shopper-ui.mjs` drives the full athlete web shop journey in Playwright: browse,
PDP, variant stock, wishlist, cart, quantity capping, checkout, the BillSummary roundup shown and
suppressed cases, then at lines 100 to 105 it clicks "Continue to pay" and screenshots
`15-checkout-razorpay-sheet`.

It has **zero assertions and zero failure exit paths**. Every journey sits inside one
`try { ... } catch (e) { console.log('DRIVER ERROR:', e.message); await cap('ZZ-error'); }` at
lines 14 and 117 to 120, and the file ends with `await b.close()`. It exits 0 whatever happens.
It is a screenshot driver wearing the name `verify-`.

CORRECTION to the audit's framing: the athlete shop checkout UI is not unautomated. It is
automated and unasserted, which is worse, because it produces a green.

### The current honest position, in one paragraph

The backend is well defended: `verify-rls-matrix.mjs` carries 375 of 376 green with zero access
control leaks, the money state machines are proven by RPC and edge function level Playwright
specs that re-derive every figure from `ledger_entries` rather than trusting a 200. The client is
barely defended: 15 Maestro flows, 7 of which retry taps to work around a real navigation defect,
9 of which still use a selector this project has already proven false passes (see F1 below), no
unit tests, and the one script that walks a checkout screen asserts nothing. Nothing at all
covers the coach creation layer, which shipped this week and has never been used by a person.

---

## Part 2. The UAT plan

Ordered by impact multiplied by how unproven the journey is. Walk them in order. Stop and record
at the first failure in a journey rather than pressing on, because a later step passing after an
earlier one failed usually means the app fell back to a state you did not intend.

For every journey, capture: a screenshot at each numbered step that says "capture", the device
and build number, and the timestamp. File findings in `docs/qa/BUG-LEDGER.md`.

Read the failure column literally. "FAIL if" describes the observable, not an interpretation. If
what you see is not in either the expected or the fail column, that is UNRESOLVED and gets
written down as UNRESOLVED, not forced into one of the two.

---

### Priority band 1: never used by a person

#### C1. A brand new coach makes themselves bookable

**Why first.** The entire coach creation layer merged on 13 August and no human has touched it.
`session_types` holds 4 rows, all created 2026-07-19 by seed, across 2 coaches. Zero rows have
ever been created through the new screen. A coach with no session type is unbookable, so this one
journey gates every rupee a coach can earn. `abi@gmail.com` is a real coach profile sitting at
0 types, 0 windows, 0 groups right now.

**Precondition.** Gate 0 complete. Sign in as `abi@gmail.com`, the genuinely empty coach. If you
prefer not to use your own account, any freshly onboarded coach works, but do not use `coach1` or
`coach2`, because both already have 2 types and 7 windows and will not exercise the empty state.

| # | Step | Expected |
|---|---|---|
| 1 | Open the app, sign in, go to the Trainings tab | The coach view loads, not the athlete view |
| 2 | Find the entry to session types and pricing (capture) | An entry point is discoverable without being told where it is. If you have to hunt, that is a finding in itself, record it |
| 3 | Open the session types screen (capture) | An empty state that tells the coach what to do, not a blank list |
| 4 | Create a type: name "Batting Basics UAT", duration 60, price 1000 | It saves and appears in the list marked active |
| 5 | Create a second type: name "Fitness Block UAT", duration 30, price 600 | Two types listed |
| 6 | Edit the first type's price to 1200 (capture) | The list shows 1200 |
| 7 | Deactivate the second type | It stays in the list, visibly inactive, and is not deleted |
| 8 | Set your availability so at least one weekday window covers a bookable hour | The window saves |
| 9 | Sign out. Sign in as `player@atlitos.dev` | |
| 10 | Search or browse coaching for this coach, open their profile (capture) | The coach is listed and shows a price from 1200 |
| 11 | Start a booking against them | "Batting Basics UAT" is offered at 1200. "Fitness Block UAT" is NOT offered, because it was deactivated |

**Expected result.** A coach who had nothing can be found, priced, and booked by an athlete.

**FAIL if.** Any of: the session types screen cannot be reached from the coach's own navigation;
a create errors; the price shown to the athlete differs from what the coach set; the deactivated
type is still offered to the athlete; the coach does not appear in athlete browse at all after
step 8.

**Automatable?** YES, in full, and it should be. Maestro can drive every step and SQL can prove
the `session_types` row landed with the right `coach_id`, `price` and `active`. This is missing
test 3 below. Nothing here touches Razorpay.

**Note for whoever reads the code afterwards.** `packages/api/src/use-coach.ts:794` says
"`sessions.session_type_id` is NOT NULL (0018_coaching.sql)". That is stale by 58 migrations.
`0076_training_groups.sql:143` runs `alter table public.sessions alter column session_type_id
drop not null;` and the live catalog confirms `is_nullable = YES`. The conclusion "a coach with
zero session types is unbookable" is still correct, but the mechanism is the athlete booking
screen listing only `active` types, not a database constraint. Do not go looking for a NOT NULL
violation; you will not find one.

---

#### C2. A coach creates a training group, schedules a session, and marks attendance

**Why here.** `create_training_group`, `update_training_group` and `create_group_session` existed
as RPCs with API wrappers and **zero call sites** until this week. The attendance and start
session screens were fully built and unreachable. All three RPCs are confirmed present in
`pg_proc` on the live project. `training_groups` currently holds exactly 1 row, so the create
path has essentially no production history.

**Precondition.** Signed in as `coach1@atlitos.dev`. Gate 0 complete.

| # | Step | Expected |
|---|---|---|
| 1 | Trainings tab, go to groups, choose create a group (capture) | A create form opens |
| 2 | Name "UAT Squad", sport cricket, capacity 4, monthly fee 500. Save | The group appears in the coach's list |
| 3 | Open the group, edit it: change capacity to 5 (capture) | The change persists after leaving and returning |
| 4 | Try to clear a field the RPC cannot clear (for example blank the name) | The app refuses in the form. It must NOT accept the edit and then silently drop it |
| 5 | From the group, schedule a group session for tomorrow at a time inside your availability (capture) | The session is created and shows on the group |
| 6 | Sign out. Sign in as `player@atlitos.dev`. Find "UAT Squad" and join it | Join flow reaches the payment step |
| 7 | Complete payment (see A2 for the sheet steps) (capture) | Membership becomes active, the athlete sees the group under My groups |
| 8 | Sign back in as `coach1`. Open the group session, start it | The session moves to in progress |
| 9 | Mark the athlete present (capture) | Attendance records and survives a screen reload |
| 10 | Complete the session | The session reaches completed |

**Expected result.** A group exists, an athlete paid into it, and the coach ran and recorded a
session.

**FAIL if.** Any RPC returns an error surfaced as a raw code to the user; the capacity edit does
not hold; the athlete cannot see the group after paying; attendance does not persist; the session
cannot be started or completed.

**Automatable?** MOSTLY. Steps 1 to 5 and 8 to 10 are fully automatable and `groups-coach.yaml`
already covers part of the attendance path. Step 7 is not, because it crosses the Razorpay sheet.
Split it: automate 1 to 5, automate 8 to 10 against a membership seeded through the edge function
rail, and leave only step 7 manual.

**Blocked today.** `groups-coach.yaml` is the flow that is currently not executed, because its own
design resets a seeded session's status with a raw Postgres `UPDATE` after each run. Under the DB
write gate it cannot run at all. Either give it its own disposable fixture, or run it on a staging
project. Until then this journey has no automated leg.

---

#### C3. A coach declines a paid request, and the athlete gets their money back

**Why here.** This is the only coach action that moves money backwards, and the refund is the
single highest trust moment in the product. It is well covered at the edge function level
(`CO-04` in `coaching.spec.ts:148`, plus `scripts/verify-co04-decline-refund.mjs`), but every one
of those proofs runs on the synthetic rail and calls `settle_refund` directly to converge. **No
human has ever watched a real decline refund land in a real customer's bank.** Exactly one real
refund exists in the whole project, and it was an athlete cancel, not a coach decline.

**Precondition.** A real, live key payment must exist first. Walk A1 to completion, stopping
before the coach accepts.

| # | Step | Expected |
|---|---|---|
| 1 | As `player@atlitos.dev`, book a session with `coach1` and pay for real (A1 steps 1 to 8) | Session is `requested`, money captured |
| 2 | Sign in as `coach1`. Open requests (capture) | The new request is listed |
| 3 | Decline it, with a reason | The app confirms, and states the athlete is being refunded |
| 4 | Capture the athlete facing screen after decline | The athlete is told the session was declined and the money is coming back. Not silence |
| 5 | Check the Razorpay dashboard for the refund | A real refund exists against the real payment id, status processed or pending |
| 6 | Two working days later, confirm the athlete's bank or card statement | The money arrived |

**Expected result.** Declining a paid request returns the full amount, and both parties are told.

**FAIL if.** The decline succeeds but no refund appears in Razorpay; the athlete is not told; the
session moves out of `requested` without a refund row; or the refund sits `pending` indefinitely
with nothing surfacing that to anyone.

**Automatable?** PARTIALLY, and the boundary is worth stating exactly. The state machine, the
ledger netting to zero, the closed bare RPC, and the absence of a stranded `captured` intent are
all already automated and green. What cannot be automated is the two things that matter to a
customer: that Razorpay actually accepted the refund on a live key, and that the money arrived.
Razorpay's own settlement is third party and asynchronous over days. Steps 5 and 6 stay manual,
permanently.

---

#### A6. Delete your own clip, and turn comments off

**Why here.** Merged 13 August. `0100` and `0101` are **not applied to production**, confirmed:
zero delete policies on `public.clips`, and no `comments_enabled` column. Until Gate 0 item 1 is
done, this journey cannot pass, and every failure it produces will be an environment failure
dressed as a product bug.

**Precondition.** Gate 0 item 1 verified by re-querying `information_schema.columns` for
`clips.comments_enabled` and getting a row back. Signed in as an account that owns at least one
live clip. Note: `FB-004` recorded that no demo account has a `live` clip seeded, so you may need
to upload one first, which is step 1.

| # | Step | Expected |
|---|---|---|
| 1 | Upload a clip from the Clutch tab, wait for it to reach live (capture) | The clip appears in your own profile grid |
| 2 | Open the clip from your profile grid, open the owner menu (capture) | Delete and a comments toggle are offered |
| 3 | Turn comments off | The comment affordance disappears for viewers |
| 4 | Sign in as a second account, open the same clip | No comment input. Existing comments, if any, are handled per the design, record what you see |
| 5 | Back as the owner, turn comments on | The comment affordance returns |
| 6 | Post a comment from the second account, then delete your own comment as its author | Your own comment deletes, others' do not |
| 7 | As the owner, delete the clip (capture) | It goes from the feed and from the profile grid |
| 8 | As the second account, refresh the feed | The clip is gone, no broken card, no crash |

**Expected result.** A person controls their own clip and their own comment, and nobody else's.

**FAIL if.** Delete is offered on somebody else's clip; the comments toggle does not affect what
a second account sees; a deleted clip leaves a broken card; the owner menu does not appear at all
(which, if `0100` is applied, is the real bug, and if it is not, is Gate 0).

**Automatable?** MOSTLY, and it should be, because ownership rules are exactly the class of thing
that fails silently. Two accounts, an assertion that the two user ids differ (per the isolation
rule in `CLAUDE.md`), and prove the FORBIDDEN action is refused, not just that the allowed one
works. The clip upload leg is slower to automate because it waits on transcode; seed a live clip
instead.

**Known adjacent defect, do not re-file.** The comments sheet cannot open: `maxHeight: '75%'` is
inert because its parent `KeyboardAvoidingView` has no style, so the percentage cannot resolve.
Recorded open in `CURRENT-STATE.md`. If comments do not open, check whether that is the cause
before filing anything new.

---

#### A7. An expired membership offers Renew, and renewing works

**Why here.** Before `0104`, an active membership never became lapsed, the athlete saw "Active
until <past date>" forever, and the Renew button was dead code. `0104` and `0105` are **not
applied**, and `sweep_group_memberships` does not exist on production. This is unwalkable until
Gate 0.

**Precondition.** Gate 0 items 1 and 2, verified by reading `cron.job` back and seeing the sweep
job active.

| # | Step | Expected |
|---|---|---|
| 1 | Confirm by SQL that a membership exists whose paid period has ended | A row is returned |
| 2 | Wait for the sweep to run, or confirm it ran, by re-reading the membership status | Status is `expired`, not still `active` |
| 3 | Sign in as that athlete, open My groups (capture) | The card shows the membership is over, and offers Renew |
| 4 | Tap Renew | The payment step opens, priced at the group's monthly fee |
| 5 | Pay for real (see A2) (capture) | Membership returns to active with a new period |
| 6 | Find a `lapsed` membership, or wait for one | Its card offers Join under the capacity guard, NOT Renew |
| 7 | Open the coach's view of the same group | Coach and athlete agree on who is active. They must not disagree |

**Expected result.** Expiry happens on its own, Renew appears only where it works, and both sides
see the same truth.

**FAIL if.** The membership never leaves `active`; Renew appears on a `lapsed` membership (it will
error, and a button that appears in order to error is worse than no button); the coach's screen and
the athlete's screen disagree about who is active.

**Automatable?** YES for the predicate half, PARTIALLY for the rest.
`scripts/verify-renew-button.ts` already proves the exact predicate pair the component evaluates,
for all four states, and correctly expects Renew only on `expired`. That is a good test. What is
not automated is that the sweep actually fires on schedule and that the renewal payment completes,
and step 7's cross view agreement, which is the bug shape that bit this project before.

---

### Priority band 2: money paths a customer will hit on day one

#### A1. Book and pay for a coaching session, end to end, on a live key

**Why here.** Three real sheet payments exist for this domain, all 20 July, all on a test key and
on a build that predates the Phase 1 security lockdown, the Clutch memory fix, and this week's
merges. The path is well proven at the edge function level and not proven at all on the current
build.

| # | Step | Expected |
|---|---|---|
| 1 | Sign in as `player@atlitos.dev` | Home loads |
| 2 | Coaching tab, browse coaches (capture) | Coaches list with a price from |
| 3 | Open `coach1` Ravi Kumar | Profile shows types and prices |
| 4 | Choose a session type, a date, and a slot (capture) | Only slots inside the coach's availability are offered |
| 5 | Read the bill summary (capture) | Price, GST and platform fee are itemised, in JetBrains Mono with tabular figures. The total is arithmetically correct |
| 6 | Continue to pay | The Razorpay sheet opens |
| 7 | Pay with a real method (capture the sheet, not the card details) | The sheet succeeds |
| 8 | Return to the app (capture) | The app shows the booking as requested. It must NOT hang on a spinner or show a generic error after a successful payment |
| 9 | Confirm in Razorpay that the payment captured | Payment present, amount matches step 5 exactly |
| 10 | Sign in as `coach1` and accept the request | Athlete sees accepted |
| 11 | Complete the session as the coach | Athlete sees completed and can rate |
| 12 | Rate it 5 | Rating records once. A second attempt is refused |

**Expected result.** Money leaves a real account, the session exists, and both parties see the
same status at every step.

**FAIL if.** The amount charged differs from the bill summary by any amount; the app does not
recover from the sheet; a payment succeeds and no session exists; a session exists and no payment
does.

**Automatable?** PARTIALLY. Steps 1 to 6 are automatable and are missing test 4. Steps 9 to 12 are
already automated and green (`CO-01`, `CO-09` in `coaching.spec.ts`). **Step 7 is not automatable
and never will be.** The Razorpay checkout sheet is third party UI, a native SDK on mobile and an
iframe on web, outside this codebase, outside the accessibility tree Maestro walks, and driving it
with a live card would be both fragile and a real charge on every run. Say this plainly rather
than pretending a synthetic capture covers it: it does not. It covers everything on both sides of
the sheet, and nothing inside it.

---

#### A5. Donate to a UPA and pay for it

**Why here.** **Zero real payments have ever been made in this domain.** 35 donation intents
exist, every one of them synthetic. It is also the most reputationally exposed path in the
product, because a donation that fails silently is a person believing they helped somebody when
they did not.

| # | Step | Expected |
|---|---|---|
| 1 | Sign in as `donor@atlitos.dev`, open the Empower hub (capture) | Verified UPAs listed |
| 2 | Open `Priya Cricket` (`upa.verified@`) | Profile with story and wishlist |
| 3 | Choose a specific wishlist item to fund (capture) | Item level donate flow |
| 4 | Enter an amount below the configured minimum | Refused clearly, before payment |
| 5 | Enter a valid amount, read the bill summary (capture) | Total correct, no invented fee |
| 6 | Pay for real (capture) | Sheet succeeds |
| 7 | Return to the app (capture) | Donation confirmed |
| 8 | Check the UPA's profile as the donor | Raised total went up by exactly your amount |
| 9 | Sign in as `upa.verified@`, open the portal dashboard | The same figure. Dashboard, item bar, donor list and the consumer hub must all agree |
| 10 | Check My Impact on the donor account | Your donation is listed |
| 11 | Make a general donation, not tied to an item | Same coherence checks |

**Expected result.** One rupee figure, identical on all four surfaces, derived from the ledger.

**FAIL if.** Any two of the four surfaces disagree by any amount. This exact incoherence was a P0
in the July audit ("Funded 100 percent, 0 donations, Total raised 0.00 for the same item"), was
fixed by `0084`, and has never been re-walked by a person on a real payment. It is precisely the
kind of fix that regresses quietly.

**Automatable?** MOSTLY, and much of it already is. `specs/money/empower.spec.ts` runs 13 tests
with zero browser navigations, all edge function and SQL. The coherence check across four
surfaces is automatable and is the highest value part. Only step 6 is not.

**Note.** The duplicate UPA card is a known seed data issue, not a read bug: two verified
`upa_applications` share the cricket headline. Do not re-file it.

---

#### A2. Join a training group and pay for it

Four real sheet payments exist here, 25 and 26 July, the most of any domain. Good coverage
already, so this sits below A5.

| # | Step | Expected |
|---|---|---|
| 1 | As `player@atlitos.dev`, find a group with spare capacity (capture) | Group listed with fee and capacity |
| 2 | Join, read the bill summary (capture) | Monthly fee correct |
| 3 | Pay for real | Sheet succeeds |
| 4 | Return to the app (capture) | Membership active, group under My groups |
| 5 | Open the group chat thread | You are in it. Member count matches active members plus the coach |
| 6 | Try to join the same group again | Refused with a clear message, before the payment step |
| 7 | Have a second account join a group that is now full | Refused with a clear message, before the payment step |

**FAIL if.** A second charge is possible for the same membership; a full group takes a payment
before refusing; the chat thread does not include you after paying.

**Automatable?** MOSTLY. `CO-06` in `coaching.spec.ts:275` already proves capacity and duplicate
join guards fire before Razorpay, with a genuine three way concurrent race and `assertIsolation`
on the joiners. `CO-08` proves a non member is denied the group thread with zero rows. Only step 3
is manual.

**On the member count.** If you see 5 members against 4 active players, that is CORRECT: 4 players
plus the coach. It was investigated and disproven as an off by one. Do not re-file it.

---

#### A3. Book and pay for a court

One real sheet payment, 18 July, the oldest of the set.

| # | Step | Expected |
|---|---|---|
| 1 | Courts tab from Home (capture) | Courts list. If the tap does nothing, that is the known intermittent defect, tap again and record that it took two taps |
| 2 | Read the header | It says what it is showing. It must not claim a distance when location has not resolved. "13,486.1 km" was BUG-039 and is fixed |
| 3 | Open a court, pick a slot (capture) | Only free slots offered |
| 4 | Read the bill summary (capture) | Court fee, GST and platform fee itemised, total correct |
| 5 | Pay for real | Sheet succeeds |
| 6 | Return to the app (capture) | Booking confirmed, appears under My bookings |
| 7 | Have a second account try the same slot | Refused. No double booking |
| 8 | Cancel the booking within the refundable window | Refund initiated, and the athlete is told |

**FAIL if.** Two bookings exist for one slot; the total charged differs from the summary; a
cancelled booking leaves a captured intent with no refund row.

**Automatable?** MOSTLY. `specs/money/courts.spec.ts` runs 11 tests including a real slot search
rather than a hardcoded slot, and `verify-oversell-probe.mjs` proves concurrent `OUT_OF_STOCK`
enforcement. Step 5 is manual. Step 1's intermittent tap is exactly what the retry loops hide, so
do this one by hand and count the taps.

---

#### A4. Buy gear and pay for it

One real sheet payment, 21 July. Lowest of the four because `verify-shopper-ui.mjs` walks the
whole screen path already, even though it asserts nothing (see F2). A human walking it once
supplies the assertions the script is missing.

| # | Step | Expected |
|---|---|---|
| 1 | Shop, browse all gear (capture) | Catalogue renders |
| 2 | Open a product, pick a variant that is out of stock (capture) | Add to cart is disabled, with a clean message |
| 3 | Pick an in stock variant, add to cart | Cart updates |
| 4 | Try to add more units than are in stock (capture) | The quantity is capped, with a notice. It must not let you buy stock that does not exist |
| 5 | Go to checkout with a total that is NOT a multiple of the roundup target | The round up to support an athlete option appears (capture) |
| 6 | Remove a line so the total IS a multiple | The round up option is suppressed (capture) |
| 7 | Restore a non multiple total, accept the round up, read the bill summary (capture) | Subtotal, delivery, GST, round up and total all itemised and arithmetically correct |
| 8 | Pay for real | Sheet succeeds |
| 9 | Return to the app (capture) | Order confirmed with an order number |
| 10 | Open the order detail (capture) | Ship to address is a snapshot of the address at order time |
| 11 | Edit that address in the address book, then reopen the same order (capture) | The order's ship to is UNCHANGED |
| 12 | Sign in as `admin@atlitos.dev`, refund the order | Refund issued, athlete told |

**FAIL if.** Step 4 lets you exceed stock; the round up appears when the total is already a
multiple; **step 11 changes the historical order's address**; the amount charged differs from
step 7.

**Automatable?** YES, all of it except step 8, and steps 1 to 7 and 10 to 11 are the exact
journeys `verify-shopper-ui.mjs` already drives. It needs assertions, not a rewrite. See F2.

---

### Priority band 3: everything else a reviewer or a first user will hit

#### A8. First run: register, log in, and get in as a guest

**Why here.** Not money, but it is the first thing every store reviewer does, and it holds the
one Maestro flow that is deliberately red.

| # | Step | Expected |
|---|---|---|
| 1 | Fresh install, launch (capture) | The guest or sign in choice is clear |
| 2 | Continue as guest | Home. **Not Register** |
| 3 | From Home, hit a gated action (like a clip) | The login gate opens with real copy |
| 4 | Close the gate | Back to Home, gate dismissed |
| 5 | Go to Register, fill every field (capture) | Registration succeeds. There must be no date of birth field, it moved to the profile |
| 6 | From Register, tap the Log in cross link | Login screen |
| 7 | From Login, tap Continue as guest (capture) | **Home.** This is the known red |
| 8 | Set your date of birth on the profile edit screen | It saves |
| 9 | Sign out, sign back in | Session restores |

**FAIL if.** Step 7 lands on Register. That is `BUG auth-register-skip`, root caused in
`apps/mobile/src/app/(auth)/login.tsx` `afterAuth()`: `router.canGoBack()` is true because
Register is still on the stack beneath Login, so `router.back()` pops back to Register.
`CURRENT-STATE.md` records the fix as applied at the cause (cross links now `replace`) but **not
yet device verified**. This journey is that verification. If it lands on Home, the fix is proven
and the Maestro flow can go green.

**Automatable?** YES, fully. `auth-register-skip.yaml` covers it and is the flow correctly left
failing. Re-run it after this walk.

---

#### A9. The main chat tab

**Why here.** It has no automated coverage whatsoever, and chat is a bottom tab, not a corner of
the product. Every existing chat assertion goes through the Trainings module shell instead.

| # | Step | Expected |
|---|---|---|
| 1 | As `player@atlitos.dev`, open the Chat bottom tab (capture) | The thread list loads |
| 2 | Read the thread rows (capture) | Real names and real previews. **Expect junk here:** 38 of 39 threads are orphaned by the earlier cascade and render as "Group". That is known, do not re-file. Record whether a real thread is findable among them |
| 3 | Open a real thread | Messages render, in order, with sender names |
| 4 | Send a message | It appears immediately and persists after leaving and returning |
| 5 | On a second device or account, confirm it arrived without a manual refresh | Realtime delivery |
| 6 | Go back from the thread | You return to the Chat tab, not somewhere else |
| 7 | Open the same thread from the Trainings shell instead | Same messages, consistent |

**FAIL if.** The message input does not render (this was `CH-01`, `CH-02`, `CH-07` on athlete web
and has never been cleared on native for this tab); a sent message does not persist; back exits
to the wrong screen.

**Automatable?** YES, fully, and it is missing test 2. Nothing here is third party.

---

#### C4. Coach earnings and the notification a session fires

| # | Step | Expected |
|---|---|---|
| 1 | As `coach1`, open earnings (capture) | Balance, lifetime earned, lifetime transferred and this month all shown, in tabular figures |
| 2 | Complete a session (from A1 step 11) | The earnings figures move by the expected amount |
| 3 | Check the athlete's device when the coach starts a session (capture) | A notification arrives |
| 4 | Check the athlete's stats after a session moves to in progress | The session is still counted |

**FAIL if.** Any of the four earnings figures disagrees with the ledger; no notification fires on
a session transition; **a started session vanishes from the athlete's stats.** That last one is a
confirmed open bug: `bookings.tsx:29` omits `in_progress` from `LIVE_STATUSES`. Verify whether it
is fixed on the current build rather than assuming.

**Automatable?** YES for earnings: `CO-02` and `CO-10` in `coaching.spec.ts` already recompute all
four figures independently from `ledger_entries` and would catch drift. PARTIALLY for
notifications: the row being written is automatable, actual push delivery to a real device needs a
real device with a real APNs or FCM token and is manual. `0102`, `0103` and `0106` must be applied
first, and they are not.

---

#### A10. Account deletion, which both stores require

| # | Step | Expected |
|---|---|---|
| 1 | Open `www.atlitos.com/delete-account` in a browser | 200, instructions are clear |
| 2 | Follow the in app deletion path | The account is deleted or a deletion is scheduled, and the user is told which |
| 3 | Try to sign in afterwards | Refused |

**FAIL if.** The path does not exist in the app. **Expect this to fail today.** `0098` is written
and not applied, and the `delete-account` edge function is neither in this branch's
`supabase/functions/` (25 directories, none named `delete-account`) nor deployed (25 active
functions, none named `delete-account`). This is a store submission blocker, not a nice to have.

**Automatable?** YES once it exists. The web page is already checkable by HTTP.

---

## Part 3. Automation verdicts, collected

| Journey | Automatable | If not, why |
|---|---|---|
| C1 coach makes themselves bookable | YES, in full | |
| C2 group create, schedule, attendance | MOSTLY | Payment leg only. Also blocked today by `groups-coach.yaml` needing a raw `UPDATE` reset that the DB write gate forbids |
| C3 decline refund | PARTIALLY | Razorpay must accept the refund on a live key, and the money must arrive in a real account, days later. Third party and asynchronous |
| C4 earnings and notifications | YES for earnings, PARTIALLY for notifications | Push delivery needs a real device and a real APNs or FCM token |
| A1 coaching payment | PARTIALLY | **The Razorpay sheet is third party UI. Automation cannot drive it, on any of the five domains.** It is a native SDK on mobile and an iframe on web, invisible to Maestro's accessibility walk, and every run would be a real charge |
| A2 group join payment | MOSTLY | Sheet only. Guards already automated and green |
| A3 court payment | MOSTLY | Sheet only |
| A4 shop payment | MOSTLY | Sheet only. Everything else is already driven, just unasserted |
| A5 donation payment | MOSTLY | Sheet only. The four surface coherence check is fully automatable and is the valuable half |
| A6 clip delete and comments toggle | MOSTLY | Upload transcode wait is slow, seed a live clip instead |
| A7 renew after expiry | PARTIALLY | Predicate half already automated. Sweep firing on schedule and the renewal payment are not |
| A8 first run and auth navigation | YES, in full | Already covered, correctly red |
| A9 main chat tab | YES, in full | |
| A10 account deletion | YES, once it exists | |

**The one honest sentence about Razorpay.** The checkout sheet cannot be automated. Not with more
effort, not with a better selector strategy. It is somebody else's UI, it is deliberately isolated
from the host app, and driving it with a live card on every CI run would charge real money. What
automation covers is everything up to the sheet opening and everything after it returns, and the
existing synthetic capture rail proves the server side of the boundary correctly. It does not
prove a customer can pay. Only a person with a real card proves that.

---

## Part 4. The five highest value automated tests that do not exist

In priority order, by what each would catch.

### 1. A deploy parity gate: repo migration ceiling equals applied ceiling, and every repo edge function is deployed

**Catches.** Exactly what I found today: `0098` through `0106` written and unapplied, and a
`delete-account` function that exists in neither place. Three features merged this week have no
database half in production, and nothing in the repo says so. Every UAT failure on C1, A6 and A7
would have been filed as a product bug.

**Shape.** Read the max version from `supabase_migrations.schema_migrations`, read the max numeric
prefix from `supabase/migrations/`, assert equal. List `supabase/functions/*/` and assert each has
an ACTIVE deployment. Fails loudly on drift.

**Why first.** It is the cheapest test on this list, it has the widest blast radius, and it
converts a whole class of phantom bug into one clear red. Plant the drift and watch it fail
before trusting it.

### 2. A Maestro flow for the main chat tab

**Catches.** Any regression in the only bottom tab with zero coverage. Open the tab, assert the
thread list renders, open a thread, assert messages render with sender names, send a message,
assert it persists after navigating away and back, assert back returns to the Chat tab.

**Why second.** It is a whole tab. The three flows that appear to cover chat are covering the
Trainings module's embedded thread list, which `trainings-shell.yaml:4` says explicitly is a
different surface.

**Do not** use `assertVisible: "ATLITOS"` in it. See F1.

### 3. Coach creation layer, end to end, with an athlete side assertion

**Catches.** The bug class that produced the whole C1 journey: a coach who completes onboarding
and is silently unbookable. `create_training_group`, `update_training_group` and
`create_group_session` sat as RPCs with zero call sites for weeks and nobody noticed, because
nothing asserted a coach could be booked.

**Shape.** Maestro drives create session type, then SQL asserts the row landed with the caller's
own `coach_id`, then a second persona's client asserts the type is offered in booking, and a
deactivated type is NOT offered. The negative half is the point: prove the deactivated type is
refused, not merely that the active one works.

### 4. Athlete checkout up to the sheet, one flow per money domain

**Catches.** A broken checkout screen, a wrong total, a missing bill summary, a disabled pay
button. Everything on the near side of the boundary automation can reach.

**Shape.** Per domain: reach checkout, assert the `BillSummary` renders, assert the displayed
total equals an independently computed expected total, tap pay, assert the sheet OPENS, then stop.
Do not enter card details. The assertion is "the handoff happened", which is the last thing this
codebase owns.

**Note.** For shop this is not new work, it is adding assertions to `verify-shopper-ui.mjs`, which
already performs every step and checks none of them.

### 5. Membership lifecycle: sweep fires, expired offers Renew, lapsed does not, renewal restores

**Catches.** A dead Renew button, a membership that never expires, and the coach and athlete views
disagreeing about who is active. All three were real. `verify-renew-button.ts` already covers the
predicate correctly and is a good model; what is missing is the lifecycle around it.

**Shape.** Assert the cron job exists and is active. Drive a membership past its period. Assert
the sweep moves it to `expired`. Assert the athlete card offers Renew, and that a `lapsed`
membership does not. Renew through the edge function rail. Assert active again with a new period.
Then assert the coach's view and the athlete's view return the same active set, which is the cross
view check nothing does today.

### Honourable mention, and it is nearly free

Re-run the 15 Maestro flows against the current tree. The 13/1/1 verdict predates 28 changed
mobile files including 18 screens. It costs one run and it either confirms the number or finds a
regression from this week's three merges. Blocked only on the device gate.

---

## Part 5. Tests that would pass even if the feature were broken

Every entry here is a green that means nothing, or a green that conceals a known red. Ranked by
how much false confidence it buys.

### F1. Nine Maestro flows use a selector this project has already proven false passes

`auth-register-skip.yaml:62` states it plainly, in the repo, in a comment written by the agent
that proved it:

> `"ATLITOS"` (all caps, AppBar.tsx line 90) is NOT a safe Home marker: it false matches
> app.json's `"name": "Atlitos"` surfaced somewhere in the OS accessibility tree, so this
> assertion can report COMPLETED while the app sits on Register (proven via screenshot +
> screen-hierarchy JSON, see docs/qa/P5-IOS-FINDINGS.md F-4).

It was fixed in that one flow, to `assertVisible: "What are you looking for..."`, the Home search
bar placeholder. **It was not swept.** It survives in nine other flows across twelve sites:

| File and line | Form |
|---|---|
| `clutch-like-gate.yaml:49` | `assertVisible: "ATLITOS"` |
| `courts-header.yaml:51` | `assertVisible: "ATLITOS"` |
| `search-domains.yaml:34` | `assertVisible: "ATLITOS"` |
| `profile-gate.yaml:40`, `:54` | `assertVisible: "ATLITOS"` |
| `shop-back.yaml:52`, `:71` | `assertVisible: "ATLITOS"` |
| `smoke-guest-home.yaml:34` | `assertVisible: "ATLITOS"` |
| `groups-join-guard.yaml:55` | `visible: "ATLITOS"` as a condition |
| `gate-login-nav.yaml:28`, `:44` | `visible: "ATLITOS"` as a condition |
| `trainings-shell.yaml:79`, `:290` | `visible: "ATLITOS"` as a condition |

Every one of these is a "we are on Home" proof that can be true while the app is on some other
screen. The four used as `when:` or `while:` conditions are worse than the assertions, because a
condition that wrongly evaluates true silently skips or runs the wrong branch and fails nothing.

**This is the class sweep rule from `CLAUDE.md` going unheld:** "When you find a bug, sweep for its
class. Fixing the instance is how the same bug ships three times." Here it shipped twelve times.

**Fix.** Replace every one with the Home search bar placeholder, exactly as `auth-register-skip`
did. Then negative test it: plant a flow that is deliberately on Register and assert it now fails.

### F2. `scripts/verify-shopper-ui.mjs` drives the entire shop checkout and asserts nothing

Zero `expect`, zero `assert`, zero `process.exit(1)`. Lines 14 and 117 to 120 wrap all six
journeys in one try/catch that swallows every failure into `console.log('DRIVER ERROR:', ...)`
and continues to `await b.close()`. The process exits 0 regardless.

It does check two things and then throws them away:

```js
console.log('OOS add-to-cart disabled =', await addBtn.isDisabled().catch(()=>'n/a'));   // line 37
console.log(`cart steppers: ${total}, disabled at cap: ${disabled}`);                     // line 73
```

Both are the actual product rules (out of stock must disable add to cart, quantity must cap at
available stock). Both are printed and never compared to anything.

The file is named `verify-`, sits alongside genuine verification scripts, and reached the point of
clicking "Continue to pay" and screenshotting the Razorpay sheet. It would pass with the entire
shop broken.

**Fix.** It is 90 percent of a real test already. Add assertions to the steps it performs, remove
the swallowing catch, exit non zero on failure. This is missing test 4 for the shop domain, nearly
free.

### F3. `scripts/verify-shopper-ui-address-snapshot.mjs` asserts its claim in a filename

Zero assertions, no failure exit. Its whole purpose is to prove that editing an address does not
retroactively change a historical order's ship to. The proof is line 28:

```js
await nav(ORDER); await shot(p,'21-order-detail-shipto-UNCHANGED-light'); await say('order after edit');
```

The word UNCHANGED is in the screenshot filename. If the address DID change, the script still
produces a file called `21-order-detail-shipto-UNCHANGED-light.png` showing the changed address,
and exits 0. The only thing standing between this and a silent false green is a human opening the
PNG.

This is the same shape as the fixture that was "proven" by sampling a sibling clip: the artifact
is named after the conclusion instead of tested for it.

**Fix.** Read the ship to text before the edit, read it after, assert equal, exit non zero if not.
Four lines.

### F4. `scripts/verify-ai-search.ts` has no failure exit path

Zero `process.exit(1)`, zero `throw`. Whatever it observes, it exits 0. Not audited in detail here
because AI search is not on the submission critical path, but it must not be counted as a passing
check.

### F5. Thirteen retry loops across seven flows hide a real navigation defect

Listed in Correction 3. These do not produce false greens on their own, they produce **true greens
that conceal a true bug**: taps on the bottom tab bar intermittently do nothing, documented at
`courts-header.yaml:20` and independently found on `CategoriesRow`'s per sport icons. A user gets
one tap, not four.

`shop-back.yaml:63` is the worst of the thirteen because it has no `while:` guard at all and taps
"Badminton" three times unconditionally.

**Fix.** Fix the tap defect, then delete the loops. Until then, every one of them should carry a
link to the open bug so nobody reads the green as "tapping works".

### F6. A fully cached `turbo` run is a verdict about a previous run

Already recorded in `CURRENT-STATE.md` and repeated here because it belongs on this list: a
`pnpm turbo typecheck` that reports 12 of 12 successful and 12 of 12 CACHED proves nothing about a
change to a gitignored generated artifact, because that artifact is not in the hash. Force the run.
`bb7c670` now regenerates the expo-router types before typecheck, which addresses the specific
route type case, but the general rule stands for anything untracked.

### F7. The whole Maestro suite result is currently a cached green in the same sense

13/1/1 is a true statement about the tree at `d0c755a`, 13 August 14:35. Twenty eight mobile source
files have changed since, including the file holding the one documented failure. Reporting it as
the current suite status is the fifth disguise: evidence about a previous run, presented as
evidence about this one.

---

## Appendix. Evidence index

Every non obvious claim above, with where to re-derive it.

| Claim | Evidence |
|---|---|
| Applied ceiling is `0097` | `select version, name from supabase_migrations.schema_migrations order by version desc limit 12` |
| `sweep_group_memberships` absent, `clips.comments_enabled` absent, no clip delete policy | single query against `pg_proc`, `information_schema.columns`, `pg_policy` |
| One live pg_cron job | `select jobid, schedule, jobname, active from cron.job` |
| 25 edge functions, no `delete-account` | Supabase list edge functions; `ls supabase/functions/` returns 25 directories |
| 9 human Razorpay payments, 0 donations | `payment_intents` grouped on `razorpay_payment_id ~ '^pay_[A-Za-z0-9]{14}$'` |
| One real refund | `refunds` where `razorpay_refund_id` is neither `rfnd_CO04%` nor synthetic: 1 row, `rfnd_TFhrCu5zWLRuzd` |
| `session_types` 4 rows, all 2026-07-19, 2 coaches | `select count(*), count(distinct coach_id), min(created_at), max(created_at) from public.session_types` |
| `abi@gmail.com` is an empty coach | `coach_profiles` joined to `auth.users`: 0 types, 0 windows, 0 groups |
| `session_type_id` is nullable | `information_schema.columns`; `0076_training_groups.sql:143` |
| Synthetic capture rail | `apps/e2e/helpers/money.mjs:88` to `:104` |
| Coaching spec never opens a browser | `grep -c "goto(" specs/money/coaching.spec.ts` returns 0 |
| Seven retry flows, thirteen blocks | `grep -c "repeat:" .maestro/*.yaml` |
| Twelve unsafe ATLITOS selectors | `grep -n '"ATLITOS"' .maestro/*.yaml` |
| `verify-shopper-ui.mjs` asserts nothing | file has no `expect`, no `assert`, no `exit(1)`; try/catch at `:14` and `:117` |
| Maestro result predates the merges | `git log -1 --format=%ci -- .maestro/` vs `-- apps/mobile/`; `git diff --name-only d0c755a..HEAD -- apps/mobile/src \| wc -l` returns 28 |
