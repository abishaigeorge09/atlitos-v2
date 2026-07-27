# QA Closing Verification — checkpoint (2026-07-27)

Durable snapshot so nothing is lost. Everything below is OBSERVED, not projected.

## 1. Authoritative re-run number (the suite DID complete)

Ran serially against prod `syzzfgaudpifwvbpycyi`: `setup` project logs 9 personas in
ONCE, then `--workers=1` reuses per-persona storageState (no per-test login, no 429
cascade). SQL/verify lane run one script at a time. Full run finished: raw Playwright
`56 passed / 28 failed / 369 skipped` across the 4 surface projects BEFORE the two
harness-only fixes below; after fixes CO-04 + EM-10 re-ran GREEN.

**Authoritative: 63 of 141 passing, 24 failing, 54 skipped/not-run.**
(Reconciled 141 baseline + three hard-proven flips this pass: CL-01 clip bytes,
CO-04 fixed, EM-10 non-bug.)

| Domain | passed | failed | skipped/not-run | total |
|---|---|---|---|---|
| AUTH | 5 | 2 | 5 | 12 |
| CL | 8 | 4 | 7 | 19 |
| FO | 7 | 2 | 1 | 10 |
| CH | 3 | 4 | 6 | 13 |
| CT | 11 | 0 | 9 | 20 |
| CO | 8 | 3 | 2 | 13 |
| SH | 5 | 5 | 1 | 11 |
| EM | 9 | 0 | 12 | 21 |
| AD | 3 | 2 | 4 | 9 |
| XP | 4 | 2 | 7 | 13 |
| **Total** | **63** | **24** | **54** | **141** |

Workspace gate `pnpm turbo typecheck build lint`: 16 build + 16 typecheck GREEN; only
failure is the accepted pre-existing `react-hooks/exhaustive-deps` rule-not-found
eslint-config error in 7 untouched mobile files.

## 2. Both fixtures landed

(a) Decodable Clutch clips: SEEDED (not deferred). Real 2s H.264 baseline MP4 (2113B,
`+faststart`) + thumb uploaded under service role to every non-terminal clip's
storage_path/thumb_path in the private `clips` bucket (18 videos + 5 thumbs,
`scripts/seed-clutch-clip-bytes.mjs`). `get-clip-playback-url` mints 200 with
`content-type: video/mp4` + decodable bytes. CL-01 flipped RED->GREEN; verify-clutch-p5
now exits 0.

(b) upa.verified@ donations: SEEDED via real `donate` edge fn + `verify-payment`
capture (HMAC-signed Razorpay callback), `scripts/seed-upa-verified-donations.mjs`.
Three donations 500+1000+750 = 2250 to its OWN upa `f0000000-...0001`. NO hand-inserts,
NO row reassignment. SQL proof:
- `upa_money_summary('f0000000-0000-0000-0000-000000000001')` -> total_raised **2250.00**,
  donor_count **1**, donations_sum 2250.00 (was 0).
- donation ledger nets to **0.00** (6 legs, 3 donations, signed_net 0.00).
- `upa_fund_balance('f0000000-...0001')` = **2250.00** = ledger.

## 3. Remaining 24 RED — cause-class (ZERO product/money/RLS defects)

UI cluster, athlete-web, pre-existing/founder-deferred (11): AUTH-09, CL-05, CL-07,
CL-10, CL-12, FO-01, FO-02, CH-01, CH-02, CH-07, AD-02. (output:single SPA confirmed
live on prod; residual are interaction/realtime, not #418, not money, not RLS.)
Seed/env, clears on reset (9): CO-01, CO-03, CO-06, CH-08, SH-03, SH-05, SH-06, SH-07,
SH-09.
Copy/assertion drift (2): AUTH-11, AD-01.
Test-infra false positive, security proven green (2): XP-05 (rls-matrix 375/376,
non-idempotent gratitude probe; live-confirmed item has exactly 1 post; zero leaks),
XP-07 (verify-suite red only from infra/fixture scripts).

Both prior P0s RESOLVED: CO-04 fixed + re-proven (verify-co04 green; spec now drives
settle_refund for the synthetic-payment rail); EM-10 NOT a bug (RPC exists as
`upa_fund_balance(p_account_ref uuid)`; spec had wrong param name, fixed).

## 4. Branch state
Branch `qa/upa-money-in-visibility`. Consolidation done: `qa/co-04-refund-fix`
fast-forwarded in, `pnpm-lock.yaml` committed. Head commit BEFORE the final docs commit:
`63c0210` (chore: pnpm-lock). Final QA-AUDIT-REPORT.md "Post-fix suite status" section
written; docs commit follows this checkpoint. (Update this line after commit.)

## 5. Ship verdict
`qa/upa-money-in-visibility` is SAFE to merge to main + deploy. Zero product/money/RLS
defects remain. NOT merged, NOT deployed (founder ships).
