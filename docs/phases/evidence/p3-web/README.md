# Phase 3 web verification evidence

**This is WEB evidence only.** Everything in this directory was driven against
`apps/mobile` running as `npx expo start --web` on `localhost:8090`, in a
Chrome tab, using script-minted Supabase sessions injected into
`localStorage` (never typed credentials). **This does not satisfy
`docs/PLAN.md`'s simulator-evidence requirement for mobile.** Native iOS
simulator verification was separately blocked this phase (no programmatic tap,
macOS Accessibility/Screen Recording permissions pending a restart). The
founder's decision was: verify the flow LOGIC on web now, do the native pass
separately. Every finding below is scoped to "the logic works when driven
through a real browser DOM," not "the native app works." See
`NATIVE-RISK-REGISTER.md` in this directory for the precise, itemized list of
what a web pass cannot speak for and must still be checked natively.

## 0. Seed fixture fix (AT-56), done first

`scripts/seed-coaching-fixtures.mjs` signed in as the fixture coaches and
wrote `session_types`/`coach_availability_windows` but never touched
`public.users`, so `city`/`state` stayed null and
`needsOnboarding()` (`session-store.ts`: `me != null && !me.city`) trapped
every seeded coach on role-select forever, no matter what role grants existed.
Fixed by calling the same `complete_player_setup` RPC the player-setup wizard
calls, before seeding session data. Ran twice back to back, both runs
succeeded and reported "already exists" for the fixture data on the second
pass, confirming idempotency. Commit `464550d`.

## 1. A. Consumer app flows (Expo web, port 8090)

| # | Flow | Result | Evidence |
|---|---|---|---|
| 1 | Athlete: browse -> coach profile -> pick session type -> Confirm/pay -> BillSummary | **BLOCKED by a real backend defect**, worked around; see below | `web-coach-profile-session-types-missing-BUG.jpg`, `web-athlete-browse-coaches.jpg`, `web-athlete-booking-billsummary-requested.jpg` |
| 2 | Athlete: cancel a `requested` session, refund copy matches real `refund_status` | **PASS** (via direct edge-function call; the web UI's own cancel button is unusable on web, see finding below) | `web-athlete-cancel-refund-result.jpg` |
| 3 | Coach: Trainings, session requests, accept and decline | **PASS** | `web-coach-trainings-requests.jpg`, `web-coach-accept-request.jpg`, `web-coach-decline-request-nopending.jpg` |
| 4 | Chat: both sides send, other side sees it, realtime (no reload) | **PASS** | `web-chat-coach-view-thread.jpg` -> `web-chat-coach-sent-message.jpg` -> `web-chat-player-view-thread.jpg` (sees it) -> `web-chat-player-sent-reply.jpg` -> `web-chat-coach-realtime-received-reply.jpg` (received live, tab never reloaded) |
| 5 | Athlete: rate a completed session; second rating attempt rejected | **PASS** | `web-athlete-completed-session-billsummary-rating-form.jpg`, `web-athlete-rating-5star-filled.jpg`, `web-athlete-rating-submitted.jpg` |

### Finding 1 (blocking defect, real, not a fixture problem): athletes cannot see any coach's session types

Reproduced at the database level, independent of the client:

```sql
set role anon;
select exists (select 1 from coach_profiles cp
  where cp.user_id = '5b262cf1-8f95-45df-b453-0802013f82a1'
    and cp.status = 'verified');
-- returns false, even though the row exists and status IS 'verified'
-- when read as postgres/service role.
```

`session_types_select_public` and `coach_availability_windows_select_public`
(`supabase/migrations/0019_coaching_rls.sql`) gate visibility with:

```sql
exists (select 1 from coach_profiles cp
  where cp.user_id = session_types.coach_id and cp.status = 'verified')
```

That `EXISTS` subquery is itself subject to `coach_profiles`' own RLS, which
has only `coach_profiles_select_own` and `coach_profiles_select_admin` — no
policy grants `anon`/non-owner `authenticated` a read on the base table. So
the subquery always evaluates false for anyone browsing someone else's
profile, and `session_types_select_public` / `coach_availability_windows_select_public`
are dead policies: they can never actually return a row. The `coach_profiles_public`
view (`WHERE status = 'verified'`) works fine for browsing because Postgres
views default to the view owner's privileges, bypassing the querying role's
RLS on the underlying table — but the two policies above reference the raw
`coach_profiles` table directly, not that view, so they don't get the same
bypass.

**Effect**: an athlete opens any coach's profile and sees "This coach has not
published session types yet." for every coach, always, regardless of real
data. This blocks the entire browse-to-book UI flow at the very first step
(picking a session type), independent of the AT-56 fixture bug fixed above.
Screenshot: `web-coach-profile-session-types-missing-BUG.jpg`.

**I did not patch this.** It's an RLS/migration change (likely: point both
policies at `coach_profiles_public` instead of `coach_profiles`, or add an
explicit `anon,authenticated` verified-read policy on `coach_profiles`
itself), which is bigger than the "trivial fix, flagged" bar for this task and
touches `docs/architecture/RLS.md`. Flagging it here as the top defect for the
next builder.

**How flow 1 and 2 were still exercised**: since the UI cannot reach Confirm
(no session type to pick), I created the booking through the real
`book-session` edge function directly (the function re-validates everything
server-side under the service role, independent of the client's own RLS, so
this is the same server-side path the UI's Confirm button would have called),
then drove the rest — viewing "My sessions," opening the booking detail, and
cancelling — entirely through the UI. The resulting `BillSummary` confirmed
the SESSION convention correctly: "Session fee ₹1,000" / "Total ₹1,000", no
added fee row, fee carved out of price (`bill: {price: 1000, platform_fee: 10,
total: 1000}` from the edge function response). This is a real pass on the
BillSummary rendering and cancel/refund logic; it is not a pass on "the
athlete can browse and pick a session type in the UI," which remains broken
per finding 1.

### Finding 2 (web-only artifact, not a product bug): `Alert.alert` confirmation dialogs are inert on Expo web

`confirmCancelRequest`/`confirmCancel`/rating-adjacent confirms use React
Native's `Alert.alert(title, message, buttons)`. On `react-native-web`,
`Alert.alert` has no web implementation by default: clicking "Cancel request"
in the browser does nothing at all (no dialog appears, no network request
fires, verified via `read_network_requests` showing zero calls after the
click). This is why flow 2 above was completed via direct edge-function call
instead of clicking through. **This is expected to behave correctly on
native**, where `Alert.alert` renders the OS's real dialog — call this out
specifically on the native pass: tap "Cancel request," confirm the native
alert actually appears with the two buttons, and confirm tapping "Cancel
request" in that alert fires `handleCancelRequest`.

### Other real observations (not defects, working as designed)

- Marking a session complete before its Razorpay payment has been captured
  correctly refuses to accrue earnings: "This session's payment has not been
  captured, so earnings cannot be accrued." The `sessions.status` transition
  to `completed` still succeeds (verified in the DB), but the ledger write is
  correctly gated. Screenshot: `web-coach-mark-complete-payment-not-captured.jpg`.
- Cancelling a `requested` session whose payment was never captured returns
  `refund_status: "not_applicable"` / `outcome: "cancelled_without_refund"`
  from `cancel-session-refund`, a value the client's copy `if/else` doesn't
  explicitly name but correctly falls through to the generic "Your request
  has been cancelled." This is the right behavior, just worth naming since
  it's the fallback branch, not the `processed`/`pending` branches.
- Second rating attempt: `rate_session` RPC rejects with
  `ALREADY_RATED: session ... has already been rated` (`P0001`), confirmed by
  calling it directly against the same session id a second time.
- Coach earnings math on an unpaid/unaccrued but completed session correctly
  shows the carve-out (`₹990` = `₹1,000 - ₹10` platform fee) as the
  *would-be* earning, consistent with the SESSION convention.

## 2. B. Portals

Chrome navigation to any external (non-`localhost`) domain was denied by the
Chrome-in-the-loop extension in this session ("Permission denied by user"),
reproduced even against `https://example.com`, so this is a session-level
permission gate, not something specific to the portal domains. Interactive,
authenticated screenshots of the partner "Live Today" dashboard and the admin
dashboard were **not possible** this session.

Fell back to fetching the deployed URLs directly (`mcp__plugin_vercel_vercel__web_fetch_vercel_url`)
to confirm nothing crashed:

| Portal | URL | Status | Result |
|---|---|---|---|
| Court partner | `atlitos-portal-court.vercel.app` | 200 | Renders "List your courts, fill every slot" landing page correctly, Sign in / Get started present |
| Life (UPA) | `atlitos-portal-life.vercel.app` | 200 | Renders "Support the athletes carrying the sport forward" landing page correctly |
| Admin | `atlitos-admin.vercel.app` | 200 | Vite SPA shell serves correctly (`<div id="root">`, correct asset hashes) |

This confirms the three portals are still deployed, still building, and still
serving their public landing pages after Phase 3 changes — it does NOT
confirm the authenticated "Live Today" partner dashboard or the admin
dashboard render correctly post-P3, since I could not sign in and navigate
past the landing page. **That specific check (Live Today still renders, admin
dashboard still loads with real data) is still open** and should be re-run
either with a Chrome session that has external-domain permission granted, or
manually by the founder.

## 3. Web passed but native is unproven or at risk

See `NATIVE-RISK-REGISTER.md` in this directory for the full, itemized list
(Platform.OS branches, the Razorpay native checkout module that has never
executed, AsyncStorage vs localStorage session persistence, expo-haptics /
expo-image-picker / expo-location surfaces, and phone-first layout risk from
testing in a wide browser window). That register was written specifically in
response to the founder's mid-task instruction to track this, and stands as
the native-pass checklist; it is not duplicated here.

## Commits

- `464550d` — `fix(seed): complete public.users so seeded coaches clear onboarding (AT-56)`
- `6661496` — `docs: register exactly what web verification cannot prove about native`
- this evidence commit — `test(web): drive Phase 3 flows on Expo web and the portals`
