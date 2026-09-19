# Debt and incident log

## 2026-08-14: a plain `CI=1 pnpm install` left `@atlitos/admin` unbuildable
## on this machine; `--force` fixed it, cause not fully root-caused

Found running `scripts/dod.sh` for the first time this pass. `CI=1 pnpm install` (no `--force`)
completed with exit 0 and reported everything up to date, but `node_modules/.pnpm` had no
`@rolldown+binding-*` package at all despite `@rolldown/binding-darwin-arm64` being pinned in
`apps/admin/package.json` and present in `pnpm-lock.yaml`. `pnpm turbo build` then failed on
`@atlitos/admin` with rolldown's own error message pointing at exactly this class of bug: "npm
has a bug related to optional dependencies." `CI=1 pnpm install --force` pulled 174 more packages,
including every `@rolldown/binding-*` platform variant, and the build went green.

Not fully root-caused: this pass could not tell whether the cause was a stale local pnpm content
store on this machine (most likely, since GitHub's runners start from an empty store on every
job and would resolve fresh) or a real lockfile/resolution bug that would reproduce in CI too.
**If the `workspace` job in `.github/workflows/dod.yml` ever fails on `@atlitos/admin#build`
with this exact "Cannot find native binding" error, this is the known cause and `--force` on the
install step is the known fix**; not applied preemptively to CI because a forced install on every
CI run defeats the lockfile pinning `--frozen-lockfile` exists for, and this pass produced no
evidence the plain form fails in a genuinely clean environment. Owner: whoever next sees this
error in an actual CI run.

## 2026-08-14: Maestro regression is not wired into CI, and schema drift against
## production has not been re-verified with a live query in this pass

**Owner: whoever next has a GitHub Actions macOS runner budget (Maestro needs a real
simulator/emulator, which ubuntu-latest cannot provide) and whoever next holds Supabase
credentials for `syzzfgaudpifwvbpycyi` outside this session.**

Two gaps carried forward honestly rather than closed under pressure:

1. **Maestro is not in CI.** `db-migrations` (this file, `dod.yml`) proves the database side on
   ubuntu-latest; the 13+ Maestro flows need a booted iOS Simulator or Android emulator, which
   GitHub's free-tier ubuntu runners cannot provide and macOS runners are expensive and slow to
   provision from a from-scratch build. This pass ran `scripts/dod.sh`, `security-invariants.sh`
   and the new `db-migrations` job's steps locally and did not build the mobile app for a
   simulator or drive any Maestro flow against the local stack, for the same reason: pointing the
   app at `http://127.0.0.1:54321` requires a config change to `apps/mobile/.env` (never read
   directly this pass, permission denied by design) and a full Release build, which is a
   multi-hour undertaking distinct from database validation. The 13 flows most recently proven
   (`docs/qa/CURRENT-STATE.md`) were run against production, read only; none has been re-run
   against the local stack's seeded data, including the two write flows
   (`groups-athlete`, `groups-coach`) the local stack was specifically built to finally unblock.

2. **Schema drift against production was not re-verified with a new live query in this pass.**
   The founder brief asked for a fresh read-only comparison of production's applied migration set
   against the 114 files in this repo. This session's environment carried no Supabase MCP tool
   and no production credential (by design: `.env.local` and `apps/mobile/.env` are permission
   denied, and no other credential was supplied), so no new SQL was run against
   `syzzfgaudpifwvbpycyi`. What is reported instead, in the validation section of this pass's
   handoff, is a compilation of what earlier sessions already verified read only and recorded
   with a query and its output: the applied ceiling was `0097` as of 2026-08-13
   (`0113_bounded_reads_support.sql`'s own header), 104 rows total, timestamp-versioned by
   filename rather than by this repo's `NNNN` numbering. Files `0099` through `0114` (16 files;
   `0098` does not exist on this branch, it lives unmerged on `phase-11/p6-account-deletion`) are
   therefore the best current estimate of what is unapplied, not a number obtained by a new
   catalog query. **This is inference from prior evidence, not a new proof, and CURRENT-STATE.md
   is explicit that an absence in the repo is not evidence about production.** Closes when
   someone with `syzzfgaudpifwvbpycyi` read access runs, at minimum,
   `select name from supabase_migrations.schema_migrations order by name` and diffs the result
   against `ls supabase/migrations`, plus a live `information_schema`/`pg_policy` structural
   comparison for any file among the 16 that could have reached production outside a tracked
   migration (the management API path CURRENT-STATE already documents as how migrations have
   actually reached this project).

## 2026-08-14: the notification push sweep is not scheduled in production

**Owner: whoever next has write access to production Supabase Vault. Closes when the two
`vault.create_secret` calls in `supabase/deploy/README.md` have been run against
`syzzfgaudpifwvbpycyi` and `supabase/deploy/notification_push_sweep_schedule.sql` has been run
after them.**

The scheduling step for `notification-push-sweep` (SCALE-REALTIME R-7) was written as migration
`0111_notification_push_sweep_schedule.sql` and moved to
`supabase/deploy/notification_push_sweep_schedule.sql` on 2026-08-14, a structural fix: it
depends on two Supabase Vault secrets (`project_url`, `service_role_key`) that are real
per-environment values and cannot live in a migration file replayed on a clean database in any
environment. Moving it did not schedule the job. Production has zero rows in `vault.secrets`
(verified read only, 2026-08-14), so `notifications.pushed_at is null` will keep accumulating
in production until a human runs the two `vault.create_secret` statements and then the script.
This was true before the move too; the move only makes the gap honest instead of blocked behind
a migration that would have failed a from-scratch local apply.

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

## Production configuration that exists only in the dashboard

**Owner: founder. Opened 2026-08-14.**

Five separate settings have now been found that exist in the production project
and leave NO trace in this repo. Each one made a clean environment silently
disagree with production, and in every case the symptom was an empty result or
a silent refusal rather than an error:

| Setting | Symptom when absent | Found by |
|---|---|---|
| `RAZORPAY_WEBHOOK_SECRET` | webhook signature check cannot run | earlier, in CURRENT-STATE |
| `enable_anonymous_sign_ins` | every guest flow dies, "Guest browsing is unavailable" | running Maestro locally |
| `custom_access_token_hook` registration | `has_role()` is FALSE for every user, so every role gated policy returns empty WITH NO ERROR | coach dashboard showed "No sessions yet" over a database holding a completed session |
| `verify_jwt = false` on 3 edge functions | next deploy 401s every Razorpay capture, silently, because Razorpay retries a non 2xx | surface audit |
| `pg_net` extension plus 2 vault secrets | migration 0111 cannot apply at all | local stack bring up |

Four of the five are now pinned in `supabase/config.toml`. The fifth needs a
human in the dashboard.

**Why this is a class and not five bugs.** The failure mode is identical every
time: the absence passes. Nothing errors, nothing logs, a query just returns
nothing and it looks exactly like missing data. It is the same shape as the
pre-push hook calling scripts that never existed, and as the storage policies
that gated on bucket name alone.

It also invalidated work. The surface audit's three tracks each hit the
`custom_access_token_hook` hole independently and each worked around it
DIFFERENTLY (a hand signed JWT, the GoTrue admin API, and abandoning the HTTP
path entirely), so no local authorization result from that audit is comparable
across tracks. Any future agent told "run the auth tests locally" would have got
a vacuous green.

**The fix that closes the class:** production configuration belongs in
`config.toml` or a versioned deploy script, never only in a dashboard. Anything
that cannot live there is recorded here with an owner. A clean checkout that
cannot reproduce production is not a test environment, it is a different
product.
The root-cause code fix was re-applied on a fresh branch off `qa-fixes/manual-pass`
(same content as `637df13`'s script and spec changes, no DB write): `scripts/verify-groups-probes.mjs`
and `scripts/verify-realtime.mjs` self-clean their probe rows when
`SUPABASE_SERVICE_ROLE_KEY` is set, and `apps/e2e/specs/money/coaching.spec.ts`
(CO-06/CO-08) tears down its test group in a `finally` block.

The same read-only sweep also turned up a second, still-active source `637df13`
missed entirely: `apps/e2e/specs/chat.spec.ts` (CH-01, CH-02, CH-07) sends real
"e2e CH-01 <ts>" / "e2e CH-02 <ts>" / "e2e CH-07 offline <ts>" messages into
the player@/coach1@ demo personas' real coaching and group chat threads, with
no cleanup at all, and production still had rows from a run timestamped the
same day as this fix. Given the house rule "when you find a bug, sweep for
its class," the same self-teardown pattern (best-effort service-role delete
in a `finally` block, no-op when the key is absent) was added there too, and
the three message-text prefixes were added to `scripts/cleanup-e2e-test-data.mjs`'s
sweep list.

`scripts/cleanup-e2e-test-data.mjs`
now exists as the standalone sweep for whatever those can't self-clean, and
implements the payment_intent safety check flagged above: it looks up each
candidate group's `group_memberships.payment_intent_id`, skips deleting any
group with a `captured` payment_intent attached, and reports those as
blocked for human review instead. It is a human-run tool, never invoked by
an agent.

### 2026-08-11 verification pass: 41 historical chat_messages rows still in production, NEEDS HUMAN SIGN-OFF

Re-verified F-31c against `syzzfgaudpifwvbpycyi` with read-only SQL after the
above fix (self-teardown in `apps/e2e/specs/chat.spec.ts` and
`money/coaching.spec.ts`, plus `scripts/verify-groups-probes.mjs` /
`scripts/verify-realtime.mjs`) was already committed:

- `training_groups` matching `E2E CO-06 `, `E2E CO-08 `, `Oversell Probe `:
  0 rows. Confirmed clean, matches the prior note above.
- `group_memberships` joined to those groups: 0 rows.
- `chat_messages` matching any of `AT-59 realtime probe `, `AT-59 realtime
  probe trial2 `, `Native e2e CH-10 ping`, `e2e CH-01 `, `e2e CH-02 `, `e2e
  CH-06 should be rejected`, `e2e CH-07 offline `: **41 rows**, dated
  2026-07-27 through 2026-08-11 07:51 UTC (i.e. pre-existing, from e2e runs
  before this session's self-teardown fix landed; nothing in this session
  wrote any of them). All 41 are plain `chat_messages.text` rows with no
  `payment_intent` linkage of any kind (chat messages don't carry a
  payment_intent_id), so they carry none of the referential-integrity risk
  the 637df13 incident did.

This session did not delete them, per the hard rule: read-only SQL against
production is fine, DELETE is not, no exceptions, even for a well-scoped
cleanup of test-fixture rows. `scripts/cleanup-e2e-test-data.mjs` (already
merged in this branch, includes the payment_intent safety check) is the
correct, reviewed tool to run this by hand:

```
node scripts/cleanup-e2e-test-data.mjs --dry-run   # inspect the 41 rows first
node scripts/cleanup-e2e-test-data.mjs             # then run for real
```

It requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for
`syzzfgaudpifwvbpycyi` in the environment, matches only the exact literal
prefixes above (no broad LIKE), and refuses to touch any `training_groups`
row whose membership carries a `captured` payment_intent (none currently
match, since the 41 remaining rows are `chat_messages`, not groups). A human
should run the `--dry-run` pass, confirm the row count and IDs look like the
41 listed here, then run it for real. Until that happens, a small number of
old test messages remain visible in the affected chat threads on
atlitos-app.vercel.app; the self-teardown fix already merged stops the count
from growing further.

## 2026-09-17

- **`packages/types/src/db/database.types.ts` is stale.** Generated with older CLI options; it lacks `account_deletions` and other tables, so it is hand-patched (0120 added `venues.booking_url` by hand). Regenerate with `supabase gen types typescript --local` in its own commit and diff the consumers. Owner: Prasanth.
- **Courts affiliate click-out not built.** `venues.booking_url` exists and admins can enter it (0120), but the mobile court detail still shows the in-app slot picker. `COURT_SELECT` in `packages/api/src/hooks.ts` needs the column and the detail screen needs the button. Owner: next mobile session; on the launch tracker.
- **GitHub repo is public.** Product code and internal docs are world-readable. Make private. Owner: Abishai.
- **EAS production environment is empty.** After 85d5da6 removed the hardcoded block, a production build has no Supabase URL until the four `EXPO_PUBLIC_*` variables exist on EAS. Owner: Abishai.
- **`gear-nightly.yml` is an interim trigger for the catalogue health sweep.** Phase S2 Track D (PRD-07 FR-48; ADR-011 D4). `pg_cron` + `pg_net` is off today (the same gap `supabase/deploy/notification_push_sweep_schedule.sql` already documents and is blocked on), so `.github/workflows/gear-nightly.yml` curls `gear-recheck` (`{sweep:true}`) and `gear-embed` (`{sweep:true, limit:200}`) nightly at 21:30 UTC via `workflow_dispatch`/`schedule`, authenticated with the `SUPABASE_FUNCTIONS_URL` and `SUPABASE_SERVICE_ROLE_KEY` repo secrets. A missing secret or an Actions outage silently starves the sweep exactly the way an un-run push-sweep already starves notifications in production: the health page will look stale with no visible error. Replace with `supabase/deploy/gear_nightly_schedule.sql`, following the exact guarded template `notification_push_sweep_schedule.sql` sets (`pg_net`/vault-secret preconditions, refuse rather than silently no-op), once `pg_net` is enabled on the project; delete this workflow in the same change. Owner: Prasanth.

## 2026-09-19

- **BUG-048 and BUG-049 not ported.** Prasanth fixed grid Add to cart and the duplicate recommended rail on the old category screen (09b586d); that screen is now a redirect and the owned grid is behind `shop.owned_enabled`. Port both onto `shop/index.tsx`'s owned path before the flag is set true. Owner: whoever flips the flag.
- **Prasanth's 16 Sep migrations 0118 to 0125 were not landed as files.** Production never applied them (ledger checked 2026-09-19). Five duplicate work already on this line under other numbers: his 0118 is our 0109, 0120 is 0096 plus 0115 (`is_actor_active`, not `is_active_user`), 0122 is 0097 (`blocked_users`, not `user_blocks`; `useClutch().blockUser` now writes `blocked_users`), 0123 is 0098, 0124 is 0113, 0125 overlaps 0093 (`take_rate_limit_token`). His 0119 (SEC-F3, trainee video insert policy locks `storage_path` to null and the trainee to a real session) is carried as `XXXX_coach_trainee_video_path_lock.sql`. **Still owed: his 0121 (SEC-F5, `order_transition` writes its own `audit_log` row so the order move and the audit row commit together).** It needs `admin-order-advance` to drop its separate insert in the same change; land both together. Owner: Prasanth. `docs/architecture/DEPLOY-RUNBOOK.md` has the full per-migration analysis.
- **`0094_clip_failed_state_and_sweep_capture` is one file here and two in production (`0094a`, `0094b`).** Same content; the ledger names differ. Do not re-apply. Note it when the ledger is next reconciled. Owner: Prasanth.
- **Privacy policy names Synth Sports as the operator with a synthsports.co contact.** Carried from Prasanth's landing rewrite because the operator's legal identity is a founder decision, not a merge decision. Decide the operating entity and contact for Atlitos (the account move out of Synth is in progress) and update `apps/landing/privacy.html`, `terms.html` and the App Store privacy URL together. Owner: Abishai.
- **A partial `pnpm turbo typecheck lint` run reads as green for packages it never reached.** During the 2026-09-19 reconciliation the turbo run stopped at the first failing task (`admin#lint`), and a bare `tsc` in `apps/mobile` then found three errors turbo had not yet reported. Read `Tasks: N successful, M total` and treat N < M as red, never the absence of a package in the failure list. `scripts/dod.sh` uses the same turbo invocation; consider `--continue` so every task runs and every failure is listed in one pass. Owner: Prasanth.
