# Phase 7 Checkpoint — Track A (schema, RLS, XP engine, read layer)

Working memory for resumability. Deleted at phase-close (folded into PHASE-7-STATUS.md).

## Track A tickets: AT-129 (schema), AT-130 (RLS), AT-131 (XP engine), AT-132 (read layer) — ALL BUILT + VERIFIED

## Applied remotely (all four migrations, in order)
- [x] 0057_learn_schema — enums drill_difficulty/xp_source + 6 tables + UNIQUE/CHECK/indexes
- [x] 0058_learn_rls — public catalog, owner-scoped completions, un-forgeable xp_events/user_milestones
- [x] 0059_learn_xp_engine — AFTER INSERT trigger grant_xp_on_drill_completion() + milestone eval
- [x] 0060_learn_read_layer — get_learn_home()

## Verification (all passed, live project, then test data cleaned up)
- Real own-row completion -> exactly ONE xp_events row, xp_amount=60 == drills.xp_value.
- Smuggle attempt (client supplies xp on completion) -> 42703 (no such column; no channel to forge).
- Direct authenticated INSERT into xp_events -> 42501; into user_milestones -> 42501.
- Duplicate completion of same drill -> 23505 UNIQUE(user_id,drill_id); no second event, total unchanged.
- Cross threshold (total 360): unlocked xp100 + drill_count2 (1 row each, idempotent), NOT xp500.
- get_learn_home() as A: xp_total 360 (derived), current_stage Rising(102), next Elite(500), 2 earned.
- Isolation: ids asserted DIFFER; A's xp_events/completions/user_milestones = 0 visible to B; catalog=3 visible; B empty state (xp 0, sport null).

## Advisor
- Security advisor: 7 learn findings, all WARN, all baseline-pattern (Anonymous Access Policies x6 tables + SECURITY DEFINER executable on get_learn_home, same class as every prior domain). No ERROR on learn tables. No new class.

## Typecheck
- [x] pnpm turbo typecheck green (12/12), types regenerated in packages/types/src/db/database.types.ts

## Docs
- [x] SCHEMA.md learn section: shipped note (0057-0060) + engine/read-layer summary
- [x] RLS.md learn section: shipped note (0058) + permissive-OR active-filter contract

## Handoff to Tracks B/C/D
- Tables: drills, drill_completions, roadmap_stages, xp_events, milestones, user_milestones
- Read RPC: get_learn_home() -> jsonb {sport, xp_total, current_stage, next_stage, stages[], milestones[]}
- Write path (Track C): client INSERTs own drill_completions {user_id, drill_id}; trigger does the rest.
- Consumer reads of drills MUST carry .eq('active', true) (permissive-OR).
- Track B admin drill CRUD RPCs (admin_upsert_drill/admin_set_drill_active) NOT built here (Track B owns).
