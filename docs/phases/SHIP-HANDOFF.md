# P9 / P10 Ship Handoff

The definitive, start-cold checklist for the two ship stages after the P8 gate. P8 was the last autonomous build phase; everything below genuinely needs the founder's device time, developer account, or dashboard access, and must not be faked or self-served. Written by the AT-152 docs freeze so P9's and P10's operators do not have to reconstruct scope from the phase narrative.

## Freeze baseline (what "shipped reality" is as of the P8 gate)

- **Migrations 0001-0069 applied** on Supabase project `syzzfgaudpifwvbpycyi`. `0062-0064` advisor burn-down, `0065` `user_status` field lock (states pass AT-143), `0066` verification-decision notification, `0067` donation donor-name snapshot, `0068` perf FK covering indexes, `0069` drop redundant indexes. `0068/0069` are perf-only: no table, enum, or contract changed, so `SCHEMA.md`'s per-table index lists remain the design intent of record.
- **Architecture docs reconciled to reality** (this freeze): `SCHEMA.md` (every live table/enum documented, none stale), `RLS.md` (AT-142 advisor disposition table + permissive-OR discipline signed off), `PAYMENTS.md` (all four finalize domains, derived roundup, donor-name snapshot, Route deferral), `API-MAPPING.md` (`ai-search`, `notify-dispatch`, clutch mints, `donate`, all edge functions with current contracts), `VIDEO.md` (v1 Supabase-Storage adapter is reality; Cloudflare Stream deferred). One drift corrected: the donor-name snapshot was cited as migration `0066` in three docs; the applied migration is `0067` (`0066` is the verification-notification wiring). No other doc-vs-reality drift found.
- **18 edge functions ACTIVE** on the project, all documented. Note `tmp-seed-demo-users` is still ACTIVE and JWT-callable (founder deletion item below).

Anything in the architecture docs marked DEFERRED / seam / stubbed is NOT shipped: LLM re-rank (`ai-search` `rerank()` is the identity function), device push transport (`notify-dispatch` leg 2 `deliverToDevice()` is stubbed), live Razorpay Route transfer (returns `503 ROUTE_UNAVAILABLE`), and Cloudflare Stream (Supabase Storage adapter in its place). These are seams, not lies: each is a clean drop-in behind an unchanged contract.

---

## P9: native verification pass

Burns down the native-debt inventory that react-native-web could never prove. Near-zero native screen coverage exists across all prior phases: every "verified" screen to date was verified on mobile-web or against the live DB, not on a device. Run the app on the iOS simulator/device and verify each item below by actually driving it. Note any residual native-only sliver as owed, never fake it.

### Enabler (do this first)

- **Grant Accessibility + Screen Recording to ClaudeCode.app, then restart it.** Without both macOS permissions, programmatic taps on the iOS simulator silently no-op (see `reference_ios_simulator.md`), so the whole native pass cannot be driven by the agent. `cliclick` is already installed; the permission grant is the gap.

### Native-prep pass done 2026-07-22 (boot + guest-surface visual inspection)

A no-tap, no-credentials native-prep pass ran before the tap-grant exists. Evidence and full recipe in `docs/phases/evidence/p9-native/`. Headline: **the real dev client compiles, links its custom native modules (incl. react-native-razorpay, which segfaults Expo Go), boots on the iPhone 17 sim connected to Metro on 8081, and auto-routes into Home as a guest with no interaction** (a persisted anonymous session from prior native work was already in AsyncStorage). Nine guest/public surfaces were reached via `atlitos://` deep links and screenshotted. This is a **visual inspection of guest-viewable rendering only**, NOT tap-driven flow verification. Per-item status of the inventory below is annotated `[native-render OK]` / `[still owed]` accordingly. The reusable dev-client-boot recipe (existing build, port-8081 rule, group-less deep links) is captured in the evidence README so the next native pass does not re-derive it.

### Native-debt inventory to burn down

1. **Native screen coverage** across every prior phase: no screen has been exercised on a real device. Walk all core surfaces at phone width on the simulator. **[native-render OK, partial]** 9 guest surfaces render correctly natively (Home, Login, Trainings gate, Clutch, Courts, Coaches, Shop, Learn, Empower). Signed-in-only and post-tap surfaces still owed.
2. **`react-native-video` autoplay** in the Clutch feed: muted autoplay, poster-to-video swap, next-card prefetch. Mobile-web never exercised the native player. **[still owed]** Feed chrome renders but the poster is blank (missing seed thumbnails) and playback is invisible in a static screenshot.
3. **`react-native-razorpay` native checkout sheet**, including **the failure path** (dismiss vs decline): `Alert.alert`/AT-64 behavior and the booking never rendering confirmed on an abandoned/declined payment. The success path was touched once natively (session `43c52265`); the failure path is unverified. **[still owed]** Native module confirmed to LINK (app boots, prior P3 proof); failure path still needs the tap-grant.
4. **Camera capture + gallery picker** (`expo-image-picker`) for clip upload and avatar/photo flows. **[still owed]** Not observable in a screenshot.
5. **`expo-haptics`** across the app (confirmations, money actions, feed interactions). **[still owed]** Not observable in a screenshot.
6. **`expo-location`** (court discovery distance, `ai-search` `lat`/`lng` narrowing). **[still owed]** Sim showed the San-Francisco-default fallback (courts read "13504.0 km"); real device + location grant needed.
7. **Splash screen** and app-launch experience. **[native-render OK]** Launch + guest auto-route verified (`01-boot.png`).
8. **Phone-width layout** on real device dimensions (not the web viewport). **[native-render OK]** Verified across 9 surfaces at iPhone 17 dimensions; no layout breakage, fonts (Inter + JetBrains Mono numerics) and lucide icons resolve.
9. **iOS keyboard offsets** on every form (auth, onboarding, checkout address, chat, support). **[still owed]** Forms render but no keyboard was raised (no typing).
10. **The `Alert.alert` / AT-64 call sites** (10 money-consequential confirms) and their `ConfirmSheet` replacements: verify each fires and blocks natively. `Alert.alert` is inert on react-native-web, so these were never provable before. **[still owed]** All behind taps on money CTAs.
11. **Device push transport for notifications**: exercise `notify-dispatch`'s stubbed `deliverToDevice()` seam with real APNs/FCM credentials. P8 shipped only the in-app `notifications` row write + in-app surface; the device leg is P9's to wire and prove. **[still owed]** Backend seam, unrelated to this visual pass.
12. **Native-theme verification**: the mobile-web dark-mode gap (real routes did not follow OS dark) becomes a native light/dark theme pass on device. `packages/theme` tokens must resolve correctly under both. **[still owed]** Only the OS default appearance was captured; light/dark toggle pass owed.

---

## P10: TestFlight

- **Founder's Apple Developer account** ($99/yr, 24 to 48h to activate). This is the critical-path external dependency; start enrollment early, before P9 finishes, so it is not the thing everything waits on.
- **A signed EAS/Xcode build**: production build config, signing identity from the developer account, EAS credentials.
- **App Store Connect metadata + screenshots + privacy declarations**: app name/subtitle/description, category, keywords, the device screenshots captured in P9, and the privacy nutrition labels (data collected: account/auth, payments via Razorpay, location for discovery, camera/photos for uploads, push tokens).
- **Apple review**: submit to TestFlight, pass Apple review, distribute to internal/external testers.

---

## The THREE founder pre-ship actions

None of these can be self-served in-repo; each is a founder dashboard/account/decision action. They are explicit pre-ship conditions, not silently dropped. The P8 gate passed WITHOUT claiming green on them (P3 Route-deferral precedent).

1. **Enable Razorpay Route** (dashboard). The ledger is already correct and derivable and both Route edge functions are deployed and correct; this is config, not rebuild. Until it is on, `razorpay-route-onboard` and `razorpay-route-transfer` return `503 ROUTE_UNAVAILABLE` by design (no fake success). Once enabled, the live payout transfer becomes provable end to end (the one thing AT-43 could not verify: a transfer Razorpay actually accepts, and the real `transfer.processed`/`transfer.failed` field names). Must be on before any real money moves.
2. **Delete `tmp-seed-demo-users`** edge function (dashboard). Still ACTIVE and JWT-callable; a seed/demo utility must not exist on a shipping backend.
3. **Ratify the platform fee rate + the PRD-02 / PRD-05 / PRD-06 resolved-by-assumption decisions.** The coaching platform fee rate, the cancel/reschedule notice window, transfer minimums/fee, the analytics threshold, plus the six PRD-05 and six PRD-06 assumptions (including the `show_donor_name` default and direction). These were resolved by assumption to keep the autonomous build moving; the founder ratifies or amends before ship.

### Cheap founder wins flagged alongside (config, not blocking)

- `auth_leaked_password_protection` is disabled: a one-toggle Auth dashboard win.
- `public_bucket_allows_listing` on `avatars`, `product-media`, `upa-photos`, `gratitude-photos`: public object read is by design; tightening bucket *listing* (leaving read public) is a dashboard setting. `upa-evidence` and `clips` are already private.

---

## Gate carry-forward (from PHASE-8-STATUS.md G6)

The P8 gate passed on autonomous hardening + a green 5-journey regression + the advisor burn-down. This document IS the record that the three founder-blocked items and the native-debt inventory were carried as explicit P9/P10 conditions rather than dropped. P9 starts at "Enabler" above; P10 starts at the Apple Developer enrollment.
