# Manual test run — athlete app, 2026-09-04 / 2026-09-05

Tester pass over the Expo app running as a **debug dev build** on iPhone 17 Pro (iOS 26.6 simulator, Xcode 26.6), against the LIVE Supabase project `syzzfgaudpifwvbpycyi`.

Reusable scenarios are in the table; the Result column is this run. Re-run by following Steps and comparing against Expected.

**Nothing was committed, pushed or deployed. No account was created, no payment was made, no data was written to the shared project.**

## Environment

| Item | Value |
|---|---|
| Build | `npx expo run:ios` debug build, dev-client, bundle `com.atlitos.app` |
| Bundler | Metro on `localhost:8081` (`npx expo start --dev-client`) |
| Backend | live project `syzzfgaudpifwvbpycyi`, publishable anon key from `apps/mobile/.env` |
| Credentials | `apps/e2e/specs/support/rls.mjs` demo personas (committed fixtures, not real user accounts) |
| Migrations 0088-0091 | **NOT applied** to the live project, so suspension enforcement and the payment recovery marker are not exercisable here |
| Device locale/location | simulator default, **San Francisco**. Relevant to TC-21. |

## Why the app appeared to hang, answered

You asked why the app was stuck loading. **The Metro bundler had been stopped.** A debug dev build fetches its JavaScript bundle from Metro at launch; with Metro down the native shell starts, shows the splash, and waits forever. Restarting Metro and relaunching brought the app up in about 40 seconds (first bundle: 3,737 modules).

That is expected behaviour for a debug build, **but the app's own handling of it is a defect** — see BUG-01. A release build embeds the bundle and is not affected.

To restart it:

```bash
cd /Users/Candy/atlitos/apps/mobile && npx expo start --dev-client
```

## Test scenarios and results

Legend: **PASS** met expectation, **FAIL** did not, **BLOCKED** could not run, **NOT RUN** deliberately skipped.

### Launch and shell

| ID | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| TC-01 | Cold launch with bundler up | Launch app | Home renders within ~60s on first bundle | PASS |
| TC-02 | Cold launch with bundler down | Stop Metro, relaunch | A timeout or an actionable error, not an indefinite splash | **FAIL — BUG-01** |
| TC-03 | Tab bar navigation | Tap each of Home, Trainings, Clutch, Courts, You | Each tab renders its own screen, selected state updates | PASS |
| TC-04 | JS runtime health | Watch Metro output across the whole session | No errors or warnings | PASS, log clean |

### Authentication

| ID | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| TC-10 | Guest gate on Profile | As guest, tap You | "Sign in to see your profile" with a Sign in CTA, no crash, no forced redirect | PASS |
| TC-11 | Login screen renders | Tap Sign in | Password / Email-or-phone-code toggle, both fields, Log in, Forgot password, Create account, Continue as guest | PASS |
| TC-12 | Submit disabled when empty | Observe Log in with empty fields | Button disabled | PASS |
| TC-13 | Password reveal toggle | Type a password, tap the eye | Plaintext shown, icon toggles | PASS |
| TC-14 | Login, valid credentials | `player@atlitos.dev` / demo password, tap Log in | Session established, Profile shows the real account | PASS |
| TC-15 | Session reflected in UI | After TC-14, view Profile | Avatar "DP", "Demo Player", `@demoplayer`, Following/Followers, Edit profile, Settings | PASS |
| TC-16 | Auth API, all personas | `POST /auth/v1/token?grant_type=password` for player/coach1/admin/partner | 200 and a JWT carrying the right `app_metadata.roles` | PASS 4/4 |
| TC-17 | JWT role claims | Decode each access token | player `[player]`, coach1 `[player,coach]`, admin `[player,admin]`, partner `[player,court_partner]` | PASS |
| TC-18 | Account creation | Open Create account, complete signup | New account created and signed in | **NOT RUN**, see Not tested |
| TC-19 | Suspended user blocked | Suspend, then call a protected API on the same token | 403 ACCOUNT_SUSPENDED | **BLOCKED**, 0090 not deployed |

`user_status` is absent from every issued JWT, which independently confirms migration `0090` is not applied to the live project.

### Courts

| ID | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| TC-20 | Courts list loads | Tap Courts | Venue cards with name, address, price/hour, Book | PASS |
| TC-21 | Distance relevance | Observe distances from the simulator's SF location | Far venues excluded, or an empty state explaining none are nearby | **FAIL — BUG-03** |
| TC-22 | Sport filter chips | Observe All sports / Football / Cricket / Badminton | Chips render, All sports selected | PASS (render only, filtering not exercised) |
| TC-23 | Venue media | Observe card imagery | Venue photos | **FAIL — BUG-06** |

### Clutch

| ID | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| TC-30 | Feed loads and plays | Tap Clutch | A clip renders and plays, with author, age, caption, like/comment/share | PASS |
| TC-31 | Header does not obscure content | Observe the top of the feed | Header and clip title legible, not overlapping | **FAIL — BUG-04** |
| TC-32 | Own clip grid | Profile, posts tab | Thumbnails for the signed-in user's clips | **FAIL — BUG-02** |
| TC-33 | Clip status pills | Observe the grid | Status accurately describes the moderation outcome | **FAIL — BUG-05** |

### Trainings

| ID | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| TC-40 | Dashboard loads | Tap Trainings | Stats tiles, My sports, My groups, Upcoming sessions | PASS |
| TC-41 | Numeric typography | Observe every figure | JetBrains Mono, tabular figures (CLAUDE.md) | PASS |
| TC-42 | Stat coherence | Compare Total sessions with Hours trained | Figures consistent with each other | **QUERY — BUG-07** |
| TC-43 | Group membership | Observe My groups | Group name, Active pill, expiry, monthly fee | PASS |

### Not tested, deliberately

| Area | Why |
|---|---|
| Account creation (TC-18) | Auth is working, so the "if login fails, try creating an account" fallback never triggered. Creating one would also write a permanent row to a shared project that is not ours, and I cannot delete it without a service-role key. Say the word and I will run it. |
| Payments (court booking, session booking, checkout, donate, group join) | Every one opens Razorpay and moves money, even in test mode. Not run without explicit approval. |
| Clip upload | Writes to the shared private `clips` bucket and the moderation queue. |
| Chat, notifications, follow/unfollow, shop checkout | Write paths against shared demo data. Read-only surfaces were exercised. |
| Suspension, payment recovery, trainee-video path lock | Migrations 0088-0091 are not deployed. Covered by `scripts/verify-security-fixes.sql` locally instead. |

## Defects found

### BUG-01 (P1) — no timeout or error when the JS bundle cannot be fetched

**This is the problem you saw.** With Metro unreachable, the app sits on the splash screen indefinitely. No spinner change, no timeout, no retry, no message.

- Repro: stop Metro, relaunch the app, wait.
- Actual: splash forever.
- Expected: after a bounded wait, an actionable state ("Can't reach the development server" / "Check your connection", with retry).
- Note: debug builds only for the Metro case, **but the same code path covers a slow or offline network on a release build**, so a user on bad connectivity gets the same dead splash. That is why this is P1 rather than a dev-only annoyance.
- Fix direction: a timeout in the splash/root layout that surfaces a retry state.

### BUG-02 (P2) — clip thumbnails never render anywhere

All nine tiles on the signed-in user's own profile grid are blank.

Root cause, `packages/api/src/hooks.ts:1053`:

```ts
thumbUrl: isHttpUrl(row.thumb_path) ? (row.thumb_path as string) : undefined,
```

`clips.thumb_path` holds a **private-bucket storage path**, never an http URL, by design (`0041`, VIDEO.md). So `isHttpUrl` is false for every row and `thumbUrl` is always `undefined`. The grid can never show a thumbnail. The file's own comment acknowledges the path "is not a loadable URL" but nothing mints one.

Fix direction: mint thumbnails through `get-clip-playback-url`, which already returns `thumbUrl` from `thumb_path`, and use that instead of the raw column. Note this interacts with the SEC-F1 remediation: the mint now validates the path prefix, so poisoned rows will correctly refuse rather than render.

### BUG-03 (P2) — Courts lists venues 13,486 km away as bookable

Header reads "Showing courts near San Francisco" and then lists Hyderabad venues at `13486.1 km` and `13499.2 km`, each with a live Book button.

The distance maths is right (SF to Hyderabad really is ~13,500 km). What is missing is any relevance bound: no max radius, no "no courts near you" empty state, no city fallback. A real user who denies location, travels, or is simply outside India sees a bookable list of unreachable venues.

Repro: run with the simulator's default location and open Courts.

### BUG-04 (P3) — Clutch header overlaps the clip title

The "Clutch" screen header is drawn on top of the clip's own title overlay ("ATLITOS 04 BADMINTON"), making both hard to read. A z-order or safe-area padding issue on the feed header.

### BUG-05 (P3) — moderator-rejected clips are labelled "Cancelled"

`apps/mobile/src/app/profile/index.tsx:37-38` and `ClutchProfileView.tsx:21-22` both map:

```ts
rejected: 'cancelled',
removed:  'cancelled',
```

"Cancelled" reads as something the user did. A clip that a moderator rejected or took down should say so ("Rejected", "Removed"), otherwise the creator has no idea a moderation decision was made against them. PRD-01 FR-44/FR-45 want the owner to understand their own clip's state.

### BUG-06 (P3) — media renders as flat colour blocks with distorted shapes

Venue cards show a solid black rectangle ("Turf 1") and a solid green blob with bulging, non-rectangular edges ("Main Ground"); the Home carousel shows a grey block over the banner; shop tiles show flat circles. Whether these are intentional colour placeholders or failed image loads, the distorted green shape is a rendering defect, and the grey block sits over banner copy and hurts legibility.

### BUG-07 (P3, needs product confirmation) — Trainings stats look inconsistent

"Total sessions 22" beside "Hours trained 5". If a session is roughly an hour, 22 sessions should not total 5 hours. Either the two tiles count different things (all sessions vs completed only) and the labels need to say so, or one derivation is wrong. Flagged as a query rather than a confirmed bug because the intended definition is not written down.

## Not defects, ruled out during the run

- **Email field dropping characters.** My first attempt produced `player@atlitos.` from an 18-character send. `login.tsx` has no `maxLength` and no sanitiser (`onChangeText={setIdentifier}` passes straight through); retyping in one go landed all 18. This was simulator input injection racing the RN text input, **not an app bug**. Worth knowing because it will bite anyone automating this screen.
- **Clutch video looking like static.** It is the seeded fixture clip's own content, not a decode failure. Playback, title overlay, like count, comment count and share all render.
- **iOS "Save Password?" prompt.** Standard iOS keychain behaviour on a submitted password field. Declined every time; nothing was saved.

## Pre-existing failures, unchanged by this pass

Confirmed against a stashed tree, so these predate all recent work:

- `supabase/functions/checkout/index.ts` — 2 × `TS2352` on the `__client_roundup` cast (`deno check`).
- `@atlitos/mobile lint` — 14 × `Definition for rule 'react-hooks/exhaustive-deps' was not found`. An eslint plugin registration problem, not code.

Neither is a security defect.

## Suggested next run

1. Fix BUG-01 and BUG-02 first: one is what a user hits on bad network, the other makes a core surface look empty.
2. Re-run TC-02 and TC-32 to confirm.
3. Get approval for the payment lane, then extend this document with court booking, session booking and checkout scenarios end to end in Razorpay test mode.
4. After 0088-0091 are deployed, TC-19 becomes runnable and `apps/e2e/specs/security.spec.ts` SEC-01..07 can run for real.


---

# Round 2 — 2026-09-05

Second pass: the social-login question, session persistence, and a data-layer sweep of every feature surface. Same build, same live project. Still nothing committed, pushed or deployed.

## Answered: there is no Google or Apple sign-in because it was never built

Asked whether social login was removed. It was not. Evidence:

| Check | Result |
|---|---|
| OAuth code in the working tree (`signInWithOAuth`, `signInWithIdToken`, `expo-apple-authentication`, `google-signin`, `AppleAuthentication`) | **0 matches** |
| Commits in the ENTIRE history touching any of those five terms (`git log -S --all`) | **0 commits each** |
| App auth files modified by the security remediation (`git status apps/mobile/src packages/api/src`) | **none** |
| Social login named anywhere in the PRDs | **not specified** |

`login.tsx` has only three commits ever, none of which removed a provider. PRD-01 **FR-5 to FR-10** define the whole intended auth surface: email or phone plus password, an OTP code path, and forgot-password via OTP. Social login is not a regression, it is an unbuilt feature.

**App Store note.** Apple's Guideline 4.8 only forces "Sign in with Apple" when an app *offers* third-party social login. With email/password only, there is no obligation. Adding Google sign-in later WOULD trigger it, so budget both, not one.

## Round 2 scenarios

| ID | Scenario | Expected | Result |
|---|---|---|---|
| TC-50 | Session survives app restart (PRD-01 FR-10) | Relaunch reopens signed in, no re-auth | PASS |
| TC-51 | Header avatar reflects the signed-in user | Signed-in user's initials | **FAIL — BUG-08** |
| TC-52 | Social login present | n/a, never specified | Not a defect, see above |
| TC-53 | Data layer across every feature surface | Each surface returns rows for a signed-in player | PASS 23/23 |
| TC-54 | Coach-only RPC refuses a player | `get_coach_wallet_balance` refuses | PASS, `NOT_COACH` |
| TC-55 | AI search returns results | Non-empty ranked results | PASS, 6 results for "badminton racket" |
| TC-56 | Signed playback URL mints | Short-lived signed URL for a published clip | PASS |

### TC-53 detail, 23 surfaces exercised as `player@atlitos.dev`

PASS: shop categories (5), active products (14), promo banners (3), venues (4), courts (5), public coach profiles (3), published clips (12), roadmap stages (15), drills (31), verified UPAs (2), UPA wishlist items (6), fee config (7), own notifications (29), own orders (24), own court bookings (47), own sessions (51), own addresses (1), own cart (1), own group memberships (1), own chat threads (32), `get_learn_home` RPC, `ai-search` edge function, `get-clip-playback-url` edge function.

Every read path this app depends on is alive and returning real data. The gaps found in this pass are all presentation-layer, not data-layer.

## New defect

### BUG-08 (P2) — the header avatar is a hardcoded letter "A" for every user

Signed in as Demo Player, the Profile screen correctly shows initials "DP" while the Home header shows "A". Not a stale-state bug, and not initials at all:

`apps/mobile/src/components/ui/app-bar.tsx:122-127`

```tsx
{avatarUri ? (
  <Image source={{ uri: avatarUri }} className="h-9 w-9 rounded-pill" />
) : (
  <View className="h-9 w-9 items-center justify-center rounded-pill bg-surface-muted">
    <Text className="font-sans-semibold text-sm text-text-secondary">A</Text>
  </View>
)}
```

The fallback is the literal string `"A"`. Any user without an uploaded avatar, which is most users, sees someone else's letter on every screen carrying the brand AppBar. It also makes the header indistinguishable between signed-in and guest, undercutting PRD-01 FR-1's guest/member distinction.

Fix: derive initials from `me.name` the way the Profile screen already does, and keep "A" only for a true guest.

## Dev-only artifacts, not product defects

Recording these so the next tester does not re-file them.

- **A blank warning bar at the bottom of the screen.** React Native's LogBox, triggered by six `Sending onAnimatedValueUpdate with no listeners registered` warnings from Reanimated. LogBox is compiled out of Release builds, so it does not exist on the device build installed on the founder's iPhone.
- **That bar swallows taps on the tab bar** while visible, which cost one test cycle here. Dismiss it before driving the bottom nav.
- **`onAnimatedValueUpdate` warnings themselves** are benign Reanimated noise, not app errors. Metro logged zero actual errors across both rounds.

## Running total

11 defects: BUG-01 to BUG-08 from testing, plus the three pre-existing/unrelated items already listed above. None introduced by the security remediation, which touched no mobile app code.

Highest value to fix first, unchanged: **BUG-01** (dead splash on a slow or missing network) and **BUG-02** (clip thumbnails can never render). **BUG-08** is a one-line fix with outsized visual impact.
