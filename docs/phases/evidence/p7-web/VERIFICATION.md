# Phase 7 (Learn / XP) Verification — AT-139, Track F

**Verifier:** Track F (opus). **Date:** 2026-07-22. **Project:** `syzzfgaudpifwvbpycyi` (live). **Branch:** `main` (all tracks A/B/C/D merged). **Method:** real player/admin JWTs over PostgREST + service SQL + Expo web structural pass. Nothing re-read from code and trusted; every claim witnessed against the live stack.

**Migrations applied (confirmed):** `0057_learn_schema` … `0061_admin_drill_rpcs`, all present in `supabase_migrations.schema_migrations`.

**Repro:** `node scripts/verify-learn-p7.mjs` (own-row REST path with the documented fixture password `AtlitosDemo!2026`, never typed). Web pass: Expo web on `:8090`, script-minted `sb-syzzfgaudpifwvbpycyi-auth-token` session for `player@atlitos.dev` injected (never typed credentials).

## Verdict: GATE PASSES. No CRITICAL or HIGH failures. Findings are MEDIUM/LOW/INFO, listed at the end.

---

## PRIORITY 1 — THE GATE: real action → server-side XP → roadmap advances, no client XP write. VERIFIED.

Subject: `player@atlitos.dev` = `58756043-7c59-43b2-b23a-c72f0011970f`, primary sport cricket, fresh (0 XP, 0 completions before).

| Step | Witnessed |
|---|---|
| Server-truth drill xp_value | `GET drills?id=eq.…440002` → `Backfoot pull shot`, `xp_value=100`, `active=true` (read from `drills`, not client) |
| `get_learn_home()` BEFORE | `xp_total=0`, `current_stage`=order 1 "Finding your stance", 0 milestones earned |
| **The ONE client write** | `POST drill_completions {user_id, drill_id:…440002}` → `201`, row `757ea61d-…`. No client write to `xp_events`/`user_milestones` in the path. |
| `get_learn_home()` AFTER | `xp_total=100` (**increased by exactly 100 = the drill's `xp_value`**); `current_stage` advanced order 1 → **order 2 "Building consistency"** (threshold 100 crossed); `next_stage`→order 3 (300) |
| Trigger-written event proof | `GET xp_events?…drill_id=eq.…440002` → exactly one row `{source:'drill_complete', xp_amount:100}`. Service SQL: player A has exactly 1 completion, 1 event, `xp_total=100` — the trigger did everything server-side. |
| Milestones unlocked | first_drill_complete (drill_count≥1), fifty_xp (≥50), hundred_xp (≥100) → 3, each genuinely newly-met (see LOW-2 re "exactly one") |

**Also proven through the actual shipped UI** (not only the script): on `/learn/drill/…440001` the shipped "Mark complete" button → confirm sheet → completion inserted a second `drill_completions` row; service SQL after: 2 completions, 2 `xp_events` (`…440002:100`, `…440001:50`, both `drill_complete`, server-side amounts), `xp_total=150`. The detail then rendered the green "Completed" state. The real user action drives the trigger; the client never writes XP.

## PRIORITY 2 — UN-FORGEABILITY. VERIFIED.

| Attempt (authenticated player A) | Result |
|---|---|
| `INSERT xp_events {…, xp_amount:9999}` | **`42501`** "permission denied for table xp_events" |
| `INSERT user_milestones {…}` | **`42501`** "permission denied for table user_milestones" |
| Smuggle XP on completion: `INSERT drill_completions {…, xp_value:9999}` | **rejected** — `PGRST204` "Could not find the 'xp_value' column of 'drill_completions'". `drill_completions` columns are `id,user_id,drill_id,completed_at` only; there is no client-writable XP column (see LOW-1 on the code). |
| `xp_total` is DERIVED | `get_learn_home()` computes `sum(xp_amount)` at read time; SCHEMA/`0057` keep no counter column. Un-forgeable by construction. |

## PRIORITY 3 — IDEMPOTENCY. VERIFIED.

Duplicate `INSERT drill_completions {…440002}` → **`23505`** "duplicate key … drill_completions_user_id_drill_id_key". `get_learn_home()` after: `xp_total` unchanged (100 at that point); `xp_events` for that drill still exactly 1 row; milestones unchanged (no double-unlock — `ON CONFLICT (user_id,milestone_id) DO NOTHING`).

## PRIORITY 4 — CATALOG + ADMIN. VERIFIED.

**Catalog active-filter (permissive-OR):** `GET drills?active=eq.true` never contains inactive `…440004` ("Slip fielding basics"). App-path `drills?active=eq.true&id=eq.…440004` → `[]` (null to a normal reader). Raw `drills?id=eq.…440004` → returns it with `active:false`, confirming RLS is permissive and the explicit `.eq('active',true)` filter is what hides it.

**Admin CRUD (real `admin@atlitos.dev` = `d247e386-…` JWT, better than synthesized claims):** created drill `5fd6d92d-…` (active by table default), edited (`xp_value 30→35`), deactivated. `audit_log` for that entity: exactly **one row per action** — `drill.create` ×1, `drill.update` ×1, `drill.deactivate` ×1, all actor `d247e386-…`.

**Refusals:** non-admin (player A) `admin_upsert_drill` → `P0001` "FORBIDDEN: admin role required". `xp_value=0` (admin) → `P0001` "VALIDATION: xp value must be greater than zero".

## PRIORITY 5 — RLS ISOLATION (non-vacuous). VERIFIED.

**JWT path (real sessions):** A = `58756043-…` (has data), B = `coach2@atlitos.dev` = `883b6f5d-…` (holds player role). **ids asserted to DIFFER first** (`true`). As B: `drill_completions?user_id=eq.<A>` → `[]`; `xp_events?user_id=eq.<A>` → `[]`; `user_milestones?user_id=eq.<A>` → `[]`. Public catalog readable to B: `roadmap_stages` (15 rows), `drills?active=eq.true` (readable).

**Named seed fixtures (data layer; both are anonymous auth users, no password, so not JWT-drivable):** A' = `b22bfbf2-435b-48c9-bb85-ee33d407eec5` (5 completions, 5 events, **470 XP**, 5 milestones) vs B' = `19ebea12-ace0-4439-a991-6c4ab58645d4` (0/0/0). `A' <> B'` = `true`. Positive control (A' has data) + negative (B' empty) both hold.

## PRIORITY 6 — WEB STRUCTURAL PASS (Expo web, `player@atlitos.dev` session). VERIFIED (light); dark blocked by carried-forward gap.

expo-router manifest already carried the learn routes (`learn`, `learn/drills`, `learn/drill/[id]`, `learn/roadmap`, `learn/milestones`) in `.expo/types/router.d.ts`.

| Screen | Rendered from `get_learn_home()` — witnessed |
|---|---|
| **Learn home** | Total XP **100** (mono tabular), Milestones **3**, "CRICKET ROADMAP / Building consistency", progress "**200** XP to Expanding your game", "Milestones, 3 of 8 earned", drill list with completed check (lucide) on Backfoot pull shot |
| **Drill library** | Active-only, sorted by XP; sport+difficulty filter chips; inactive drill absent |
| **Drill detail** | "50 XP on completion" (mono), instructions, accent "Mark complete" → confirm sheet ("… cannot be undone. Drills count once.") → green "Completed" state (lucide check-circle) |
| **Roadmap** | "CRICKET. 100 XP TOTAL", stage 2 highlighted "YOU ARE HERE", stages 3–5 locked (lucide lock), mono thresholds 0/100/300/600/1000 |
| **Milestones** | 8 rows, earned-vs-locked from real `user_milestones`: EARNED first_drill_complete (flag), hundred_xp (rocket), fifty_xp (zap); 5 LOCKED (lock). Matches `get_learn_home` exactly. Header "Earned 3 / Total XP 100" |

**Zero nested-button / `validateDOMNesting` / VirtualizedList console errors** on any Learn screen (DrillCard pressable-overlay holds); `read_console_messages onlyErrors` returned none across home, library, detail (before+after mark-complete), roadmap, milestones. Numeric readouts render mono tabular; milestone markers are lucide names, no emoji.

**Two render-timing notes (NOT bugs):** initial screenshots of Milestones and Drill library fired before react-native-web painted (blank), but `get_page_text` + a settled re-screenshot confirmed full content. No missing-data defect.

---

## Advisor diff vs P6 baseline

`get_advisors(security)` = 155 lints. **No new ERROR, INFO, or `function_search_path_mutable` entry references any learn table/view/function** (the four learn functions all `set search_path=public`). The only P7 additions are **two `authenticated_security_definer_function_executable` WARNs** on `admin_upsert_drill` / `admin_set_drill_active` — expected and by-design (internally `has_role('admin')`-gated), identical to the accepted 0039/0043 admin-RPC pattern. No new advisor class vs P6 (RLS WARN debt carried forward).

---

## FINDINGS, ranked by severity

**No CRITICAL / HIGH. All 8 gate clauses PASS.**

- **MEDIUM-1 (data hygiene, REMEDIATED):** 10 active `VERIFY Track B drill` rows (Tennis/Serve/40 XP, ids `874cbdb1…`,`7d09ec9d…`,`496fe260…`,`b39eb3ee…`,`dbcf9816…`,`a83df88a…`,`bc732e6d…`,`f6096112…`,`08bf098d…`,`8f706871…`) were left **active** in the consumer catalog by Track B's own verification runs and appeared in the Drill library. Deactivated (`active=false`) during this pass to leave the catalog clean. Follow-up: Track B verification should deactivate or roll back its probe drills, or seed them inactive.
- **MEDIUM-2 (carried-forward: dark-mode mobile-web gap):** Dark theme could NOT be captured on the Learn screens on mobile web. The design-system dark palette resolves correctly (proven on `/dev/tokens`: bg `#14100B`, card `#1E1810`, text `#F5EEE3` after the in-app nativewind `colorScheme.set('dark')` toggle), but (a) there is **no consumer-facing dark toggle** on the Learn screens (only `/dev/tokens`), and (b) the scheme **does not persist across expo-router web navigation** (after toggling dark then navigating to `/learn`, `document.documentElement.classList.contains('dark')` returned `false` and the page re-rendered light). A manual `.dark` class flips only the tailwind-className layer (header), not the `useThemeColors()` inline-token components. This is a pre-existing platform gap, NOT a P7 regression — the Learn screens consume the same tokens and render dark correctly when the scheme is dark; full dark verification is owed to the P9 native pass.
- **LOW-1 (accuracy):** the XP-smuggle attempt returns PostgREST `PGRST204` (schema-cache: no such column) rather than Postgres `42703` that Track A cited from raw SQL — PostgREST intercepts before Postgres. Same substantive guarantee: `drill_completions` has no client-writable XP column.
- **LOW-2 (gate-wording clarification):** "if a threshold is crossed, exactly one milestone unlocks" is not literally true on a fresh player's first completion — `first_drill_complete` (drill_count≥1) necessarily co-fires with any `xp_threshold` milestone the same completion meets. The 100-XP first completion correctly unlocked **3** (first_drill_complete, fifty_xp, hundred_xp), each a genuinely newly-met criterion. Behavior is correct; the "exactly one" phrasing is the imprecision.
- **INFO (evidence medium):** the Chrome MCP `save_to_disk` did not write a filesystem-reachable image in this environment, so this pass's web evidence is transcribed (rendered `get_page_text`, exact values, console-error checks, and inline screenshots described above) rather than persisted PNGs — reported, not faked (per the "report a block rather than fake evidence" directive). Backend evidence is fully reproducible via `scripts/verify-learn-p7.mjs`.

## Carried-forward advisories (NONE dropped)

Route not enabled; AT-88; **dark-mode mobile-web gap** (MEDIUM-2 above); native coverage + P9 native-pass debt (Learn gestures/haptics); `tmp-seed-demo-users`; TS skew; **RLS WARN debt** (SECURITY DEFINER executable-by-`authenticated`; now +2 for `admin_upsert_drill`/`admin_set_drill_active`, by-design); PRD-02 assumptions; AT-73; `show_donor_name`; and the P7 assumptions incl. **cross-domain XP is a designed-in hook (`xp_source='other'`), not built** (no PRD FR wires session/court/donation/clip to XP in v2). Finish line = TestFlight (P9 native + P10 ship).

## State left on the live project

`player@atlitos.dev` now holds 2 real completions / 150 XP / stage 2 / 3 milestones (the gate evidence, intentionally retained; also gives the Learn web pass a populated render). Admin probe drill `5fd6d92d-…` left deactivated. 10 Track B `VERIFY` drills deactivated. No `xp_events`/`user_milestones` rows were ever client-written (all forge attempts returned 42501; smuggle returned PGRST204 and wrote nothing).
