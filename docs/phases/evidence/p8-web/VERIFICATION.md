# AT-153 — Track V: 5-Journey Regression (P8 Gate G4)

Date 2026-07-22. Project `syzzfgaudpifwvbpycyi`. Branch `main` (HEAD `a1f66c0`, all P8 work merged: RLS burn-down 0062-0064, states lock 0065, verification notification 0066, donor snapshot 0067, perf indexes 0068-0069, ai-search, notify-dispatch).

Method: scripted-real against the live stack, driving the deployed edge functions and RPCs with real fixture JWTs (never typed credentials; fixture password path). SQL used to prove balance + isolation, never to substitute for a functional read. Every isolation check asserts the two ids DIFFER first (AT-62 lesson).

## Verdict: GATE PASS — J1-J5 all GREEN. No blocking finding.

Whole-DB ledger after all drives: **21 groups, 0 unbalanced, global net 0.00, 51 legs.**

---

## J1 COURTS — GREEN
- Discovery read (AT-63 class) still works post-RLS-collapse: guest sees 2 verified coaches via `coach_profiles_public`, athlete gets **110 bookable slots** over 14 days (`get_coach_busy_slots` + availability), private tables (`coach_profiles`, `coach_certificates`, `sessions`, `payment_intents`) invisible to non-owner athlete AND anon (0 rows). `verify-discovery.mjs`.
- Book + pay: `book-court` created real booking `1ff1b1d8-c4ea-41ae-a4e3-18dce9021c8e`, status **confirmed**, realtime INSERT received, check-in UPDATE applied. Ledger group = 3 legs, balanced.
- Isolation: cross-partner probe B (different venue `a0000000…0001`, id ≠ A) received **0** events on A's exact channel and project-wide. `verify-realtime.mjs`.

## J2 COACHING — GREEN
- Verified-only visibility holds (guest sees only 2 verified coaches; base `coach_profiles` invisible).
- Full lifecycle proven on real session `99384050-a82c-461a-a930-e08a3e934936` (requested→accepted→completed→rated, rating 5). Coach earnings accrued: ledger group **debit platform 1000 = credit coach 990 + credit platform 10** (SCHEMA worked example verbatim), balanced.
- State machine enforced server-side, re-confirmed LIVE: a `reschedule` from a terminal `rated` session raised `INVALID_TRANSITION` (the guard firing, not a bug).
- Isolation: athlete sees only own sessions (11 visible / 11 own).
- NOTE: `verify-realtime.mjs` prints a red "FAILED" on its Part 4 because the harness reuses a session already in `rated` and drives an invalid transition. That is a harness fixture-state artifact — the DB correctly rejected it. J2 lifecycle + earnings verified via the balanced real session above + the live guard.

## J3 COMMERCE — GREEN
- Browse active-only (14 active products via anon), cart, checkout with roundup, capture: order `31bffaf4-fb8f-4d9d-bf31-c94442830350` created **placed**. Ledger: **debit platform 170 = credit platform 168 + credit upa_fund (General Fund) roundup 2**, balanced. Roundup credited to the General Fund.
- Admin lifecycle: `admin-order-advance` moved order **placed → shipped** (200, `#ATL00011`), ledger unchanged and still balanced.
- Isolation: shopper A (5 orders) vs shopper B (id ≠ A) — each sees 0 foreign rows across orders/cart_items/addresses/wishlist. "ISOLATED AND NON VACUOUS". `verify-commerce-rls.mjs`.

## J4 CLUTCH — GREEN
- Pipeline: `stream-upload-url` (uploading) → `uploadToSignedUrl` → `stream-webhook` ready/finalized → idempotent replay → moderate/approve → published → playback via signed URL → takedown → removed. `verify-clutch-p5.mjs`.
- Takedown makes it unplayable: raw storage path 4xx (anon + owner), moderation URL 403 for wrong role.
- RLS: non-published clip (id ≠ non-owner) nonOwnerCount **0**; published visible to non-owner (3); removed clip nonOwnerCount **0**. Direct engagement writes (`clip_likes`, `follows`) denied 42501; `toggle_clip_like` RPC works.

## J5 EMPOWER + LEARN — GREEN
- Donation (scripted-real): `donate` → capture recorded donation `44f3ab53…` (amount 75). Ledger **debit platform 75 = credit upa_fund 75**, balanced. Roundup allocation nets platform to zero (J3 order: platform debit 170 = platform credit 168 + fund 2). Guards proven: MIN_AMOUNT, PRICE_MISMATCH, ITEM_FUNDED.
- Financial invariant: client writes to `donations`, `ledger_entries`, `upa_applications`, `upa_wishlist_items.funded_amount/status` all **42501**. Public verified-UPA reads work (200). `verify-f-rls.mjs`, `verify-empower-p6.mjs`, `verify-f-donation.mjs`.
- Learn: real drill completions granted XP server-side (`xp_events`, source `drill_complete`, e.g. drill …0001 → 50 XP, …0002 → 100 XP) and advanced the roadmap (milestones/roadmap_stages read by xp_total). `verify-learn-p7.mjs`.

---

## RLS-isolation-still-holds proof (the #1 regression risk)
Public reads WORK (too-few would mean a broken public read): verified coaches 2, bookable slots 110, active products 14, published clips 4, active drills 12, verified UPAs 200. AND non-owner sees ZERO owner-scoped rows (too-many would mean broken isolation), ids asserted to differ first:

| Table | Owner sees | Non-owner sees owner's rows |
|---|---|---|
| orders | 5 | 0 |
| sessions | 11 | 0 (anon 0) |
| donations | present | write 42501 |
| notifications | 9 | **0** |
| xp_events | 2 | **0** |
| clips (unpublished) | 1 | 0 |
| cart_items / addresses / wishlist | 1 each | 0 |
| coach_profiles / certificates / payment_intents | — | 0 (athlete + anon) |

## P8 additions in-journey
- ai-search returns visibility-scoped results only (player query → 1 `coach` hit from `coach_profiles_public`; queries read through caller JWT + explicit public filter). Requires auth (guest 401 UNAUTHENTICATED) by design.
- Notifications written by real actions and owner-scoped: donation captures wrote `donation` notifications to the coach; clip moderation wrote `clip_moderation` ("Your clip is live" / "…removed") to the owner. Non-owner sees 0.
- States-pass holds: player writing own `users.status` blocked by `lock_user_admin_fields` trigger → `FIELD_LOCKED` (P0001). The six machine tables carry no status UPDATE grant (42501).

## Advisor state (fresh run 2026-07-22)
- Security: **3 ERROR**, all `security_definer_view` (`public_profiles`, `coach_profiles_public`, `product_variant_availability`) — exactly the KEEP-by-design set, unchanged, **0 NEW ERROR**. WARNs match dispositioned set (61 anon sign-ins, 55+13 security-definer fns, 4 bucket-listing, 1 leaked-password).
- Performance: `auth_rls_initplan` = **0** (burned down from 100). `function_search_path_mutable` 5 (from 14). `multiple_permissive_policies` ~26 (from 43) — all residual by-design public+owner/admin overlaps. `unused_index` INFO only.

## Findings (ranked)
1. BLOCKING: none.
2. LOW — `verify-realtime.mjs` harness reuses a terminal `rated` session and drives an invalid `reschedule`, emitting a misleading red "FAILED" that is the state machine working. Harness hygiene only; carry to a future fixture-reset. Does not affect the gate.
3. LOW/INFO — donor-name snapshot column present and AT-149-proven (rolled-back txn), but no live donation currently carries a non-null `donor_display_name` (all live donors opted out/anonymous), so the display path has no live named row to show. Mechanism intact; not a regression.
4. INFO — ai-search is auth-only (guest 401); guest discovery uses the direct discovery read path instead. By design (`userScopedClient`, no service role in search).

## Carried forward (none dropped)
All SHIP-HANDOFF.md P9/P10 debt and the three founder pre-ship actions stand: enable Razorpay Route (503 ROUTE_UNAVAILABLE by design), delete `tmp-seed-demo-users`, ratify fee-rate/PRD assumptions; native pass (device push transport, native Razorpay failure path, camera/gallery, haptics, react-native-video autoplay, Alert.alert/AT-64 confirms, native theme); TestFlight (Apple Developer enrollment). Cheap founder wins: `auth_leaked_password_protection` toggle, bucket-listing tighten.
