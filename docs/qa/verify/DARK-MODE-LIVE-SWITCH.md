# Live appearance switch: the device test for the apply-theme.ts fix

Written 2026-08-14 by the agent that made the fix, which CANNOT run it: a worktree has no device,
and a screenshot only means anything on the INTEGRATED tree. This file exists so the fix is
falsifiable by someone else rather than asserted by me.

Fix under test: `apps/mobile/src/lib/apply-theme.ts`, two functional lines, platform-gating the
`'system'` workaround so native no longer pins its own appearance. Background, mechanism and the
class sweep are in `docs/qa/CURRENT-STATE.md` (DISPROVEN section, "Live dark mode was NOT broken
by the p6 merge").

## The one rule that makes this test worth running

**A relaunch under dark was ALREADY passing before the fix.** So a green taken after a relaunch
proves nothing at all, and would be the tenth environmental-failure-as-product-bug on this
project. The ONLY capture that carries information is one taken with the app foregrounded and
never relaunched across the appearance change. Do not restart the app between steps 4 and 6.

## Preconditions

- Release build, bundle embedded. Prove it, do not assume it:
  `ls "$APP/main.jsbundle"` must exist inside the `.app`. "No Metro running" is NOT proof.
- iPhone 16 Pro Max, `8AF6A5E2-F889-4477-8634-97B4AB5D5453`.
- Load average under 25. Refuse to run above it.
- Signed in as a user whose `users.theme` is `system` or NULL, or a guest. An explicit
  `light`/`dark` preference pins on purpose and is not what this tests. Confirm read-only:
  `select id, theme from users where id = '<uid>';`

## Procedure

    UDID=8AF6A5E2-F889-4477-8634-97B4AB5D5453

    # 1. Known starting point, cold, in light.
    xcrun simctl ui $UDID appearance light
    xcrun simctl terminate $UDID com.atlitos.app
    xcrun simctl launch $UDID com.atlitos.app

    # 2. Navigate to a screen that renders BOTH color systems. The athlete
    #    Profile tab is the right one: its Edit profile / Settings pills are
    #    Tailwind-class driven, and its body text comes from useThemeColors().
    #    A screen that only uses one system cannot distinguish the two failure
    #    modes and will mislead you.

    # 3. Baseline.
    xcrun simctl io $UDID screenshot /tmp/dark-01-light-cold.png

    # 4. THE TEST. App stays foregrounded. No terminate, no launch.
    xcrun simctl ui $UDID appearance dark
    sleep 2
    xcrun simctl io $UDID screenshot /tmp/dark-02-dark-live.png

    # 5. Back again, still foregrounded, to catch a one-way listener.
    xcrun simctl ui $UDID appearance light
    sleep 2
    xcrun simctl io $UDID screenshot /tmp/dark-03-light-live.png

    # 6. Control. Only NOW is a relaunch allowed.
    xcrun simctl ui $UDID appearance dark
    xcrun simctl terminate $UDID com.atlitos.app
    xcrun simctl launch $UDID com.atlitos.app
    xcrun simctl io $UDID screenshot /tmp/dark-04-dark-cold.png

## PASS

All four hold. Fewer than all four is not a pass.

1. `dark-02-dark-live.png` is a dark screen: dark page background, light ink.
2. `dark-02-dark-live.png` is visually equivalent to the `dark-04-dark-cold.png` control. This is
   the assertion that actually matters, and it is why the control is taken. "Looks darker than
   before" is not it.
3. `dark-03-light-live.png` returns to light, matching `dark-01-light-cold.png`. A listener that
   fires once and then detaches passes 1 and 2 and fails here.
4. In `dark-02-dark-live.png` the Tailwind-class chrome and the `useThemeColors()` text agree.
   Specifically: no light pill with light ink, and no near-black text on a near-black card. A
   split here means the web and native paths have been crossed again and is a DIFFERENT bug from
   the one being fixed, so report it separately rather than calling the whole thing failed.

## FAIL, and what each failure means

- `dark-02` indistinguishable from `dark-01` while `dark-04` is correctly dark: **the fix did not
  work.** This is the exact original symptom, unchanged. Next step is to check whether the build
  actually contains the fix before theorising, because a stale bundle produces precisely this.
  `grep -c "Platform.OS === 'web'" apps/mobile/src/lib/apply-theme.ts` on the tree that was built,
  then confirm the `.app`'s bundle is newer than the source file.
- `dark-02` correct but `dark-03` stuck dark: the override is being cleared in one direction only.
  Real bug, narrower than the original.
- `dark-04` (the control) NOT dark: stop. The test is invalid, and this is an environment problem,
  not a product one. Do not file anything from runs 02 or 03. Check the device really is the one
  being screenshotted, that no system dialog holds focus, and that the user's `theme` is not an
  explicit `light`.
- Any capture showing a redbox: environment. Discard the whole run.

## Android

The same defect exists on Android by the same mechanism
(`AppearanceModule.kt:85`, `AppCompatDelegate.setDefaultNightMode`), so this is not an iOS-only
fix and a green on iOS alone does not cover it. On Pixel_7_API_35 substitute
`adb shell "cmd uimode night yes"` and `night no` for the `simctl ui` calls, keeping the
foregrounded-throughout rule identical.

## Maestro

No flow asserts appearance, so Maestro adds nothing here and its green would be misleading. The
screenshot A/B above IS the test. Existing flows should still be run per the standing rule, pinned
with `--udid`, to confirm no regression, but they are not evidence about this fix.
