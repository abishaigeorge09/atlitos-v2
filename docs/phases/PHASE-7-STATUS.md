# Phase 7 Status: Learn and XP

**Status: OPEN. Planner skeleton (2026-07-22).** Stories AT-129 through AT-139 filed under epic AT-9 (Learn and XP), with the admin drill CRUD story also citing epic AT-10 (Admin Back Office). Deliverables below are unchecked; builders tick them as they land. This doc is the P7 contract and phase memory.

Gate (docs/PLAN.md P7): "Learn + XP: drills, roadmap, xp from real actions, lucide milestones, admin drill CRUD. GATE: roadmap progresses from real activity."

Scope ceiling: `docs/prd/PRD-01-athlete.md` Learn section (FR-48 through FR-51, the consumer Learn surface in `apps/mobile`) and `docs/prd/PRD-04-admin.md` Drill CRUD (FR-49 through FR-51, the admin drill authoring surface in `apps/admin`). Nothing else. No coach-authored drills, no challenges, no leaderboards, no streaks-as-a-feature, no AI drill recommendation, no roadmap or milestone admin authoring UI (PRD-04 line 191 explicitly leaves `roadmap_stages`/`xp_events` untouched by admin in v2).

**This is NOT a money phase (P6 handoff, PHASE-6-STATUS.md).** XP is progression, not currency. No payment domain, no ledger leg, no `finalize-payment` case, no edge-function finalize handler, no state machine on a money-bearing row. XP is modelled as its own append-only progression log (`xp_events`), never through `ledger_entries`. We mirror the ledger *discipline* (append-only, total is derived not stored, not client-writable) without any of the money machinery. Do not over-engineer against the money invariant where no money exists.

## The one design crux: XP accrues from REAL actions, tamper-proof, never a client XP write

This is the whole phase. The schema and RLS for it are ALREADY specified in `docs/architecture/SCHEMA.md` (Domain: learn) and `docs/architecture/RLS.md` (lines 118, 257 to 260); P7 implements exactly that, it does not redesign it. Written out so no builder invents a different mechanism:

### Which real event grants XP

In P7 the single XP-granting real action is **drill completion** (PRD-01 FR-49). A player, on the Drill Detail screen, marks a drill complete. That is a genuine athlete action, not a client writing an XP number. The XP awarded is the drill's own `drills.xp_value` (a positive int, admin-authored), never a client-supplied amount.

Cross-domain XP (a session reaching `completed`/`rated`, a court booking, a captured donation, a published clip) is a **designed-in hook only**: `xp_source` already carries an `other` value for exactly this, but NO PRD FR wires any of those domains to XP, so P7 does NOT build cross-domain aggregation. That is the proportionate call and it respects the PRD ceiling (see resolved assumption 1). The mechanism below extends to `other` sources later by adding one more trigger on the relevant domain table, with zero change to the read layer.

### The mechanism: server-side trigger, tamper-proof, not client-writable

1. The client INSERTs its own `drill_completions` row (`user_id = auth.uid()`, `drill_id`). RLS grants `authenticated` an own-row `INSERT` on `drill_completions` and nothing more (no `UPDATE`/`DELETE`). This is the only client write in the whole XP path. No money moves, so a bare own-row insert is the right proportionate write path; no edge function or RPC is warranted.
2. An `AFTER INSERT ON drill_completions` trigger (SECURITY DEFINER, server side) writes exactly one `xp_events` row in the SAME transaction: `source='drill_complete'`, `drill_id` set, `xp_amount = (SELECT xp_value FROM drills WHERE id = NEW.drill_id)`. The amount is read from the drill row server side; a client cannot forge it. The client has **no** `INSERT`/`UPDATE`/`DELETE` grant on `xp_events` at all, so a direct write returns `42501` (asserted at the gate).
3. A milestone-evaluation trigger (on the same completion, or on the `xp_events` insert) evaluates each `milestones.criteria` jsonb (`{"type":"xp_threshold","value":N}` against the running XP sum, or `{"type":"drill_count","value":N}` against the completion count) and inserts a `user_milestones` row for each newly met criterion. The client has **no** write grant on `user_milestones` either (`42501`); a milestone cannot be self-awarded.

### XP total is DERIVED, never a mutable counter

A user's XP total is `sum(xp_amount)` over their `xp_events`, computed at read time. There is no denormalized XP counter column anywhere (SCHEMA.md keeps the total off the row deliberately, the same rule as ledger balances). The client can read its own `xp_events` (owner-scoped SELECT) but can never write them, so the total is un-forgeable by construction.

### Idempotency: the same action never double-grants

`drill_completions` carries `UNIQUE(user_id, drill_id)`. A second completion of the same drill by the same user fails the constraint, the trigger never fires a second time, and no second `xp_event` is written. That IS the idempotency guard FR-49 requires; it is a schema constraint, not application logic that could be bypassed. `user_milestones` carries `UNIQUE(user_id, milestone_id)` for the same reason. v2 first cut awards XP once per drill, no redo affordance (resolved assumption 2).

### The roadmap progresses as a pure function of XP, so the gate is provable

- **Roadmap current stage** = the highest `roadmap_stages.stage_order` (for the player's sport) whose `xp_threshold <= sum(xp_events.xp_amount)`, computed at read time (SCHEMA.md line 838). It is a pure function of the XP total, which is itself a pure function of the append-only event log. Nothing denormalized, nothing client-set.
- **Milestones** render earned (a `user_milestones` row exists) vs locked (a `milestones` row with no matching user row), each with its `icon_name` (a lucide name, never an emoji).

The gate "roadmap progresses from real activity" is therefore provable end to end with no client XP write anywhere in the path:

> real action (player marks a drill complete) -> a trigger appends exactly one `xp_events` row with the server-read amount -> the read layer recomputes the XP total -> the roadmap current stage advances and any newly met milestone unlocks -> and a direct client `INSERT` into `xp_events` or `user_milestones` returns `42501`.

## Admin drill CRUD (the content the roadmap draws on)

Drills are admin-authored reference content (PRD-04 FR-49 to FR-51), created and edited in `apps/admin` (Refine). Mechanism reuses the established admin RPC + `audit_log` pattern (the same shape as `admin_approve_verification_request`, PHASE-6-STATUS.md handoff): a SECURITY DEFINER `admin_upsert_drill(...)` and `admin_set_drill_active(...)`, each `has_role('admin')`-gated inside, each writing exactly one `audit_log` row per accepted mutation (create, edit, deactivate). No client outside admin has any write grant on `drills`. Roadmap stages and milestones are seed-authored reference content, NOT an admin screen in v2 (resolved assumption 4).

## Permissive-OR discipline (the repo has been bitten four times; this is a rule)

`drills`, `roadmap_stages`, and `milestones` all carry an `anon`-inclusive public `SELECT` policy (public reference content, RLS.md line 118). Because RLS is permissive-OR, an unscoped `select * from drills` returns every drill, including inactive ones. **Every app and portal read of `drills` carries its own explicit `.eq('active', true)` filter** (the consumer Learn surface shows active drills only; admin sees all). `xp_events`, `drill_completions`, and `user_milestones` are strictly owner-scoped and, for `xp_events`/`user_milestones`, not client-writable. Every owner read carries its own explicit `.eq('user_id', user.id)` in app code, seeds, and tests, regardless of what RLS would do. Isolation tests assert the two party ids actually DIFFER before trusting a cross-user result (AT-62 lesson).

## Gate definition (the bar; "roadmap progresses from real activity")

P7 passes when all of the following hold on the deployed stack:

1. **Real action grants XP, server side (PRD-01 FR-49).** A real signed-in player marks a drill complete (an own-row `drill_completions` insert). A trigger writes exactly one `xp_events` row with `xp_amount` equal to that drill's `xp_value`, in the same transaction. No client wrote `xp_events`.
2. **XP total is derived (PRD-01 FR-48).** The player's XP total shown on Learn home equals `sum(xp_events.xp_amount)` for that player, read at request time; there is no denormalized XP counter column.
3. **Roadmap advances as a pure function of XP (PRD-01 FR-50).** The roadmap current-stage indicator is the top `roadmap_stages.stage_order` (for the player's sport) whose `xp_threshold <= XP total`; completing enough drills to cross a threshold advances the stage, with no hardcoded stage and no client write.
4. **Milestones earned vs locked from real data, lucide only (PRD-01 FR-51).** Milestones render earned when a `user_milestones` row exists (trigger-inserted from criteria) and locked otherwise, each with a lucide `icon_name`, never an emoji glyph.
5. **Tamper-proof (CLAUDE.md discipline).** A direct `authenticated` `INSERT` into `xp_events` and into `user_milestones` each returns `42501`. A client cannot forge `xp_amount`; the trigger sources it from `drills.xp_value`.
6. **Idempotent (PRD-01 FR-49).** Re-completing the same drill (a duplicate `drill_completions` insert) fails `UNIQUE(user_id, drill_id)`, writes no second `xp_event`, and leaves the XP total unchanged. No redo affordance in v2 first cut.
7. **Admin drill CRUD with audit (PRD-04 FR-49, FR-50, FR-51).** Admin create, edit, and deactivate of a drill each write exactly one `audit_log` row; a created drill appears in the Learn library and is available to roadmap logic; a non-admin write to `drills` is refused.
8. **Isolation and public-catalog scoping hold, non-vacuously (CLAUDE.md permissive-OR).** Two player ids are asserted to DIFFER before the isolation result is trusted; player A's `xp_events`/`user_milestones`/roadmap are never visible to B; the public `drills`/`roadmap_stages`/`milestones` catalog is readable but the consumer surface applies its explicit `active = true` filter (an inactive drill never shows in the app).
9. `pnpm turbo typecheck build lint` green, RLS advisor run and diffed against the P6 baseline, light and dark web evidence captured, biased approver APPROVE.

**Not a gate clause, deliberately:** any cross-domain XP source (session/court/donation/clip), any leaderboard, any streak feature, any roadmap or milestone admin authoring UI, any drill "redo" for repeat XP.

## Web now, native later. What that means concretely here.

P7 is the most fully web-verifiable phase in the plan: it touches no money, no Razorpay, no camera, no push. Everything is exercisable on the deployed stack.

**Verified on web in P7:**
- The whole XP engine and read layer: the completion write, the XP-award trigger, the milestone-evaluation trigger, the roadmap-stage and XP-total derivations, the `42501` lockouts, idempotency, and RLS isolation. All backend and platform independent, exercised by real scripted player sessions and real SQL/HTTP against the live project (the P4/P5/P6 scripted-but-real pattern).
- The gate itself: real action -> `xp_event` -> roadmap advances -> milestone unlocks, driven by an actual completion insert under a real player JWT and read back. Fully web-verifiable.
- Every Learn screen (Learn home, Drill library, Drill detail, Roadmap, Milestones) and the admin Drill List / Create / Edit, all four states each, light and dark, on react-native-web and in the Refine admin app.

**Deferred to the native pass (P9), genuinely native, not the gate:**
- Native gestures and haptics on the Learn screens (mark-complete press feedback, roadmap scroll). The mark-complete write, the trigger cascade, and every derivation are proven on web; only the touch feel is owed to the device pass. Nothing money or device bound exists in Learn.

## Founder decisions resolved by assumption (build does not stall; the assumption ships)

The founder will not answer mid-phase (full-autonomy directive). Each open question is resolved as follows:

1. **XP source scope (the crux).** ASSUMED drill completion is the ONLY XP-granting real action in P7, matching PRD-01 FR-49 and the `xp_source='drill_complete'` enum. Cross-domain XP (session/court/donation/clip) has no PRD FR and is NOT built; it stays a designed-in hook via `xp_source='other'` for a later phase. This scopes the whole XP engine and avoids over-engineering beyond the PRD ceiling.
2. **Drill redo affordance (PRD-01 FR-49, SCHEMA.md open q4).** ASSUMED XP is one-time per drill in v2 first cut; `UNIQUE(user_id, drill_id)` is the guard. No redo / repeat-XP path is built. A future recurring-conditioning redo would be a distinct schema change, not a relaxation of the constraint.
3. **Roadmap "assignment" (PRD-01 FR-48 "assigned roadmap stage").** ASSUMED a player's roadmap is derived from their primary sport's `roadmap_stages` set, not an explicit admin or coach assignment. A player with no sport selected, or a sport with no seeded stages, sees the explicit Learn-home empty state (FR-48), never a zero-filled roadmap.
4. **Roadmap and milestone authoring.** ASSUMED `roadmap_stages` and `milestones` are seed-authored reference content, NOT an admin CRUD surface. PRD-04 grants admin drill CRUD only (FR-49 to FR-51) and line 191 explicitly leaves roadmap and XP untouched by admin in v2. Only drills get an admin screen.
5. **Mark-complete write path.** ASSUMED the client directly INSERTs its own `drill_completions` row (RLS own-row INSERT) and a trigger cascades the XP event and milestone rows; no edge function or RPC, because no money moves. Proportionate to a non-money content phase.

## Deliverables owed, by track

Every builder ticket carries, as **step 0 inside its worktree**, `git merge main --no-edit` to pull all current phase work before building (worktree stale-base has bitten prior builds; a stale base is missing prior migrations, types, and edge functions). Any ticket that adds a mobile route must, after adding it, regenerate `.expo/types/router.d.ts` via a brief `expo start --web` before typecheck; `turbo typecheck` does not regenerate it and a fresh Learn route will otherwise fail typecheck against a stale router manifest (PHASE-6-STATUS.md gotcha).

### Track A: schema, RLS, the XP engine, derivations (opus)
- [ ] AT-129 Learn schema migration: `drills`, `drill_completions`, `roadmap_stages`, `xp_events`, `milestones`, `user_milestones` per SCHEMA.md Domain: learn, with enums `drill_difficulty` and `xp_source` if not already present, the `UNIQUE(user_id, drill_id)` and `UNIQUE(user_id, milestone_id)` and `UNIQUE(sport, stage_order)` and `milestones.key` constraints, `CHECK (xp_value > 0)`, and the `idx_drills_sport_active` / `idx_xp_events_user_id` indexes (PRD-01 FR-48, FR-49, FR-50, FR-51; PRD-04 FR-49)
- [ ] AT-130 Learn RLS: public `anon`-inclusive SELECT on `drills`/`roadmap_stages`/`milestones` (all rows, reference content), `drills` write `has_role('admin')` only; `drill_completions` own-row `INSERT` only (no UPDATE/DELETE), owner SELECT; `xp_events` owner SELECT with NO authenticated write grant; `user_milestones` owner SELECT with NO authenticated write grant. Document the permissive-OR active-filter contract for `drills` (RLS.md lines 118, 257 to 260; PRD-01 FR-49, FR-51; CLAUDE.md permissive-OR)
- [ ] AT-131 XP engine triggers: `AFTER INSERT ON drill_completions` writes exactly one `xp_events` row (`source='drill_complete'`, `drill_id` set, `xp_amount` read from `drills.xp_value` server side) in the same transaction; a milestone-evaluation trigger inserts `user_milestones` for each newly met `criteria` (`xp_threshold` against the XP sum, `drill_count` against the completion count); both idempotent via the UNIQUE constraints (PRD-01 FR-49, FR-50, FR-51)
- [ ] AT-132 Learn read layer: `get_learn_home()` returning the player's XP total (`sum(xp_amount)`), current roadmap stage (top `stage_order` whose `xp_threshold <= total` for the player's sport), and earned vs locked milestones, all computed at read time with no denormalized counter; owner-scoped explicitly (PRD-01 FR-48, FR-50, FR-51)

### Track B: admin drill CRUD (sonnet)
- [ ] AT-133 Admin drill CRUD: SECURITY DEFINER `admin_upsert_drill(...)` and `admin_set_drill_active(...)` RPCs (`has_role('admin')` inside, each writing exactly one `audit_log` row per accepted mutation), plus the Refine Drill List (name, sport, skill category, difficulty, XP value) and Drill Create/Edit screens with required-field validation, optional media, and activate/deactivate (PRD-04 FR-49, FR-50, FR-51)

### Track C: Learn consumer screens, mobile (sonnet)
- [ ] AT-134 Learn home + Drill library/list + `useLearn` hook in `packages/api`: Learn home shows roadmap progress, XP total, drill categories (FR-48 empty state when no roadmap), Drill library filterable by sport and difficulty with the explicit `active = true` filter; the hook independently handles loading/empty/error/loaded like `useEmpower` (PRD-01 FR-48; screens Learn home, Drill library)
- [ ] AT-135 Drill detail + mark complete: instructions, a mark-complete action that INSERTs the own `drill_completions` row, completion state that persists across reload, idempotent (a completed drill shows completed and does not re-award), no redo affordance (PRD-01 FR-49; screen Drill detail)
- [ ] AT-136 Roadmap + Milestones screens: milestone track with the current stage highlighted and XP thresholds shown, Milestones screen rendering earned vs locked from real `user_milestones` data with a lucide icon per milestone and never an emoji (PRD-01 FR-50, FR-51; screens Roadmap, Milestones)

### Track D: fixtures and copy (haiku)
- [ ] AT-137 Learn seed fixtures: `supabase/seed/seed_p7_learn.sql` with drills across sports/difficulties/`xp_value`s (some inactive, to prove the active filter), `roadmap_stages` per sport with ascending `xp_threshold`s, milestones covering both `xp_threshold` and `drill_count` criteria each with a lucide `icon_name`, and a few `drill_completions` for one demo player so roadmap and milestones render populated; every seed row carries its explicit owner id and any isolation fixture uses two ids asserted to DIFFER; no emoji, no hyphen/em-dash in any seeded copy string (PRD-01; PRD-04)
- [ ] AT-138 House-style copy pass across all P7 Learn mobile screens and the admin drill screens: no emoji and lucide names only, no hyphen/em-dash in any copy string, JetBrains Mono tabular figures on every numeric readout (XP, levels, stage numbers, counts, progress percent), tokens only, all four states present on every screen (CLAUDE.md; DESIGN-LANGUAGE.md; PRD-01 FR-70)

### Track E: verification (opus)
- [ ] AT-139 XP tamper-proof and gate verification, against the LIVE project, non-vacuously by actual attempts and row reads: (1) a real player marks a drill complete and exactly one `xp_events` row appears with `xp_amount == drills.xp_value`, no client `xp_events` write in the path; (2) the roadmap current stage advances as a pure function of the XP total when a threshold is crossed, and a milestone unlocks when its criteria are met; (3) direct `authenticated` INSERT into `xp_events` and `user_milestones` each return `42501`, and a client cannot forge `xp_amount`; (4) idempotency: a duplicate completion writes no second event and leaves the total unchanged; (5) isolation, two player ids asserted to DIFFER first, A's XP/roadmap/milestones never visible to B, the public catalog readable but the app `active = true` filter enforced; (6) admin create/edit/deactivate each write exactly one `audit_log` row and a non-admin drill write is refused. Capture light and dark web evidence under `docs/phases/evidence/p7-web/` (PRD-01 FR-48, FR-49, FR-50, FR-51; PRD-04 FR-49, FR-50, FR-51; CLAUDE.md permissive-OR)

## Dependency order

Track A first: AT-129 (schema) -> AT-130 (RLS) and AT-131 (triggers) -> AT-132 (read layer). AT-131 needs AT-129; AT-132 needs AT-131. Track B (AT-133) needs AT-129/AT-130. Track C needs AT-130 + AT-132 (and seeded drills from AT-137 for populated render). AT-137 fixtures need AT-129. AT-138 runs after the screens land. AT-139 verification runs last, after every other P7 ticket.
