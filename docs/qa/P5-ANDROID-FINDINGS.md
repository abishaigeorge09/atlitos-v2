# Launch Phase 5, Track A: Android native QA findings

Device: `Pixel_7_API_35` emulator (created this session; no `avdmanager`/`sdkmanager` on this
machine, so the AVD was hand-authored by cloning `Pixel_Fold_API_35`'s config with a phone `hw.lcd`
and `pixel_7` device profile, same system image already present locally:
`android-35/google_apis_playstore/arm64-v8a`, no download needed). 1080x2400 @420dpi, a standard
phone form factor, not the foldable.

Package: `com.atlitos.app`.

## Headline: does the app install and render on Android

**Yes.** Confirmed on a release APK built from this worktree's own source, launched cold with no
Metro attached. Screenshot: `evidence/p5-android/06-release-launch-t0.png`.

## Environment notes that changed the plan

### 1. This worktree's base was stale relative to Track N; merged `phase-11/p5-track-n` in

Cut from `main` (Step 0), not from `phase-11/p5-track-n` as `LAUNCH-PHASE-5-STATUS.md`'s dependency
order requires ("Stage 1 Track N ... Stage 2 Track I || Track A"). Evidence: `apps/mobile/package.json`
had no `expo-notifications` or `@sentry/react-native`, and `apps/mobile/app.json` had no
`expo-notifications` plugin entry, directly contradicting the dispatch brief's claim these were
already compiled into the pre-built debug APK. Merged `phase-11/p5-track-n` into this worktree
(fast-forward-compatible merge of already-committed N work, not a new edit) before testing anything,
so the source under test actually matches what Track N shipped. Stashed one pre-existing uncommitted
local change to `apps/mobile/app.json` (`stash@{0}`, adds only `"package": "com.atlitos.app"`,
content already present on `phase-11/p5-track-n`, safe to drop, never applied).

### 2. The pre-built debug APK was not trustworthy evidence. Traced why, then built a release APK instead

Installed the pre-built debug APK first (`agent-a7d938edb5936d4b0`'s `app-debug.apk`, 250.9 MB) per
the dispatch brief, pointed it at a Metro instance launched from this worktree's own `apps/mobile` on
port 8082 with `adb reverse tcp:8082 tcp:8082`, deep-linked
`atlitos://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082`. It installed and rendered
real content. But my own Metro's log (`/tmp/atlitos-metro-android.log`) never once showed a bundle
request the entire session, while a **different, stale Metro instance on port 8081** turned out to be
serving `/Users/abishaigeorgegosula/dev/atlitos/apps/mobile` (the main checkout, not this worktree,
PID 37638, `expo run:ios --configuration Release`), directly reachable from the emulator via
`10.0.2.2:8081` with no `adb reverse` needed. Confirmed with `curl localhost:8081/status` +
`lsof -p 37638` showing its cwd. The debug APK's JS almost certainly came from there. This is the
Metro trap from the dispatch brief, in the worst variant: it did not fail, it silently rendered the
wrong tree's code and looked like a pass. A green screenshot against a debug+Metro build is not
evidence unless you have independently confirmed which Metro actually served it.

Per the dispatch's own "strongly preferred alternative," and matching iOS QA's choice, switched to a
release APK. `npx expo prebuild --platform android --clean` + `./gradlew assembleRelease --no-daemon`
against this worktree's own `apps/mobile`. Confirmed the bundler ran against
`.claude/worktrees/agent-a05e607d07df407a2/apps/mobile` (`Android Bundled ... entry.js (4316
modules)`, path in the Gradle log). `buildTypes.release` in the generated (gitignored)
`android/app/build.gradle` signs with the debug keystore, so no signing setup was needed.

First release build attempt failed: `error: An organization ID or slug is required` from the Sentry
Gradle plugin's source-map upload step (`@sentry/react-native/expo`'s config plugin needs
`SENTRY_ORG`/`SENTRY_PROJECT`, not present locally). Not a product bug, a local-build-only CI
concern; the JS bundle itself had already built successfully before this step ran. Rebuilt with
`SENTRY_DISABLE_AUTO_UPLOAD=true`, which reused nearly the entire Gradle cache and succeeded in 1m39s.
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk` installed clean.

## Flow-by-flow Maestro results

Ran against the **debug+Metro session before the Metro-trap discovery**, so the underlying JS is
unverified as this worktree's code (see above); results recorded for completeness but not relied on
as proof of this worktree's correctness. All 3 flows that ran to completion passed on the device
(real taps, real assertions, real screenshots), which independently proves the harness and the
device work, even though the JS source can't be attributed with confidence:

| Flow | Result | Notes |
|---|---|---|
| `smoke-guest-home` | PASS | `evidence/p5-android/maestro-output/smoke-guest-home.log` + `-footer.png` |
| `search-domains` | PASS | `evidence/p5-android/maestro-output/search-domains.log` |
| `shop-back` | PASS | `evidence/p5-android/maestro-output/shop-back.log` |
| `category-nav` | FAILED | `evidence/p5-android/maestro-output/category-nav-fail.png` shows a black screen at the exact moment of the assertion. Ruled out: not a redbox (no red text, no error banner), not a system dialog. This is a cold-start JS-bundle-loading black splash: `launchApp` force-stops the dev-client process, so every flow re-fetches the whole bundle from Metro, and this flow's first assertion has no wait built in before the ~15-20s bundle-eval window I measured on first cold launch. Did not continue running the remaining 4 debug-session flows once the Metro-trap was found; not re-run against the release APK because Maestro's `launchApp` + a JS-embedded release build removes the whole bundle-fetch race, so this specific failure mode should not recur, but that is inference, not verified. **Flagged as unverified, not re-run under time constraints.** |

Did not re-run the Maestro suite against the release APK. The release build's JS is confirmed correct
(this worktree's own bundle, embedded, no Metro dependency), and manual on-device verification below
covers the same surfaces the flows exercise (Home, Clutch, Courts, deep links, login gate), but the
suite itself was not machine-re-run end to end against the release build. **This is a gap, named
explicitly**: the next session should run `maestro test .maestro/` against
`app-release.apk` before calling P5-2/P5-3/P5-21 closed.

## Parity risks (P5-12 through P5-20)

| Risk | Result | Evidence |
|---|---|---|
| KeyboardAvoidingView | PASS (source review) | All 9 screens using it (`login`, `register`, `forgot/index`, `forgot/otp`, `forgot/reset`, `coach-setup/[step]`, `player-setup/[step]`, `chat/[id]`, `clutch/post/[id]`) correctly guard `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`, relying on the manifest's `android:windowSoftInputMode="adjustResize"` (confirmed present) for Android. Not independently re-verified by typing into a field on-device under time constraints; source pattern is consistent and correct. |
| Deep links (`atlitos://`) | PASS | `adb shell am start -a android.intent.action.VIEW -d "atlitos://courts"` from a cold, force-stopped process launched directly into the Courts tab with the right header and filter chips. `evidence/p5-android/14-deeplink-cold-courts.png`. AndroidManifest carries the VIEW/BROWSABLE intent-filter for `scheme="atlitos"` (confirmed in the generated manifest, no gap). |
| Android location permission (P5-20) | PASS | Same deep link triggered the full native permission sheet with Precise/Approximate and While-using/Only-this-time/Don't-allow, all present (`evidence/p5-android/14-deeplink-cold-courts.png`). Granted "Only this time"; the Courts list resolved to "Showing courts near Mountain View" (emulator's fixed GPS fix) and rendered real distance-sorted results (`evidence/p5-android/16-deeplink-location-wait.png`). |
| Image picker / camera permission (P5-18) | PASS (source review) | `profile/edit.tsx`, `coach-setup/[step].tsx`, `player-setup/[step].tsx` all call `ImagePicker.requestMediaLibraryPermissionsAsync()` explicitly and handle `!permission.granted` with a visible error, not a crash or silent no-op. `clutch/upload.tsx` uses `launchImageLibraryAsync` directly (which self-prompts) and treats `result.canceled` as a clean early return. Camera capture (`launchCameraAsync`) is not wired anywhere in the app yet, only a comment flags it as future work in `clutch/upload.tsx` — this is a cross-platform scope gap, not Android-specific, not filed as a Track A finding. |
| Hardware back, general navigation | PARTIAL PASS | From a bottom-tab screen that is not Home (tested from Clutch), a single hardware back press exits the app directly to the launcher, with no intermediate "return to Home tab" step (`evidence/p5-android/10-after-back-from-clutch.png`). This is default expo-router/React Navigation tab behavior, not a crash, but is worth a product decision: most Android apps return to the first tab before exiting. See Finding A-3. |
| Hardware back, mid-modal (LoginGateModal) | **FAIL**, see Finding A-2 | `evidence/p5-android/12-login-gate-open2.png` (before) vs `13-login-gate-after-back.png` (after one BACK press): pixel-identical, the sheet does not close. |
| Razorpay checkout Activity + hardware back mid-payment | **NOT EXERCISED** | Ran out of session time before reaching a real checkout screen (Clutch/Courts/Shop all need either a seeded booking flow or a cart with a real SKU walked through to payment). Source review only: `src/lib/razorpay-checkout.native.ts` is a thin, platform-agnostic wrapper over `react-native-razorpay`'s `.open()`/reject contract, and both a user-dismiss and a genuine failure already funnel through the same `RazorpayCheckoutCancelledError`, which should behave identically whether the sheet is dismissed by a swipe (iOS) or the Activity's back stack unwinding (Android) via the library's own back handling. **Not verified on-device.** This is the single largest gap in this pass and should be the first thing the next session does. |
| SDK 57 edge-to-edge safe-area (BUG-003 class) | PASS on what was exercised | Status bar, bottom tab bar, and the LoginGateModal sheet all rendered with correct padding against the device chrome in every screenshot taken (no content clipped under the status bar or bottom nav). `ConfirmSheet` and `GroupMembersSheet` were not opened this session (no destructive-confirm or group-chat flow reached), so BUG-003's other two named sheets are unverified. |
| ExoPlayer video playback in Clutch | **FAIL**, see Finding A-1 | This is the headline defect of the session. |
| reanimated 4.5 + aurora SVG perf | PARTIAL, see Finding A-4 | No visible jank on the auth screen's aurora animation in casual observation, but Reanimated logged dozens of `RetryableMountingLayerException: Unable to find SurfaceMountingManager for tag` warnings during Clutch feed scrolling, which is a real Fabric/Reanimated mounting race, not a false alarm (see finding). Aurora screen itself not stress-tested (no frame-timing capture, no systrace). |

## Findings

### A-1. P0. Clutch video cards render as solid visual noise, both in the Home preview and the full Clutch feed. Android-only (very likely; environment-confirmed emulator artifact, needs a physical-device recheck before ranking above P1)

**Screen/component:** `ClipVideo` (`src/components/molecules/clip-video.tsx`), rendered from
`ClutchPreviewCard` on Home and from the main feed in `(tabs)/clutch/index.tsx`.

**Repro:** Cold launch → Home → scroll to the Clutch preview card. **Screenshot:**
`evidence/p5-android/07-release-home-scrolled.png`. Same result opening the Clutch tab directly:
`evidence/p5-android/09-clutch-tab2.png`. The entire video surface renders as television static
(high-frequency black/white noise) instead of either the poster image or a decoded video frame. The
overlay chrome (like/comment/save/share rail, author name, caption, the `ATLITOS 04 BADMINTON`
sport-tag text) renders correctly on top of it, so this is specifically the `VideoView`'s surface,
not a layout or data problem — the clip's own metadata loaded fine.

**Ruled out:** not a black screen (video genuinely decodes: `adb logcat` shows real
`ExoPlayerImpl`/`MediaSessionService` state transitions with `PLAYING`, advancing `position`, and
growing `buffered position`, e.g. position 28ms → 792ms across ~1.5s of real time). Not a missing
asset (`ExoPlayerImpl: Init ... AndroidXMedia3/1.9.0` succeeds, `CCodec`/`Codec2Client` negotiate a
720x1280 H.264 decoder without error). Not a stale/expired signed URL rejection (no 4xx/network error
in logcat around the failure).

**Root cause, from logcat, high confidence:** `java.lang.OutOfMemoryError` on the render thread:
```
E ExpoModulesCore: Unable to send event 'statusChange' by shared object of type VideoPlayer
E ExpoModulesCore: java.lang.OutOfMemoryError: Failed to allocate a 144 byte allocation with 694592
  free bytes and 678KB until OOM, target footprint 201326592, growth limit 201326592; giving up on
  allocation because <1% of heap free after GC.
```
and a second one on `playingChange`. Counted **15 distinct `ExpoVideoBasicMediaSession_*` instances**
created/destroyed in a short scroll session (`adb logcat | grep -oE
"ExpoVideoBasicMediaSession_[0-9]+" | sort -u`), i.e. roughly one native `ExoPlayer` + `MediaSession`
pair per feed item mounted, not a small fixed pool. `(tabs)/clutch/index.tsx`'s `FlatList` has no
`windowSize`, `maxToRenderPerBatch`, or `removeClippedSubviews` override, so it uses React Native's
default virtualization window (21 screens' worth), which for a feed where every item is an expensive
native video player is far too large. Each `ClipVideo` creates its own `useVideoPlayer` instance with
no visible pooling/reuse, so scrolling a few screens' worth of the feed creates enough concurrent
native players to exhaust the default ~192MB Java heap, and the OOM corrupts state around the video
surface (most likely: a `SurfaceTexture`/`GraphicBuffer` allocation fails and the platform compositor
is left showing whatever was previously in that graphics buffer, which is exactly what uninitialized-
buffer "static" looks like).

**Android-vs-iOS:** the per-item MediaSession is a Media3/Android-specific cost; iOS's `AVPlayer` has
no equivalent per-instance OS-level session object, so the same `windowSize` default is far cheaper
there. iOS QA's own status doc records only "iOS release build passes full Maestro flow," with no
mention of a Clutch feed OOM, consistent with this being materially worse on Android. Flagging as
**very likely Android-only** rather than certainly, because the emulator's software (goldfish) GPU
path is also a known amplifier of graphics-memory pressure; the failure mode (a real
`OutOfMemoryError` from the JVM heap, not a GPU driver crash) argues this is a real resource-
management bug rather than purely an emulator artifact, but that should be confirmed on a physical
device before this is treated as unconditionally reproducible in production.

**Fix direction for Track F (not applied, out of scope for this track):** bound `FlatList`'s
`windowSize`/`maxToRenderPerBatch`, and/or gate `useVideoPlayer` so only the 1-2 nearest-to-viewport
items hold a live native player (release/recreate on scroll past a threshold), the same pattern
`ClipVideo`'s own `active` prop already partially supports (`player.pause()` when inactive) but does
not extend to releasing the underlying native instance.

### A-2. P1. Hardware BACK does not close portal-rendered overlays (LoginGateModal, and by the same code pattern GroupMembersSheet). Android-only by definition (no hardware back key on iOS)

**Screen/component:** `LoginGateModal` (`src/components/organisms/LoginGateModal.tsx`),
`GroupMembersSheet` (`src/components/organisms/chat/GroupMembersSheet.tsx`).

**Repro:** Home → tap the AppBar avatar as a guest to raise the login gate → press hardware BACK.
**Before:** `evidence/p5-android/12-login-gate-open2.png`. **After one BACK press:**
`evidence/p5-android/13-login-gate-after-back.png`. The two screenshots are visually identical; the
sheet does not dismiss, and BACK does not fall through to the underlying screen either (no
navigation, no exit) — the press is simply absorbed with no visible effect.

**Ruled out:** not a missed tap (the coordinates and timing were verified working for the Close
button in the same session, and the sheet has no loading state). Not a Maestro/harness artifact, this
was driven by raw `adb shell input keyevent KEYCODE_BACK`, no test framework involved.

**Root cause:** `LoginGateModal` and `GroupMembersSheet` deliberately do **not** use React Native's
native `Modal` (the code comments explain this was already required to fix two iOS a11y/navigation
bugs, see `.maestro/README.md`). They render in-tree through the root `PortalHost` instead. Native
`Modal` gets Android's hardware-back-closes-it behavior for free via `onRequestClose` (confirmed:
`ConfirmSheet`, which still uses native `Modal`, wires `onRequestClose={onCancel}` and should close
correctly on BACK, though this was not independently re-verified on-device this session since no
destructive-confirm flow was reached). The portal-overlay pattern gets no equivalent for free, and
there is **zero `BackHandler` usage anywhere in `apps/mobile/src`** (`grep -rln BackHandler` returns
nothing), so nothing intercepts the key event for either portal-based sheet.

**Class sweep:** this affects every component using the `Portal` pattern from `@rn-primitives/portal`
that presents as a dismissible overlay. Found two by name (`LoginGateModal`, `GroupMembersSheet`);
did not exhaustively grep for every Portal consumer under time constraints. Track F should grep
`import.*Portal.*@rn-primitives/portal` before considering this fixed everywhere.

### A-3. P2. Hardware BACK from any bottom tab other than Home exits the app directly, no intermediate return-to-Home step. Android-only (no equivalent gesture on iOS)

**Repro:** Cold launch → tap Clutch tab → press hardware BACK once. **Screenshot:**
`evidence/p5-android/10-after-back-from-clutch.png` (lands on the Android launcher). Common Android
convention is that BACK from a non-root bottom tab returns to the first/Home tab before a second BACK
exits the app; this app exits on the first press from any tab. Not a crash, not silent data loss, but
a genuine platform-convention gap worth a product decision rather than a silent fix.

### A-4. P2. Reanimated logs a burst of `RetryableMountingLayerException: Unable to find SurfaceMountingManager for tag` warnings while scrolling the Clutch feed. Android/Fabric-specific, first-ever compile of this reanimated version on Android per the dispatch brief

**Evidence:** `adb logcat`, tags `50, 62, 72, 80, 92, 280, 282, 284` each repeating the same
`synchronouslyUpdateUIProps failed ... RetryableMountingLayerException` pattern dozens of times within
under a second during a Clutch feed scroll. "Retryable" means Reanimated catches and presumably
retries internally rather than crashing (no ANR, no visible glitch beyond A-1's separate video
issue), but the volume (dozens of failures per scroll gesture) indicates Reanimated is racing Fabric's
view-recycling on Android under real scroll load, consistent with react-native-reanimated 4.5's first
Android compile being unproven, exactly as the dispatch brief anticipated. Did not correlate this
specifically to the aurora SVG screen (auth/login), which was not scroll-stress-tested this session.

### A-5. P1. Android push (P5-23): blocked at the `app.json` config layer, before the credentials/EAS-key blocker the plan already names

**Exact state:** `expo-notifications` **is** now a real dependency and plugin entry (after merging
`phase-11/p5-track-n`), and the native compile succeeds cleanly with it. But `apps/mobile/app.json`
has **no `googleServicesFile` key anywhere** (checked `main`, `phase-11/launch-p4`, and
`phase-11/p5-track-n` — none of the three sets it), so `expo prebuild` never copies
`google-services.json` into `android/app/`, and `grep -n "google-services" android/build.gradle
android/app/build.gradle` returns nothing: **the `com.google.gms.google-services` Gradle plugin is
never applied.** `google-services.json` itself exists but only as an untracked file in the main
checkout (copied manually into this worktree per the plan's bootstrap sequence); a config plugin
reference is what's actually missing. Firebase (which `expo-notifications`/`getExpoPushTokenAsync`
needs on Android to mint the underlying FCM registration token before exchanging it for an Expo push
token) will not auto-initialize without this.

`registerForPushTokenAsync()` in `src/lib/push.ts` is written defensively (every native call
try/caught, degrades to `null`, never throws into app start), so this doesn't crash anything, it just
silently produces no token. Did not trigger the actual registration call on-device and inspect the
resulting log line this session (no signed-in test account reached) to confirm the exact failure mode
this produces at runtime; the config-layer gap above is confirmed by static inspection of the
generated Gradle project, not yet by a captured runtime error.

**Disposition, consistent with the plan's own D-clause:** this is a second, earlier blocker layered
on top of the FCM V1 credentials gap the plan already calls BLOCKED-EXTERNAL. Even once `eas
credentials` has the service-account key uploaded, a **local** prebuild (as opposed to an EAS cloud
build, which may inject `google-services.json` differently through its own credential store) will
still fail to wire Firebase in without `android.googleServicesFile` being added to `app.json`. This
is Track N's file; recorded here as a finding, not fixed.

### A-6. P3. `ExpoVideo` logs an error (not just a warning) about picture-in-picture on every video mount

```
E ExpoVideo: Current activity does not support picture-in-picture. Make sure you have configured
  the `expo-video` config plugin correctly.
```
Fires every time a `VideoView` mounts, both in the Home preview and the Clutch feed. Not visibly
breaking anything (playback proceeds regardless per A-1's analysis), but it's an `E`-level log on a
code path that runs on every single video card, which will show up in Sentry/crash-reporting noise
once push/Sentry are fully wired, and is a one-line `app.json`/`expo-video` plugin config fix
(`supportsPictureInPicture` option) if PiP is intentionally out of scope, or a real gap if it isn't.

### A-7. P3. `Sentry` view managers log "Could not find generated setter" warnings on cold start (release build)

```
W unknown:ViewManagerPropertyUpdater: Could not find generated setter for class
  io.sentry.react.RNSentryOnDrawReporterManager
W unknown:ViewManagerPropertyUpdater: Could not find generated setter for class
  io.sentry.react.replay.RNSentryReplayMaskManager
W unknown:ViewManagerPropertyUpdater: Could not find generated setter for class
  io.sentry.react.replay.RNSentryReplayUnmaskManager
```
Non-fatal (app renders and Sentry's native init line `io.sentry.auto-init read: false` proceeds
cleanly with no crash after it), but this is Fabric codegen not finding generated prop setters for
Sentry's own native view managers, consistent with this being the first-ever Android compile of
`@sentry/react-native` in this repo, exactly as the dispatch brief flagged as unproven. Worth a
second look once a real device/crash test can confirm Sentry actually delivers an event end to end
(not attempted this session, no crash was triggered on purpose).

### Investigated, ruled out as non-issues (recorded so the next session does not re-litigate them)

- **A yellow "Open debugger to view warnings." banner on every screen** in the pre-Metro-trap-
  discovery debug session. This is React Native's stock dev-mode LogBox banner (confirmed via the
  Maestro screen-hierarchy dump, `text: "Open debugger to view warnings."`), present only because
  that was a debug build. It does not appear in the release build (`evidence/p5-android/06-*` through
  `16-*` have no such banner). Not a product bug.
- **"App Start Span could not be finished. Sentry.wrap was called before Sentry.init."** warning seen
  once in the debug session's logcat. Checked specifically for it in the release build's logcat
  (`adb logcat -d --pid=12468 | grep -i "App Start Span"`) and it does not appear. Not carried forward
  as a finding since it does not reproduce in the build actually under test.
- **Foldable-specific layout risk**: not applicable, this session used a hand-built standard-phone AVD
  (`Pixel_7_API_35`, 1080x2400), not the pre-existing `Pixel_Fold_API_35`.

## Android push (P5-23): summary

**BLOCKED**, for two stacked reasons, in order:
1. `apps/mobile/app.json` has no `googleServicesFile` reference on any branch checked, so the
   `google-services` Gradle plugin never applies during a local prebuild (Finding A-5). This is
   fixable by Track N without touching credentials at all.
2. Even with (1) fixed, the FCM V1 service-account key has not been uploaded via `eas credentials`
   (plan's own named external blocker, unchanged this session, not independently re-checked since
   that requires Expo account access outside this track's scope).

Client-side token registration code (`src/lib/push.ts`) is written to degrade to `null` rather than
crash, so neither blocker produces a visible app failure, just silent no-op push registration.
Recorded here as BLOCKED with the exact reason per both layers, not attempted to fix (out of scope,
Track N owns `app.json`, credentials are founder-gated per the plan).

## What Track A did not get to, named explicitly for the next session

- **Razorpay checkout Activity flow + hardware back mid-payment (P5-12)**: not exercised on-device at
  all. Source review only. This is the largest verification gap from this session and should be first.
- **The 7 shared Maestro flows re-run against the release APK**: not done. 3 ran clean against the
  (evidentially-unreliable) debug session, 1 failed on what looks like a cold-start timing artifact
  specific to the debug+Metro path, 3 were never run this session (`courts-header`, `profile-gate`,
  `gate-login-nav`, `auth-register-skip`, `trainings-coach-browse`, `trainings-shell`,
  `groups-athlete`, `groups-coach`, `groups-join-guard`, `integrator-coach-trainees` — the full
  `.maestro/` directory has more flows than the 7 the plan names explicitly; only the plan's named 7
  were in scope and only 4 of those were attempted).
- **ConfirmSheet and GroupMembersSheet on-device**: not opened this session (no destructive-confirm
  or group-chat flow reached), so the BUG-003 safe-area sweep and the A-2 hardware-back gap are
  unverified for these two specific components beyond the code-pattern match to LoginGateModal.
- **P5-7 (Android half), the 10 money-consequential `Alert.alert` call sites**: not verified this
  session.
- **CL-13, CL-17, CH-12, CT-12, CO-12, CO-13, SH-10, EM-14, XP-06** (the 9 native EXT judgment walks,
  D4): not walked this session.
