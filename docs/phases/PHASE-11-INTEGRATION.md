# Phase 10/11 Integration

Branch `phase-11/integration` consolidates the phase-10 and phase-11 product branches off `origin/main` (1199955).

## Branches merged (in order)

1. `phase-10/auth-logic-fixes` (9ccfb0e) — contains `phase-10/auth-redesign` (33ddb68); the redesign was branched into it, so the aurora AuthScene came in with this merge and the separate auth-redesign merge was skipped (`git branch --contains 33ddb68` confirmed the containment).
2. `phase-10/fix-chat-names` (42bcd25)
3. `phase-10/fix-fb002-dark` (fe526d1)
4. `phase-10/bugfix-014-015` (d2a61bb)
5. `phase-11/clutch-profile` (bdab05d)
6. `phase-11/sports-learn` (c5574e8)

All six merged with git's ort strategy with no manual conflict resolution required. The additive overlaps (splash.tsx, SettingsContent.tsx, trainings shell, hooks.ts, database.types.ts) auto-merged keeping both sides.

## Migrations: three files share the 0088 prefix

`0088_join_group_member_before_full.sql`, `0088_clip_saves.sql`, and `0088_set_athlete_sports.sql` share the `0088` prefix but have distinct full names. They are independent and additive, and all three are ALREADY APPLIED to prod. They are kept as-is (distinct full names sort deterministically) and deliberately NOT renumbered or re-applied, because renumbering a filename after it has been recorded as applied would make the runner treat it as a new unapplied migration. Do not drop, renumber, or re-apply any of them.
