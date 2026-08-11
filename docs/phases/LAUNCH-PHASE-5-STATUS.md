# Launch Phase 5 Status: Native both-platform QA

**Status: PLANNED, not started.** Planned 2026-08-11. Base branch `phase-11/launch-p5`, cut from
`phase-11/launch-p4` @ `e9b87d3`.

Program plan: `~/.claude/plans/snappy-foraging-meadow.md` (approved). This is the **launch program's**
Phase 5, not `docs/PLAN.md`'s P5 Clutch. See D1.

## The gate, verbatim from the plan

Plan line 209:

```
- GATE: both platforms pass the native suite green + ux-critic walk; zero P0/P1 native bugs.
```

Scope lines the gate is derived against, verbatim (plan lines 206 to 208):

```
## Phase 5 - Native both-platform QA (the actual ship surface)
- **iOS:** author/run the 7 Maestro flows + the 16 EXT judgment walks on the **16 Pro Max**; fix
  native-only bugs; tap-verify FB-004; live Razorpay key smoke (success/dismiss/decline).
- **Android (front-loaded from Phase 0 for the 14-day clock):** add `android.package`
  (`com.atlitos.app`) + versionCode + intentFilters; first-ever `eas build --platform android`;
  debug the native compile (razorpay/reanimated 4.5/expo-video/svg/nativewind on Android); full
  Android-emulator QA of the parity risks (Razorpay Activity flow, aurora SVG/reanimated perf,
  KeyboardAvoidingView, hardware back / mid-payment back, ExoPlayer video, SDK-57 edge-to-edge
  safe-area = the BUG-003 class again, image-picker/camera permissions, deep links).
```

Two clauses in that text cannot be executed as written. Both are handled by a recorded amendment
(D3) and a recorded interpretation (D4) below, not by quietly softening the gate.

## Design gate check

The `docs/design/DIRECTION.md` + `## Gate 1 response` convention postdates this repo. The equivalent
gate was opened and **answered by the founder with a date and his own decision**: `PHASE-0-STATUS.md`
line 20, "Founder picked EMBER #E46136 at the token gallery, 2026-07-13; locked in packages/theme",
alongside line 12 (PRDs adopted as the working contract). The gate is held. No refusal.

## Decisions this planner makes, so builders do not each pick one

### D1. This doc is `LAUNCH-PHASE-5-STATUS.md`, not `PHASE-5-STATUS.md`

`docs/phases/PHASE-5-STATUS.md` already exists and is the **Clutch** phase from `docs/PLAN.md`
(approved 2026-07-22). The launch program re-uses the numbers 0 to 7. Overwriting it would destroy
the only record of the Clutch gate. Alternative rejected: renumber the launch program to P12 and up,
which contradicts the approved plan text every other agent reads. Cold agents: launch-program phases
are `LAUNCH-PHASE-N-*`; original build phases are `PHASE-N-*`. Launch phases 0 to 4 wrote **no**
status doc at all; their handoff lives in `.claude-resume.md`, `docs/phases/ANDROID-BOOTSTRAP.md`,
`docs/qa/SECURITY-LOCKDOWN.md`, `docs/OBSERVABILITY.md`, and `git log` on `phase-11/launch-p3|p4`.

### D2. Discovery runs parallel. Fixes run sequential. This is the file-ownership call.

Both QA tracks would otherwise write `apps/mobile/src/**`, and a safe-area bug found on Android
frequently lives in the same component as an iOS bug. Fanning two fixers onto one source tree buys
merge conflicts at roughly fifteen times conversation cost.

So: **Track I and Track A are read-only on all source.** They drive devices, run flows, and write
evidence plus a findings file each. **Track F is the single writer of `apps/mobile/src/**`**, works
from those two findings files, and re-verifies each fix on both devices (both are free by then).
Alternative rejected: give iOS fix rights and Android none, which is asymmetric and leaves Android
fixes homeless.

### D3. Razorpay smoke uses the TEST key. The live-key clause is amended, not dropped.

The plan says "live Razorpay key smoke". The live key is **externally blocked**: Route KYC is with
Razorpay support, ticket 20324138, 4 to 8 business hour SLA at filing. Blocking six days of native QA
on a support queue is the failure mode the P3 gate amendment already taught this build.

Phase 5 smokes success, dismiss, and decline on **both** platforms against
`EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_TCwxkMaUz54BPH`, already in `eas.json` production env. The
native sheet, the Activity return path, and the cancel/error mapping are what Phase 5 is actually
testing; those are key-independent.

**The live-key smoke is re-homed to Phase 7 and is BLOCKING there.** It must run on a real
`rzp_live_` build before any store Submit. Approver: this amendment needs your acknowledgment at the
gate. If you reject it, Phase 5 cannot close and the re-cut is to split Phase 5 into 5a (native QA,
test key) and 5b (live-key smoke, gated on the founder).

### D4. "The 16 EXT judgment walks on the 16 Pro Max" means the 9 that are native surfaces

`docs/qa/TEST-CATALOG.md`'s EXT lane is 16 cases, and **8 of them are Court Partner Portal, Life/UPA
Portal, Admin, or edge-function cases** that have no native surface and cannot run on a phone. The
gate says "native suite". Faithful reading, not narrowing.

**In Phase 5 (native, both platforms):** CL-13, CL-17, CH-12, CT-12, CO-12, CO-13, SH-10, EM-14,
XP-06. Note CL-17 / CT-12 / CO-12 / CO-13 / SH-10 / EM-14 were catalogued against
`atlitos-app.vercel.app`, which is being taken dark under the native-only decision, so the device
**is** their surface now. CH-12 was catalogued as "MISSING if unspecced"; Phase 4 shipped
report/block, so it is now executable.

**NOT in Phase 5, and owed elsewhere so they are not dropped:** CT-09, CT-13, CT-18, EM-09, EM-12,
EM-13, AD-08 (portal/admin walks) and SR-06 (ai-search edge). Re-home to the Phase 6 web/portal lane.

### D5. Android target is a new `Pixel_8_API_35` AVD, tested under both navigation modes

Only `Pixel_Fold_API_35` exists locally. A foldable is neither the store-screenshot geometry nor a
representative phone; edge-to-edge and KeyboardAvoidingView bugs read differently on it. Create
`Pixel_8_API_35` from `system-images/android-35/google_apis/arm64-v8a` (present, no download).
API 35 is Android 15, where **edge-to-edge is enforced** and the BUG-003 class reproduces.
Run the edge-to-edge, back-button, and safe-area clauses under **gesture nav AND 3-button nav**;
they behave differently and only one of them is the emulator default.

### D6. The `development` and `preview` EAS profiles must get the env block before any build

`eas.json` puts `EXPO_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `RAZORPAY_KEY_ID` / `SENTRY_DSN` only under
`build.production.env`. `development` and `preview` have none, and `apps/mobile/.env` is gitignored
and therefore absent from any EAS upload and from any fresh worktree. This is exactly the class that
crashed TestFlight build 7 (`supabase.ts` throws at init on empty env). A dev-client Android build
made today would install and crash on open, and the crash would be read as an Android native bug.
Track N adds the same env block to both profiles as its first commit.

### D7. Metro ports are fixed per track: iOS 8081, Android 8082

One Metro per worktree so each track runs its own tree. Android emulator reaches the host with
`adb reverse tcp:8082 tcp:8082`. Launch Metro detached with `nohup ... & disown` per
`docs/qa/EMULATOR-TEST-SESSION.md` step 2; a plain background job gets killed mid-session.

### D8. Phase 5 has no migration budget

Latest applied migration is `0097_report_block.sql`. A QA phase that needs a schema change has found
a Phase 4 escape, and that is an escalation, not a quiet migration. If the approver rules one
unavoidable, **Track F owns `0098` to `0099` exclusively**. No other track may create a migration.

### D9. Prune the 12 stale worktrees before spawning any new one

`git worktree list` shows 14 entries, 12 of them finished p3/p4/observability agents, plus one
prunable `/private/tmp` entry. They are on the same volume as the Android build output and 95 GB is
the free-space headroom. `git worktree prune` then remove the merged `.claude/worktrees/agent-*`
directories. Stage 0.

### D10. `expo-updates` stays out

The plan lists it under launch Phase 0 and it never landed (`app.json` plugins has no
`expo-updates`). Adding an OTA channel mid-QA changes what the device is running. Out of Phase 5 by
PRD-ceiling discipline; flagged to Phase 6 as carried Phase 0 debt.

## Worktree bootstrap trap, read this before spawning any builder

`git worktree` gives a clean checkout with **no untracked and no gitignored files**. Missing in every
fresh worktree and required to build or run mobile:

- `apps/mobile/.env`
- `apps/mobile/google-services.json` (Android FCM, currently untracked in the main tree)
- `apps/mobile/google-service-account.json` (gitignored, Play submit only, not needed for Phase 5)
- `node_modules` at root and per app, plus `apps/mobile/ios` and `apps/mobile/android` (both
  gitignored, both regenerated by prebuild)

Every builder prompt carries: copy the three files from `/Users/abishaigeorgegosula/dev/atlitos/`,
run `pnpm install`, then `git merge phase-11/launch-p5 --no-edit` as step 0 (the stale-base lesson
from the original P5).

## Scope, every item traced

Ids are `P5-n`, matching the launch program's existing `P0-4` / `P1-1` / `CT-1` convention. Tracker
agent files these as `AT` stories (project key is **AT**, board 67, **no In Review status**, leave
tickets In Progress with an implementation comment).

| id | item | traces to |
|---|---|---|
| P5-1 | Boot 16 Pro Max `8AF6A5E2-F889-4477-8634-97B4AB5D5453`, install dev client, Metro 8081, make default; update `EMULATOR-TEST-SESSION.md` + `reference_ios_simulator` memory to name it primary, iPhone 17 fallback | plan line 155 |
| P5-2 | Author the 7 Maestro flows: AUTH-12, CL-15, CL-16, CH-10, CH-11, CT-01, CT-14 | plan 207, TEST-CATALOG MAESTRO lane |
| P5-3 | Run the 7 flows green on iOS | plan 207 |
| P5-4 | The 9 native EXT judgment walks on iOS (D4) | plan 207, D4 |
| P5-5 | Razorpay TEST-key smoke on iOS: success, dismiss, decline | plan 207, D3, P4 advisory "native failure path unverified" |
| P5-6 | Tap-verify FB-004 (profile own-clip IG viewer, playback + layout) | plan 207, FOUNDER-REVIEW.md FB-004 |
| P5-7 | AT-64: verify the 10 money-consequential `Alert.alert` call sites fire on both natives | carried P4/P8 advisory |
| P5-8 | iOS native-only bug fixes | plan 207 |
| P5-9 | Android config: `android.package` (present), versionCode via EAS remote (no manual entry), verify the generated `AndroidManifest.xml` carries the `atlitos://` VIEW/BROWSABLE filter; add explicit `intentFilters` only if absent | plan 208, ANDROID-BOOTSTRAP.md |
| P5-10 | Android build from the **current** head (dev client + preview APK). The existing FINISHED APK predates launch Phases 3 and 4 | plan 208, ANDROID-BOOTSTRAP.md |
| P5-11 | Debug the native compile: razorpay-checkout, reanimated 4.5 + worklets 0.10.2, expo-video, react-native-svg 15, nativewind, **plus expo-notifications, @sentry/react-native, google-services** (all three added after the compile-green build) | plan 208 |
| P5-12 | Razorpay Activity flow on Android: sheet launches, result returns to `RazorpayCheckout.open()`, `RazorpayCheckoutCancelledError` maps the same as iOS swipe-dismiss | plan 208 |
| P5-13 | Aurora SVG + reanimated render and perf on a real Android render | plan 208 |
| P5-14 | `KeyboardAvoidingView` on every form screen: auth, onboarding steps, checkout, chat input | plan 208 |
| P5-15 | Hardware back, incl. **mid-payment**, under gesture nav and 3-button nav | plan 208, D5 |
| P5-16 | ExoPlayer playback: clutch feed autoplay/paging, trainee review, codec, buffering, audio focus | plan 208 |
| P5-17 | SDK 57 edge-to-edge safe-area sweep, the BUG-003 class on Android; include the three known sheets (`LoginGateSheet`, `ConfirmSheet`, `GroupMembersSheet`) | plan 208, BUG-003/007/008 |
| P5-18 | image-picker camera/photos/mic runtime permission prompts appear, and **denial is handled**, in clutch upload and both onboarding avatar steps | plan 208 |
| P5-19 | Deep links `atlitos://` from cold start, background, and `adb shell am start -a android.intent.action.VIEW -d` | plan 208 |
| P5-20 | Android location permission variants, incl. "only this time" and denial, on courts-near-me | ANDROID-BOOTSTRAP.md |
| P5-21 | Run the 7 Maestro flows green on Android | plan 209 "both platforms" |
| P5-22 | Android native-only bug fixes | plan 208 |
| P5-23 | Push delivery on device, both platforms (**Android conditional, see risks**) | launch P4 gate carry |
| P5-24 | ux-critic walk, both platforms | plan 209 |
| P5-25 | Findings consolidated into `docs/qa/BUG-LEDGER.md`; zero P0/P1 native bugs open | plan 209 |

## File ownership map

Paths are relative to `/Users/abishaigeorgegosula/dev/atlitos`. **The sets below are disjoint by
construction. Any track that needs to write outside its OWNS list files a finding instead.**

### Track N, native bring-up and harness. Sonnet. Sequential, FIRST, blocking.

Sonnet because this is native build config and YAML authoring: real debugging judgment on a Gradle
or EAS failure, but no money, schema, or RLS blast radius. Haiku would stall on a build log.

- **OWNS:** `apps/mobile/app.json` · `apps/mobile/eas.json` · `apps/mobile/package.json` ·
  `pnpm-lock.yaml` · `patches/**` · `.maestro/**` · `docs/qa/EMULATOR-TEST-SESSION.md` ·
  `docs/phases/evidence/p5-bringup/**`
- **MUST NOT TOUCH:** `apps/mobile/src/**` · `packages/**` · `supabase/**` · `apps/portal-court/**` ·
  `apps/portal-life/**` · `apps/admin/**` · `apps/landing/**` · `docs/qa/BUG-LEDGER.md` ·
  `docs/qa/P5-*-FINDINGS.md`
- **Stage N1:** D6 env block · P5-1 · P5-9 · P5-10 · P5-11 · create `Pixel_8_API_35` (D5) · install
  both dev clients · Metro 8081 and 8082 up (D7)
- **Stage N2:** P5-2, the 7 flows, selector-debugged on the 16 Pro Max. Authored **once**, in this
  track, so the two QA tracks do not race on `.maestro/`

### Track I, iOS native QA. Sonnet. Parallel with A. Worktree.

Sonnet: judgment walks and flow execution, writes no source.

- **OWNS:** `docs/phases/evidence/p5-ios/**` · `docs/qa/P5-IOS-FINDINGS.md`
- **MUST NOT TOUCH:** everything else in the repo. Read-only on `apps/**`, `packages/**`,
  `.maestro/**`, `supabase/**`
- **Deliverables:** P5-3 · P5-4 · P5-5 · P5-6 · P5-7 (iOS half) · P5-23 (iOS half). Every finding
  gets a severity, a repro, and a screenshot path
- **Device:** iPhone 16 Pro Max `8AF6A5E2-F889-4477-8634-97B4AB5D5453`, Metro **8081**

### Track A, Android native QA. Sonnet. Parallel with I. Worktree.

Sonnet: first-ever Android runtime debugging plus judgment walks, writes no source.

- **OWNS:** `docs/phases/evidence/p5-android/**` · `docs/qa/P5-ANDROID-FINDINGS.md` ·
  `.maestro/android/**` (Android-only flows: hardware back, permission dialogs. The 7 shared flows
  are read-only here; a needed platform guard is filed, not edited)
- **MUST NOT TOUCH:** everything else. Read-only on `apps/**`, `packages/**`, `.maestro/*.yaml`,
  `supabase/**`
- **Deliverables:** P5-12 through P5-21 · P5-7 (Android half) · P5-23 (Android half)
- **Device:** `Pixel_8_API_35` emulator, Metro **8082**, `adb reverse tcp:8082 tcp:8082`

### Track F, native fix pass. Sonnet, with Opus on the money path. Sequential, AFTER I and A.

Sonnet for layout, safe-area, keyboard, permission, and playback fixes. **Opus for any fix touching
`apps/mobile/src/lib/razorpay-checkout*.ts`, any checkout or payment screen, `BillSummary`, or a
`packages/theme` primitive**: money-adjacent and shared-primitive changes are the highest blast
radius per CLAUDE.md's tiering rule. Split the track at that boundary if the fix list warrants it.

- **OWNS:** `apps/mobile/src/**` · `packages/ui-native/**` · `packages/theme/**` ·
  `docs/qa/BUG-LEDGER.md` · `docs/design/DESIGN-LANGUAGE.md` ·
  `docs/phases/evidence/p5-fixes/**` · `supabase/migrations/0098*`, `0099*` (only under D8)
- **MUST NOT TOUCH:** `apps/mobile/app.json` · `apps/mobile/eas.json` · `.maestro/**` ·
  `docs/qa/P5-*-FINDINGS.md` (read-only input) · `apps/portal-*/**` · `apps/admin/**` ·
  `apps/landing/**` · `supabase/functions/**`
- **Deliverables:** P5-8 · P5-22 · P5-25. Each fix re-verified on **both** devices, and each fix
  swept for its class per CLAUDE.md (BUG-003 produced BUG-007 and BUG-008 exactly this way)

### Config findings from Track F

If a fix needs `app.json` or `eas.json`, Track F writes the exact required diff into its findings
section and the **integrator applies all config changes in one serialized commit** at merge, then
re-runs the specific flow that proved the bug. No track ever edits a config file it does not own.

### Overlap check

`{N} ∩ {I} = ∅` · `{N} ∩ {A} = ∅` · `{I} ∩ {A} = ∅` · `{F} ∩ {N} = ∅` · `{F}` runs after `{I}` and
`{A}` are complete. **I and A may run in parallel, each in its own worktree.** N and F are
sequential because they hold the two write-heavy sets.

## Dependency order

```
Stage 0  orchestrator + Haiku
         commit pending main-tree changes (app.json, landing pages, .vercelignore,
         google-services.json) onto phase-11/launch-p5; git worktree prune (D9); cut the branch
   |
Stage 1  Track N  N1 config + builds + devices  ->  N2 the 7 Maestro flows      [BLOCKING]
   |
Stage 2  Track I  ||  Track A          two worktrees, disjoint, read-only on source
   |
Stage 3  Track F  single writer of apps/mobile/src/**, re-verify on both devices
   |
Stage 4  integrator (merge, pnpm turbo typecheck build lint, batched config commit)
         -> dod-auditor (Opus, EXECUTES each P5-n)
         -> ux-critic (P5-24, both platforms)
         -> approver (Opus, re-derives the verbatim gate + rules on the D3 amendment)
```

Nothing in Stage 2 may start until N2 reports the 7 flows authored and at least smoke-running,
otherwise Track A has no flows to run and the two tracks race on `.maestro/`.

## Risks and blockers, named now

- **Android push (P5-23) may be untestable.** The FCM V1 service-account key has not been uploaded
  via `eas credentials`; that step is a founder gate in the infra checklist (item 7).
  `google-services.json` being present is necessary, not sufficient. **Clause disposition:** if the
  key is not uploaded when Track A reaches it, P5-23 Android is recorded BLOCKED-EXTERNAL with the
  evidence that the client registers a token correctly, and delivery is re-homed to Phase 7
  pre-submit. iOS push is testable now: the Team-Scoped Expo push keys already cover
  `com.atlitos.app`.
- **Razorpay live key.** D3. Ticket 20324138.
- **The 12 stale worktrees plus an Android build compete for 95 GB.** D9 first. Prefer EAS cloud
  builds over `expo run:android` to keep build output off this disk; fall back to local only for
  fast fix-iteration in Stage 3.
- **A green Gradle compile is not a green runtime.** ANDROID-BOOTSTRAP.md line 80 says so explicitly.
  Do not let "the APK built" stand in for any P5-12 to P5-20 clause.
- **`expo-modules-jsi` patch is iOS-only** and deliberately has no Android analogue
  (ANDROID-BOOTSTRAP.md). Do not "fix" its absence.

## Can this phase meet its gate as scoped

Yes, with the two recorded adjustments (D3 live key, D4 EXT lane) and with P5-23 Android carrying an
explicit external-block disposition. If the approver rejects D3, the re-cut is 5a/5b as stated there.
No other clause is at risk of being unmeetable.

## Handoff owed at phase close

Open native defects with severity and home; the D3 live-key item written as a **blocking Phase 7
pre-submit clause**; the 8 non-native EXT walks written into the Phase 6 lane; the Android push
disposition; Phase 0 carry-overs still open (`expo-updates`, athlete web not yet dark); and whether
the 6.7" store screenshots for Phase 6 were captured from the 16 Pro Max during this phase, since the
device is already booted and the padding-to-under-2:1 rule for the Android set is recorded in
ANDROID-BOOTSTRAP.md.
