# Debt and incident log

## 2026-08-14: a private repo on the free plan cannot require a status check

**Owner: the founder (Abishai). Closes when the repo is on GitHub Pro or Team,
or is made public, and `Definition of Done / Security invariants` is added to
the branch protection rule for the default branch as a REQUIRED check.**

`.github/workflows/dod.yml` now runs the invariants and the typecheck, lint and
build on every push and pull request. On the free plan a **private** repository
cannot mark a status check as required, so that workflow reports and cannot
refuse. A red tick and a merged pull request can coexist. Per the house rule,
CI that cannot block is not a gate, so it must not be described as one.

**The stand-in gate is `scripts/hooks/pre-push`**, installed into a clone by
`scripts/install-hooks.sh`. It refuses the push when the invariants or the
Definition of Done are red. Its limits are real and are stated in its own
header: it applies only to a machine that has run the installer, `git push
--no-verify` skips it, and it cannot touch a push made anywhere else. It is a
gate for one person on one machine.

Until this is closed, the honest description of enforcement on this repo is:
one laptop refuses, everything else reports.

## 2026-08-14: two invariant sub-checks that cannot fully run

Both are recorded rather than quietly dropped, because an unrunnable check that
nobody wrote down reads as a passing one.

1. **`db-dual-policy-drift` does not run in CI.** It re-derives the set of
   tables carrying both an owner and a public policy from `pg_policy` and fails
   if `docs/qa/verify/dual-policy-tables.txt` is stale. A GitHub runner has no
   route to the Supabase project and no credentials, so CI and the pre-push hook
   both pass `--offline`, and the script prints NOT RUN with what that leaves
   uncovered. Consequence: a table that GAINS a public policy is not noticed
   until someone runs the script with `ATLITOS_DB_URL` set, or supplies a
   catalog dump with `--live-tables`. Owner: whoever next runs a migration that
   adds a public read policy. Closes when a scheduled job with read-only
   credentials runs the non-offline form.

2. **`copy-dashes` does not catch an in-word hyphen.** It catches em-dashes,
   en-dashes and a hyphen used as punctuation between spaces. It deliberately
   does not catch `placeholder="YYYY-MM-DD"` at
   `apps/mobile/src/app/profile/edit.tsx:318`, which is on the founder decision
   list in `docs/qa/verify/VERIFICATION-WAVE-1.md` section 6, nor compound words
   inside copy. Widening it today would fire on an undecided line, and a check
   that fires on legitimate code is how a whole script gets ignored. Owner: the
   founder, on the same decision. Closes when the date mask is settled, at which
   point the pattern can be widened and re-born-red.

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

**Correction, same day, found by the concurrent native QA session:** the
"referential integrity checked in both directions, resolved clean" verdict
above was itself incomplete. It checked `auth.users`/`public.users` and
`payment_intents`/`group_memberships` - the two relations the earlier
incident had already burned - but not `chat_threads`. The F-31c cascade
deleted the 36 training_groups, their memberships, and matching
`chat_messages`, but never touched the `chat_threads` (context_type
`'group'`) that pointed at those groups. Result: 38 of 39 group chat
threads in production are orphaned (only "Cric Squad" is real), and real
users see them in the Chat tab as threads titled just "Group" with no
messages. Filed as `AT-158`, deliberately not fixed here - the right fix
is probably not another delete, since `chat_messages` still reference
these threads, and whether those messages should survive their group is a
product call, not an agent's to make alone.

The auditing session's own words on this are worth keeping verbatim,
because the lesson generalizes past this one incident: "Checking only the
failure modes you already know about is exactly the trap we spent today
naming, and I walked into it while auditing someone else for it." A
verification is only as complete as the set of relations it checks, and
that set should be the schema's real foreign-key graph around the deleted
rows, not just the ones a prior incident already taught you to worry
about.

## 2026-08-11: same class of pollution, one layer up - e2e auth accounts

`apps/e2e/specs/auth.spec.ts`'s AUTH-03/AUTH-04 (register a new player/coach)
create a real account against production on every run and had no teardown,
same shape as the training_groups pollution above but at the auth layer.
Found 42 `e2e.player.*`/`e2e.coach.*@atlitos.dev` accounts dating back to
2026-07-27. Independently confirmed via SQL before acting: zero attached
court_bookings, payment_intents, group_memberships, or training_groups
across all 42 - pure signup-only fixture rows, nothing money-adjacent.
Deleted via `auth.users` (confirmed `ON DELETE CASCADE` to `public.users`
via `pg_constraint` before running it). Reviewed and executed by the human
in this session (not a spawned agent), consistent with the DB_WRITE_GATE
rule above.

Added self-teardown to both tests (`deleteE2eAuthAccount`, gated on
`SUPABASE_SERVICE_ROLE_KEY` being present, same graceful-degradation
contract as `coaching.spec.ts`'s CO-06/CO-08 teardown) so this stops
recurring. There is no in-app self-delete endpoint yet - confirmed by
reading `apps/landing/delete-account.html`, which is a manual
email-support process, Guideline 5.1.1 debt already tracked in
`docs/phases/OAUTH-GOOGLE-APPLE-SPEC.md`.
