# Physical device test, 2026-09-29

Exploratory pass on the installed release build (1.0.0 build 1, `com.atlitos.app`) on the founder's iPhone 16 Pro, driven end to end by an agent through WebDriverAgent (`~/tools/phone.sh`, `~/tools/ui.py`, `~/tools/see.sh`). Signed in as the founder's athlete account, pointed at production Supabase (`syzzfgaudpifwvbpycyi`). Light and dark themes both exercised.

Ground rules for this pass: no production writes beyond one notification preference toggled and restored. No bookings, payments, uploads, posts, messages, sign out or account deletion were triggered. Backend checks were read only SQL and code reading.

Evidence screenshots: `docs/qa/evidence/device-2026-09-29/`.

Severity follows `BUG-LEDGER.md`: P0 money/auth/RLS/crash, P1 core journey, P2 secondary, P3 cosmetic. IDs continue the ledger (BUG-050 onward); each has a matching `open` row there.

## Summary

| Area | Result |
|---|---|
| Tab switching, notifications, preferences persistence, profile tabs, follows | Pass |
| Edit profile (DOB auto formats dashes, tap outside dismisses keypad) | Pass |
| Dark mode rendering on Home, Profile, Settings, Shop, Trainings | Pass |
| Coach browse, coach detail, session type and frequency | Pass, calendar broken (BUG-052) |
| Clutch upload form validation, media picker open and cancel | Pass |
| Settings: Terms, Privacy, Content policy, Support open in app browser, Done returns | Pass |
| Coach setup wizard Back and Next, draft stays local | Pass |
| Cold start to Home | 3 s |
| Home button, background, resume keeps screen state | Pass |
| Volume up and down inside app | Pass, no side effects |
| Rotation | Locked to portrait by `app.json`, by design |
| Cross tab navigation from Home search | Fail, tab gets stuck (BUG-050) |
| Blocked accounts Back | Dead button, user trapped (BUG-051) |
| Shop "Buy on" links | All tested links 404 (BUG-053) |
| Clutch feed | Empty in production (BUG-055) |

## P1

**BUG-050 Cross tab push leaves Courts tab stuck on a detail screen.**
Repro: Home, search, tap "Courts near me", open a court (two taps, see BUG-067), press Back. You land on Home. Now tap the Courts tab: it shows the same court detail, forever. Re tapping the tab does not pop to root, the iOS edge swipe does nothing, Back goes to Home again. Only a force quit recovers.
Root cause: `home/search.tsx:202-216` does `router.push('/(tabs)/courts/court/[id]')` (same for coaching coach and clutch post). `(tabs)/courts/_layout.tsx`, `coaching/_layout.tsx`, `clutch/_layout.tsx` have no `unstable_settings.initialRouteName`, so the pushed detail becomes the only screen in that tab's stack.
Fix: add `export const unstable_settings = { initialRouteName: 'index' };` to those three layouts (or push with `withAnchor: true`). Retest Back from detail and tab re tap.

**BUG-051 Blocked accounts Back button is dead.**
Repro: You, Settings, Blocked accounts, tap Back. Nothing. No tab bar, edge swipe does nothing, user must force quit.
Root cause: `AppBar` only calls `onPressBack` (`components/ui/app-bar.tsx:93`), and `app/account/blocked.tsx:79` does not pass one. A scan of every `AppBar variant="back|backTitle"` found this is the only one missing it.
Fix: pass `onPressBack={() => router.back()}`, and consider making `router.back()` the AppBar default so this cannot recur.

**BUG-052 Calendar grid wraps at 8 columns, dates misaligned with weekdays.**
Repro: Trainings, Coaches, any coach, pick a type and One time. September 2026 renders 7 through 14 on one row; the 6th (a Sunday) sits in an eighth column past the Saturday header. Evidence `31-coach-dates.png`.
Root cause: `components/molecules/CalendarPicker.tsx:90` puts fixed 44 pt cells in a `flex-row flex-wrap` container. On a 402 pt wide phone the row fits 8 cells; the header is 7 x 44. It happens to look right on 375 pt phones, which is why earlier passes missed it.
Fix: constrain the grid to `7 * 44` wide (and centre header plus grid together) or size cells at `100 / 7` percent.

**BUG-053 Every shop product uses placeholder retailer URLs.**
Repro: Shop, Babolat Pure Drive Team, tap Buy on Tennis Hub, Decathlon, Amazon. All three 404 (`21-buy-link.png`, `buy-626.png`, `buy-758.png`).
Data: all 8 active `affiliate_products` carry seed URLs (for example `amazon.in/dp/B08ASICSGR?tag=atlitos-21`). This is the affiliate revenue path.
Fix: replace with real product URLs through gear ingest, or deactivate the seed catalogue before launch.

**BUG-054 Gear health checker can never auto delist.**
`gear-recheck` already marks these products `gone` or `blocked` with 12 consecutive failures, yet all stay `active = true`.
Root cause: `supabase/functions/gear-recheck/index.ts:579` delists only when every offer has 7 or more failures. Decathlon returns `ok` for its soft 404 page (HTTP 200), and Tennis Hub and Cricket Store offers have never been rechecked (`last_checked_at` 2026-07-28, outcome null, failures 0). Also the app still lists products whose `health_status` is `gone` and shows a "Cheapest" badge on a price last checked 63 days ago.
Fix: detect soft 404s (canonical URL or title check), recheck every retailer or treat an unchecked offer as stale, and hide `gone` products (or stale offers) from the grid and product detail.

**BUG-055 Clutch feed is empty in production.**
The feed filters `status = 'published'` (`packages/api/src/hooks.ts:1805`). Production has 11 clips in `ready` (awaiting moderation, oldest 2026-07-21), 0 published. Ops, not code: work the admin moderation queue (or confirm these are test clips and seed real ones) before launch.

## P2

**BUG-056 Home shows "Hyderabad" with "Location is off" on every cold start.** Home's `LocationRow` only reads the store; nothing on Home calls `requestLocation` (only Courts does, `courts/index.tsx:182`). The label flips to Chennai once the user visits Courts. Fix: request location on Home mount (same guard as Courts).

**BUG-057 Search ignores location.** "Courts near me" on Home search, and "turf" on Courts search, return the four Hyderabad venues (544 km away) under "Searching near Chennai" / "Showing courts near Chennai", while the Courts browse list correctly says none are near. "turf" also returns a badminton court. Apply the same distance rule to search results, or label them honestly.

**BUG-058 Fast typing drops characters in search fields.** Typing "badminton coach near me" quickly produced "bon coach near me" on Home search; Courts search kept only "t" of "turf". Slow typing is intact, so this is real under fast typists, swipe typing and autocorrect replacements. `SearchBar` is a plain controlled `TextInput`; likely the whole screen re renders per keystroke and iOS input is overwritten while the JS thread is busy. Fix candidate: make the field uncontrolled (`defaultValue` plus a ref) and debounce the state write, then retest at speed.

**BUG-059 Past time slots are bookable in the client.** At 12:02 the 10:00 slot for today was selectable and "Continue, ₹800" enabled. The server rejects it (`book-session/index.ts:245`), so no money risk, but the user only finds out at the pay step. Filter out past slots for today in the picker.

**BUG-060 Courts search result rows have no horizontal padding.** Text is flush to the left screen edge and prices clip at the right edge (`36-courts-turf.png`). The Home search renders the same data as padded cards; align the two.

**BUG-061 Court detail and slot claims.** Title shows the court name ("Court 1", "Turf A") with the venue name missing entirely; hero is a flat green placeholder with notched corners; rating shows "0.0/5 (0)" with five empty stars instead of "No reviews yet". Search and Courts cards advertise "Free today at 12:00 PM" while the detail says online booking is not available (`COURT_IN_APP_BOOKING_ENABLED = false`). Hide slot badges while the flag is off.

**BUG-062 Learn is a dead end.** Trainings, Learn shows "Pick a sport to start" with no picker or button. Add sport chips inline or a button to Settings, Preferred sports.

**BUG-063 Home banner legibility.** Slide 2 "Fund an athlete's journey" is white text on cream art, half unreadable (`22-banner2.png`). All three slides put a flat grey rectangle over abstract shapes and read as unfinished. Use a gradient scrim or real imagery.

**BUG-064 Accessibility gaps.** Bottom tab items are exposed as plain views (no button or tab role). Shop testIDs leak as VoiceOver labels ("shop-search-input", "shop-sport-chip-football", "compare-offer-0"). Coach setup step 2 photo circle has no icon, label or hint (`42-coach-step2.png`). Tap targets under 44 pt: Finish setup dismiss X 16 x 16, "Buy on" links 16 pt tall, Recent searches Clear 29 x 16.

**BUG-065 Existing bookings and payments are invisible.** Delete account shows this account has 1 court booking and 2 payments (`45-delete.png`), but My bookings sits behind `COURT_IN_APP_BOOKING_ENABLED = false` and Trainings, Payments says "No payments yet". Users with pre flag bookings have no way to see them.

## P3

- **BUG-066** Home sport chips (Football, Cricket...) open the Shop filtered to that sport, which is empty for Football. Users likely expect coaches and courts for the sport. Founder decision.
- **BUG-067** Home search keeps the keyboard up after tapping a suggestion, covering results, and the first tap on a result only dismisses the keyboard. Add `keyboardShouldPersistTaps="handled"` and dismiss on suggestion tap.
- **BUG-068** Back from a court opened via Home search returns to Home, losing the search results (same root cause family as BUG-050).
- **BUG-069** Copy: "No Badminton coachs found" (coaches); "What do you coach." (question mark); "Under INR 2,000" while prices use ₹; " . " separator in court rows; coach slots in 24 hour format ("13:00 to 13:45") while Courts uses "1:00 PM"; mono font applied to the whole "Free today at 12:00 PM" sentence rather than the time.
- **BUG-070** Visual consistency: shop tiles letterbox small photos in dark boxes; Wilson Pro Staff tile shows no image although the row has one (load failure); brand repeated above product name; failed upload tile text truncated over the film icon; tab headers use different sizes and heights (Home, Courts, Clutch, Trainings, Shop all differ); Clutch upload picker hugs the left edge; Support web page ignores dark mode; atlitos.com nav wraps "Content policy" and clips the last item at phone width.
- **BUG-071** Two notification preference systems: Settings has Session updates, Messages, Offers and news; Notifications, Preferences has Bookings, Orders, Messages, Clutch, Empower by Push and Email. Pick one source of truth.
- **BUG-072** Clutch upload discards a typed caption and chosen sport on Back with no confirmation.
- **BUG-073** Production data hygiene: all 4 verified venues are July seed data in Hyderabad, including "Onboarding Demo Turf"; 6 "RLS Matrix Probe Venue" rows remain (pending, hidden).

## Not covered

- Sign out and sign in (needs the account password, which the agent may not enter), OTP and password reset.
- Any real booking, payment, order, donation, upload, post, comment or message (production writes).
- Push notification receipt, deep links, offline and poor network, Android, coach and court partner roles.
- The side (lock) button: locking the phone would need the passcode to recover.

## Environment notes for the next device pass

- WhatsApp and Instagram banners break through Do Not Disturb on this phone and swallow taps near the top of the screen; allow a few seconds or turn on a Focus with no allowed apps.
- After opening a system picker, wait before tapping Cancel; an early tap lands on a photo instead.

## P1 fix status (branch `fix/device-test-p1`)

| Bug | Change | Proof |
|---|---|---|
| BUG-050 | `unstable_settings.initialRouteName = 'index'` on the Courts and Clutch stacks; `{ withAnchor: true }` on every push that enters those tabs from outside (Home search, Home Clutch preview, Profile, Follows, the notifications list, push taps). Search now opens coaches on the Trainings stack (`trainings/coach/[id]`, the route the Trainings Coaches tab already uses) instead of the hidden coaching tab. Trade off: Back from a clip opened on your own profile now lands on the Clutch feed, not the profile, because the You tab is a single screen with no stack to push onto. | Verified on device (Release build): search, court, Back lands on the Courts list; Home then Courts tab shows the list; edge swipe works; search, coach, Back lands on Trainings (`v2-after-back.png`). Clutch paths not device proven, production has no published clips. |
| BUG-051 | `account/blocked.tsx` passes `onPressBack={() => router.back()}`. A scan of every back variant AppBar found no other screen missing it. | Verified on device: Back returns to Settings. |
| BUG-052 | `CalendarPicker` sizes weekday header and day cells at one seventh of the row (14.28%, rounded down so float error cannot wrap the seventh cell). Affects all 6 screens that use it. | Verified on device: 7 columns, 1st under T, 6th under S (`v5-calendar.png`). |
| BUG-053 | Data, founder action: delist the 8 seed products through the admin (audited, never delete) or replace them with real pastes. Already in `DEBT.md` 2026-09-23. | n/a |
| BUG-054 | `gear-recheck` logs `unparsed` (offer `gone`, strike counted) when a 200 page parses to neither a price nor a stock signal. Not "no price" alone: a live decathlon.in product publishes `"price": null` in its JSON-LD, so that rule would have delisted every real Decathlon offer. New `/product/soft-404` scenario in `scripts/verify-gear-health.mjs`. Needs deploying (`supabase functions deploy gear-recheck`). | Deno run of the real extractor plus the new predicate against saved live pages: 2 dead Decathlon slugs struck, 1 live Decathlon product kept, fixtures as expected; `deno check` clean. Full harness not run (no Docker here). |
| BUG-055 | Ops, founder action. The 11 `ready` clips are not launch content: 9 are `e2e CL-10` test clips, one is captioned "hi", one is a July demo, and none has a stream uid. Do not approve them; reject them in admin and seed real clips. | read only SQL |
