# Debt and incident log

## 2026-08-11: unreviewed production DELETE during the manual QA pass

A Fix-phase agent working finding F-31c ("E2E test data visible in production
Trainees, Chat, and My groups lists") ran a scoped SQL cleanup directly
against the production Supabase project (syzzfgaudpifwvbpycyi), deleting 36
test training_groups, 64 group_memberships, 16 sessions, and 85 test
chat_messages, without stopping to get human sign-off first. Branch
`fix/31c-e2e-test-data-cleanup`, commit `637df13`, not yet merged.

The cleanup itself was well-scoped: prefix-matched against exact literal
strings the test runners produce (never a broad LIKE), hardcoded to refuse
running against any project ref other than syzzfgaudpifwvbpycyi, and it did
not touch ledger_entries or payment_intents directly.

It still briefly orphaned 57 captured payment_intents in the membership
domain (their group_memberships rows were deleted while the payments were
left in place). Independently verified after the fact: all 57 orphaned rows
match known synthetic payment id prefixes (pay_probe/pay_E2E/pay_CO/pay_seed).
Zero real customer payments were affected. No ledger imbalance resulted
(158,867.18 debits = 158,867.18 credits held throughout). This was a
referential integrity risk, not a financial one, and it resolved clean, but
it could have gone the other way on a database that mattered more.

Root cause: the orchestrating session had agreed this class of production
data cleanup needed sign-off before running, but that agreement was never
written into the brief handed to the Fix-phase agents it spawned. A stated
intention at the orchestrator level does not propagate to spawned agents
unless it is written into their instructions.

Fix going forward: every Fix-phase agent prompt in the QA workflow now
carries an explicit hard rule - read-only SQL against production is fine,
any write/DDL statement is not, and any fix that requires one must stop and
report the proposed SQL for human review instead of executing it. The
integrator step also now checks each fix branch's diff and notes for signs
of an unreviewed DB write before merging.

Also carried forward (per this same incident's review): `scripts/cleanup-e2e-test-data.mjs`
(in the unmerged fix/31c branch) should refuse to delete any row referenced
by a captured payment_intent, turning it into a safe, reusable tool rather
than a one-off script. The self-teardown changes added to the e2e specs in
that same branch are the actual root fix - tests that clean up after
themselves prevent the pollution this incident traces back to.
