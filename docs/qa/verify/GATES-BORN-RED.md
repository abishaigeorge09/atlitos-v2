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

## Search Phase L0: the bar, the refactor, three invariants (2026-09-26)

Branch `l0/search-bar` off `integration/search-l0`. Every run below is local
(`http://127.0.0.1:54321`), functions served with empty `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`.
Exit codes are the scripts' own.

### `scripts/verify-search-eval.mjs`, born red against the CURRENT ai-search (before any search change)

Run at 21:02 IST, fixture only on the stack (`sharing 0 active non fixture affiliate products, 0
verified non fixture venues`). The plan predicted typo and Hinglish under threshold and no `answer`;
both happened, plus more:

    judgments 8070 rows: 7273 derived, 797 agent, 0 human, 0 llm.
              NO row is human graded. This measures the bar on derived and agent grades only.
    vector   vector path not exercised: no committed embeddings (docs/search-eval/fixtures/embeddings.b64.json is absent).
    class              n   CP     NDCG@10 P@5    Hit@1  R@5    honest court  ground flags
    gear_brand          10 1.000 0.848   0.900   n/a   n/a 0.900    n/a   n/a   n/a
    gear_typo           10 1.000 0.100     n/a   n/a 0.100 0.100    n/a   n/a   n/a
    gear_type           10 0.908 0.764   0.820   n/a   n/a 1.000    n/a   n/a   n/a
    gear_price          10 0.872 0.923   0.955   n/a   n/a 1.000    n/a 0.000   n/a
    gear_brand_price    10 0.952 0.886   0.850   n/a   n/a 0.900    n/a 0.000   n/a
    gear_age_skill      10 1.000 0.480     n/a   n/a   n/a 0.900    n/a   n/a   n/a
    gear_vague          10 1.000 0.631     n/a   n/a   n/a 0.800    n/a   n/a   n/a
    gear_hinglish       10   n/a 0.000     n/a   n/a 0.000 0.000    n/a   n/a   n/a
    gear_comparison     10 0.474 0.090     n/a   n/a   n/a 1.000    n/a 0.000   n/a
    gear_specific       10 1.000 0.795     n/a 0.700   n/a 1.000    n/a   n/a   n/a
    gear_empty          10 1.000 1.000     n/a   n/a   n/a 0.400    n/a   n/a   n/a
    gear_sport          10 1.000 1.000   1.000   n/a   n/a 1.000    n/a   n/a   n/a
    gear_keystroke       6   n/a   n/a     n/a   n/a   n/a   n/a    n/a   n/a 1.000
    crt_timed            8 1.000 0.990     n/a   n/a   n/a 1.000  1.000 0.000   n/a
    crt_place            6 1.000 0.831     n/a   n/a   n/a 0.833  0.667   n/a   n/a
    crt_venue            8 1.000 0.659     n/a 0.833   n/a 0.750  1.000   n/a   n/a
    crt_empty            6 1.000 1.000     n/a   n/a   n/a 0.833  1.000   n/a   n/a
    home                 6 0.979 0.644     n/a   n/a   n/a 1.000  1.000 0.000   n/a
    OVERALL            154 0.952 0.637                        0.779  0.917 0.000
    FAILED 21 gate(s):
      NDCG@10 [gear_typo] (needs 0.75) = 0.100
      Recall@5 [gear_typo] (needs 0.8) = 0.100
      NDCG@10 [gear_hinglish] (needs 0.75) = 0.000
      Recall@5 [gear_hinglish] (needs 0.8) = 0.000
      answer grounding (needs 1) = 0.000
      ... 16 more: constraint precision in 5 classes and overall (0.952), NDCG in 5 more
      classes and overall (0.637), Hit@1 gear_specific 0.700 and crt_venue 0.833, honest
      empty 0.779, court window 0.917
    exit 1

The bar is not wrong: it fails where the plan said it would, for the reasons the per query
findings name (every typo and Hinglish query returns empty; there is no `answer` field; the
comparison anchor is returned as its own "cheaper" answer; sold out products pass price ceilings).

`--degraded` (throttle saturated for the harness user, which is the gate outcome the plan's "spend
guard forced over budget" produces, without touching the shared daily budget):

    Response flags: vector=true on 0 of 160 queries, mode=llm on 0
      degraded NDCG@10 overall (needs 0.7) = 0.637
      degraded constraint precision (needs 1) = 0.952
    exit 1

`vector=true on 0 of 160` is the proof the run was actually degraded; the harness fails if any
degraded response reports `vector: true`. The same count in a normal `--class gear_brand` run is
`vector=true on 9 of 10`, so the assertion can tell the two apart.

### `--baseline-diff`, born red, then the L0-T2 refactor proven against it

    baseline recorded 2026-09-26 21:03 IST at df837d6        (--write-baseline)
    control, no code change:           baseline diff: 0 of 160 compared queries changed     exit 0
    PLANT index.ts results.slice(0, body.limit).reverse():
                                       baseline diff: 95 of 160 compared queries changed    exit 1
    plant reverted (git checkout):     baseline diff: 0 of 160                              exit 0
    after the split into fetch-gear.ts, fetch-courts.ts, fetch-people.ts (21:06 IST):
                                       baseline diff: 0 of 160 compared queries changed     exit 0
    PLANT fetch-courts.ts [...byVenue.values()].slice(1):
                                       CHANGED CRT-01.1 "badminton court tonight" ...       exit 1
    plant reverted:                    baseline diff: 0 of 160                              exit 0

The second plant sits inside a NEW module, which proves the served function was running the split
code and not a stale worker. Court broaden lines are compared with the slot phrase ("today at
9:30 PM") masked, since the clock moves it without any code change; ids are compared exactly and
in order. A later run on a stack carrying rows other proofs leave behind (two verified badminton
coaches from `verify-manual-payouts.mjs`) changed 1 of 160 (`GLB-01.1`, coaches added), with
`supabase/functions` unchanged since the refactor commit (`git diff --stat a556ecd HEAD` empty):
the diff is only meaningful on the catalogue state the baseline was taken on, and the harness
prints that state under `sharing` on every run.

### `scripts/lib/search-eval-metrics.test.ts` (tsx), NDCG against a hand computed example

Planted `Math.log2(i + 2)` -> `Math.log2(i + 1.5)` in the discount:

    FAIL  DCG of [3,2,0,1] is 9.3234658 (hand computed) (14.696836852176643)
    FAIL  IDCG of [3,3,2,1,0] is 13.3471848 (hand computed) (19.3826043086361)
    FAIL  NDCG@10 is 0.6985343, and the pool order does not matter (0.7582488203418738)
    FAIL  NDCG@2 cuts the ranking at 2: [0,3] over pool [3] is 7/log2(3)/7 = 0.6309298 (0.44250704934975993)
    FAILED 4 check(s)                                                                        exit 1

Reverted (`git status --porcelain` empty): `ALL CHECKS PASSED`, 19 of 19, exit 0.

### `scripts/seed-search-eval.mjs` refuses every non local target with zero writes

A fake `psql` first on PATH appends to a log whenever it is invoked:

    SUPABASE_URL=https://syzzfgaudpifwvbpycyi.supabase.co      REFUSED ... would write to PRODUCTION     exit 1
    same, plus ATLITOS_ALLOW_PRODUCTION_WRITE=yes-i-mean-production                                      exit 1
    ATLITOS_LOCAL_DB_URL=postgresql://postgres:pw@db.example.com:5432/postgres
                                                  REFUSED ... only writes to the local stack             exit 1
    psql log after all three:                     none (file never created)
    positive control, loopback target:            psql invoked: postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -q -f .../local_seed_search_eval.sql
                                                                                                         exit 0

The control shows the fake psql does log when called, so the empty log after the three refusals is
evidence rather than an unexercised check.

### `scripts/security-invariants.sh`: `no-fake-affiliate-tag`

Against the unmodified `scripts/seed-affiliate-catalog.mjs`:

    FAIL  no-fake-affiliate-tag    a hand written affiliate tag in a seed, script or eval file
            scripts/seed-affiliate-catalog.mjs:173:  offer('002', ..., 'https://www.amazon.in/dp/B08PDT4?tag=atlitos-21'),
            ... 8 lines
    security-invariants: 1 of 8 checks FAILED.                                          exit 1

The eight `?tag=atlitos-21` parameters were removed. The first pattern (`[?&]tag=|atlitos-21`)
then matched 0 lines while the same file still carried 9 `?aff=atlitos` parameters on Tennis Hub,
Decathlon and Cricket Store links (counted directly: `tag=` 0, `atlitos-21` 0, `aff=atlitos` 9).
Same fabrication under another name, so the pattern was widened to
`[?&](tag|aff)=|=atlitos|atlitos-21` and went red again:

    FAIL  no-fake-affiliate-tag    a hand written affiliate tag in a seed, script or eval file
            scripts/seed-affiliate-catalog.mjs:172:  offer('001', ..., 'https://www.tennishub.in/babolat-pure-drive-team?aff=atlitos'),
            ... 9 lines                                                                 exit 1

After removing them: `PASS  no-fake-affiliate-tag`, `security-invariants: 8 checks passed.` (offline).

### `search-log-no-user` and `clicks-zero-policy` (SQL, local catalog)

    clean:   PASS  search-log-no-user   search_query_log does not exist yet (Phase L1), so it has no user column
             PASS  clicks-zero-policy   RLS on and zero policies on: affiliate_clicks
             security-invariants: 14 checks passed.                                     exit 0
    PLANT create table public.search_query_log (..., user_id uuid, ...);
          create policy invariant_plant_admin_read on public.affiliate_clicks for select to authenticated using (true);
             FAIL  search-log-no-user   search_query_log carries a user column
                     public.search_query_log.user_id
             FAIL  clicks-zero-policy   a click table has a policy or has RLS off
                     affiliate_clicks: policy invariant_plant_admin_read
             security-invariants: 2 of 14 checks FAILED.                                exit 1
    PLANT 2: search_query_log WITHOUT a user column; alter table affiliate_clicks disable row level security;
             PASS  search-log-no-user   search_query_log has no column naming a user
             FAIL  clicks-zero-policy   a click table has a policy or has RLS off
                     affiliate_clicks: row level security is OFF
             security-invariants: 1 of 14 checks FAILED.                                exit 1
    plants dropped, RLS re-enabled (verified: 0 policies, 0 search_query_log tables, relrowsecurity true):
             security-invariants: 14 checks passed.                                     exit 0

Plant 2 matters as much as plant 1: it proves the check reports a table that exists without a user
column as clean (the branch L1 will actually hit), and that RLS off with zero policies, a wide open
table, is caught rather than read as "zero policies, fine".

### `scripts/search-eval-embed.mjs` and `scripts/probe-search-latency.mjs`

    embed, no key file, no env var:          no Voyage key ... Nothing was written.                     exit 1
    embed, SUPABASE_URL=production:          REFUSED: ... reads the fixture from the local stack only   exit 1
    harness with a SYNTHETIC blob (deleted afterwards): loaded 60 product and 160 query embeddings;
                                             first component round trips (-0.01785678 written, -0.0178568 read back);
                                             60 fixture rows embedded, 156 unique queries cached
    same blob, VOYAGE_MODEL=voyage-3-large:  ERROR committed embeddings are tagged voyage-3, VOYAGE_MODEL is voyage-3-large   exit 1
    blob removed:                            Cleared 60 fixture embedding(s) that did not come from the committed file.
    probe, production without --confirm-production:   REFUSED                                          exit 1
    probe, service role key:                           REFUSED: that is a service role key             exit 1
    probe, local stack, 1 run, unpaced:                40 of 40 HTTP 200; typing p50 24 ms p95 32 ms   exit 0

Neither was run for real: no Voyage key was available to this track, and the probe was not pointed
at production (`docs/phases/PHASE-L0-STATUS.md` says why).
