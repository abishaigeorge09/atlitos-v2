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
