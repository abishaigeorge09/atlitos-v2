# ATLITOS v2 — Autonomous Build Complete (P0-P8)

Founder-facing summary. As of 2026-07-22 the autonomous build is done.

## What is finished

Phases P0 through P8 are all closed and gate-approved by the biased approver. The product is functionally complete and proven on web plus backend against the live Supabase project `syzzfgaudpifwvbpycyi`: all 5 core journeys (court booking + pay, coaching book/accept/complete/rate/earnings, commerce browse-to-order + admin lifecycle, Clutch upload/moderate/publish/feed/takedown, Empower donate + roundup and Learn XP) run green end to end. The RLS burn-down (143 policies) changed no access set, the whole-DB ledger balances (0 unbalanced groups), no client-writable status field exists on any money- or state-bearing row, and the advisor debt is burned down (initplan 100->0, permissive 43->21, search_path 14->5, 0 new ERROR) with every residual by-design item dispositioned in RLS.md.

## What remains (both need you)

- **P9 native verification pass.** Everything react-native-web could never prove: native screens on device, react-native-video autoplay, the native Razorpay sheet including the failure path, camera + gallery, haptics, location, keyboard offsets, the 10 money-consequential confirms, device push through `notify-dispatch`'s stubbed seam, and native light/dark theme. Needs your device time and the ClaudeCode.app Accessibility + Screen-Recording macOS grant (without both, simulator taps silently no-op). Full inventory in `SHIP-HANDOFF.md`.
- **P10 TestFlight.** Needs your Apple Developer account ($99/yr, 24 to 48h to activate; start enrollment early, it is the critical-path external dependency), a signed EAS build, App Store Connect metadata + screenshots + privacy labels, and Apple review.

## The 3 founder pre-ship actions

1. **Enable Razorpay Route** (dashboard). Ledger is already correct and derivable; this is config, not rebuild. Route functions return `503 ROUTE_UNAVAILABLE` by design until on. Must be on before any real money moves.
2. **Delete `tmp-seed-demo-users`** edge function (dashboard). Still ACTIVE and JWT-callable; must not exist on a shipping backend.
3. **Ratify the platform fee rate + PRD assumptions**: coaching fee rate, cancel/reschedule notice window, transfer minimums/fee, analytics threshold, plus the six PRD-05 and six PRD-06 assumptions (including the `show_donor_name` default and direction). Resolved by assumption to keep the build moving; ratify or amend before ship.

Cheap dashboard wins flagged alongside: enable `auth_leaked_password_protection`; tighten `public_bucket_allows_listing` on the 4 public buckets (read stays public).

Start-cold detail for both ship stages: `docs/phases/SHIP-HANDOFF.md`.
