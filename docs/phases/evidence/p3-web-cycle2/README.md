# Phase 3 cycle 2 web evidence: browse-to-book re-drive, dark mode

**This is WEB evidence only**, same caveat as `docs/phases/evidence/p3-web/README.md`.
Driven against `apps/mobile` running as `npx expo start --web --port 8090` in a
Chrome tab, using script-minted Supabase sessions (`@supabase/supabase-js`
`signInWithPassword`, fixtures `player@atlitos.dev` / `coach1@atlitos.dev`,
password `AtlitosDemo!2026`) injected directly into `localStorage` under the
`sb-syzzfgaudpifwvbpycyi-auth-token` key. No credentials were ever typed into
the browser.

This directory closes punch items 3 and 4 from the approver's P3 cycle-1
rejection.

## Item 3: browse-to-book, re-driven post AT-63

The prior cycle's evidence (`p3-web/`) predates the AT-63 RLS fix by nine
minutes (evidence commit `d3b5c8f` at 12:34, fix `fe4462b` at 12:43), and its
one booking was created by calling the edge function directly because the web
UI could not reach Confirm (`web-coach-profile-session-types-missing-BUG.jpg`).
Nobody had seen browse-to-book work in the UI.

Re-driven now, as `player@atlitos.dev`, entirely through UI clicks, no direct
edge-function or SQL calls:

1. **Coach discovery list** loads two seeded coaches
   (`web-athlete-browse-coaches-light.jpg` / `-dark.jpg`).
2. **Coach profile** for Demo Coach One (`coach_id`
   `5b262cf1-8f95-45df-b453-0802013f82a1`, the same coach the cycle-1 SQL
   repro used) renders both session types, "Batting Basics" and "Advanced
   Bowling" (`web-athlete-coach-profile-sessiontypes-light.jpg` / `-dark.jpg`).
   This is the screen that was blank before AT-63.
3. Picking "Batting Basics" + "One time" + date 2026-07-20 renders **6
   non-empty availability slots** (12:00-13:00 through 17:00-18:00)
   (`web-athlete-coach-profile-slots-light.jpg`). On the second (dark) pass,
   driven a few minutes later after the light-mode run had booked the
   12:00-13:00 slot, **5 slots remained**, all still non-empty
   (`web-athlete-coach-profile-slots-dark.jpg`). **This is the direct AT-63
   proof: an athlete's browser session, scoped by RLS as `anon`/authenticated
   non-owner, can read another user's `coach_profiles`, `session_types`, and
   `coach_availability_windows` rows and see real, non-empty slot data.**
4. Selecting a slot and clicking Continue reaches **Confirm and pay**, with
   a `BillSummary`-shaped fee breakdown (Session fee / Total, both
   ₹1,000, JetBrains Mono figures) (`web-athlete-booking-confirm-billsummary-light.jpg`
   / `-dark.jpg`). This is the screen the UI could not reach last cycle.

Two bookings were created this way (13:00-14:00 slot, still `requested`, and
the earlier 12:00-13:00 slot from the light-mode pass); both are visible in
`My sessions`, confirming the write path is live end to end from the UI, not
just Confirm rendering.

**Not completed: the actual Razorpay payment on "Pay".** The instruction was
to prove the browse-to-book path was reachable in the UI, and the UI-driven
booking through Confirm/BillSummary now demonstrably is; clicking "Pay" itself
routes into the platform-divergent web Razorpay checkout implementation
(already covered separately in `p3-web`'s Finding 1 workaround and the native
simulator pass in `p3-native/`), which was out of scope for this re-drive.
Nothing new was found broken there; it was simply not re-exercised.

Also captured for completeness, both existing real sessions from the
founder's two native payments, confirming the list and detail screens are
populated with real, not fixture-only, data:

- `99384050-a82c-461a-a930-e08a3e934936`, status `rated`, "Your review 5.0/5
  Excellent first session." (`web-athlete-session-detail-rated-light.jpg` /
  `-dark.jpg`, and `web-coach-session-detail-dark.jpg` from the coach side).
- `43c52265-2fa8-493a-8807-6db2e36a7ec9`, status `Cancelled`, "This session
  was cancelled." (`web-athlete-session-detail-cancelled-refund-light.jpg`).
  Refund status copy is present but this screen does not show a distinct
  processed-refund line; the cancellation state itself is confirmed, refund
  amount/state is not surfaced on this screen (unchanged from p3-web's
  finding, not something this pass introduced).

## Item 4: Phase 3 dark mode evidence

All 19 prior P3 web screenshots were light. Per the amended gate clause 4,
web is acceptable evidence for theming since it is shared across platforms.
Captured in dark:

- `web-athlete-browse-coaches-dark.jpg`
- `web-athlete-coach-profile-sessiontypes-dark.jpg`
- `web-athlete-coach-profile-slots-dark.jpg` (5 non-empty slots, see above)
- `web-athlete-booking-pick-time-details-dark.jpg`
- `web-athlete-booking-confirm-billsummary-dark.jpg`
- `web-athlete-session-detail-rated-dark.jpg`
- `web-coach-trainings-dark.jpg` (Stats tab, non-empty session requests list,
  showing the two sessions booked during this same pass)
- `web-coach-session-detail-dark.jpg`

### How dark mode was set, and a real finding along the way

Screens read theme via `useThemeColors()`
(`apps/mobile/src/theme/use-theme-colors.ts`), which resolves nativewind's
`useColorScheme()`, not RN's own `Appearance`. There is no in-app toggle
reachable from a real screen; the only control is `ThemeToggle` in the dev-only
`apps/mobile/src/app/dev/gallery.tsx`, which calls nativewind's `colorScheme.set()`.

**Finding, not fixed (flagging per instructions, out of scope to fix):** on a
fresh hard load of any route, `dev/gallery`'s toggle itself reports the
resolved system scheme as **dark** (this Chrome/OS environment's
`prefers-color-scheme` is dark), yet every real app screen loaded via a fresh
URL (coaching, trainings, session detail) rendered in **light** regardless.
Something in the "system" resolution path for real screens is not
picking up the same system-dark signal `dev/gallery`'s toggle sees, or an
initial-render/hydration mismatch is sticking to a light default. This was
not chased further since the phase's ask was to produce dark evidence, not
to fix theme resolution, but it is worth a ticket: dark should be the
default here per DESIGN-LANGUAGE.md ("dark is first class, not an inverted
afterthought"), and today it silently is not, on web, for real screens.

Given no in-app toggle and no working system-follow on real screens, dark
mode was set the way the app's own dev tooling sets it: hard-navigate to
`/dev/gallery`, click its `ThemeToggle` to cycle to an explicit `Dark`
override (verified via `document.documentElement.classList.contains('dark')
=== true`), then move to the target screen via `history.pushState` +
a dispatched `popstate` event rather than a fresh URL load. This was
necessary because Expo Router's web static export does a full document
reload (and a fresh JS/nativewind module instance, resetting the override)
on any real browser navigation (typed URL, or this harness's `navigate` tool);
only client-side transitions preserve nativewind's in-memory scheme. No CSS
was injected; the app's own `colorScheme.set()` call is what flipped every
screen, both the StyleSheet-token screens and the `dark:` Tailwind class
screens, matching `gallery.tsx`'s own documented behavior.

## Failures / things not fixed

- The system-dark-not-applied-to-real-screens discrepancy above, flagged not
  fixed.
- The web Razorpay "Pay" click path was not re-exercised (see item 3 above);
  no new evidence either way this pass.
- The athlete session detail screen for a cancelled session does not surface
  refund amount or `refund_status` distinctly (pre-existing, not introduced
  or fixed here).
