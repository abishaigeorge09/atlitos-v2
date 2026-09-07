# Security remediation — 2026-09-04

Implementation pass against `output/doc/atlitos-v2-security-audit-2026-09-04.docx` (10 findings) and `docs/qa/SECURITY-AUDIT-2026-09-03.md`. Local only: no deploy, no migration push, no dashboard change, per the operator's instruction that the Supabase credentials are the repo owner's and are not available here.

**Disposition: still NOT safe to ship.** Every code and SQL fix below is written and proven locally, and none of it is live. The audit's P0s are closed in the repository and open in production until someone with project access deploys them.

## What was verified, and how

The blocker in the previous pass was that nothing in this repo could execute a migration without the live project's credentials. That is now false. `scripts/verify-migrations-local.sh` stands up a scratch Postgres, applies `scripts/local-supabase-shim.sql` (the minimum platform stand-ins: `auth`/`storage`/`cron` schemas, `auth.uid()`/`auth.jwt()`, the four Supabase roles and their default grants), replays all 91 migrations in order, and runs `scripts/verify-security-fixes.sql` against the result. No Supabase project, no service-role key, no Docker.

```
verify-migrations-local: applying 91 migrations...
verify-migrations-local: running scripts/verify-security-fixes.sql...
  ... 30 assertions ...
NOTICE:  verify-security-fixes: all cases passed
```

Negative control run: reverting `0089`'s policy on the scratch database makes the suite fail with `FAILED: SEC-F3 a coach cannot choose storage_path on insert`. The suite can fail.

Also run: `pnpm turbo typecheck` (12/12 pass), `deno check` on every edge function, `./scripts/check-release-config.sh`. Two **pre-existing** failures were confirmed to predate this work by re-running them against a stashed tree, and are untouched: `supabase/functions/checkout/index.ts` has 2 `TS2352` errors on its `__client_roundup` cast, and `@atlitos/mobile lint` reports 14 instances of `Definition for rule 'react-hooks/exhaustive-deps' was not found`, an eslint plugin registration problem rather than a code problem. Neither is a security defect and neither was introduced here.

Not run: `apps/e2e` (needs `SUPABASE_SERVICE_ROLE_KEY` and the live deploys) and any live probe.

## SEC-F11 (NEW, P1) — the migration chain was unreplayable

Not in the audit, found by executing what the audit could only read. `supabase/migrations/0027_session_transition_service_role_gate.sql` ended with stray tool-call output:

```
grant execute on function public.session_transition(...) to authenticated;
</content>
</invoke>
```

`psql` stops at `ERROR: syntax error at or near "</"`. The live database is presumably fine, because `0027` was applied before the corruption was committed, which is exactly why no one noticed: the deployed system looks correct while the repository cannot rebuild it. Any `supabase db reset`, any fresh staging project, any disaster-recovery replay breaks at migration 27 of 91.

Fixed by deleting the two lines. The harness above is the regression guard: it replays the whole chain, so a corrupt migration now fails a check instead of waiting for a rebuild.

## Findings addressed

| ID | Severity | State |
|---|---|---|
| SEC-F1 | P0 | Fixed locally, hardened. **Not deployed.** |
| SEC-F2 | P0 | Fixed locally, proven. **Not deployed.** |
| SEC-F3 | P1 | Fixed locally, proven. **Not deployed.** |
| SEC-F4 | P1 | Implemented locally, proven. **Not deployed.** |
| SEC-F5 | P1 | Fixed locally, proven. **Not deployed.** |
| SEC-F6 | P1 | Fixed, with a guard. Needs EAS secrets set. |
| SEC-F7 | P2 | Fixed locally. **Not deployed.** |
| SEC-F8 | P2 | **Not actionable here.** Dashboard only. |
| SEC-F9 | P3 | **Not done.** See below. |
| SEC-F10 | P3 | Fixed locally. **Not deployed.** |
| SEC-F11 | P1 | Fixed. Repo-only, no deploy needed. |

### SEC-F1 — arbitrary private clip read via `thumb_path`

The write guard from the previous pass is kept and now shares one predicate with a new read guard. `mintSignedClipUrl(supabase, objectPath, requiredPrefix)` takes the prefix as a REQUIRED third argument, so a new call site cannot forget it without failing to compile, and `assertPathUnderPrefix` refuses anything outside the prefix or containing a `..` segment. Prefixes are derived from the row (`${clip.owner_id}/`, `coach-videos/${coach_id}/${player_id}/`), never from the body.

This matters because the write guard alone leaves rows poisoned *before* the fix still mintable. The audit asked for exactly this and it is the reason the guard is on the shared function rather than at four call sites.

### SEC-F2 — captured payment with permanently incomplete downstream work

Confirmed worse than the audit's static reading: for courts, `court_booking_confirm_payment` commits the booking and a subsequent `ledger_entries` failure leaves a confirmed booking that no retry will ever credit.

Built the operator's chosen design. `payment_intents.finalized_at` (`0088`) records that the domain handler completed. The gate's zero-row branch now has three outcomes instead of two, and a `captured` intent with `finalized_at is null` re-enters its domain handler rather than reporting `already_processed`. Re-entry is safe because three of five handlers already had ledger idempotency guards; courts, the one that did not, gained one.

Backfill matters as much as the column: every row already at or past `captured` is stamped, or the entire live history would read as work-owed the moment this deploys.

Limits, stated rather than hidden: repair happens on the next delivery of a capture. `payment_finalization_backlog()` and the new `payments_unfinalized` arm of `expire_stale_holds()` make a stuck charge visible; nothing re-invokes finalization on its own. The audit's outbox worker was explicitly deferred by the operator.

### SEC-F3 — coach trainee video path and relationship injection

Both halves. `0089` requires `storage_path is null` on a client insert and an existing `sessions` row linking coach to the named player. `get-coach-trainee-video-url` re-derives the only prefix the row may point at, which also refuses rows written before the migration.

### SEC-F4 — suspension was a label, not a control

`users.status` had existed since `0001` and was read by nothing. Three layers now: the access-token hook denies a suspended user a token (widest, bounded by the token TTL); `getAuthenticatedUser()` refuses immediately, closing all 23 edge functions on the very next request; and a RESTRICTIVE `is_active_user()` insert policy covers twelve direct-write tables. `support_tickets` is deliberately excluded so a suspension stays appealable.

The operational path that did not exist at all: `admin_suspend_user` / `admin_reinstate_user`, admin-gated, reason-required, self-suspension refused, idempotent, with the audit row and member notification in the SAME transaction as the status change. `apps/admin`'s user list gained the action inline rather than behind the User Detail screen PRD-04 sketches, which is a product story this change did not earn.

### SEC-F5 — audit rows diverging from mutations

Moved into `order_transition` (`0091`), one transaction with the status change and the timeline row. This also fixes an accuracy bug the audit did not name: the edge function derived `before.status` from a lookup on the TARGET status whose fallback returned `in_transit`, so a `placed -> cancelled` advance was audited as though the order had shipped. There is a regression case for exactly that.

`book-court`'s walk-in audit result was discarded outright; it is now captured and logged. Logged rather than thrown, because the booking, intent and ledger group are all committed by that point and a 500 would tell a partner their walk-in failed when it did not. Marked with a `ponytail:` comment naming the ceiling: real atomicity needs one RPC owning the whole walk-in write, which is its own change.

### SEC-F6 — production EAS profile carried a test Razorpay key

`build.production.env` removed entirely, so EAS resolves all three values from project secrets. `scripts/check-release-config.sh` fails on `rzp_test` or `rzp_live` anywhere in `eas.json` and on a non-empty production `env` block, wired into the root `lint` script beside `check-tokens.sh`. Verified in both directions: it passes now and fails when the key is put back.

**Action required:** production builds will now fail closed until `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and a live `EXPO_PUBLIC_RAZORPAY_KEY_ID` are set as EAS production secrets. That is deliberate, and it is a real prerequisite before the next production build.

### SEC-F7 — internal error detail returned to clients

Fixed at `errorResponse`, the single function every response passes through, rather than at the ~40 `AppError("INTERNAL", err.message)` throw sites. Below 500 the message passes through untouched, because that is business meaning clients render (`SLOT_TAKEN`, `PRICE_MISMATCH`, `OUT_OF_STOCK`). At 500 and above the detail goes to the server log with a correlation id and the client receives the id. The CODE is preserved either way, which is what `mapEdgeFunctionError` keys on, so no client behaviour changes.

### SEC-F9 — not done

The LLM abuse budget. P3, and the operator asked for P0/P1 first. It needs a rate-limit store and a policy decision on the budget per user and per IP, which is product configuration rather than a defect fix. `ANTHROPIC_API_KEY` is not currently set on the project, so the exposure is latent; it becomes real the day that key is added, and should be closed before then.

## Blockers, in the order they matter

1. **Nothing is deployed.** Every edge-function fix (SEC-F1, F2, F5, F7, F10) needs `supabase functions deploy`, and every migration (0088-0091) needs `supabase db push`. Until then production has the vulnerabilities the audit described.
2. **Migration 0027's corruption means `db push` may need care.** The live project has almost certainly already applied 0027; confirm against `supabase_migrations.schema_migrations` before pushing, so the repaired file is not replayed into a database that already has it.
3. **EAS production secrets are unset**, and production builds now fail closed without them.
4. **SEC-F8 is dashboard-only.** Leaked-password protection for project `syzzfgaudpifwvbpycyi` cannot be enabled from code.
5. **The e2e truth lane has never run against these changes.** `apps/e2e/specs/security.spec.ts` now carries SEC-01 through SEC-07; SEC-04 in particular is written and unexecuted because it needs the live project.
6. **The token hook must be registered.** `0090`'s suspension denial only fires if `custom_access_token_hook` is still registered under Auth > Hooks. If it was ever removed, that layer is silently inert. The edge and RLS layers still hold, which is why it is not the only layer.

## Deploy runbook

```bash
supabase link --project-ref syzzfgaudpifwvbpycyi
supabase migration list                 # confirm 0027 is already applied
supabase db push                        # 0088, 0089, 0090, 0091
supabase functions deploy          # ALL of them, see below
E2E=1 SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @atlitos/e2e test
```

Deploy ALL functions, not a subset. `_shared/http.ts` (SEC-F7's error sanitisation) and `_shared/supabase.ts` (SEC-F4's suspension check) are imported by every function in the directory and are bundled in at deploy time, so a partial deploy leaves some functions still leaking 5xx detail and still serving suspended accounts. The functions whose OWN file changed are `stream-webhook`, `get-clip-playback-url`, `get-clip-moderation-url`, `get-coach-trainee-video-url`, `book-court` and `admin-order-advance`; the other seventeen change through `_shared/`.
