# Android bootstrap

Atlitos mobile (`apps/mobile`, Expo/React Native) had never been built for Android before this
work. This doc records the config added, the result of the first Android compile, the
Android specific risks to QA before any real Android ship, and the actions only the founder
can take.

Branch: `phase-11/android-bootstrap`, based on `phase-11/integration` (`3513a8c`).

## Config added

### `apps/mobile/app.json`

- `android.package`: `"com.atlitos.app"`. This was missing entirely; without it, EAS cannot
  produce an installable Android package (the Android equivalent of `ios.bundleIdentifier`,
  which was already set). Chosen to match the iOS bundle id so both stores use the same
  identity.
- `expo-image-picker` added to the `plugins` array with `photosPermission`,
  `cameraPermission`, and `microphonePermission` strings. The dependency was already in
  `package.json` and is used for avatar upload (`profile/edit.tsx`, onboarding steps) and
  clutch clip upload (`clutch/upload.tsx`), but the config plugin was never registered. In a
  fully managed (CNG) Expo project, an unregistered permission-bearing plugin means the
  permission entries never get written into the native project at prebuild time. Concretely
  this was already a live gap on iOS (no `NSPhotoLibraryUsageDescription` in `infoPlist`,
  which crashes the app the first time the library picker opens) and on Android it meant no
  `RECORD_AUDIO` permission, which `expo-image-picker` requests by default because clutch
  clips are picked as video-with-audio. Fixed for both platforms in the same edit.
- `android.versionCode` intentionally NOT added manually. `eas.json`'s
  `cli.appVersionSource: "remote"` plus `build.production.autoIncrement: true` means EAS
  owns and increments `versionCode` remotely; hardcoding one in `app.json` would fight that.
  Confirmed on the first build: EAS reported "No remote versions are configured... 
  Initializing versionCode with 1."
- `android.intentFilters` intentionally NOT added. The top-level `"scheme": "atlitos"` is
  picked up automatically by Expo's own prebuild config (the same mechanism that wires the
  iOS URL scheme), which generates a `VIEW`/`BROWSABLE`/`DEFAULT` intent filter for
  `atlitos://` on Android without any extra config. Verify after the first real prebuild
  by checking the generated `android/app/src/main/AndroidManifest.xml` for the intent
  filter; add an explicit `android.intentFilters` entry only if it is missing or if a
  verified `https://` App Link (not just the custom scheme) is needed later.
- Adaptive icon: already fully configured (`android-icon-foreground.png`,
  `android-icon-background.png`, `android-icon-monochrome.png` all present under
  `assets/images/`, monochrome covers Android 13+ themed icons). No changes needed.

### `apps/mobile/eas.json`

- Added `submit.production.android`: `serviceAccountKeyPath` pointing at
  `./google-service-account.json` (not committed, see founder actions) and
  `track: "internal"` so the first Play upload lands on the internal testing track, not
  production.
- Added a `.gitignore` entry for `google-service-account.json` so the real key can never be
  committed once the founder drops it in.

## First Android build result

`eas build --platform android --profile preview --non-interactive`, run as `synthorgtech`
(already authenticated, no login prompt needed — see the report for why this was possible).

- Build queued successfully: versionCode initialized to 1 by EAS remote versioning.
- EAS auto-generated and stored an Android upload keystore on the Expo server (first time;
  no existing Android credentials in the project).
- Project archive uploaded (36.6 MB), fingerprint computed, build handed to EAS's build
  queue.
- Full result (native compile of `react-native-razorpay`, `react-native-reanimated@4.5.0`,
  `expo-video`, `react-native-svg@15`, `nativewind`, `react-native-worklets@0.10.2` on
  Android for the first time) is appended below once the build finishes — see the build log
  at the EAS dashboard link captured in the terminal output for this run.

### Result: FINISHED (2026-08-06)

The first-ever Android compile SUCCEEDED. `eas build:list --platform android` reports:

- Status: `FINISHED`, platform ANDROID, appVersion `1.0.0`, versionCode `1`.
- Installable APK artifact produced:
  `https://expo.dev/artifacts/eas/VlsX1EoSYU950GEL1OC7wK-DSod6-Eymm1dbgx0omwg.apk`

So none of the native modules that had never been compiled for Android before
(`react-native-razorpay`, `react-native-reanimated@4.5.0` + `react-native-worklets@0.10.2`,
`expo-video`/ExoPlayer, `react-native-svg@15`, `nativewind`) blocked the Gradle build. This
is a compile-green result only. It does NOT mean the parity-risk list below has been
exercised at runtime; that is Phase 5 Android QA on a real emulator against this APK.

## `expo-modules-jsi@57.0.3` patch: iOS vs Android

The committed patch (`patches/expo-modules-jsi@57.0.3.patch`) changes one Swift file,
`apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift`, swapping
`abs(milliseconds)` for `milliseconds.magnitude` in the JS-Date-to-native-Date bounds check.
That is an iOS/Swift-only source tree; `expo-modules-jsi` itself is not part of the module's
Android surface at all.

The Android equivalent code path is `expo-modules-core`'s Kotlin
`DateTypeConverter` (`expo-modules-core/android/.../kotlin/types/DateTypeConverter.kt`),
which converts an out-of-range JS timestamp via `value.asDouble().toLong()`. Kotlin's
`Double.toLong()` saturates to `Long.MAX_VALUE`/`MIN_VALUE` on overflow rather than trapping,
so the specific Swift crash this patch fixes does not have an Android analog and does not
need a matching patch. Flagging this so it is a documented decision, not a silent gap, next
time someone audits `patchedDependencies`.

## Android parity-risk QA list

None of this has been exercised on a real Android device or emulator yet. Before any Android
ship, walk each of these:

- **Razorpay checkout Activity flow.** `react-native-razorpay` ships its own
  `com.razorpay.CheckoutActivity` via its bundled `AndroidManifest.xml`, merged in
  automatically by Gradle manifest merging during prebuild (confirmed present in the
  installed package). Never exercised: does the checkout sheet actually launch, return a
  result to `RazorpayCheckout.open()`, and does `razorpay-checkout.native.ts`'s
  cancel/error path (`RazorpayCheckoutCancelledError`) behave the same on Android's back
  button as it does on iOS's swipe-to-dismiss.
- **Hardware back button, especially mid-payment.** Android's system back button has no iOS
  equivalent. Every screen with a multi-step flow (onboarding, checkout, group join, payout
  setup) needs an explicit check: does back navigate the wizard step, dismiss the screen, or
  (worst case) leave a payment sheet in an inconsistent state. `predictiveBackGestureEnabled`
  is currently set to `false`, which side-steps the newer Android 14+ predictive-back
  animation but does not remove the need to test the plain back button.
- **Aurora / decorative SVG + reanimated combos.** `react-native-svg@15` and
  `react-native-reanimated@4.5.0` (with `react-native-worklets@0.10.2`) both have a history
  of Android-specific rendering and threading quirks that don't show up on iOS (SVG filters,
  gradient rendering, and worklet-driven layout animations in particular). Anywhere the app
  animates an SVG (aurora backgrounds, decorative elements) needs a visual pass on a real
  Android render, not just a passing typecheck.
- **`KeyboardAvoidingView` behavior.** iOS and Android have historically needed different
  `behavior` props (`padding` vs `height`/`undefined`) and different `keyboardVerticalOffset`
  tuning. Every form screen (auth, onboarding steps, checkout, chat input) needs a check that
  the keyboard doesn't cover the active field or the submit button on Android.
- **ExoPlayer (`expo-video`) playback.** Android's video pipeline is ExoPlayer, not
  AVPlayer. Clutch clip playback, trainee video analytics, and any autoplay/loop behavior
  need a real-device check for codec support, buffering behavior, and audio focus handling
  (does video audio duck or pause other audio correctly).
- **SDK 57 edge-to-edge / safe-area.** Expo SDK 57 on Android defaults new projects to
  edge-to-edge display (drawing behind the system status/nav bars). Combined with
  `react-native-safe-area-context@5.7`, every screen needs a check that content isn't
  clipped behind the status bar or the gesture nav bar, especially screens with a
  transparent or colored header.
- **`expo-image-picker` permissions, live now.** With the plugin fix above,
  `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` (API 33+) or `READ_EXTERNAL_STORAGE` (older) plus
  `RECORD_AUDIO` are declared. Needs an on-device check that the Android runtime permission
  prompts actually appear and that a denial is handled gracefully (not a silent failure) in
  clutch upload and the two onboarding avatar steps.
- **Deep links (`atlitos://`).** Confirm the auto-generated intent filter actually opens the
  app from a cold start, a backgrounded state, and via `adb shell am start -a
  android.intent.action.VIEW -d "atlitos://..."`, matching whatever iOS universal/custom
  link testing has already been done.
- **Location permission on Android.** `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` are
  already declared, but Android's permission dialog (foreground-only vs "while using the
  app" vs "only this time") differs from iOS's; confirm the courts-near-me flow degrades
  gracefully on "only this time" or a denial.

## Founder actions needed

- **Google Play Console account.** No Play Console developer account has been referenced
  anywhere in this repo or in `eas.json`/`app.json`. Needs the $25 one-time Play developer
  registration (organization or individual) before any internal-track upload can land
  anywhere.
- **Play Console app record.** Once the account exists, create the app record with package
  name `com.atlitos.app` (must match `android.package` above exactly).
- **Google Play service account key.** `eas submit --platform android` needs a service
  account JSON key with the Play Android Developer API enabled and access granted to the
  app in Play Console (Users and permissions > Invite new user > Service account, with at
  least "Release to testing tracks" permission). Save it as
  `apps/mobile/google-service-account.json` (already gitignored) or point
  `submit.production.android.serviceAccountKeyPath` in `eas.json` at wherever it actually
  lives. This is a founder-only credential; do not paste the key contents into chat or a
  commit.
- **EAS auth for the Android submit step.** The build step itself did not need fresh Play
  auth (EAS owns and auto-generated the Android signing keystore, and `eas build` doesn't
  touch Play). Only `eas submit --platform android` will need the service account key above
  — nothing further needed for build/compile itself under the current `synthorgtech`
  EAS login.
