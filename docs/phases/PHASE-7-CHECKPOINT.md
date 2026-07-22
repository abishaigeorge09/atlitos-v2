# Phase 7 Checkpoint — Track A (schema, RLS, XP engine, read layer)

Working memory for resumability. Deleted at phase-close (folded into PHASE-7-STATUS.md).

## Track A tickets: AT-129 (schema), AT-130 (RLS), AT-131 (XP engine triggers), AT-132 (read layer)

## Migration plan (continues from 0056)
- [ ] 0057_learn_schema.sql — AT-129: enums + 6 tables + constraints + indexes
- [ ] 0058_learn_rls.sql — AT-130: RLS policies + grants (permissive-OR public catalog; owner-scoped; no client write on xp_events/user_milestones)
- [ ] 0059_learn_xp_engine.sql — AT-131: AFTER INSERT trigger on drill_completions -> xp_events + milestone eval
- [ ] 0060_learn_read_layer.sql — AT-132: get_learn_home() derived reads

## Applied remotely (record version ids here as they land)
- (none yet)

## Verification (record verdicts)
- (pending)

## Typecheck
- (pending)
