# Every gate, watched failing

Written 2026-08-14 on branch `track/dod-security-gates`, off `integration/p6-audit-fixes`.

This document exists so nobody has to take the enforcement layer on trust. `docs/qa/CURRENT-STATE.md`
records the rule that earned it: **a gate must be watched failing before it is believed.** For every
check in `scripts/security-invariants.sh` and every step in `scripts/dod.sh`, a violation was
planted, the script was run, the failure was read, the plant was removed, and the tree was proved
clean afterwards.

## What was broken

`.git/hooks/pre-push` had called two scripts since 11 August 2026:

    if [ -x scripts/dod.sh ]; then ...
    if [ -x scripts/security-invariants.sh ]; then ...

Neither file existed in the tree. Neither had ever existed in any commit. There was no `.github/`
directory. The `[ -x ]` guard makes an absent file a false test, so the body never ran, the hook
printed nothing, and the push proceeded. Reproduced directly:

    $ if [ -x scripts/never_existed.sh ]; then echo "body ran"; fi; echo "exit_after_guard=$?"
    exit_after_guard=0

Nothing printed above that line. The absence passed.

## The checks, and the plant that made each one red

Every run below is `scripts/security-invariants.sh --offline` unless stated. Exit code shown is the
script's.

| Check | Planted violation | What the run printed | Exit |
|---|---|---|---|
| `money-client-write` | `.from("payment_intents").update({ status: "captured" })` in `apps/mobile/src` | `FAIL money-client-write ... __invariant_canary.tsx:4: .from("payment_intents")` | 1 |
| `money-status-write` | a chained `.from("sessions").update({status})` and a single-line `.from("court_bookings").update({status})` | both reported, lines 4 and 7 | 1 |
| `e2e-negative-proof` | `apps/e2e/specs/__invariant_canary.ts` writing `ledger_entries` with no `expect(` in the file | `FAIL ... touches a money table with no expect() in the file` | 1 |
| `hardcoded-hex` | `{ color: "#FF6B00", border: "#1a1a1aFF" }`, plus `#14100B` inside a comment on the line above | the code line reported, **the comment line not reported** | 1 |
| `no-emoji` | a pictograph and a dingbat-plus-variation-selector in two string literals | both reported at lines 2 and 3 | 1 |
| `copy-dashes` | em-dash in a `title=` prop, spaced hyphen in a JSX text node, en-dash in a `label=` prop, em-dash in a `message:` value, plus an em-dash in a comment | the four copy sites reported, **the comment not reported** | 1 |
| `owner-scope` | three reads of dual-policy tables in one file: unscoped, scoped with `.eq`, and unscoped under a waiver comment | **only the unscoped one** reported, at line 4 | 1 |
| `owner-scope`, list missing | `docs/qa/verify/dual-policy-tables.txt` moved away | `FAIL owner-scope the dual-policy table list is missing` | 1 |
| `db-dual-policy-drift`, stale | a live list carrying one extra table the tree does not know | `FAIL ... the committed dual-policy table list is stale` with the diff `> new_public_table` | 1 |
| `db-dual-policy-drift`, unreachable | `ATLITOS_DB_URL` pointed at a closed port | `FAIL ... could not query the live catalog` plus psql's connection refused | 1 |
| `db-dual-policy-drift`, absent | no connection string, no `--offline` | `FAIL ... the drift check could not run. A check that should apply but cannot run is a failure, not a skip.` | 1 |

Three of those rows are negative tests on the exclusions rather than on the rule, and they matter as
much: a check that also fires on its own documentation, on a waived line, or on an insert is a check
people learn to ignore.

`scripts/dod.sh`, planted with `export const plantTypeError: number = "this is not a number";` in
`apps/admin/src`:

    dod: invariants OK
    @atlitos/admin:typecheck: src/__dod_canary.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'.
    dod: typecheck FAILED
    dod: lint OK
    dod: RED.  Failed steps: typecheck
    DOD_EXIT=1

The hook, three ways:

    # scripts/dod.sh moved away
    pre-push: REQUIRED GATE MISSING: scripts/dod.sh is not in the tree.
              Refusing the push. A gate that is absent has not passed, it has not run.
    HOOK_EXIT=1

    # scripts/security-invariants.sh present but chmod -x
    pre-push: scripts/security-invariants.sh exists but is not executable, so it cannot run.
              Refusing the push. Fix with: chmod +x scripts/security-invariants.sh
    HOOK_EXIT=1

    # an emoji planted in apps/mobile/src, hook run end to end
    pre-push: running scripts/security-invariants.sh
    FAIL  no-emoji                 emoji in source
    pre-push: security invariants are RED, so this push is refused.
    HOOK_EXIT=1

That last one is the whole point: the same absence that used to exit 0 now exits 1.

## Three bugs the planting found, that reading would not have

Recorded because each was invisible in the source and obvious in the output.

1. **BSD awk silently mangled every pattern.** `\.from\("..."` handed to awk via `-v` had its
   unrecognised escapes stripped before the regex engine saw it, leaving an unbalanced group and a
   syntax error on all 386 files. Fixed by writing `[.]from[(]` with bracket classes, which behave
   the same under BSD awk, gawk and mawk. Sibling of the `grep -E` and `\b` trap already recorded on
   this project: a pattern that cannot match is indistinguishable from a tree that is clean.
2. **The emoji check reported the right file at line 8007 of a three line file.** Perl's `$.` keeps
   counting across an `ARGV` list unless the handle is closed at `eof`. It found the violation and
   could not tell you where.
3. **Two of the first two `money-status-write` findings were false positives**, both TypeScript row
   type declarations (`status: SessionStatus;`) sitting a few lines under a plain SELECT, at
   `packages/api/src/use-coach.ts:563` and `packages/api/src/use-shop.ts:1024`. The rule was
   re-anchored on the write verb, which is the thing actually forbidden. Three more false positives
   followed on `owner-scope`, all `.insert(...).select(...)` chains, which is an insert with a
   RETURNING clause and not a read.

None of the three would have been caught by running the script against a clean tree, because all
three produce a green.

## The tree afterwards

    $ git status --porcelain
     M apps/admin/src/pages/venues/list.tsx
     M docs/DEBT.md
    ?? .github/
    ?? docs/qa/verify/dual-policy-tables.txt
    ?? scripts/dod.sh
    ?? scripts/hooks/
    ?? scripts/install-hooks.sh
    ?? scripts/security-invariants.sh

No canary file survived. The only change to product source is a four line waiver comment on the
admin venue queue, which is the one legitimately unscoped read of a dual-policy table in the
codebase.

## What is NOT proven

- **`db-dual-policy-drift` has never run against production over psql.** Its comparison logic was
  born red and then green using `--live-tables` with a catalog dump, and its failure branches were
  all exercised, but the psql path itself was only watched failing against a closed port. Production
  credentials live in `.env.local`, which this session is not permitted to read. Recorded in
  `docs/DEBT.md`.
- **The GitHub Actions workflow has never executed.** It is committed and unrun. Its first real run
  is its own born-red moment and should be watched.
- **No UI was touched, so no screenshot or Maestro run applies.** The one source edit is a comment.

## copy-dashes widened, p6 integration audit, 2026-08-14

An adversarial audit of the p6 scale merge found `copy-dashes` PASSING over three real misses,
because the original pattern only fired inside JSX props, JSX text nodes and object-literal
keys. Reproduced against a planted file, `apps/mobile/src/__copy_dashes_plant.ts`:

    export const PLANT_EM_DASH_CONST = "This is copy — with an em dash in a bare const.";
    export const PLANT_EN_DASH_CONST = "This is copy – with an en dash in a bare const.";
    export function plantTemplateLiteral(name: string) {
      return `Hello ${name} — welcome to the app.`;
    }

Run before widening: `PASS copy-dashes no em-dash, en-dash or spaced hyphen in rendered copy`.
A check reporting clean over an unexamined class is worse than no check (CLAUDE.md, rules
learned expensively), so the pattern was widened to also cover em-dash/en-dash inside bare
`const` string literals and single-line template literals (deliberately not the spaced hyphen,
see the script comment for why that would be false-positive-prone on this shape). Same three
planted lines, same file, after widening:

    FAIL  copy-dashes              dash punctuation in user-visible copy
            apps/mobile/src/__copy_dashes_plant.ts:1:export const PLANT_EM_DASH_CONST = "This is copy — with an em dash in a bare const.";
            apps/mobile/src/__copy_dashes_plant.ts:3:export const PLANT_EN_DASH_CONST = "This is copy – with an en dash in a bare const.";
            apps/mobile/src/__copy_dashes_plant.ts:6:  return `Hello ${name} — welcome to the app.`;
            Use a comma or a period. See CLAUDE.md > House style.
    security-invariants: 1 of 8 checks FAILED.

The plant was then deleted (`git status --porcelain` clean afterwards) and the real merged tree
re-run: `PASS copy-dashes` with 0 offenders, confirming the wider pattern does not fire on the
`// ATLITOS v2 - <path>` file header convention (162 files, excluded as a comment line) or on any
other existing const/template literal in the tree.
