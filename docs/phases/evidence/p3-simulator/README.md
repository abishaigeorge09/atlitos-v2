# iOS simulator verification, first attempt (2026-07-19)

Founder flagged that the mobile app had never been run on a simulator, only Expo web. First simulator run:

- Expo Go installed on the booted iPhone 17 simulator, dev server on port 8091.
- ios-sim-atlitos-splash.png: Atlitos launching natively in Expo Go (icon plus "Loading project").
- Metro bundled the app for iOS successfully: 3680 modules, confirmed twice in the dev server log, plus a 90ms HMR rebuild. The app compiles and boots on real iOS, not just react-native-web.
- ios-sim-expo-go-launcher.png: Expo Go's launcher listing Atlitos under Recently opened.

## Blocker: no programmatic tap

Getting from the launcher into the app needs one tap on the Atlitos row. `xcrun simctl` has no tap primitive, and both fallbacks are blocked by macOS privacy settings that this terminal has not been granted:
- AppleScript System Events: "osascript is not allowed assistive access" (-1719), needs Accessibility permission.
- screencapture for cliclick targeting: "could not create image from display", needs Screen Recording permission. (cliclick itself is installed at /opt/homebrew/bin/cliclick.)

Unblock either way: (a) founder taps Atlitos once in the simulator, or (b) grant the terminal Accessibility and Screen Recording in System Settings, Privacy and Security, after which simulator screens can be driven and captured automatically for every future phase gate.

## Native dev build achieved (2026-07-19, 08:20 IST)

Expo Go was a dead end by design: apps/mobile depends on react-native-razorpay, a third-party native module, and Expo Go can only run the fixed native code it ships. Every launch segfaulted in react-native-worklets (EXC_BAD_ACCESS, crash report in ~/Library/Logs/DiagnosticReports). The fix is a development build.

Done:
- `npx expo install --fix` plus an @expo/metro-runtime peer bump: 13 packages had drifted from SDK 57.0.7 expectations. Committed.
- `npx expo run:ios` initially failed: Xcode 26.3 / Swift 6.2.4 rejects an `abs()` call in expo-modules-jsi 57.0.3 as ambiguous, and 57.0.3 is the newest 57.x release. Patched to `.magnitude`; patch recorded in patches/expo-modules-jsi-swift62.patch.txt and MUST be re-applied after any fresh install or iOS builds break.
- Second build: BUILD SUCCEEDED, 0 errors. Atlitos.app installed on the iPhone 17 simulator as com.synthorgtech.atlitos-mobile. The Razorpay pod compiled cleanly (deprecation notices only), so the native checkout has never been closer to verifiable.

Remaining blocker, unchanged: no programmatic tap. The dev client keeps binding to the synth project's Metro server on port 8081 (that project is running concurrently on this machine), so the red error overlays seen in ios-sim-* are synth's code, not Atlitos's, confirmed by diffing the reported _layout.tsx lines against apps/mobile/src/app/_layout.tsx and by Metro on 8091 logging zero bundle requests. Redirecting the dev client needs one tap (Dismiss, then select the Atlitos server) which simctl cannot perform.

Unblock, either:
1. Founder taps Dismiss then picks the 8091 Atlitos server once, or
2. Stop the synth Metro server on 8081 so Atlitos is the only candidate, or
3. Grant the terminal Accessibility and Screen Recording in System Settings, Privacy and Security, THEN RESTART THE TERMINAL (a grant does not apply to an already-running process; screencapture still failed after the grant for this reason). cliclick is installed and would then drive the simulator unattended.

## RESOLVED: Atlitos running natively on iOS (2026-07-19, 08:48 IST)

ios-sim-atlitos-running-native.png: the real splash screen rendering in the native dev build on the iPhone 17 simulator. No Expo Go, no react-native-web.

Final fix, simpler than everything attempted before it: the expo-dev-client binds to Metro on port 8081 by default and ignores a --url launch argument once a redbox is showing. The synth project held 8081, so Atlitos on 8091 was unreachable. Founder authorised stopping synth's Metro; Atlitos's Metro was then started on 8081 and the dev client connected on its own with no deep link and no tap.

Durable rule for this machine: run the Atlitos dev server on 8081 and make sure no other Expo project holds it. To restart synth later, run npx expo start in that project on a non-default port.

Working sequence to reproduce from cold:
1. `cd apps/mobile && npx expo run:ios` (rebuild only when native deps change; re-apply patches/expo-modules-jsi-swift62.patch.txt first)
2. `npx expo start --dev-client --port 8081`
3. `xcrun simctl launch <udid> com.synthorgtech.atlitos-mobile`
4. `xcrun simctl io <udid> screenshot out.png`
