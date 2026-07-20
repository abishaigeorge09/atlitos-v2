# What web verification cannot speak for

Written 2026-07-20 while Phase 3 was being verified on Expo web, because the
founder's instruction was: make web work, but keep the design native-safe, and
he will test native later. This is the precise list to check on that pass, so
it is not a re-test of everything.

## The good news, and it is the main finding

The platform divergence surface is **small and properly isolated**, not smeared
through the app:

- **Exactly two `Platform.OS` branches in the whole codebase**, both in
  `src/app/(tabs)/chat/[id].tsx` lines 173-174, both keyboard avoidance
  (`behavior` and `keyboardVerticalOffset` on iOS). Nothing else branches.
- **Checkout is split the correct React Native way**: `razorpay-checkout.web.ts`
  and `razorpay-checkout.native.ts` behind a shared
  `razorpay-checkout.types.ts` contract. Both satisfy the same interface, so
  every caller (`courts/book/pay.tsx`, `coaching/book/pay.tsx`,
  `trainings/earnings/payout-setup.tsx`) is platform agnostic.

So a web pass genuinely exercises the shared logic. What it cannot exercise is
listed below.

## 1. The native checkout has never run. This is the big one.

`razorpay-checkout.native.ts` is 41 lines calling `RazorpayCheckout.open()`
from `react-native-razorpay`, a third-party native module. Every payment this
project has ever taken, including the founder's real Rs 670 test payment in P2,
went through the 110-line **web** implementation. The native file has executed
zero times.

Specifically unverified: that the native sheet opens at all; that its success
result really carries `razorpay_order_id` / `razorpay_payment_id` /
`razorpay_signature` in those exact key names; and the error shape, since the
code assumes the library rejects with `{ code, description }` rather than a
real `Error` on BOTH user dismissal and genuine failure, and treats both as
`RazorpayCheckoutCancelledError`. If that assumption is wrong, a real payment
failure is silently reported to the user as a cancellation.

This is AT-58, and it is the single highest-value thing to check natively.

## 2. Auth session storage

`src/lib/supabase.ts` uses `AsyncStorage`, whose web adapter reads
`window.localStorage`. Native uses real AsyncStorage. Session persistence
across app restart, and the SSR no-op storage guard, therefore behave
differently and are unproven natively. Every web test in this phase injected a
script-minted session rather than signing in through the UI, so the native
sign-in and session-restore path is untested end to end.

## 3. Native-only modules, by blast radius

- `expo-haptics`: 19 files. No-ops on web, so any incorrect usage is invisible
  in a web pass. Low risk of breakage, zero web coverage.
- `expo-image-picker`: 3 files. Permission prompts and the picker sheet are
  native surfaces that do not exist on web.
- `expo-location`: 1 file (courts distance). Web uses the browser geolocation
  prompt; native uses the OS one and needs the Info.plist usage string that
  app.json's plugin config supplies.
- `expo-splash-screen`: 1 file. The web splash and the native launch screen are
  different mechanisms entirely.

## 4. Layout

The app is phone-first. A browser window is wide, so a screen can look correct
on web purely because it has room. The known instance is the court detail hero
placeholder, already logged as oversized at desktop widths (AT-34). Treat any
screen that only reads well wide as suspect until seen at 402pt.

## 5. Keyboard behaviour

Follows directly from finding 1 in the good-news section: the only two
`Platform.OS` branches exist precisely because keyboard avoidance differs, and
the iOS branch (`padding`, offset 88) has never been observed. Chat is where a
wrong offset shows up worst, since the composer sits at the bottom.

## How to run the native pass efficiently

1. Grant Accessibility and Screen Recording to
   `/Users/abishaigeorgegosula/.local/share/claude/ClaudeCode.app`, then fully
   quit and relaunch Claude Code (a grant does not reach a running process).
2. `cd apps/mobile && npx expo start --dev-client --port 8081` (Metro must own
   8081; the dev client ignores `--url` once a redbox is showing), then
   `xcrun simctl launch A91EC474-AE40-49D8-BA90-CCF14ED517D7 com.synthorgtech.atlitos-mobile`.
3. Drive item 1 first. If the native checkout works, the rest of this list is
   comparatively cheap.
