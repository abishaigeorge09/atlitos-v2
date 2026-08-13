# Atlitos: current state, what is proven, what is not

Last updated 2026-08-13.

## How to use this document

Read this BEFORE investigating anything. It exists because five separate agents independently
investigated the same Clutch bug and four of them reached wrong conclusions, each starting cold
without the previous findings. Rediscovery is the single largest waste on this project.

Three rules for anyone editing it:

1. **A finding without evidence is not a finding.** Cite a file and line, a command output, or a
   query result. "It should work" is not a result.
2. **Record what was DISPROVEN, not just what is true.** The disproven section below is the most
   valuable part of this file. It is what stops the next agent repeating a dead end.
3. **Environmental failures have masqueraded as product bugs EIGHT times here.** Before filing any
   failure, open the screenshot and rule out a stale build, a wrong device, a redbox, and a system
   dialog holding accessibility focus.

---

## Founder decisions

| Date | Decision |
|---|---|
| 2026-08-13 | Coach scope: build the FULL creation layer, including 1:1 session start and membership reminders. |
| 2026-08-13 | Clip controls: delete your own clip, plus comments off per clip. NOT a full audience model. |
| 2026-08-13 | No money-UI test automation. The founder is satisfied the payment path works. |
| 2026-08-13 | Date of birth off signup, collected on the profile instead. SHIPPED. |
| 2026-08-13 | Landing subscription tiers removed. Restore only when a real purchasable plan exists. |
| 2026-08-12 | Google and Apple sign-in stay in Phase 8, AFTER store submission. |
| 2026-08-12 | Razorpay account migration happens BEFORE store submission. |

---

## PROVEN, with evidence

### Native builds and the Android crash
- **Android builds.** Release APK, 250.9 MB, all four ABIs, with Sentry, reanimated, worklets and
  expo-modules-core native libs present.
- **iOS builds.** Release with `main.jsbundle` embedded, 9.65 MB, verified by inspecting the .app
  rather than by "no Metro running", which is NOT valid proof because `expo run:ios` starts its own.
- **The Clutch OOM crash is FIXED and independently re-verified on device.** Home Dalvik went from
  163 MB to 30 MB. Tapping Clutch previously killed the process; it now survives, plus 15 rapid
  swipes and 10 tab cycles, with ZERO OutOfMemory from the app.
  Cause: `expo-video`'s Android `maxBufferBytes` defaults to 0, which media3 reads as unset and
  answers with a 125 MB buffer taken from the JAVA heap. Home mounted one such player because
  `ClutchPreviewCard` passes `active={false}` but left `mountPlayer` at its true default.
  Fix in `apps/mobile/src/lib/video-buffer.ts`, applied at all three `useVideoPlayer` call sites.
  `android:largeHeap` was deliberately NOT used.
- **Android hardware BACK works.** Both the portal-overlay dismiss and the tab-back behaviour
  verified on device with Maestro, not just typechecked.

### Test suite
- Maestro: **13 pass, 1 fail, 1 not executed.** The single failure is a real bug left correctly red.
  The not-executed flow (`groups-coach`) requires a Postgres reset between runs, which the DB write
  gate forbids; its data was verified clean by read-only SQL instead.
- `pnpm turbo typecheck` 12/12, `build` 7/7, `lint` 8/8.

### Chat
- Chat renders and works on native. Verified by re-running `groups-athlete.yaml` after the data
  pollution was cleared: login, trainings, My groups, Cric Squad found without scrolling, thread
  rows, sender names, previews, member counts.

### Landing and legal
- `/`, `/privacy`, `/terms`, `/support`, `/delete-account` all return 200 on www.atlitos.com.
  `/support` and `/terms` were 404 before 2026-08-13 and both stores require them.
- The privacy policy now discloses phone number and Sentry, which it previously omitted. A privacy
  policy that does not match the Data Safety form is a known Play takedown shape.

---

### Two build traps that each cost a full cycle, 2026-08-22

**1. `expo run:ios` exits 1 AFTER a successful build.** The failure is the launch step:
`osascript -e tell app "System Events" to count processes whose name is "Simulator"`
exits non-zero without the automation permission. The compile is fine. Do NOT read a
non-zero exit as a broken build. Grep the log for `Succeeded` and install by hand:
`xcrun simctl install <udid> <DerivedData>/Release-iphonesimulator/Atlitos.app`.

**2. Grepping that log for "Build Succeeded" ALWAYS RETURNS ZERO.** Xcodebuild's pretty
printer puts ANSI codes between the words, so the literal string is never present. Strip
first: `tr -cd '\11\12\15\40-\176' < log | sed 's/\[[0-9;]*m//g'`. This produced a
false "the build failed" reading before the real cause was found.

**3. The Sentry debug-symbols phase fails a local Release build.** `ios/sentry.properties`
carries no org or project and falls back to `SENTRY_ORG` / `SENTRY_PROJECT` /
`SENTRY_AUTH_TOKEN`, which are not set locally, so `sentry-cli` errors with "An
organization ID or slug is required" and the build stops. Export
`SENTRY_DISABLE_AUTO_UPLOAD=true` for local QA builds. Do not edit the project file.

### The coach dashboard header row is clean at 393pt, and the sweep found a real bug next to it

Proven 2026-08-22 on atlitos-390 (iPhone 16, 393pt), Release build, exit 0. Screenshot:
`~/.maestro/tests/2026-08-22_172356/coach-dash-header-393/takeScreenshot/tmp/header393/01-coach-dash-393.png`

`(shell)/index.tsx:419` once put "Upcoming sessions" plus three sm text buttons in one
`flex-row` with no wrap and no `flexShrink`. The two-row plus `flexWrap` fix HOLDS: the
heading sits on its own line and all three links render in full with margin to spare.
A peer session had proven this at 440pt and correctly refused to call it clean, because
440pt is not the width that overflows. It is now backed at the width that does.

TWO THINGS THIS COST, WORTH KEEPING:

1. **Maestro drives that device with `--udid`, not `--device`.** The peer was blocked for
   a full session believing the device could not be driven. It can.
2. **THE SCREENSHOT FOUND A BUG EVERY ASSERTION MISSED.** All eight `assertVisible` calls
   passed while "Sessions this month" and "Earnings this month" ran flush into their icons
   with zero gap. `StatTile` (`components/ui/stat-tile.tsx:28`) had the SAME SHAPE as the
   header bug it was sitting under: a `justify-between` row, a label that cannot shrink, no
   gap. This is exactly why the house rule says open the screenshot. An assertion cannot
   tell wrapped from clipped from collided; it only knows the node exists.

Swept the class rather than fixing the instance. 13 rows share the shape. Most pair short
static copy and are fine. Four carried UNBOUNDED USER DATA and were fixed:
`stat-tile.tsx` (label vs icon, the proven one), `coach-card.tsx` `{name}`,
`session-card.tsx` `{personName}`, `GroupMembersSheet.tsx` `{groupName}`.
`ChatThreadList.tsx` `{title}` was CHECKED AND DELIBERATELY LEFT ALONE: it is "Messages"
or absent, never unbounded. Shape alone is not a bug, and a cosmetic edit to a row that
cannot break is how a sweep turns into noise.

### A whole afternoon of device QA ran against PRODUCTION while I believed it was local

2026-08-23. The worst kind of error: everything reported green, nothing lied, and
nothing was checked.

THE MECHANISM. I grepped a built bundle once to confirm its backend:

    grep -aoE "https://[a-z]+\.supabase\.co|http://127\.0\.0\.1:54321" main.jsbundle

That character class `[a-z]` CANNOT MATCH a real Supabase project ref, because
refs contain digits and `syzzfgaudpifwvbpycyi` is matched only if digits are
allowed. The production URL was sitting in the bundle the whole time. The grep
found only the local URL (present as an unrelated default), I read the absence
of a production hit as PROOF OF LOCAL, and wrote "the Release build embeds
http://127.0.0.1:54321, good, safe" into the record and into a message to a
peer session. Every device run after that was pointed at production.

WHAT IT COST, honestly accounted:
  - No destructive write. Verified after the fact on production:
    `Deleted user` tombstones = 0, and the deletion RPCs are not even deployed
    there, so the one destructive screen refused on arrival.
  - The only writes were AUTH SIGN INS for demo accounts. player@atlitos.dev
    carries a last_sign_in_at stamped at the exact time of my flow runs.
  - One invented bug. The delete account screen showed "Could not find the
    function public.account_deletion_preview without parameters in the schema
    cache". I chased it through four wrong hypotheses (stale PostgREST cache,
    missing EXECUTE grant, POST body shape, GET vs POST volatility), each
    disproved by curl against the LOCAL stack where every calling convention
    returned 200. The screen was right and I was wrong: it was PRODUCTION
    correctly reporting that 0098 is not applied there.
  - The 393pt layout proof is still valid, and is arguably better evidence for
    having run on real production strings and values.

That was luck, not design. The luck is why this entry exists.

THE GENERAL LESSON, which is bigger than this project:
**A grep that finds nothing is not evidence of absence until the pattern has
been shown to match something.** Negative test the check itself. This is the
second time the same shape has bitten this repo: `git grep -E` ignoring `\b`
made guard greps pass while violations sat in the tree.

THE FIX. `scripts/assert-build-target.sh` reports which project a built .app
talks to and fails when it is not the one you expected. It SELF TESTS ITS OWN
PATTERN first and refuses to report a clean result if it cannot match a string
known to be present, which is precisely the failure above. Born red against the
production build (exit 1), and proven able to pass (exit 0 with
`production` expected), so it is not a check that only ever fails.

    bash scripts/assert-build-target.sh <path-to-.app> local

RUN IT BEFORE EVERY QA FLOW. `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` set in the build environment take precedence
over `apps/mobile/.env`, which holds production and is the default any plain
`npx expo run:ios` will pick up.

### The two lines were reconciled on 2026-09-14. Read this before touching origin/main.

Prasanth pushed 11 commits to origin/main on 7 September, branched from the main of
29 July, because the 275 August commits were never pushed. He rebuilt several things that
already existed here. A plain merge produced 26 conflicting files and EIGHT duplicate
migration numbers (his 0088 to 0095 against different local files at the same numbers).

Production was checked and is unchanged: 109 migrations, no delete_my_account, no
user_blocks table. So THIS branch is what production runs, and his commits were fitted
onto it by cherry pick on `integration/p6-reconciled`, not merged.

TAKEN (in whole or part): gitignore; court earnings fix; iOS permission strings and
privacy manifest (his duplicate expo-image-picker entry dropped because the app does call
launchCameraAsync); content-policy.html and legal.css; the UI defect fixes minus a 150 km
courts radius that would empty the tab for a reviewer abroad; react-hooks lint with the
glob widened to .ts so packages/api is actually linted; his blocked accounts screen, a drop
in onto the local clutch.blockedUsers() API; the notifications channel leak fix; his
AppErrorBoundary, made to report to Sentry because nested inside Sentry.ErrorBoundary it
would otherwise swallow every crash; check-release-config.sh born red against the test key
and the eas.json env block removed; his QA reports and the 7 SEC test cases.

NOT TAKEN, deliberately: every migration he wrote (all collide or re-implement functions
production already holds in this branch's form); his edit to 0027, which is applied in
production; his delete-account edge function and report RPCs (local 0097 and 0098 are the
ones in production); his privacy.html and terms.html (fuller drafts, but carrying five
unsettled REVIEW decisions and no Sentry disclosure, while the local pages are live and
complete); his edge function edits from SEC-F1 to F11 (written against his schema, logged
for review); a per tile thumbnail mint (the batch poster endpoint covers it); a cart badge
that fetched the whole cart on every Home focus.

FOR PRASANTH: compare docs/qa/SECURITY-REMEDIATION-2026-09-04.md against
docs/qa/SECURITY-LOCKDOWN.md and re-apply on this base anything the local lockdown does
not already cover. His fuller privacy and terms drafts are worth a lawyer's pass; they
live at origin/main bd0ba6c. Branch from integration/p6-reconciled from now on.

## DISPROVEN. Read this before theorising.

### The Clutch "static" is NOT a rendering bug
Five explanations were proposed. **All five were wrong**, including two of mine.

| Claim | Why it is wrong |
|---|---|
| iOS Simulator expo-video decode limitation | Reproduces on Android too |
| Android only, Media3 heavier than AVPlayer | Reproduces on iOS too |
| Memory pressure | Persists with `mountPlayer={false}`, no player mounted, zero OOM |
| The seed thumbnails are raw random bytes | They are valid JPEGs, 49 KB to 649 KB |
| The fixture JPEGs are valid but their CONTENT is noise | Partly right, but I sampled the WRONG CLIP |

**The actual answer.** I fetched the assets for clip `6d0a88b3` ("Hi"), found clean ffmpeg colour
bars, and concluded the app must be mangling good data. The clip actually failing on screen was
`b8c0c76e` ("Husband s"), whose thumbnail IS genuinely 541,379 bytes of noise with the caption and
a cyan rectangle PAINTED INTO the source image. The "diagnostic clue" I built a chroma/stride
theory on was literally drawn into the file.

Refuted three ways by the verifying agent: the clean JPEG bundled INTO the app renders perfect
colour bars under the exact geometry the poster uses; per-column mean luma across the failing card
is FLAT at 44 to 53, and six bars spanning Y 29 to 226 cannot lose all luma to a chroma-only fault;
and a positive control clip renders correctly through the identical code path.

**Lesson: sample the exact failing artifact, not a sibling.**

### There is no member-count bug
I reported "5 members" against 4 active memberships as an off-by-one. It is correct: 4 active
players PLUS the coach is 5, and `chat_thread_members` is exactly 5. The pending membership is
correctly excluded. I compared player memberships against a total that includes the coach.

### Registration is not broken
The Register screen renders, all fields work, and both cross-links navigate. The apparent failure
was a Maestro selector that false-passed on the wrong screen. There IS a real bug underneath, but
it is navigation, not registration: see below.

### "X does not exist" is only as current as the tree it was checked against
A long-lived branch drifts, and the danger is not the code conflict, which git surfaces. It is
the CONCLUSION drawn from an absence, which git cannot surface at all.

Observed 2026-08-13. Three feature branches sat 169 to 170 commits behind `phase-11/launch-p4`.
Two concrete defects followed:

1. **Silent migration collisions.** One branch numbered its five migrations 0088 to 0092 against
   a tree that appeared to stop at 0087. On the target every one of those numbers was already
   taken by a different file, including three separate `0088_*` files. Merged as authored, some
   would SILENTLY NEVER RUN. Always number above the APPLIED ceiling on the integration branch,
   not above what your branch can see.
2. **A wrong conclusion written into a docblock.** A track challenged the comment-count mismatch
   finding on the grounds that no blocking feature and no client-side filtering existed. True on
   its branch, FALSE on the target, where `0097_report_block.sql` exists and `hooks.ts` carries
   39 block references. The reasoning was sound; the tree was ten migrations stale.

**Rule: merge the integration branch INTO a stale branch before reviewing or merging it, then
re-read every conclusion drawn from what the tree CONTAINS.** An absence is evidence about the
tree you looked at, never about the tree you are merging into.

"X does not exist" is the obvious form, but the dangerous set is broader and includes
**"X is unused", "nothing calls this", "there is only one instance", and "this is dead code"**.
All of those are absences dressed as facts.

Worked example, same day. A track reported a third instance of the sheet bug in a "dead code"
`components/organisms/CommentsSheet.tsx` and proposed leaving it. Checked against the target:
the file existed at the merge base, still exists on the branch, and **`launch-p4` had already
deleted it**. It was never dead code awaiting a decision; it was already gone, and only still
present because the branch was 171 commits behind. Deleting it "as dead code" would have been
a no-op at best and, had the reasoning been applied to a file launch-p4 had KEPT and started
using, a live deletion.

**A gate that references a script that never existed.** Sixth disguise, and the most expensive,
because it invalidates months of assurance rather than one result.

`.git/hooks/pre-push` runs two security checks:

    if [ -x scripts/dod.sh ]; then ...
    if [ -x scripts/security-invariants.sh ]; then ...

NEITHER SCRIPT HAS EVER EXISTED IN ANY COMMIT. `git log --all` on both paths returns nothing.
The `[ -x ]` guard means their absence is not an error: the hook prints nothing, exits 0, and
the push proceeds. There is no `.github/` directory, so no CI catches it either.

So every "the invariants are enforced" statement on this project has been held by reviewer
attention alone. Same shape as the missing route types, one level up: the absence PASSES, and a
green from a check that never ran is indistinguishable from a green that proves something.

**Rule: a gate must be watched failing before it is believed.** Plant the violation, watch the
hook or the check go red, then fix it. See [[feedback_checks_born_red]]. Applies to hooks, CI
steps, lint rules, assertions and typechecks equally.

**FIXED 2026-08-14, branch `track/dod-security-gates`.** `scripts/dod.sh` and
`scripts/security-invariants.sh` now exist. The `[ -x ]` guard is gone: a missing or
non-executable gate script REFUSES the push instead of exiting 0. The hook itself is now
versioned at `scripts/hooks/pre-push` and installed by `scripts/install-hooks.sh`, because a gate
whose source lives only in `.git/hooks` is unreviewable and is most of how this happened.
`.github/workflows/dod.yml` runs the same scripts on every push and pull request, and reports
rather than blocks, since a private repo on the free plan cannot require a status check. That gap
is in `docs/DEBT.md` with an owner. Every check was planted, watched failing, and the plant
removed, with the real output in `docs/qa/verify/GATES-BORN-RED.md`. Three defects were found by
the planting that reading could not have found, including a pattern BSD awk silently mangled into
matching nothing across all 386 files.

**A cached green is evidence about a previous run.** Fifth disguise, and the cheapest to fall
for. A session regenerated the route types, ran `pnpm turbo typecheck`, and got 12 of 12
successful, 12 of 12 CACHED. A fully cached result says nothing whatever about the file just
regenerated; it replays a verdict reached before the change existed. Forced uncached it was
4 of 4 and genuinely enforced, which was the first real route check in the whole effort.

Turbo hashes tracked source, so a change to a route FILE does invalidate correctly. Verified by
planting a bad route against a warm cache: 11 of 12 cached, mobile re-ran, TS2820 raised. What
does NOT invalidate is a change to a gitignored generated artifact alone, because it is not in
the hash. So regenerating `.expo/types/router.d.ts` with no source change can still replay a
stale green.

**Rule: when the thing you changed is not tracked, a cached green proves nothing. Force the run.**

**A generated file is evidence about when it was generated, not about the tree.** Fourth
disguise, and it bites in BOTH directions.

`apps/mobile/.expo/types/router.d.ts` is expo-router's typed-route union, derived from the
filesystem, and `.expo/` is gitignored. On the integrated tree it produced four TS2345/TS2820
errors on `/(tabs)/trainings/session-types`, `group/edit` and `group/schedule`, while BOTH
contributing branches typechecked green in isolation. All three screens existed. The generated
file was dated 11 August, before any of the work, so real routes read as typos and TypeScript
helpfully suggested the wrong one ("Did you mean group/[id]").

Negative-tested, and the result is the part worth knowing:

    file STALE    typecheck FAILS with false errors
    file MISSING  typecheck PASSES with 0 errors
    file FRESH    typecheck PASSES correctly

So a fresh checkout or CI does not fail, it passes **because the safety net is not running at
all**. Typed routes are only enforced for someone who has generated the file, and are silently
unenforced everywhere else. Regenerate with `npx expo customize tsconfig.json` (non
interactive, idempotent) before trusting a red OR a green on route types.

**Absence of the literal string is not absence of the thing.** Third disguise, same day. An
agent found `0101`'s docblock citing policies `clip_comments_active_insert` and
`clip_comments_active_delete`, greped every migration, found nothing, and DECLINED to edit the
comment. That refusal was correct. Both policies exist on the live project and are restrictive,
created by `0096_suspend_enforcement_and_kpis.sql` inside a loop that builds the name at
runtime: `v_policy_name := r.tablename || '_active_insert';`. The literal never appears in the
repo because it is constructed, not written. Had the agent treated grep-absence as absence it
would have removed a TRUE statement on false grounds.
Anything built by string concatenation is invisible to the check we keep telling each other to
run: dynamic SQL, generated identifiers, computed policy and constraint names, `format(%I)`,
and table-driven DDL loops. When a grep comes back empty against a name that ought to exist,
query the live catalog (`pg_policy`, `pg_proc`, `information_schema`) before concluding.

A further instance, `apps/mobile/src/app/(tabs)/clutch/post/[id].tsx`, is the mirror image: the
branch's rewrite removed imports that only made sense against the old file, while launch-p4 had
rewritten the same file by 554 insertions and added 9 report/block references. Taking the
branch's side wholesale would have silently deleted the report and block feature, with a green
typecheck. That merge was ABORTED rather than hand-resolved, and handed back to its author to
re-apply on the current file.

### A forked session cannot tell inherited work from its own
A fork inherits the transcript INCLUDING tool results, so it can hold a perfectly accurate
description of the world alongside a wrong belief about who produced it. It is dangerous
EXACTLY BECAUSE the description is accurate: nothing looks wrong until the fork re-does
completed work, or "restores" something that was never broken.

"I remember receiving that output" cannot distinguish having run a command from having
inherited its result.

**The transcript cannot settle it. The environment can.** A session's own identity is not
inheritable: its job directory (`~/.claude/jobs/<id>/tmp`) and the task output paths its
agents write to (`/private/tmp/claude-501/.../<id>/tasks/`) belong to the running session, not
to the copied history. Compare that id against the one the source observed `/fork` emit and
the question is answered from both sides independently, with neither party taking the other's
word. In the 2026-08-13 case the source was `8ea01d2a` and the fork was `965f7dfa`.

**Rule: check identity, not recall.** A fork cannot distinguish inherited work from its own by
reading the transcript, because tool results are inherited too. It CAN distinguish it by
reading its own session identity, which is environment rather than memory.

This is the same failure as every other entry in this section, applied to a session's own
history rather than to a bug: reasoning off a symptom instead of checking the artifact.
Observed 2026-08-13 between this session and `atlitos-mobile-audit-fixes`. It changed no
world state, because both readings agreed on what was done and on what must not be repeated.

### The webhook was never unconfigured
An investigation concluded the production Razorpay webhook had never been set up and called it a
launch-blocking P0. `supabase secrets list` shows `RAZORPAY_WEBHOOK_SECRET` is set, and
`webhook_events` holds 9 signature-verified rows from 18 to 26 July. The inference came from repo
contents alone; the secret was set directly against the project, which leaves no trace in the repo.
**Absence of config in the tree is not evidence of absence in production.**

### Live dark mode was NOT broken by the p6 merge, and the token system was never at fault
Symptom: with the app already running, `simctl ui <udid> appearance dark` reports dark but the
captured screens are indistinguishable from light. A COLD RELAUNCH under dark renders correctly.
The device agent correctly refused to attribute this to the recent merge without an A/B. It is a
regression, but from `025d77a` (2026-08-11, "resolve system theme to concrete light/dark before
toggling dark class"), three days earlier and unrelated to the merge.

Cold-launch-correct plus live-change-broken rules OUT the palette and the token plumbing, and
`useThemeColors()` was verified reactive (it reads nativewind's `useColorScheme()`, not a
one-shot). The broken thing is that the app PINS its own appearance and then cannot observe the OS.

Mechanism, read out of the installed sources rather than inferred. `025d77a` made
`applyTheme('system')` resolve to a concrete `'light'`/`'dark'` and call `colorScheme.set()` with
it. That is right on web and actively harmful on native, because on native
`colorScheme.set(v)` calls `Appearance.setColorScheme(v)`
(`react-native-css-interop/src/runtime/native/appearance-observables.ts:32`), which is a hard OS
level override:

- iOS `RCTAppearance.mm:112` sets `window.overrideUserInterfaceStyle` on every window. The trait
  collection is then pinned, so a later system change posts no
  `RCTUserInterfaceStyleDidChangeNotification`, `appearanceChanged:` (line 130) never runs, and no
  event reaches JS. RN's JS side compounds it: `Appearance.js:96` caches the concrete value in
  `state.appearance`, and `getColorScheme()` returns that cache until an event it will never get.
- Android `AppearanceModule.kt:85` maps it to `AppCompatDelegate.setDefaultNightMode(MODE_NIGHT_NO)`,
  the same pin. So this is not iOS only.

Cold launch works because `RCTAppearance` reads the key window's real trait collection in `init`,
before anything is overridden. The manual `Appearance.addChangeListener` that `025d77a` added
cannot rescue it: it listens for the event that is no longer emitted and reads the poisoned cache.

**Fix (2 functional lines, `apps/mobile/src/lib/apply-theme.ts`): platform-gate the workaround.**
Native forwards `'system'` straight through, which nativewind maps to
`Appearance.setColorScheme('unspecified')`, clearing the iOS override and setting Android to
`MODE_NIGHT_FOLLOW_SYSTEM`, and leaves `colorSchemeObservable` undefined so `colorScheme.get()`
falls back to nativewind's own `systemColorScheme`, kept live by its Appearance and AppState
listeners. Web keeps the resolve-to-concrete workaround that fixed J54/K59 etc.

NOT device-proven, and cannot be from a worktree. The device pass must run the A/B in
`docs/qa/verify/DARK-MODE-LIVE-SWITCH.md`; a fix that only ever shows a green after a relaunch
proves nothing, because relaunch was already passing.

Class sweep, appearance domain, all call sites enumerated: `_layout.tsx:41` (the sibling D23
`dark` class toggle from the same QA batch) is already correctly `Platform.OS !== 'web'` gated and
is NOT an instance. `use-theme-colors.ts` and `AuthScene.tsx` read the reactive nativewind hook,
not a one-shot. The only two module-scope `StyleSheet.create` blocks in the app
(`(auth)/splash.tsx:182`, `AuthScene.tsx:366`) carry spacing and radii only, no color, so there is
no captured-at-import palette anywhere. `applyTheme` has exactly two callers, `_layout.tsx:113`
and `SettingsContent.tsx:171`, and both inherit the fix. One LATENT instance of the same class,
left alone deliberately: `packages/ui-native/src/ThemedText.tsx:39` defaults `mode = "light"`, a
non-reactive theme read, but it has ZERO call sites in any app, so it cannot be the observed bug.
It is flagged, not deleted: "unused" is exactly the absence-dressed-as-fact this section warns of.

---

## OPEN

### Product gaps found 2026-08-13, now being built
- **The coach has NO creation layer.** A coach who completes onboarding has ZERO `session_types`
  rows and no screen to create one. the athlete booking screen lists only `session_types` where
  `active`, so NOTHING IS BOOKABLE FROM THAT COACH. **Correction 2026-08-14:** this
  previously said `sessions.session_type_id` is NOT NULL. It is NULLABLE, verified against
  information_schema. SCHEMA.md's column table says NOT NULL and contradicts its own prose
  forty lines later; I repeated the doc rather than checking the catalog. The conclusion
  survives, the stated mechanism did not. The wizard writes pricing into `verification_requests.payload`, which nothing
  reads. `0004` promised a backfill that was never written.
- `create_training_group`, `update_training_group` and `create_group_session` all exist as RPCs
  with API wrappers and have **ZERO call sites**. Attendance and start-session screens are fully
  built and unreachable.
- **No notification fires on ANY session transition.** Nobody is told a session started.
- **An active membership never becomes lapsed.** No `cron.schedule` call exists anywhere in the repo. **Correction 2026-08-14:** that is true
  of the TREE and false of PRODUCTION, which runs `expire-stale-holds` every 5 minutes. I
  drew a conclusion about the live system from an absence in the repo, which is the exact
  failure this section exists to warn about. The
  athlete sees "Active until <past date>" forever, the Renew button is dead code, and the coach's
  screen computes lapsed client-side so the two views disagree.
- **Clip privacy does not exist.** No visibility column, and a user cannot delete their own clip:
  `revoke update, delete on public.clips from authenticated`.
- **The comments sheet cannot open.** `maxHeight: '75%'` is inert because its parent
  `KeyboardAvoidingView` has no style, so the percentage cannot resolve. It is the only place in
  the app using a native RN `Modal`, which the house rule forbids.
- **Video analysis is not being built** but six surfaces still reference it, including "My review
  videos" on the athlete dashboard which links to a screen that can never have content.
- **Clutch grid pagination is half wired, p6 integration audit 2026-08-14.** Track 1's media scale
  fix bounded `getCreatorClips`/`getMyClips` to `CLUTCH_GRID_PAGE_SIZE` (24) and gave both an
  optional `cursor` parameter (`packages/api/src/hooks.ts`), closing the API side of the
  undisclosed regression the audit found: a creator with more than 24 published clips now shows
  only 24. Neither call site passes a cursor or wires `onEndReached`
  (`apps/mobile/src/app/(tabs)/clutch/creator/[id].tsx`, `apps/mobile/src/app/(tabs)/clutch/profile.tsx`),
  so the grid still hard-stops at 24 with no way to reach older clips. NOT wired by the
  integrator: this is a screen-level UI change (FlatList state, loading-more affordance) and
  CLAUDE.md's "no UI ships unproven" rule requires a screenshot from a Release build plus a
  Maestro run before any screen change ships, both of which the integration pass was explicitly
  told not to do (no device or simulator work). Flagging for the founder/next phase rather than
  landing an unproven screen change. Founder should also decide whether 24 is right permanently,
  now that it doubles as `PLAYBACK_BATCH_MAX`.

### Known real bugs
- Auth navigation: Register to Log in to Continue as guest returned the user to Register. FIXED at
  the cause (the cross-links now `replace` instead of pushing), not yet device-verified.
- `bookings.tsx:29` omits `in_progress` from `LIVE_STATUSES`, so a started session vanishes from
  the athlete's stats.
- Comment count mismatch: the header uses `clips.comment_count` while the list subtracts blocked
  authors client-side, so a viewer who blocked someone sees "12 comments" over a list of 9.

### Infrastructure
- **Migration `0027` has tool-call XML committed into it.** The history will NOT replay from a
  clean checkout: no `db reset`, no preview branch, no disaster recovery. Production is unaffected.
  Being repaired.
- Migration `0098` (account deletion) is written and NOT applied. The `delete-account` edge
  function is not deployed.

### Production data pollution, five tables
One shared Supabase project serves dev, e2e and production with no isolation and no teardown.
- `training_groups`: 36 of 37 were e2e fixtures. CLEANED (by another session, without the agreed gate).
- Leaked auth accounts: 44 since 27 July. CLEANED.
- `clips`: **16 of 22 in the live feed are e2e fixtures.** NOT cleaned.
- `venues`: **6 of 10 are test rows.** NOT cleaned.
- `chat_threads`: **38 of 39 orphaned** by the training_groups cascade, rendering as "Group" in the
  UI. NOT cleaned.
- **The generator is still unfixed.** Cleaning without fixing it ships the same mess again.

### Store submission
Blocked on the founder: live Razorpay key (production currently ships `rzp_test_`), a demo reviewer
account (seed accounts were rotated in the Phase 1 lockdown), screenshots, content ratings, and
both privacy questionnaires. Answers with file-and-line citations are in `docs/store/`.

### Test coverage, honestly
The backend is well defended. **No automated test opens any athlete checkout UI.** Every money test
starts at the edge function. The Razorpay sheet has been driven once, by a human, on 20 July. Real
refunds cannot be tested because payment ids are synthetic. There are NO unit or integration tests
anywhere in the monorepo. Five Maestro flows wrap taps in retry loops that hide a documented
"tap does nothing" navigation defect.

---

## Environment traps, each of which cost hours

- **JDK 17 is installed** at `/opt/homebrew/opt/openjdk@17` but is NOT registered with `java_home`,
  so `/usr/libexec/java_home -V` wrongly reports it missing.
- **Metro must start from `apps/mobile`**, never the repo root. From the root it cannot resolve the
  entry and serves a redbox that looks exactly like a product bug.
- **`maestro test .maestro/` in DIRECTORY form runs flows concurrently** and will grab the wrong
  device, including a live Android emulator. Run per flow with `--udid`.
- **`gradlew assembleRelease` silently ships a STALE JS bundle.** Force with
  `:app:createBundleReleaseJsAndAssets --rerun-tasks`.
- **The Android emulator needs `-gpu swiftshader_indirect -no-window`** or it binds IPv6 ports and
  sits permanently offline.
- **`pnpm install` can exit 0 having done nothing** when it wants a from-scratch reinstall and the
  terminal is non-interactive. Use `CI=1`.
- **`fatal: Unable to write index` usually means the disk is full**, not repo corruption. Check
  `df` first, then look for a stale zero-byte `.git/index.lock`.
- **Agent worktrees are the number one disk consumer.** Atlitos reached 88 GB, of which 82 GB was
  39 worktrees. `~/bin/worktree-gc` now reclaims them daily at 04:10, and never removes anything
  dirty or unmerged.

---

## Where things live

| What | Where |
|---|---|
| Approved plan | `~/.claude/plans/snappy-foraging-meadow.md` |
| Bug ledger | `docs/qa/BUG-LEDGER.md` |
| iOS QA findings | `docs/qa/P5-IOS-FINDINGS.md` |
| Android QA findings | `docs/qa/P5-ANDROID-FINDINGS.md` |
| Store submission pack | `docs/store/` |
| OAuth spec (Phase 8) | `docs/phases/OAUTH-GOOGLE-APPLE-SPEC.md` |
| Phase 5 status | `docs/phases/LAUNCH-PHASE-5-STATUS.md` |
| Account deletion design | `docs/architecture/SCHEMA.md`, account deletion section |

Note the launch program re-uses phase numbers 0 to 7 from `docs/PLAN.md`. Launch-program docs are
prefixed `LAUNCH-`. `docs/phases/PHASE-5-STATUS.md` is the Clutch phase, NOT native QA.

---

## 2026-08-14. What the local stack found in its first night

Docker was reinstalled (colima) and `supabase start` ran for the first time in
this repo's history. Local dev had NEVER been initialised: there was no
`config.toml`. That single fact explains why every test before tonight was
read-only against production, and why the findings below sat undetected.

### The class that matters most: production config that exists only in a dashboard

Five settings were found that exist in the production project and leave NO
trace in the repo. In every case the symptom was silence, never an error:

| Setting | Symptom when absent |
|---|---|
| `RAZORPAY_WEBHOOK_SECRET` | signature check cannot run |
| `enable_anonymous_sign_ins` | every guest flow dies |
| `custom_access_token_hook` registration | `has_role()` is FALSE for EVERY user, so every role-gated policy returns an empty set with no error |
| `verify_jwt = false` on 3 edge functions | the next deploy 401s every Razorpay capture, silently, because Razorpay retries a non-2xx |
| `pg_net` + 2 vault secrets | migration 0111 cannot apply |

Four are now pinned in `supabase/config.toml`. The fifth needs a human.

**The `custom_access_token_hook` one invalidated work.** Three separate audit
tracks hit it independently and each worked around it DIFFERENTLY (a hand-signed
JWT, the GoTrue admin API, abandoning HTTP entirely), so no local authorization
result from that audit is comparable across tracks. If you are told "run the auth
tests locally", check this hook is registered first or you will get a vacuous
green.

### A clean checkout could never stand up

THREE migration files each claimed version `0088`. `schema_migrations` has
`version` as its primary key, so the second one failed with `23505` and the whole
stack rolled back. Merged into one file. Also note **production's migration
history is timestamp-versioned and disjoint from these file numbers** (104 rows,
`20260713064243` onward, filename in `name`), because migrations reached
production through the management API, never `supabase db push`. Reasoning like
"renumbering an applied migration confuses the runner" does not apply here.

### P0, closed: an unreviewed charity applicant's photo was public

Every anon SELECT policy on `storage.objects` gated on the BUCKET NAME ALONE
while each owning table gated on status, so the database refused the row and
then served its photograph. Reproduced with no credentials at all: HTTP 200,
2.79 MB. `0116` makes each policy mirror its table's condition.

**`0116` was necessary and NOT sufficient, and the gap would fool a policy
review.** On a bucket with `public = true`, `/object/public/` is served WITHOUT
consulting RLS. Enumeration closed; direct fetch stayed open. `0117` makes
`upa-photos` private. Consequence: portal-life needs signed URLs (task #44).

**Verify storage fixes with a cache-buster.** Three retests returned 200 from
Cloudflare's edge and read exactly like a failed fix; only `?cb=$RANDOM` showed
the origin's 400.

### The empty-catch class, two instances found

`mintPlayback` swallowed every error, so a failed clip rendered as a bare black
rectangle. `openComments` swallowed every error, so a clip with 36 comments
rendered as "No comments yet. Start the conversation." Both now surface a real
error state. **When a catch is empty, the failure becomes indistinguishable from
emptiness, and emptiness is a lie the UI tells confidently.** Sweep for more.

### The generator that polluted production

All eight `scripts/seed-*.mjs` defaulted to production: either
`?? 'https://syzzfgaudpifwvbpycyi.supabase.co'` or by reading
`apps/mobile/.env`. `node scripts/seed-demo-users.mjs` with no environment
seeded production. `assertWritableTarget` now refuses unless
`ATLITOS_ALLOW_PRODUCTION_WRITE=yes-i-mean-production`.

### A coach could start a group session and never end it

Found by running `groups-coach.yaml`, which had never executed once because it
writes. `completeGroupSession` called `session_transition('complete')` whose
docblock claimed group rows were allowed; the live function refused `complete`
from every state with no group exemption. `0118` narrows the gate and PROVES the
money-free claim rather than trusting `group_id`.

### A brew upgrade can break every iOS build, and it looks like a Hermes bug

`ios/.xcode.env.local` (gitignored, so it is per machine and invisible in
review) pinned a VERSION SPECIFIC node path:

    export NODE_BINARY=/opt/homebrew/Cellar/node/24.7.0/bin/node

A `brew upgrade` on 2026-08-14 moved node to 26.7.0 and took `simdjson` with
it, leaving that exact binary linking against a library that no longer exists.
Every iOS Release build then failed inside the Hermes script phase:

    Script '[CP-User] [Hermes] Replace Hermes for the right configuration' failed
    ...
    dyld: Library not loaded: /opt/homebrew/opt/simdjson/lib/libsimdjson.26.dylib
    Referenced from: /opt/homebrew/Cellar/node/24.7.0/bin/node
    Abort trap: 6

IT PRESENTS AS A NATIVE BUILD FAILURE and nothing points at node or Homebrew
unless you read the dyld lines inside the script output. Two wrong hypotheses
were tried first (xcodebuild contention, then stale Pods); `pod install` cost a
full build cycle to disprove.

FIX: point NODE_BINARY at `/opt/homebrew/bin/node`, the stable symlink that
survives version bumps. Never a Cellar path.

TWO HABITS THIS EARNED. Do not pipe a build log through `tail`: the first
failure's real error was lost that way and cost an extra rebuild. And treat a
Homebrew upgrade mid-session as a change with a blast radius; the CLI upgrade
that fixed the edge function 401 also broke the native toolchain.

### Environment traps added tonight

- **The springboard chooser. KEEP THE QA SIMULATOR SINGLE-APP.** Other
  projects' apps were installed on `8AF6A5E2-F889-4477-8634-97B4AB5D5453`
  (Follow Me, BelieversDiary). Opening `atlitos://` raised `Open in "Follow
  Me"?` ON TOP of a correct screen, holding accessibility focus so every assert
  beneath it failed; it survived a Cancel tap AND uninstalling that app, and
  only a reboot cleared it. With Follow Me gone the chooser simply offered the
  next sibling, and a later run HANDED THE DEEP LINK TO BELIEVERSDIARY, whose
  onboarding screen was captured mid-suite under a `back to Atlitos` status
  bar. It is NOT a real scheme collision: all three Info.plists were read and
  none claims another's scheme, so this is stale LaunchServices state. Both
  sibling apps are now uninstalled from that simulator; it carries Atlitos and
  the Maestro runner only. If a deep link behaves oddly again, check what else
  is installed BEFORE suspecting the router. That is trap #10.
- **XCUITest cannot see the comments sheet.** With it open, the hierarchy is
  SEVEN text nodes, all simulator status bar. `assertVisible` on a comment row
  cannot pass however correct the render. Prove that sheet with screenshots. The
  same fact is a real accessibility defect worth fixing.
