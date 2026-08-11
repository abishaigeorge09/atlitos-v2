# T3 (Android compile) and T4 (Maestro harness) status at session end

Written 2026-08-11. Both T3 and T4 ran into the same root cause: this machine was under
extreme, machine-wide CPU contention for the whole session (`uptime` load averages climbed
from ~415 to ~500 while I worked, with 7+ concurrent `expo export` processes visible in `ps`
from other active worktrees/tracks). Neither result below is fabricated; both are the real,
current state with real command output behind them.

## T3, Android compile: IN PROGRESS, no errors so far, not yet complete

Sequence run:
1. `npx expo prebuild --platform android --clean` from `apps/mobile`, succeeded cleanly, exit 0.
   Log: `evidence/p5-bringup/android-prebuild.log`.
2. Wrote `apps/mobile/android/local.properties` pointing `sdk.dir` at the existing
   `~/Library/Android/sdk` (already gitignored via `/android`, not committed).
3. `JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-22.jdk/Contents/Home ./gradlew assembleDebug
   --no-daemon` from `apps/mobile/android`. JDK 17 is not installed on this machine (only 11 and
   22 via `/usr/libexec/java_home -V`); 22 was used and Gradle accepted it.

At time of writing this process (PID 89623) has been running **58+ minutes** and is still
compiling. It has, in order, successfully:
- Configured the project and resolved all Expo modules, including the three added since the
  last finished Android build named in the plan: `expo-notifications` (57.0.9),
  `@sentry/react-native` / `sentry_react-native`, and consumed `google-services.json` presence
  without error (see caveat below).
- Downloaded and installed NDK 27.0.12077973 (was missing, license auto-accepted, install
  completed).
- Compiled and assembled every third-party native module to AAR with zero errors:
  `react-native-razorpay`, `react-native-svg`, `react-native-safe-area-context`,
  `react-native-async-storage`, `react-native-masked-view`, `sentry_react-native`,
  `react-native-reanimated` (4.5.0 + worklets 0.10.2), `react-native-screens` (4.25.2),
  `react-native-gesture-handler` (3.0.2). Only Kotlin deprecation **warnings**, no errors, in any
  of them.
- Built native CMake targets for all four ABIs (`armeabi-v7a`, `x86`, `x86_64`, `arm64-v8a`) for
  `react-native-worklets`, `react-native-screens`, `expo-modules-core`, `react-native-reanimated`.

No compile error has appeared at any point. This is a strong positive signal for "does the app
compile for Android today" but I did not see `:app:assembleDebug` finish and no APK exists yet
at `apps/mobile/android/app/build/outputs/apk/debug/` as of this writing. Full running log:
`evidence/p5-bringup/android-compile.log` (snapshot, the process was still live when copied).

**Update, end of session: the background build process was killed by the harness** (task
`bwql15isf`, status `killed`) after roughly 60 minutes, having progressed as far as
`expo-modules-core:buildCMakeDebug[armeabi-v7a]` (3 of 4 ABIs' native Fabric code compiled,
zero errors at any point, `:app:assembleDebug` itself never started). No APK was produced.

**Disposition: do not report "Android compiles" as a fact.** Everything observed points toward
a clean compile (every third-party native module built across all ABIs with zero errors, only
Kotlin/C++ deprecation warnings), but the run did not reach `:app:assembleDebug` before being
killed, so this is not proven. The next agent should re-run, ideally on a machine that is not
under 400+ load average:
```
cd apps/mobile/android
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-22.jdk/Contents/Home ./gradlew assembleDebug --no-daemon
```
Gradle should resume from its build cache (`apps/mobile/android/.gradle`, `~/.gradle`), so a
re-run should be substantially faster than this cold ~60 minute attempt, most of which was spent
waiting for CPU time rather than doing new work.

### google-services.json wiring finding (not fixed, reported per scope)

`google-services.json` was copied into `apps/mobile/` (gitignored, matches the worktree
bootstrap doc) but `app.json` has no `android.googleServicesFile` key, and no
`com.google.gms.google-services` Gradle plugin was applied by prebuild (grepped
`apps/mobile/android/build.gradle` and `apps/mobile/android/app/build.gradle`, no match). The
file is present on disk but not wired into the Android build at all, so `expo-notifications`
compiles today (confirmed above) but FCM will not actually initialize from this file even before
the known FCM V1 key gap (plan's named risk). This is a config gap Track N could close
(`app.json` is in scope), but per the dispatch's explicit instruction not to touch push
credentials/signing, I'm reporting it rather than wiring it, since it's adjacent to that gate and
the plan already carries an explicit BLOCKED-EXTERNAL disposition for Android push (P5-23).

## T4, Maestro harness: BLOCKED, not completed

Attempted to boot the iPhone 16 Pro Max (`8AF6A5E2-F889-4477-8634-97B4AB5D5453`, booted
successfully), start Metro, and connect the already-installed dev client so at least one
existing flow (`.maestro/smoke-guest-home.yaml`) could be run as a harness smoke test before
attempting to author the 7 new P5-2 flows (AUTH-12, CL-15, CL-16, CH-10, CH-11, CT-01, CT-14).

Found port 8081 already bound by a live, healthy (`/status` returns `packager-status:running`)
Metro process whose argv resolves to `/Users/abishaigeorgegosula/dev/atlitos/node_modules/...`,
i.e. the **main tree**, not any worktree, not started by me. I did not kill it since I do not own
it and cannot confirm no other track depends on it.

Started my own Metro on 8083 (`export PATH`, `nohup npx expo start --port 8083 --clear`,
confirmed listening via `lsof`). The dev client's `atlitos://expo-development-client/?url=...`
deep link did briefly start bundling once ("Bundling 39%..." observed on screen) but every
subsequent screenshot showed the app back on its red error screen still requesting
`http://localhost:8081/...`, i.e. the app's baked-in/persisted dev server URL is 8081, not the
URL passed via `openurl`, and a `simctl launch` in between reset it back to that default. My own
8083 Metro log (`/tmp/atlitos-metro-8083.log`, not yet copied into evidence since it never
produced a usable result) never logged a single bundle GET despite the on-screen "Bundling 39%"
moment, meaning that moment was almost certainly the foreign 8081 process serving the same
`com.atlitos.app` bundle, not mine.

Root cause read: this machine had 7+ concurrent `expo export`/Metro-class processes running from
other active worktrees during my whole session (`ps aux | grep 'expo/bin/cli export' | wc -l` =
7, `uptime` load average 415 to 500+ on what is very likely an 8 to 12 core machine). Bundling a
4394-module app under that contention did not complete in any attempt within my session, on
either port.

**Disposition: no new Maestro flow was authored or run, per the explicit instruction not to write
flows I have not executed.** The 9 existing flows in `.maestro/` were not touched or re-verified
either, for the same reason (no working bundle to run them against).

**What the next agent needs:** either wait for the machine's other concurrent agent load to
drop, or coordinate to free port 8081 legitimately, then redo the doc's Startup steps 2 to 4 in
`docs/qa/EMULATOR-TEST-SESSION.md` (which are otherwise unchanged and were not the problem here).
Once a bundle loads, author and run the 7 P5-2 flows against the 16 Pro Max, one at a time,
verifying each before moving to the next.
