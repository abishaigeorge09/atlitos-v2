# P5, Track I: iOS native QA findings

Device: iPhone 16 Pro Max, iOS 26.3, UDID `8AF6A5E2-F889-4477-8634-97B4AB5D5453`. Build under
test: the Release configuration built by Track N (`npx expo run:ios --configuration Release`,
embedded JS bundle, no Metro dependency), per `evidence/p5-bringup/T4-HARNESS-STATUS.md`.

Evidence root: `evidence/p5-ios/`. Full sequential run transcript:
`evidence/p5-ios/maestro-full-run.log`. Per-flow artifacts (screenshots, screen hierarchy JSON,
device logs): `evidence/p5-ios/maestro-runs/<flow-name>/`. A first attempt that ran all 15 flows
in parallel and partly against the wrong simulator (device selection raced against an Android
emulator also live on this machine) is preserved, not discarded, at
`evidence/p5-ios/maestro-runs-attempt1-wrongdevice/` and is not used for any finding below.

## Environmental fix required before any flow could run correctly

`maestro test .maestro/` (directory form) runs all flows **concurrently** against whatever
device Maestro auto-selects, which on this machine had both the iOS simulator and an Android
`Pixel_7_API_35` emulator live (Track A's device). The first run produced 15/15 instant
failures (`FBSOpenApplicationServiceErrorDomain code=4`, simulator could not launch the app
because multiple xctest driver sessions collided on it) and, worse, silently executed several
flows against the Android emulator instead of the named iOS device. Fix: loop over each
`.yaml` file individually with `maestro test <file> --udid 8AF6A5E2-...`, sequential. This is
recorded so Track A and any later Maestro run does not repeat it.

## Flow-by-flow classification

Every failure was opened as a screenshot and, where relevant, the screen-hierarchy JSON before
classifying, per the rule that a failed assertion is not evidence of a defect by itself.

| Flow | Result | Classification | Evidence |
|---|---|---|---|
| `category-nav` | PASS | Pass | `maestro-runs/category-nav/` |
| `clutch-like-gate` | PASS | Pass | `maestro-runs/clutch-like-gate/` |
| `gate-login-nav` | PASS | Pass | `maestro-runs/gate-login-nav/` |
| `profile-gate` | PASS | Pass | `maestro-runs/profile-gate/` |
| `search-domains` | PASS | Pass | `maestro-runs/search-domains/` |
| `shop-back` | PASS | Pass | `maestro-runs/shop-back/` |
| `smoke-guest-home` | PASS | Pass | `maestro-runs/smoke-guest-home/` |
| `courts-header` | FAIL | **Stale test + real defect, see F-3** | `maestro-runs/courts-header/.../step-013-assertCondition-Turf_B.png` |
| `groups-athlete` | FAIL | **Stale test + real defect, see F-2** | `maestro-runs/groups-athlete/.../step-021-scrollUntilVisible-Cric_Squad.png` |
| `groups-coach` | FAIL | Stale test | `maestro-runs/groups-coach/` |
| `groups-join-guard` | FAIL | Stale test | `maestro-runs/groups-join-guard/.../step-012-scrollUntilVisible-Demo_Coach_One.png` |
| `integrator-coach-trainees` | FAIL | Stale test | `maestro-runs/integrator-coach-trainees/` |
| `trainings-coach-browse` | FAIL | Stale test | `maestro-runs/trainings-coach-browse/` |
| `trainings-shell` | FAIL | Stale test | `maestro-runs/trainings-shell/.../step-040-assertCondition-Coach_Demo_Coach_One.png` |
| `auth-register-skip` | FAIL | **Inconclusive, needs re-authoring, see F-4** | `maestro-runs/auth-register-skip/.../step-033-assertCondition-Badminton.png` |

### Stale test, not a defect (6 of 9 failures)

`courts-header`, `groups-coach`, `groups-join-guard`, `integrator-coach-trainees`,
`trainings-coach-browse`, and `trainings-shell` all fail on the same shape: the flow asserts a
named seed fixture (`Turf B`, `Cric Squad`, `Demo Coach One`) that does not exist in the current
database. Opening every failure screenshot confirms the screen itself is fully rendered,
correctly laid out, no crash, no redbox, no stuck spinner. `groups-join-guard`'s Coaches screen
(`step-012-scrollUntilVisible-Demo_Coach_One.png`) shows three real, cleanly rendered coaches
(Abishai, Sana Iyer, Ravi Kumar) with correct star ratings, mono-font pricing, and location
pills. `trainings-shell`'s Coaches tab shows the same: a live "Ravi Kumar" card under "My
coaches" with session count and next-session date, and "Browse coaches" filtered to Cricket.
None of these screens are broken. Per the coordinator's note, seed accounts were rotated during
launch Phase 1's security lockdown, so a fixture named `Demo Coach One` or `Cric Squad` in a
flow authored earlier in P5 no longer exists. **Disposition: these 6 flows need their fixture
assertions rewritten against current seed data, not a product fix.** Filed as a Track N /
integrator follow-up, not a bug.

### F-2. Real defect: load-test fixture rows visible in a real account's group list

`groups-athlete` (login as `player@atlitos.dev`, real credentials, real session) opens
Trainings > My groups and scrolls for `Cric Squad`. The screenshot
(`groups-athlete/.../step-021-scrollUntilVisible-Cric_Squad.png`) shows the list is not empty
and not missing `Cric Squad` for a rendering reason: it is filled with dozens of entries named
`E2E CO-08 <timestamp>`, `E2E CO-06 <timestamp>`, and `Oversell Probe <timestamp>`, all `Active`,
all with real per-month prices (`500/mo`, `1,500/mo`). These read as automated load/e2e test
run artifacts (see `scripts/load/phase3-*.mjs` in this repo) that were seeded into the same
Supabase project this QA pass runs against, rather than into an isolated project. **Severity
P2.** This is a data-hygiene defect, not a native code defect: a real player account's group
list is dominated by test noise, which both breaks fixture-based test flows (explaining several
of the "stale test" failures above, since `Cric Squad` may simply be buried past what a bounded
scroll reaches) and would be visible to any real user browsing this seed environment. Home:
seed/fixture data layer, not `apps/mobile/src`, out of Track I's write scope. Screenshot:
`evidence/p5-ios/maestro-runs/groups-athlete/.maestro/tests/2026-08-11_171537/groups-athlete/screenshots/step-021-scrollUntilVisible-Cric_Squad.png`.

### F-3. Real defect: broken court images and impossible distance readouts

`courts-header` fails on missing `Turf B` (stale test, per above), but the screenshot
(`evidence/p5-ios/finding-courts-image-load-and-distance.png`, copied from
`maestro-runs/courts-header/.../step-013-assertCondition-Turf_B.png`) shows two real defects on
the courts that do exist:

1. **Broken image load.** The "Turf 1" card's photo area renders solid black, and "Main Ground"
   renders a plain green vector shape instead of a venue photo. This is the same failure class
   already seen on Home's "Donate to Empower" cards in the initial bring-up screenshot
   (`evidence/p5-bringup/ios-release-home.png`): a signed image URL that is failing to resolve
   or a fallback placeholder rendering where a photo should be. **Severity P2**, sweep the class:
   check the image-loading path shared by court cards and donation cards (likely a common
   `<Image>`/signed-URL-minting helper).
2. **Impossible distance readout.** Both court cards show `13,486.1 km` and `13,499.2 km` under
   the header text "Showing courts near San Francisco", for courts located in Hyderabad and
   Bangalore per their address lines. A location claiming to be "near" the user while reporting
   a 13,000+ km distance is a broken geo-distance calculation or a hardcoded/wrong device
   location paired with real Hyderabad seed coordinates, not scoped correctly for a
   guest/no-location session. **Severity P1**, this is a visible, numeric, house-style-relevant
   defect (a JetBrains-mono distance readout showing a nonsensical value undermines the "courts
   near me" feature's basic premise). Home: courts list / distance-calculation query, likely
   `apps/mobile/src/app/(tabs)/courts/index.tsx` or its data hook. Not fixed here, Track I is
   read-only on source; filed for Track F.

### F-4. Inconclusive: `auth-register-skip`'s final assertion is a false pass, real screen state needs re-verification

The flow logs `Assert that "ATLITOS" is visible... COMPLETED` immediately before
`Assert that "Badminton" is visible... FAILED`, which reads as if the app reached Home and only
the sport-chip assertion failed. The failure screenshot instead shows the **Register** screen
("Create your account"), and the full screen-hierarchy JSON dump at that step
(`maestro-runs/auth-register-skip/.../step-033-assertCondition-Badminton.json`) contains no
occurrence of the Home header text "ATLITOS" anywhere in the tree, only the app's own
title-cased accessibility label `"Atlitos"` (from the OS-level app metadata, not a screen
element). Maestro's text matcher is evidently case-insensitive/substring enough that `"ATLITOS"`
matched that unrelated label, masking that the preceding `repeat: tap "Continue as guest" while
"Email or phone *" visible` (yaml lines 87-94) did not land the app back on Home. Two candidate
explanations, neither confirmed:

- A genuine navigation defect: tapping "Continue as guest" from the real Login screen
  (distinct from the already-known LoginGateModal gate bug documented in this same flow's
  header comment) sometimes fails to exit the auth stack.
- A selector-ambiguity defect in the flow itself: "Log in" and "Continue as guest" text may
  match more than one on-screen element across Login/Register, causing a tap to land on the
  wrong instance and loop back into Register.

**Disposition: not classified as a confirmed product defect.** The evidence is real (the app is
genuinely on the wrong screen at that point) but the two candidate causes point to different
owners (native navigation vs. test authoring) and disambiguating requires either instrumenting
the tap coordinates or re-running with unique `testID`-based selectors instead of visible text.
Recorded as a P2 follow-up: harden `auth-register-skip.yaml`'s final two assertions to a
selector that cannot false-match (e.g. `id: home-search-bar` rather than the text "ATLITOS"),
then re-run to determine which of the two explanations is real.

## The four seeded observations

### Obs-1. Share/Save action-rail overlap in the Home Clutch preview tile

**Confirmed, root cause identified in source.** `ClutchPostCard.tsx` (`apps/mobile/src/
components/molecules/ClutchPostCard.tsx`, lines 152-198) renders a fixed action rail (Like,
Comment, Save, Share, in that order, each a `min-h-11` icon+label stack separated by
`gap-lg`), absolutely positioned `bottom-md right-md`, sized for the full-bleed Clutch feed
screen where a card is close to full device height. `ClutchPreviewCard.tsx` (`apps/mobile/src/
components/organisms/home/ClutchPreviewCard.tsx`, lines 104-120) reuses the same
`ClutchPostCard` unmodified inside a `View` constrained to `aspectRatio: 4/5` with
`overflow-hidden`, a container roughly a third the height of the full feed card. The rail's
natural stacked height does not fit: Like and Comment are clipped off the top of the visible
tile by `overflow-hidden`, and Save/Share render pushed up against the tile's top edge, close
enough to the video content and to each other that the "Share" label visually collides with
adjacent content. Confirmed via two screenshots at different zoom (`evidence/p5-bringup/
ios-release-home.png` and the full-feed `clutch-like-gate-sheet.png`, where the same rail
renders cleanly, one item per row with normal spacing, because that screen gives it enough
height). **Severity P2. Fix: `ClutchPostCard` needs a `variant`-aware or prop-driven action
rail (e.g. hide Like/Comment in the teaser, or the preview needs a taller aspect ratio), not a
one-off patch in the tile.** Filed for Track F, `apps/mobile/src/components/molecules/
ClutchPostCard.tsx` and `.../organisms/home/ClutchPreviewCard.tsx`.

One caveat: a person/document-shaped glyph visible underneath the "Share" label in the tight
crop (`/tmp/qa-crop/share-save-crop.png`, not committed, reproducible by cropping
`evidence/p5-bringup/ios-release-home.png` around x650-1320,y330-860) does not correspond to
any icon in `ClutchPostCard`, `ClutchPreviewCard`, or `ClipVideo` source. The most likely
explanation is a visual coincidence with the static-noise video artifact underneath (Obs-4),
not a fourth UI element. Not claimed as a separate defect.

### Obs-2. `Husband s` caption, missing apostrophe

**Confirmed as a data defect, not a render defect.** Queried the live table directly:
`curl .../rest/v1/clips?select=id,caption&caption=ilike.*Husband*` returns
`{"id":"b8c0c76e-ca27-48de-8fcf-98b6ee040dc8","caption":"Husband s"}`. The stored `caption`
column value itself has no apostrophe; there is no client-side stripping to fix. This is a seed
or upload-time data-entry defect (the apostrophe was lost before the row was written), not a
`ClutchPostCard`/caption-rendering bug. **Severity P3, home: seed data, not `apps/mobile/src`.**

### Obs-3. Blank/noisy Clutch preview image

Covered under F-3 as the same broken-image-load class (black tile on Courts, gray-noise/blank
card on Home's "Donate to Empower"). Not treated as a separate finding.

### Obs-4. Static-noise video tile

**Simulator video-decode artifact, not a product defect**, with one real caveat. `ClipVideo.tsx`
(`apps/mobile/src/components/molecules/clip-video.tsx`) receives `active={false}` from
`ClutchPreviewCard` (line 112: `active={false}` is hardcoded for the Home teaser), so the
player's own effect (`clip-video.tsx` lines 48-54) calls `player.pause()` and never `.play()`.
The design intent is clearly poster-only for this teaser (`showPoster = !firstFrame || !url`,
line 56). The TV-static pattern visible in every screenshot of a Clutch card on this build (Home
preview, full feed, and the like-gate sheet) is a known class of iOS Simulator limitation:
`expo-video`'s `VideoView` frequently cannot hardware-decode on Simulator and renders garbage
frames instead of a black/paused frame, a well-documented Simulator-only behavior, not something
that reproduces on a physical device. **Not filed as a product bug.** The one real caveat: since
`showPoster` should be `true` here (`firstFrame` never fires because the player is never played),
the poster image should be covering this static, and it is not, meaning either `posterUrl` is
also failing to resolve (the same broken-image-load class as F-3/Obs-3) or the static is
somehow painting over a valid poster. Given F-3 already establishes a broken-image-load defect
class active in this same build, the more likely read is the poster URL failed to resolve here
too. Recommend Track F re-check with a real device Sentry-authenticated render before assuming
either half of this is fully explained.

## Dark mode (native theming root-cause check, requested by coordinator)

Toggled `xcrun simctl ui ... appearance dark` on Home. Screenshot:
`evidence/p5-ios/dark-mode-home.png`. Background, status text, search bar, "Hyderabad" location
row, all four sport-category circles and their icons, the notification bell badge, and the
bottom tab bar all recolored correctly to the dark theme. **Native does not share the web dark
mode bug.** Reasoning: every themed element checked (`ClutchPreviewCard`, `PromoCarousel`, the
Home shell) resolves color through `useThemeColors()` (`apps/mobile/src/theme/
use-theme-colors.ts`), a hook reading `packages/theme` bound to React Native's native
`Appearance`/`useColorScheme()` API, which iOS reports correctly regardless of any DOM state.
The `className=` (NativeWind) usages present in the same files (`bg-accent`, `text-text-inverse`,
etc., confirmed via `grep -rn "className=" apps/mobile/src` returning 89 files) resolve through
NativeWind's own native colorScheme integration, which also hooks `Appearance` directly rather
than toggling a `.dark` class on a DOM element the way the web app does. **There is no native
equivalent of the reported web root cause** (NativeWind never adding the `dark` class to
`<html>`); that bug is web-runtime-specific (`apps/portal-*` / `apps/landing`, not
`apps/mobile`). One cosmetic note, not a defect: the Home promo banner ("Gear up for the
season") keeps a light cream background in dark mode, but this is a raster marketing image
(`PromoCarousel.tsx` renders `<Image source={{uri: item.imageUrl}}>` covering the full card,
`apps/mobile/src/components/organisms/home/PromoCarousel.tsx` line 86), not app chrome, so it is
expected to look the same regardless of theme, the same way a photo would.

## FB-004: profile own-clip IG viewer, playback + layout

**Blocked, not verified.** Opened `atlitos://profile` while signed in (screenshot:
`evidence/p5-ios/fb004-profile.png`). The grid, layout, avatar fallback ("DP" initials),
follower counts, and per-tile status pills (`Under review`, `Cancelled`) all render correctly
with no crash. However every clip on this account's own grid carries a moderation status of
`Under review` or `Cancelled`, none `Live`, so the actual IG-style viewer/playback screen this
case exists to test cannot be exercised through this account: there is no published own-clip to
open. Not classified as a defect (moderation queue state may be intentional for this demo
account, or may itself indicate clips never leaving the review queue, which would be a separate
finding one layer removed from native QA). **Recommend the next agent either seed this account
with at least one `live` clip, or re-run against a different demo account confirmed to have
published clips**, then complete the tap-through this case requires.

## The 9 native EXT judgment walks (P5-4)

**Not completed this session; time-boxed out.** CL-13, CL-17, CH-12, CT-12, CO-12, CO-13,
SH-10, EM-14 all require either a second seeded account (moderator, donor, or a full
multi-step purchase/booking journey) or judgment-walk time budget beyond what this session
had left after the flow-classification and seeded-observation work above. XP-06 (house-style
copy sweep) is partially done: `grep -rn "—" apps/mobile/src --include="*.tsx"` found one
live em-dash in user-visible copy, `apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx:290`,
`` `${attendanceRate}%` : '—' `` as the empty-state placeholder for a stat tile. **Severity P3**,
house-style violation (no em-dashes in copy strings), one-line fix (use "Not yet" or similar),
filed for Track F. No other em-dash occurrences found in `apps/mobile/src`.

## P5-5 Razorpay TEST-key smoke, P5-7 Alert.alert money sites

**Not run live this session.** Source-level survey only: `Alert.alert` money-consequential call
sites confirmed present in `apps/mobile/src/app/home/donate/[id].tsx`,
`(tabs)/coaching/booking/[id].tsx` (4 call sites: accept/decline confirms and two refund-copy
variants), `learn/drill/[id].tsx`, `(tabs)/trainings/session/[id].tsx` (cancel-session confirm),
`(tabs)/courts/booking/[id].tsx`, `shop/cart.tsx`, `account/addresses.tsx`, and
`components/organisms/ConfirmSheet.tsx`. Device-level tap-through verification that each one
actually fires (P5-7) and the Razorpay success/dismiss/decline smoke (P5-5) were not run; both
need a live pass with real navigation to each screen and are the highest-value next steps for
whoever picks this up.

## Summary for the gate

Zero confirmed P0 native defects this session. Two P1s (F-3's distance readout; note F-3's
image-load defect is scored P2 not P1), three P2s (F-2 data pollution, F-3 image load, Obs-1
action-rail overlap, F-4's inconclusive navigation state pending re-verification), and
low-severity P3s (Obs-2 caption data, XP-06 em-dash). **6 of the 9 flow failures are stale
test fixtures, not defects, and should not block the gate; they need `.maestro/*.yaml`
reauthored against current seed data (Track N or integrator, not a P5 native-code fix).**
FB-004, the 9 EXT walks, Razorpay smoke, and Alert.alert tap-through remain undone and are the
handoff for the next iOS session.

## 2026-08-13 repair pass: classification of the 7 failing flows

Branch `phase-11/p5-maestro`, off `phase-11/launch-p4`. Scope: `auth-register-skip`,
`courts-header`, `groups-athlete`, `groups-coach`, `groups-join-guard`,
`trainings-coach-browse`, `trainings-shell`. All classifications below are backed by read only
SQL against `syzzfgaudpifwvbpycyi` and/or an on-device screenshot; nothing here is asserted
without one or the other. No write, DDL, seed script, or cleanup was run against production at
any point.

**Environmental note that shaped this whole pass**: the iOS simulator's installed build
predated commit `24bb65a` (the date of birth removal) despite a file timestamp suggesting
otherwise, and `apps/mobile/.env` does not exist in a fresh git worktree (it is gitignored), so
the first two rebuild attempts crashed at launch with `supabaseUrl is required`. Fixed by
exporting `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`/
`EXPO_PUBLIC_RAZORPAY_KEY_ID` inline for the build command (also needed
`SENTRY_DISABLE_AUTO_UPLOAD=true`, the Sentry debug symbol upload step fails without an
`SENTRY_ORG` in this environment). Every flow below was reverified against this fresh, correct
Release build, not the stale one. A "Could not load your dashboard" transient network flake
was seen twice across roughly two dozen runs, on both original and already-fixed sections of
the same flow; resolved on retry, not caused by any edit here.

| Flow | Disposition | Evidence |
|---|---|---|
| `courts-header` | Stale test, fixed | "Turf B" court still exists live (id `b0000000-...-002`); it just was not always above the fold, order shifts with location resolution timing. Now scrolls for it. Also reverifies BUG-039 (distance readout) fixed: header now reads "Showing all verified courts" with no distance claim when location has not resolved, instead of "13,486.1 km". |
| `auth-register-skip` | Bad selector (fixed) + real bug (left failing) | Two issues stacked. (1) Bad selector: the flow's final assertions used bare text `"ATLITOS"`, which matched something off the visible Register screen (the app's own `app.json` name surfacing in the accessibility tree) and reported COMPLETED while genuinely still on Register; proven by screenshot plus a hierarchy dump with no on-screen "ATLITOS" node. Fixed to the Home search bar placeholder, unique to Home. (2) Once the selector could no longer lie, a real navigation bug surfaced and reproduces every run on the fresh build: tapping "Log in" on Register, then "Continue as guest" on Login, lands back on Register instead of Home. Root cause in `apps/mobile/src/app/(auth)/login.tsx`'s `afterAuth()`: `router.canGoBack()` is true because Register is still on the stack beneath Login, so `router.back()` pops to Register. Left failing on purpose, filed as a P2 for Track F. Also removed the now obsolete "Date of birth \*" assertion (commit 24bb65a moved DOB to profile edit). |
| `groups-join-guard` | Stale test, fixed | "Demo Coach One" does not exist. coach1 (`5b262cf1-8f95-45df-b453-0802013f82a1`) is "Ravi Kumar" now; seed accounts were renamed by launch Phase 1's security lockdown. Retargeted and reran clean. |
| `trainings-coach-browse` | Stale test, fixed | Same "Demo Coach One" -> "Ravi Kumar" fixture rename. Reran clean. |
| `trainings-shell` | Stale test (multiple), fixed | Same coach rename, plus three more fixture-drift issues surfaced once the flow could actually reach real screens: (a) chat threads no longer mask the participant name behind "Atlitos user" (removed from the product entirely, no occurrence left in source); asserts the real names ("Ravi Kumar" for the player, "Demo Player" for the coach) instead. (b) both accounts' Analytics tabs were authored against a 3 session empty state threshold and have since organically grown past it (5 sessions each); asserts the "Sessions held" (athlete) / "Hours coached" (coach, different layout branch) stat labels instead of a count dependent empty string. (c) the upcoming session drill in card was pinned to an exact date, 2026-07-30, which has since passed and rolled off the list; matches any upcoming session with the coach instead. One selector robustness fix along the way: the drill in tap landed on the Clutch bottom tab instead of the session card because the card sat right at the tab bar edge after scrolling; `centerElement: true` fixes it. |
| `groups-athlete` | Real bug reclassified as stale fixture, with evidence, plus a bad selector | The dispatch brief classified the `.*4 members.*` failure as a status-filter defect: chat member count allegedly including a pending, not yet active membership. SQL evidence shows the opposite: `chat_thread_members` for the Cric Squad thread holds exactly 5 rows (coach1 plus the group's 4 currently ACTIVE memberships), and the one pending membership correctly has no `chat_thread_members` row. The count does filter on status; a 4th athlete simply took an active paid membership after this flow was authored against 3. Reasserted "5 members" as the correct current count. Separately, the flow's message-send step had a bad selector (`.*Message.*` could match the "Send message" button as a substring, tapping Send with nothing typed); fixed to `.*Message input.*`, matched against the input's actual accessibility text. Full pass after both fixes. |
| `groups-coach` | Not executed live | Its own documented design resets a seeded session's status via a raw Postgres `UPDATE` after each run, which the DB write gate for this task forbids outright. Running it without that reset would leave the seeded session permanently `completed`. Left unexecuted; every assertion it makes was instead checked read only via SQL and none of it is stale (Cric Squad, the seeded group session, its 3 unmarked participants, and the attendance policy text all match current data exactly), so the original "stale fixture" bucket this flow was lumped into was very likely wrong for this specific flow. Needs a live run with write permission, or a staging project, from the next agent. |

### Final honest tally (14 of 15 flows executed, one held back for the write gate)

13 pass, 1 fail (real product bug, correctly left red), 1 not executed (`groups-coach`, data
verified clean, blocked only by the write gate). Zero flows were weakened to manufacture a
green.

### Real product bugs confirmed this pass

1. **auth-register-skip navigation bug (P2), confirmed and root caused.** Guest exits Login via
   "Continue as guest" after reaching it through Register's "Log in" link lands back on
   Register instead of Home. `apps/mobile/src/app/(auth)/login.tsx` `afterAuth()`,
   `router.canGoBack()` incorrectly prefers `router.back()` over `router.replace('/(tabs)')`
   when the stack beneath Login is another auth screen rather than a gate's origin screen.
   Screenshot: `.maestro` run artifacts under `~/.maestro/tests/2026-08-13_130708/` and
   `2026-08-13_134624` (also captured a related selector-robustness bug on the same run, the
   drill in mistap into Clutch, see `trainings-shell` above).

### Data pollution swept, not this pass's job to fix

Both `groups-athlete`'s `.*4 members.*` reclassification and `trainings-shell`'s Analytics
threshold rewrite trace back to the same root the earlier F-2 finding already named: this
Supabase project is a shared environment where automated load/e2e scripts continuously write
into the same accounts real QA sessions run against (dozens of `e2e CH-XX`, `E2E CO-XX`
sessions and chat messages observed on `player@atlitos.dev` and `coach1@atlitos.dev` during
this pass). This is not a defect in the product; it means any Maestro assertion that hardcodes
a count, a date, or a specific fixture name on these two accounts will keep going stale on its
own, independent of any real regression. Recommend the next infra pass either give Maestro its
own isolated seed accounts, or convert every remaining count/date-sensitive assertion in this
suite to the same "label present" or "any matching row" pattern used in the fixes above.

### What a flow needed that does not exist in the database (named, not created)

Nothing in the 7 flows required data that is actually missing. Every "stale fixture" here was a
renamed identity (`Demo Coach One` -> `Ravi Kumar`) or organic data growth past a hardcoded
threshold, not an absence. The one item still genuinely missing from an earlier finding (not
part of this 7): FB-004 needs a demo account with at least one `live` (not `Under review` or
`Cancelled`) clip to exercise the IG-style viewer; still not seeded, not created here either.
