# Plan: bulk catalogue data entry, review before live, multiple images

Phase A4 of the admin line. Architecture is `docs/architecture/ADR-013-catalogue-data-entry.md`
(D1 to D8); read it first, this plan does not repeat its reasoning. Direction is the approved
`docs/design/DIRECTION-ADMIN.md`. The admin kit and every page group are already on it
(`docs/PLAN-ADMIN-UX.md`, phases A1 to A3).

## What the founder asked for, 2026-09-22

Verbatim in substance: a sample CSV and a CSV drop; the ability to paste the entire data itself,
not only links, because the AI autofill still needs work; adding and editing multiple images
directly; link input as one source among several; rows going to a tester account for approval
before they go live; and the whole thing being efficient for data entry people and easy to manage
and see.

Answers given at intake, treated as fixed:

- **Scope order.** Affiliate gear now, the owned catalogue immediately after, on the same
  components. ADR-013 D5 and D6 are shaped so the second pass needs no new decision.
- **Landing state.** Imported rows are never live. They land `draft`, are submitted, and a tester
  account (`catalogue_reviewer`) approves before a shopper can see them.
- **Reference.** The GMV inventory admin, pending: the site needs a sign in this session will not
  perform. Gate 1 below does not open until either those screens or the founder's word arrive.

## Gates

**Gate 1, design.** A kitchen sink page showing the import screen in all its states, the review
queue, and the image manager, judged against the GMV reference. Nothing in Phase B starts before
it passes. This is the one gate that is NOT self served under the autonomy directive, because the
founder named a specific reference and the standing rule is never to design cold.

**Gate 2, this plan.** Self gated, as PLAN-ADMIN-UX.md was.

## Phases

### B1: the spine (no UI)

Gate, each provable against the running local stack, not by reading code:

1. As anon, a `submitted` product is invisible: the browse query returns zero rows for its title,
   and the same query returns it once approved. One script, one live query, before and after.
2. A `data_entry` only actor editing an `approved` row reverts it to `submitted` and the anon
   query for that title goes back to zero in the same run.
3. A `data_entry` actor calling `admin_review_affiliate_product` is refused. Assert the three
   user ids differ before any other assertion runs.
4. `select count(*) from affiliate_products where active and review_status is distinct from
   'approved'` is zero, wired into `scripts/security-invariants.sh` so it stays zero.
5. The 20 products live today are still live after the migration.

Tracks: B1-T1 migrations (enum values in their own migration first, per ADR-013 D8), B1-T2 the
RPCs and grants, B1-T3 `scripts/verify-catalogue-review.mjs` and the invariant line. Every check
is born red: plant the violation, watch it fail, then make it pass.

### B2: import (CSV and paste)

Gate: a 200 row CSV where row 40 is malformed imports 199 products and reports row 40 with its
line number and the reason; re-importing the same file changes nothing (`external_ref`
idempotency); a file with the columns reordered imports identically; a file with a column renamed
fails before a single row is written; pasting the same content from a spreadsheet gives the same
result as the file, through the same parser.

Tracks: B2-T1 `import-parser.ts` plus its unit tests (the parser is pure, so it is the one place
here with real unit tests), B2-T2 `import-api.ts` chunking and the batch lifecycle, B2-T3
`import.tsx` and `catalogue-sample.csv`.

### B3: images

Gate: uploading three images to a product yields three rows and three Storage objects under
`manual/<product id>/`; setting the second primary updates `image_url` and `image_path` through
the trigger and the shopper card shows it; removing the primary promotes another or nulls the
cache; an oversized or non image file is refused by Storage before any row is written; a
`data_entry` uploader cannot write into a `retailer_key` prefixed path.

### B4: the review queue and the data entry surfaces

Gate: a reviewer sees only `submitted` rows by default, approves with one action, rejects with a
required reason (the frozen strings from PLAN-ADMIN-UX.md apply: "Confirm reject", "A rejection
reason is required."); a data entry person sees their own drafts, their rejected rows with the
reason, and their import batches; every list opens with `PageHeader` and every number is mono.

### B5: the owned catalogue

The same five surfaces pointed at `products`/`product_variants`/`product_media`. Scoped when B1
to B4 are merged, not before.

## Verification

Per phase: `scripts/dod.sh`, the matrix and axe pass added to
`docs/qa/evidence/admin-ux/capture-matrix.mjs` for the new routes, zero critical and zero serious
axe violations (the bar A2 now holds), and a walkthrough that drives the real screens rather than
asserting from a diff.

## Risks

1. A 5,000 row import. Chunked at 200 with per row savepoints; the recovery path is a re import,
   which is idempotent. The reviewer queue then holds 5,000 rows, which is a workflow problem, not
   a technical one; ADR-013 leaves it open and this plan does not pretend to solve it.
2. A renamed column fails the whole file rather than silently importing nulls. Deliberate.
3. Papaparse is a new dependency in `apps/admin`. Small, no transitive weight, and the
   alternative is the silent column misalignment ADR-013 D6 describes.
4. The new enum values cannot be used in the transaction that adds them. Their own migration,
   first, per D8.
5. Two new roles means two new ways to get a grant wrong. Every RPC's role check is proven by a
   refusal test, not by an allowed one.
