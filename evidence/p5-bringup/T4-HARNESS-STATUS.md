# P5 T4: Maestro harness status

Date: 2026-08-11

## Result: harness EXECUTES, app content BLOCKED

## What is proven

Maestro 2.7.0 is installed and drives the booted iPhone 16 Pro Max
(UDID 8AF6A5E2-F889-4477-8634-97B4AB5D5453) correctly.

`maestro test .maestro/smoke-guest-home.yaml` ran end to end:
launched com.atlitos.app, executed conditional blocks, scrolls and
assertions, produced screenshots and a screen hierarchy, and detected
no app crash. The harness itself is not the problem.

16 flows already exist in `.maestro/`. `config.yaml` sets
`appId: com.atlitos.app`, which matches the installed bundle.

## What is NOT proven, and why

The flow reported `Assert that "Badminton" is visible... FAILED`.

**This is not a product bug.** The screenshot at the moment of failure
(`step-009-assertCondition-Badminton.png`) shows a Metro redbox:

    Metro has encountered an error: Failed to get the SHA-1 for:
    /Users/abishaigeorgegosula/dev/atlitos/node_modules/expo/virtual/streams.js

Every assertion after app launch failed for that single reason. Any QA
run in this state would produce a sheet of fabricated failures.

## Root cause

The installed app is a **dev client** (no embedded jsbundle), so it
renders whatever Metro serves it.

The Metro instance on port 8081 had been started from the **monorepo
root** (`/Users/abishaigeorgegosula/dev/atlitos`) rather than from the
Expo project root (`apps/mobile`). Proof that root is the wrong project
root:

    curl http://localhost:8085/index.bundle?platform=ios
    -> UnableToResolveError: Unable to resolve module ./index
       from /Users/abishaigeorgegosula/dev/atlitos/.

Started correctly from `apps/mobile`, the same Metro bundles cleanly:

    iOS Bundled 14034ms node_modules/.pnpm/expo-router@57.0.7/.../entry.js
    (4394 modules)
    /.expo/.virtual-metro-entry.bundle -> HTTP 200, 19,442,395 bytes

Note `/index.bundle` 404 is expected and is not a fault: the entry for
expo-router is the virtual metro entry, not `index`.

## Action taken

The 8081 Metro was **orphaned**: its parent chain terminated at launchd
(PID 1), so no session owned it. It was misconfigured and was actively
corrupting simulator runs. It was stopped.

The Metro on 8083 has a live parent (PID 3047) and was left untouched.

A correctly rooted Metro was started on port 8085 from `apps/mobile`.

## Remaining blocker

After stopping 8081 and pointing the dev client at 8085 via
`atlitos://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8085`
(openurl exit 0), the app still displays the stale redbox and no new
bundle request reaches 8085. The dev client is not re-attaching.

## Recommendation

Do not run Tracks I and A against a dev client. Build a **release iOS
app with the JS bundle embedded**:

    npx expo run:ios --configuration Release

That removes Metro from the QA path entirely, eliminates this whole
class of false failure, and tests something closer to what actually
ships. The Android side already has a real APK, so the two platforms
would then be tested on comparable artifacts.

---

## RESOLVED 2026-08-11: release build fixes it

`npx expo run:ios --configuration Release` built with zero errors and
installed `Atlitos.app` in a new container. The JS bundle is embedded,
verified directly rather than inferred:

    Atlitos.app/main.jsbundle   9,652,651 bytes

`ExpoNotifications_privacy.bundle` is also present, so the push module
is compiled into the iOS binary.

`maestro test .maestro/smoke-guest-home.yaml` then passed every step:
launch, scroll, assert ATLITOS, assert Badminton, scroll to footer,
assert tagline, screenshot. All COMPLETED.

Both earlier failures are confirmed environmental, not product bugs:
- `Badminton` failed against the redbox from the misrooted Metro.
- `ATLITOS` failed because the "Open in Atlitos?" system dialog held
  accessibility focus. Dismissing it cleared the failure.

Note `expo run:ios` starts its own Metro on 8081. That is harmless for a
Release build since the bundle is embedded, but it means "no Metro
running" is not a valid way to prove embedding. Check for
`main.jsbundle` in the .app instead.

## Visual observations for Track I, logged not fixed

From `ios-release-home.png` on the iPhone 16 Pro Max:

1. The Clutch video tile renders as static noise. LIKELY a simulator
   video decoding limitation rather than a product bug. Must be
   confirmed on a physical device before it is logged as a defect.
2. The `Share` label overlaps its own icon in the Clutch tile, and
   `Save` is clipped by the tile edge. This is a layout defect and is
   not simulator specific.
3. The first "Donate to Empower" card shows a large blank area where an
   image should be, while the adjacent card renders a graphic. Possible
   image load failure.
4. Caption text renders as `Husband s`, which suggests an apostrophe is
   being stripped or mis-encoded.

None of these were fixed. Items 2, 3 and 4 belong to Track F via
Track I's findings file.
