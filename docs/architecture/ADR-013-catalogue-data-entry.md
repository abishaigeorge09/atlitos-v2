# ADR-013: Bulk catalogue data entry, review before live, and multiple images

Status: Proposed. No PRD-04 FR citation exists for this feature yet (see Open questions); this
ADR is written against the founder's verbatim requirements in the brief that commissioned it,
carried here rather than invented as a numbered FR. Build should not start before PRD-04 gains
the corresponding FRs, per CLAUDE.md's "not traceable to a PRD-0X FR-y, it does not belong in
this phase."

Date: 2026-09-22. Relates to `docs/architecture/ADR-011-shop-search-ingest-health.md` (the
existing ingest/health machinery this extends, not replaces), `docs/PLAN-ADMIN-UX.md` (A2-T1
owns `pages/gear/*`, A3 owns the ingest flow this ADR's import path sits beside), migrations
`0086` and `0120`.

## Context and Problem Statement

The affiliate gear catalogue (`affiliate_products`/`product_offers`) has exactly one entry
path today: the manual form, one product and its offers at a time, through
`admin_upsert_affiliate_product`/`admin_upsert_product_offer` (0120). `gear-ingest`'s
"paste a link" flow (ADR-011 D3) helps when a retailer page can be fetched, but Amazon India
answers the server fetch with a bot wall (`retailer_programmes.fetchable = false`, ADR-011's
2026-09-22 amendment), so a meaningful share of the catalogue has no automated source at all
and must be typed by hand. A product carries exactly one image (`image_url`), sourced either
from a retailer feed or nothing.

The founder needs data entry people to load the catalogue at volume: a downloadable sample CSV
and a drop zone that imports many products and their retailer offers at once; a paste surface
for the entire product data, not only a link, because AI autofill is not reliable yet; multiple
images per product added and edited directly, not by pasting one URL; and every imported or
hand typed row held in a tester account's queue for approval before a shopper can see it. Today
nothing in the schema distinguishes "entered" from "reviewed," any admin can make a row live the
instant they type it, and there is no role narrower than `admin` to hand a data entry hire.

## Scope

Affiliate gear (`affiliate_products`, `product_offers`) only. The owned catalogue
(`products`/`product_variants`) is the next phase; every decision below states explicitly
whether its shape carries over or is gear specific. The short version: the review state machine
and the two new roles are decisions this catalogue makes first and the owned catalogue should
copy; multiple images do not need a new decision there at all, because `product_media`
(`0070_product_media_bucket.sql`) already gives `products` exactly the `id, product_id,
storage_path, position, is_primary` shape D5 below builds for gear. Bulk import and its batch
record are gear specific in their row shape (retailer offers) but the RPC pattern (chunked,
savepoint-isolated, idempotent on a stable external reference) generalises directly.

## Decision Drivers

- The founder's requirement list, verbatim in substance, from the brief: sample CSV plus drop
  zone; paste the whole data, not only a link; multiple images, added and edited directly;
  link input as one source among several; review before live; efficient and legible for data
  entry people.
- CLAUDE.md's financial-adjacent invariant generalised to catalogue truth: clients never write
  `affiliate_products`/`product_offers` directly, only through an admin RPC that checks
  `has_role()` inside itself. This ADR does not relax that boundary; it widens which roles the
  RPCs accept.
- CLAUDE.md: a policy without a grant is inert, and a test written against an unscoped query
  passes for the wrong reason. Every new RLS surface below states its grant explicitly and its
  own non-vacuous Confirmation.
- RLS.md's permissive-OR lesson: any predicate a shopper's browse query relies on must be
  re-derivable from the row itself inside the `SELECT` policy, never assumed true because an
  app screen happens not to show unapproved rows.
- Ten thousand users is the consumer scale target; it does not apply to this tool's own
  operator count (a handful of data entry and review staff), but a single operator's own browser
  tab and a single RPC call's payload and duration still need real bounds, which is what forces
  chunked import rather than one request per file.
- Prefer the boring option. `product_media`'s shape, `product-images`' Storage precedent, and
  the existing admin RPC/audit_log convention are reused everywhere they fit; a new dependency
  (a real CSV parser) is added only where a hand rolled one is a named, specific risk.

## Considered Options

1. **Extend the existing tables and RPCs**: a review state column on `affiliate_products`, two
   new `app_role` values, a new `affiliate_product_images` table mirroring `product_media`, and
   a chunked batch-import RPC pair with an `import_batches`/`import_rows` audit trail. No new
   edge function, no new vendor. (chosen)
2. **Do nothing further**: keep the one-product-at-a-time manual form, `admin` as the only
   catalogue role, `active` as the only live/not-live flag, one `image_url` per product.
3. **A new edge function owns import, review and image handling**, writing under the service
   role instead of the caller's own JWT.
4. **A third-party bulk-data or PIM tool** (a spreadsheet-sync service, Airtable-as-CMS, or a
   dedicated catalogue-import SaaS) feeding Supabase via webhook.

## Decision Outcome

Chosen: **1**. Each decision below names its own alternatives and Confirmation; all are
collected in the top-level Confirmation section.

### D1. Review state: a column on `affiliate_products`, not a separate table

New columns: `review_status text not null default 'draft'` (`check in ('draft', 'submitted',
'approved', 'rejected')`), `submitted_by`, `submitted_at`, `reviewed_by`, `reviewed_at`,
`rejection_reason`. The public browse predicate on `affiliate_products` and `product_offers`
changes from `active = true` to `active = true and review_status = 'approved'`, enforced
directly in the `SELECT` policy's `USING` clause, so the guarantee a shopper never sees an
unapproved row lives in the one place RLS.md's permissive-OR lesson says it must: the predicate
itself, not an app screen's filter.

**The 20 products already live when this column is added** are backfilled to
`review_status = 'approved'`, `reviewed_at = now()` in the SAME migration, keyed on their
current `active = true`, before any default takes effect for new rows. Skipping this would
silently delist the entire live catalogue the moment the column exists, an outage indistinguishable
from the silent-empty-result class RLS.md and `docs/DEBT.md`'s "the absence passes" entry both
warn about.

**D1b, the bypass a review column alone does not close.** `admin_upsert_affiliate_product` stays
callable on an already `approved` row (routine edits should not require re-review from a trusted
admin). But a `data_entry`-only actor (no `admin`, no `catalogue_reviewer` role) editing an
`approved` row is exactly how "review before live" gets defeated in one step: approve a stub,
then edit it freely forever. The RPC therefore checks the caller's role set on every edit: if the
caller holds `data_entry` and neither `admin` nor `catalogue_reviewer`, an edit to a row whose
`review_status = 'approved'` reverts it to `'submitted'` in the same statement. Because the
public predicate already requires `review_status = 'approved'`, this takes the product off the
shopper feed the instant a data-entry-only edit lands, until it is reviewed again.

Alternatives considered:

- **A separate `catalogue_review_queue` table** (one row per review event, `affiliate_product_id`
  foreign key) normalises the workflow state out of the content table. Rejected: the shopper's
  hot-path `SELECT` would then need to join or subquery that table inside its own policy, which
  is precisely the shape RLS.md's 0030 lesson calls out (a subquery inside a policy runs under
  the CALLER's own RLS on the referenced table, not the policy owner's), forcing a
  `SECURITY DEFINER` boolean helper for a check that a plain column check already answers
  in the row itself, for no normalisation benefit a single-row-per-product workflow needs.
- **Do nothing, reuse `active` as the only state** (option 2's shape): the tester's "approval"
  action becomes the existing `admin_set_affiliate_product_active(true)`. Rejected: this
  conflates three distinct reasons a row is not live (never reviewed, rejected, auto-delisted by
  the health sweep) into one boolean, loses who submitted/reviewed/rejected and when, and gives
  the reviewer nothing to filter a "pending" queue by, since `active = false` also matches every
  product `gear-recheck` has ever auto-delisted (ADR-011 D4).

**Confirmation**: `scripts/verify-catalogue-review.mjs` — as anon, `select * from
affiliate_products where review_status != 'approved'` returns zero rows (42501-equivalent empty,
not an error, matching the guest-read-surface convention); create a product as `data_entry`,
submit, approve as `catalogue_reviewer`, assert it now appears in an anon browse query for its
title; edit the same approved product as a `data_entry`-only user, assert `review_status`
reverts to `submitted` AND the SAME anon browse query for its title now returns zero rows in the
same script run (non-vacuous: before/after on one live query, not two separate assertions that
could each pass for an unrelated reason). SQL invariant in `scripts/security-invariants.sh`:
`select count(*) from affiliate_products where active and review_status is distinct from
'approved'` must be `0`, a standing check that the two flags never drift apart outside the two
RPCs that are allowed to move them together.

### D2. Roles: two new `app_role` values, not a table, not a flag on `admin`

`data_entry` and `catalogue_reviewer` join `app_role` as two more values in the same enum that
already carries `court_partner`/`court_staff`/`moderator`. Both are global operational roles
like `moderator`, not per-venue like `court_staff`, so an enum value is the right shape, not a
membership table.

Grant surface:

- `data_entry` may call `admin_upsert_affiliate_product`, `admin_upsert_product_offer`,
  `admin_submit_affiliate_product_for_review`, the three image RPCs (D5), and the import RPCs
  (D3). It may **not** call `admin_review_affiliate_product` or `admin_set_affiliate_product_active`
  directly: going live is not this role's door.
- `catalogue_reviewer` may call `admin_upsert_affiliate_product`/`admin_upsert_product_offer`
  (correct a typo while reviewing, without bouncing back to data entry),
  `admin_submit_affiliate_product_for_review`, `admin_set_primary_affiliate_product_image`, and
  `admin_review_affiliate_product`. It may **not** call the import RPCs or
  `admin_add_affiliate_product_image`/`admin_remove_affiliate_product_image`: a tester approves
  what exists, it does not add new source material.
- `affiliate_products_select_admin`/`product_offers_select_admin` (0120) widen from
  `has_role('admin')` to `has_role('admin') OR has_role('data_entry') OR
  has_role('catalogue_reviewer')`, a single predicate change, still the same non-owner
  operational-data class (like `product_fetch_log`, not like `sessions`), so this does not
  introduce a new permissive-OR shape: one policy, one predicate, not a stacked owner-plus-public
  pair.
- `admin_review_affiliate_product` stays admin/`catalogue_reviewer` only, explicitly excluding
  `data_entry`. This is the one grant line that is the actual security boundary the whole feature
  exists to draw; every other grant above is secondary to it.

**Granting the roles**: there is no existing "make user X role Y" admin tool (`user_roles` has
no `authenticated` write path at all, by design, per RLS.md). A narrow new RPC,
`admin_set_catalogue_role(p_user_id, p_role)`, `has_role('admin')`-checked inside, hard-refuses
any `p_role` outside `('data_entry', 'catalogue_reviewer')`. This is deliberately not a general
role-granter: a generic `admin_set_any_role` would let an admin (or a bug) hand out `admin` or
`moderator` through a second door, defeating the one place role escalation is meant to be
reviewable.

Alternatives considered:

- **Rows in a separate table** (the `court_staff`/`venue_staff` shape): rejected because that
  shape exists for a role scoped to one owning entity (one venue); `data_entry` and
  `catalogue_reviewer` are global, the same shape `moderator` already is, so a second
  parallel-to-`user_roles` table would just be `user_roles` again with extra steps.
- **`admin` with a flag** (the do-nothing/boring-existing option): rejected as the single most
  direct way to fail the founder's actual requirement. If both jobs are "admin," a data entry
  hire can self-approve, and granting `admin` for a data-entry job hands them venue creation,
  order/fee-config access, and every other admin surface, not least-privilege for a role whose
  entire job is typing product rows.

**Confirmation**: `scripts/verify-catalogue-roles.mjs`. First and mandatorily: seed three real
users and assert `dataEntryUserId !== reviewerUserId && reviewerUserId !== adminUserId &&
dataEntryUserId !== adminUserId` before any other assertion runs — this is the isolation-test
trap named in the brief made concrete for this feature: a fixture helper that accidentally
grants both test roles to the same physical user would make every FORBIDDEN assertion below
pass for the wrong reason, because the identity holding the "wrong" role would also hold the
"right" one. Then: a `data_entry` caller invoking `admin_review_affiliate_product` on their own
just-submitted row gets `FORBIDDEN`; a `catalogue_reviewer` caller invoking
`admin_import_catalogue_rows` gets `FORBIDDEN`; a `player`-role caller gets `FORBIDDEN` from
every RPC in this ADR. SQL invariant: `select count(*) from information_schema.role_routine_grants
where routine_name = 'admin_review_affiliate_product' and grantee = 'anon'` is `0`.

### D3. Write path for bulk import: a chunked, savepoint-isolated RPC, not row-by-row client calls, not an edge function

New: `admin_create_import_batch(p_source, p_filename)` returns the new batch row;
`admin_import_catalogue_rows(p_batch_id, p_rows jsonb)` processes one CHUNK of parsed rows (the
client sends 200 at a time) and returns a per-row result; `admin_finalize_import_batch(p_batch_id)`
recomputes the batch's counters and closes it. All three are `SECURITY DEFINER`,
`has_role('admin') OR has_role('data_entry')` checked inside, called under the importer's own
forwarded JWT from the browser, never the service role: the same non-negotiable boundary
ADR-011 D3 already draws for `gear-ingest`.

Inside `admin_import_catalogue_rows`, each row is wrapped in its own `begin ... exception when
others then ... end` block. In PL/pgSQL this is an implicit savepoint: a raised exception inside
is caught and rolled back to the start of that block WITHOUT aborting the calling function's
outer transaction, so row 40 of 200 failing validation leaves rows 1 through 39 and 41 through
200 committed, with row 40's own error text recorded on its `import_rows` line. A row's own two
writes (the product upsert, then its offer upsert) go through the SAME
`admin_upsert_affiliate_product`/`admin_upsert_product_offer` RPCs the manual form calls,
matched by `external_ref` (D6): found means update, not found means create. Validation therefore
cannot drift between manual entry and bulk import, the same "extend, do not fork" principle
ADR-011 D3 states for `gear-ingest`.

Chunk size (200 rows) bounds one HTTP request's payload and one function invocation's duration
regardless of file size; a 5000-row file is roughly 25 sequential chunk calls from the browser,
not one 5000-row statement and not 5000 individual round trips.

Alternatives considered:

- **Client calls the existing two RPCs row by row under its own JWT**, writing its own
  `import_rows` status row after each call. Rejected as the primary path: a 5000-row file becomes
  roughly 10,000 sequential round trips from one browser tab (RPC call, then a separate status
  write), twice the chunked design's request count for no correctness gain, and the RPC write and
  the status write are two separate non-atomic steps, so a dropped connection between them leaves
  a row whose true database state and recorded import status disagree.
- **A new edge function** (`catalogue-import`) parses and writes under the service role.
  Rejected: there is no external network fetch here the way `gear-ingest` has one (D5 already
  keeps image upload direct-to-Storage, see below), so an edge function would only be a second
  deployable that re-forwards the same JWT to the same RPCs a direct browser-to-Postgres RPC
  call already reaches in one hop; it would also move CSV parsing off the browser, where the
  preview grid the founder asked for ("easy to manage and see") needs the parsed rows anyway.

**Confirmation**: `scripts/verify-catalogue-import.mjs` — import a 3-row CSV with row 2 deliberately
invalid (a negative price); assert the batch finalises `status = 'completed_with_errors'`,
`succeeded_rows = 2`, `failed_rows = 1`, row 2's `import_rows.error` names the actual problem, and
no `affiliate_products`/`product_offers` row exists for row 2's `external_ref`; re-import the SAME
file unmodified with row 2 fixed, assert rows 1 and 3 update in place (same `affiliate_products.id`
as the first run, not a duplicate) and row 2 now creates one new product.

### D4. Batch record: `import_batches` and `import_rows`, kept, not blind imports

Kept, so a batch can be reviewed, corrected, re-run and reverted as a unit, per the brief.

`import_batches`: `id`, `created_by`, `source` (`'csv' | 'paste'`), `filename` (nullable, paste
has none), `status` (`'processing' | 'completed' | 'completed_with_errors'`), `total_rows`,
`succeeded_rows`, `failed_rows`, `created_at`, `completed_at`.

`import_rows`: `id`, `batch_id`, `row_number` (the original file line, for pointing a data entry
person back at the exact row), `raw` (the parsed row as submitted, for re-run and for showing a
failed row's original values), `before` (a snapshot of the product's prior field values when
this row updated an existing product, null when it created one — populated by the same RPC
right before it calls `admin_upsert_affiliate_product`, the same before/after shape `audit_log`
already carries everywhere else in this codebase), `affiliate_product_id`, `status`
(`'pending' | 'created' | 'updated' | 'failed' | 'reverted'`), `error`, `created_at`.

RLS on both: `SELECT` for `has_role('admin') OR has_role('data_entry') OR
has_role('catalogue_reviewer')`, no `anon`, no per-user ownership scoping (this is small-team
operational data, the `product_fetch_log` class, not the `orders` class); no direct
`INSERT`/`UPDATE`/`DELETE` grant to any client role, RPC-only, matching the "clients never write
these tables directly" contract every table in this ADR follows.

Retention: kept indefinitely, the `audit_log` class, not a TTL'd cache. A batch is a real
editorial event on the catalogue and the `before` snapshots are what makes revert possible;
unlike `audit_log`, `import_rows.status` is legitimately mutated by a later revert, so it is not
enforced insert-only at the grant level the way `audit_log`/`ledger_entries` are.

`admin_revert_import_batch(p_batch_id)`, `has_role('admin')` only (a revert is rarer and more
consequential than an import; the conservative default is admin-only, widen later if the
volume argues for it). For every row with `status in ('created', 'updated')`: a `created` row
(`before is null`) calls `admin_set_affiliate_product_active(id, false)`, the existing soft-delist
path (this table never hard-deletes, matching every other affiliate-catalogue action in this
codebase); an `updated` row calls `admin_upsert_affiliate_product` with the `before` snapshot's
field values restored, itself audited as an ordinary update. Reusing the two existing choke-point
RPCs for both branches means revert produces the same `audit_log` trail an equivalent manual
correction would, nothing new to reconcile against.

Alternatives considered:

- **Blind imports**, no batch record: rejected outright, it is what "correct or revert as a
  unit" explicitly needs and what the brief asks for by name; a failed 5000-row import with no
  batch record leaves a data entry person unable to tell which of the 5000 rows failed without
  re-diffing the whole file against the database by hand.

**Confirmation**: covered by `scripts/verify-catalogue-import.mjs` (D3) for creation and
`scripts/verify-catalogue-revert.mjs` (new) for revert — import 2 products (one new, one that
updates a pre-existing seeded product's price), revert the batch, assert the new product is
`active = false` and the updated product's price is restored to its pre-import value, both
re-derived from a live `SELECT`, not from the revert call's own return value.

### D5. Multiple images: a new `affiliate_product_images` table, mirroring `product_media`

New table, the SAME shape `product_media` already has for the owned catalogue: `id`,
`affiliate_product_id`, `storage_path`, `position` (smallint, default 0), `is_primary`
(boolean, default false, at most one true per product via the same partial unique index
`product_media` uses), `created_at`. This is not a new pattern invented for gear; it is the
existing owned-catalogue pattern applied to the second product model, which is why D5 needs no
follow-up decision when the owned catalogue phase starts.

`image_url`/`image_path` on `affiliate_products` are **not removed**. They become the
denormalised primary-image cache every existing consumer already reads (the shopper card,
`ai-search`'s candidate hydration, `gear-embed`'s text extraction which never touched images
anyway). A trigger, `sync_primary_affiliate_image`, fires on insert/update/delete of
`affiliate_product_images` and keeps `image_path`/`image_url` equal to whichever row now has
`is_primary = true` (null when a product has zero images, unchanged from today). No existing
read path changes.

**Existing products are not backfilled into the new table.** Their `image_url`/`image_path`
keep working exactly as today, unmanaged by the new gallery until someone explicitly adds a
first image through it. A backfill is not fully possible cleanly for the original seed
products anyway: several carry a bare `image_url` with `image_path IS NULL` (never copied into
Storage), and `affiliate_product_images.storage_path` needs a real Storage object to point at.
Writing a backfill migration that fabricates one would be inventing data this ADR has no source
for.

**Storage path for admin-uploaded images**: the existing `product-images` bucket, new prefix
`manual/<affiliate_product_id>/<sha256-16>.<ext>`, keeping the bucket's existing hash-dedupe
convention. `retailer_key`-prefixed paths (the ones `gear-ingest` writes under the service role)
are untouched; the new bucket policy's `WITH CHECK` constrains `storage.objects.name` (qualified,
per RLS.md's 0016 lesson: an unqualified `name` inside a policy that joins another table binds to
the WRONG table's `name` column) to start with `'manual/'`, so a `data_entry`/`admin` uploader
cannot write into a retailer-key path even by constructing the request by hand.

**Upload path**: direct to Storage from the browser under the uploader's own JWT, gated by a
new `product-images` bucket policy (`has_role('admin') OR has_role('data_entry')`,
insert/update/delete, `manual/` prefix only) — the SAME precedent `product-media` already sets
(admin-scoped direct write, no edge function in the loop). After the Storage `PUT` succeeds, the
browser calls `admin_add_affiliate_product_image(p_affiliate_product_id, p_storage_path,
p_is_primary)` to register the DB row (RPC-only, same as every other write in this ADR);
`admin_set_primary_affiliate_product_image(p_id)` and `admin_remove_affiliate_product_image(p_id)`
follow the same shape. A DB row is never created without a prior successful Storage write; the
reverse (an uploaded object with no DB row, if the RPC call fails after upload) is accepted as a
small, harmless orphan, the same class ADR-011 D3 already accepts for an abandoned ingest preview.

**Size and type limits**: reuse the existing standard `0089_security_lockdown_phase1.sql` set on
every public photo bucket — `file_size_limit = 10485760` (10MB), `allowed_mime_types = {image/jpeg,
image/png, image/webp, image/heic, image/heif}` — rather than inventing a second standard for this
one bucket. **Maximum 8 images per product**, enforced inside `admin_add_affiliate_product_image`
(an RPC-level check, not a schema constraint, the same weight `admin_create_venue`'s "at least one
court" check already carries), bounding unbounded growth from a careless bulk operator.

Alternatives considered:

- **An array column** (`image_paths text[]`) on `affiliate_products`: rejected. No room for
  per-image metadata beyond array position, a delete is a read-modify-write of the whole array
  that races under two concurrent edits, no foreign-key integrity to a Storage object, and it
  would be a second, different multi-image shape sitting beside `product_media`'s in the same
  codebase for what is conceptually the identical feature.
- **Reusing `image_path`/`image_url` for multiple values** (comma-joined, or similar): rejected
  outright, it is exactly the hand-rolled-delimiter fragility named elsewhere in this ADR as
  unacceptable for a CSV, and it breaks every existing single-image consumer at once, the highest
  blast radius of any option here.
- **An edge function for the upload itself** (mirroring `gear-ingest`'s image copy): rejected.
  `gear-ingest`'s server hop exists because fetching a THIRD PARTY URL server side is something a
  browser cannot do; a file already sitting on the operator's own machine has no such gap, and a
  Deno function re-streaming a multi-MB upload through its own request/response cycle is strictly
  worse than the browser talking to Storage directly, especially once several operators are
  uploading several photos each during a bulk pass.

**Confirmation**: `scripts/verify-catalogue-images.mjs` — as `data_entry`, upload three images to
one product, assert `affiliate_products.image_path` equals the primary image's `storage_path`
after each primary change; attempt a 9th image, assert `VALIDATION` refusal; attempt a direct
`storage.objects` insert with a `retailer_key/...` path as a `data_entry` JWT, assert it is
refused (the `manual/` prefix check holds); attempt an 11MB file, assert Storage itself refuses
it before any RPC call happens, and assert no `affiliate_product_images` row was created for it.

### D6. CSV contract: one row per product-offer pair, a stable `external_ref` for idempotency, a real parser

Column set of the sample CSV, one row per (product, retailer offer):

| Column | Required | Notes |
|---|---|---|
| `external_ref` | yes, every row | Data entry person's own stable code for the product. Repeated on every offer row for the same product; matched against `affiliate_products.external_ref` on import. New nullable, unique-when-present column, so this doubles as the same-file grouping key and the cross-run idempotency key: one column, one concept. |
| `title` | yes | |
| `brand` | no | |
| `sport` | no | must match the `sport` enum's values exactly (case-insensitive); an unrecognised value is a named row error, never silently null |
| `category` | no | the category NAME, resolved to `categories.id` by exact case-insensitive match; an unrecognised name is a named row error, never a silent skip |
| `skill_level` | no | free text |
| `age_range` | no | free text |
| `description` | no | |
| `retailer` | yes | free text, matching `product_offers.retailer`'s existing shape; not required to match a `retailer_programmes` key, since this is manually sourced data, not a server fetch |
| `price` | yes | plain digits, at most 2 decimal places, no currency symbol, no thousands separator; `"₹1,299.00"` and `"Rs. 1299"` are both a named row error, not a silent misparse, because a locale-formatted number is exactly the ambiguity a real parser does not fix, it is a data-entry contract |
| `currency` | no | defaults `INR`; must be a 3-letter ISO code if present |
| `affiliate_url` | yes | must start with `http://` or `https://`, same check `admin_upsert_product_offer` already runs |
| `in_stock` | no | `true`/`false`/blank (defaults true) |

**Idempotency on re-import**: a row whose `external_ref` matches an existing
`affiliate_products.external_ref` updates that product (and, via `(affiliate_product_id,
retailer)`'s existing unique constraint, that specific offer in place); a new `external_ref`
creates a product. `external_ref` is required on every row, deliberately, to remove any
ambiguity about whether title-matching or a blank grouping key is in play.

**Parser: Papaparse**, a new dependency in `apps/admin`. Chosen specifically because a hand
rolled `line.split(",")` fails on exactly the row shapes this data will contain: a `description`
cell with a comma inside it, or a pasted multi-line description, misaligns every column after it
on that row, SILENTLY, not with an error, which for a `price`/`currency` pair is the worst
possible failure mode (a wrong number reads as a valid number). Papaparse handles quoted fields
with embedded commas and newlines, strips a UTF-8 BOM (Excel always writes one), and reports
per-row parse failures with a row number instead of throwing on the whole file. No other new
dependency is added; `zod` was considered for the per-row validation layer and rejected as
unneeded weight, since every validation rule above (numeric price, known sport value, URL
scheme) is a single-line check the RPCs already run for the manual-entry path, reused here
rather than re-expressed in a schema library.

**"Wrong column order"**: Papaparse runs with `header: true`, so rows parse to objects keyed by
header name, not by column position — a file whose columns are physically reordered relative to
the sample parses correctly as long as the header names match (case-insensitive, trimmed). The
real risk is a renamed or missing header, not a reordered one: every REQUIRED header absent from
the file is a file-level rejection before any row is processed (fail fast, named in the preview),
and an unrecognised EXTRA header is ignored with a warning, never silently folded into the wrong
field.

Alternatives considered:

- **One row per product, offer columns duplicated positionally** (`offer_1_retailer,
  offer_1_price, ..., offer_2_retailer, ...`): rejected, hard-caps the offer count, produces an
  unreadable wide header, and does not match how a data entry person naturally builds or edits
  a spreadsheet (copy a row, change three cells).
  - A JSON blob in one CSV cell carrying the offers array: rejected, defeats the entire point of a
  flat, hand-editable file; a data entry person cannot reliably hand-type JSON, which is the exact
  fragility the sample CSV exists to avoid.

### D7. Paste the whole data: the same parser, a delimiter sniff, no second parsing path

The paste surface accepts TSV (what a browser clipboard carries when a spreadsheet range is
copied out of Google Sheets or Excel, the native "paste from a spreadsheet" case) or the same
comma-delimited CSV text pasted as raw text. Both require the same header row as the file upload
path as their first line.

Reconciliation with the CSV path, so there is exactly one parser: a shared
`parseCatalogueRows(text, delimiter?)` function sniffs tab vs comma by counting occurrences in
the first non-empty line (tab wins ties, since spreadsheet paste is the common case), then calls
Papaparse with that delimiter. A dropped file and a pasted block differ only in where the raw
text string came from (a `File` read vs a clipboard `paste` event); both feed the same parser,
the same preview grid, the same row-level validation, and the same chunked
`admin_import_catalogue_rows` submission path. There is no second, independently maintained
parser to drift out of sync with the first.

**"One product per block" free text, explicitly not built now.** A label-colon-value block
format (distinct products separated by a blank line) is a genuinely different parser, not a
delimiter variant, and carries its own ambiguity (is `"Price: 1200"` a price field or a title
line containing the word Price). The founder's stated reason for the paste surface — "the AI
autofill still needs work" — is already answered by TSV/CSV paste without a second bespoke
format guesser. Named as an explicit non-goal (see below), not silently dropped.

**Confirmation** (D6/D7 combined): `scripts/verify-catalogue-csv-contract.mjs` — the sample CSV
itself round-trips through `parseCatalogueRows` and the import RPC with zero errors; a
tab-pasted copy of the same three rows (simulating a spreadsheet paste) produces the identical
result via the same function; a file missing the `price` header is rejected before any row is
processed, naming `price` in the error; a row with `price` = `"₹1,299"` is rejected by name, not
silently parsed as `1` or `1299`; a row with columns physically reordered relative to the sample
still imports correctly (header-matched, not position-matched).

### D8. Migration numbering

Per `docs/BRANCHING.md` rule 4, files are `XXXX_<name>.sql` while the branch lives, renumbered at
merge. Highest number in `supabase/migrations/` today is `0126`.

| Provisional file | Contents |
|---|---|
| `0127_catalogue_roles.sql` | `app_role` gains `data_entry`, `catalogue_reviewer`. Own file, not combined with anything that USES the new values: Postgres refuses a new enum value referenced in the same transaction it was added in, so the RPC that checks `p_role in ('data_entry', 'catalogue_reviewer')` (D2) lives in the NEXT migration, not this one. `admin_set_catalogue_role`. |
| `0128_catalogue_review_state.sql` | `affiliate_products` review columns + `external_ref` + backfill of existing `active = true` rows to `approved`; widened public browse and admin `SELECT` predicates; `admin_submit_affiliate_product_for_review`, `admin_review_affiliate_product`; `admin_upsert_affiliate_product`/`admin_upsert_product_offer` role checks widened, `admin_upsert_affiliate_product` gains trailing `p_external_ref text default null` (its third extension, still backward compatible per ADR-011 D3's convention) |
| `0129_affiliate_product_images.sql` | `affiliate_product_images` table + RLS + `sync_primary_affiliate_image` trigger + three image RPCs + `product-images` bucket policy addition (`manual/` prefix, admin/`data_entry` write) |
| `0130_catalogue_import_batches.sql` | `import_batches`, `import_rows` + RLS + `admin_create_import_batch`, `admin_import_catalogue_rows`, `admin_finalize_import_batch`, `admin_revert_import_batch` |

## Consequences

Good: every new write path is RPC-gated exactly like every existing catalogue write, so the
"clients never write these tables directly" invariant never needs a new kind of proof, only a
wider grant list on the same proof; `affiliate_product_images` reuses a pattern the owned
catalogue already has, so that decision is free when the next phase needs it; the batch record
makes a bad 5000-row import a recoverable mistake instead of a support incident; no new vendor,
no new edge function, one new small dependency (Papaparse) with a specific, named reason.

Bad: two more `app_role` values is two more branches every future RLS review has to carry, on top
of the seven that already exist; the `review_status`/`active` pair is a second piece of state to
keep in sync (mitigated by the standing SQL invariant in D1, but that invariant has to keep
existing); `admin_revert_import_batch` reuses the existing upsert RPCs to restore prior values,
which means a revert itself writes a fresh `audit_log` row rather than erasing the import's row,
by design, but that makes an `audit_log` history for a heavily reverted product noisy; the
`manual/` Storage prefix is a naming convention, not a bucket-level security boundary on its own,
its safety depends on the `WITH CHECK` clause being written correctly the first time (D5's own
Confirmation exists specifically to catch a regression here); a data entry person can still
import 5000 rows into `draft` faster than one tester can review them, a real workflow bottleneck
this ADR does not solve (see Open questions).

## Confirmation

1. `scripts/verify-catalogue-review.mjs` — D1, the review predicate and the approved-edit
   reversion rule; SQL invariant `active` implies `review_status = 'approved'` in
   `scripts/security-invariants.sh`.
2. `scripts/verify-catalogue-roles.mjs` — D2, three-distinct-ids-first, then the
   `data_entry`/`catalogue_reviewer` grant boundaries; SQL invariant on
   `admin_review_affiliate_product`'s grantee list.
3. `scripts/verify-catalogue-import.mjs` — D3, D6, D7: partial failure, idempotent re-import,
   the sample CSV and its tab-pasted equivalent, the reordered-header and bad-header-name cases.
4. `scripts/verify-catalogue-revert.mjs` — D4, revert restores a created row to delisted and an
   updated row to its prior values, both re-derived from a live `SELECT`.
5. `scripts/verify-catalogue-images.mjs` — D5, primary-image sync, the 8-image cap, the
   `manual/` prefix refusal for a `retailer_key/...` path, the 10MB bucket refusal.
6. `supabase start` + CI's `db-migrations` job — D8, the four migrations replay clean in order,
   including the two-migration split for the new enum values.

None exist yet; each is the check its own decision must be proven against before merge, born
red: plant the violation, watch it fail, then make it pass.

## Pros and Cons of the Options

| Option | Good | Bad |
|---|---|---|
| **1 (chosen)**: extend existing tables/RPCs, two new roles, `product_media`-shaped images, chunked batch import | Every write reuses the existing RPC-gate proof shape; no new vendor or deployable; the images decision is free for the owned catalogue phase | Two more `app_role` values to carry in every future RLS review; review state is a second flag to keep in sync with `active` |
| **2**: do nothing further | Zero new schema, zero new code | Cannot meet any of the founder's six stated requirements; `admin`-only means no least-privilege data entry hire is possible; review, images and bulk import all stay unbuilt |
| **3**: a new edge function owns import/review/images | Server-side code is easier to unit test in one place | A second deployable and secret surface for work that needs no external network call; moves parsing off the browser where the preview grid needs it; contradicts the "extend, do not fork" reuse this ADR otherwise achieves |
| **4**: third-party PIM/spreadsheet-sync tool | Offloads bulk-edit UI to a vendor built for it | New vendor dependency to keep alive for an internal tool at this data volume; data still has to land in these exact tables under this exact RLS boundary, so a middle vendor adds a sync/webhook reliability problem without removing any of the schema work this ADR already does |

## Component design

### Component boundaries

| Component | Owns |
|---|---|
| `apps/admin/src/pages/gear/import.tsx` (new) | The `/gear/import` route: drop zone, paste textarea, preview grid, chunked submit, batch summary. |
| `apps/admin/src/pages/gear/import-parser.ts` (new) | `parseCatalogueRows(text, delimiter?)`, the ONE parser shared by the drop zone and the paste surface (D6, D7). Pure, no network call. |
| `apps/admin/src/pages/gear/import-api.ts` (new) | Chunking, the three import RPC calls, batch status polling. |
| `apps/admin/src/pages/gear/review.tsx` (new) | The `/gear/review` route: the `catalogue_reviewer`'s pending queue, approve/reject with a reason gate (the same pattern verification reject and moderation reject already use, `PLAN-ADMIN-UX.md`). |
| `apps/admin/src/pages/gear/images.tsx` (new) | The multi-image manager: drag-reorder, set primary, remove, direct-to-Storage upload. |
| `apps/admin/src/pages/gear/api.ts` (extended) | New types (`ReviewStatus`, `ImportBatchRow`, `ImportRowResult`, `AffiliateProductImageRow`) declared locally first, same precedent the file's own header comment already sets for the S2 health columns; new RPC wrapper functions. |
| `apps/admin/src/pages/gear/list.tsx`, `show.tsx` (touched) | A `review_status` `Badge` via `src/lib/status.ts`; the show screen gains the image gallery and the submit/approve/reject actions, each gated by the caller's own role. |
| `apps/admin/public/catalogue-sample.csv` (new) | The downloadable sample: the exact D6 column set, three example rows including one two-offer product to demonstrate the repeated-`external_ref` shape. |
| `docs/design/IA-ADMIN.md` (touched) | Gains `/gear/import` and `/gear/review` routes. |
| `docs/architecture/SCHEMA.md`, `RLS.md`, `API-MAPPING.md` (touched, same change, per CLAUDE.md's docs update duty) | The columns, tables, RPC signatures and grants named in D1 through D5. |

No new edge function, no new Storage bucket (the existing `product-images` bucket gains one
policy, D5).

### Data model deltas and the security boundary

No table here is user-owned; every one is system-owned reference or operational data, the same
class `affiliate_products`/`product_offers`/`product_fetch_log` already are (RLS is a floor, every
read still carries its own explicit narrowing per CLAUDE.md, not that any of these tables have a
`user_id`-shaped ownership column to narrow by).

| Table | New/changed columns | Read | Write |
|---|---|---|---|
| `affiliate_products` | `external_ref`, `review_status`, `submitted_by`, `submitted_at`, `reviewed_by`, `reviewed_at`, `rejection_reason` | public: `active AND review_status = 'approved'`, minus `embedding` (unchanged column-level grant); admin/`data_entry`/`catalogue_reviewer` read all | `admin_upsert_affiliate_product` (admin/`data_entry`/`catalogue_reviewer` JWT); `admin_submit_affiliate_product_for_review`, `admin_review_affiliate_product` (review state only) |
| `product_offers` | none | public: owning product `active AND review_status = 'approved'`; admin/`data_entry`/`catalogue_reviewer` read all | `admin_upsert_product_offer` (admin/`data_entry`/`catalogue_reviewer` JWT) |
| `affiliate_product_images` (new) | id, affiliate_product_id, storage_path, position, is_primary, created_at | admin/`data_entry`/`catalogue_reviewer` only, no anon/public | `admin_add_affiliate_product_image`/`admin_remove_affiliate_product_image` (admin/`data_entry` JWT); `admin_set_primary_affiliate_product_image` (admin/`data_entry`/`catalogue_reviewer` JWT) |
| `import_batches` (new) | id, created_by, source, filename, status, total_rows, succeeded_rows, failed_rows, created_at, completed_at | admin/`data_entry`/`catalogue_reviewer` only | `admin_create_import_batch`, `admin_finalize_import_batch` (admin/`data_entry` JWT) |
| `import_rows` (new) | id, batch_id, row_number, raw, before, affiliate_product_id, status, error, created_at | admin/`data_entry`/`catalogue_reviewer` only | `admin_import_catalogue_rows`, `admin_revert_import_batch` (admin/`data_entry` JWT for import, admin only for revert) |
| `user_roles` | no new columns | unchanged (own rows; admin reads all) | `admin_set_catalogue_role` (admin JWT, restricted to the two new role values only) |
| `product-images` bucket | new `manual/` prefix | public read (unchanged) | new policy: admin/`data_entry`, `manual/` prefix only; `retailer_key/` prefix stays service-role-only via `gear-ingest` |

### Interface signatures crossing a component boundary

```sql
-- role grant, admin only, restricted to exactly two values
admin_set_catalogue_role(p_user_id uuid, p_role text)  -- p_role in ('data_entry','catalogue_reviewer') or VALIDATION

-- review state machine, admin/data_entry/catalogue_reviewer create-and-submit,
-- admin/catalogue_reviewer decide
admin_submit_affiliate_product_for_review(p_id uuid) returns affiliate_products
  -- requires review_status in ('draft','rejected'), else INVALID_TRANSITION
admin_review_affiliate_product(p_id uuid, p_decision text, p_reason text default null)
  returns affiliate_products
  -- p_decision in ('approve','reject'); reject requires p_reason; requires review_status = 'submitted'
  -- approve sets review_status='approved', active=true in the same statement

-- existing RPCs, extended (ADR-011's convention: trailing, defaulted, backward compatible)
admin_upsert_affiliate_product(..., p_image_path default null, p_source_image_url default null,
                                p_external_ref text default null)
admin_upsert_product_offer(...)  -- signature unchanged, role check widened only

-- images, admin/data_entry add-and-remove, admin/data_entry/catalogue_reviewer re-order primary
admin_add_affiliate_product_image(p_affiliate_product_id uuid, p_storage_path text,
                                   p_is_primary boolean default false) returns affiliate_product_images
admin_set_primary_affiliate_product_image(p_id uuid) returns affiliate_product_images
admin_remove_affiliate_product_image(p_id uuid) returns void

-- bulk import, admin/data_entry
admin_create_import_batch(p_source text, p_filename text default null) returns import_batches
admin_import_catalogue_rows(p_batch_id uuid, p_rows jsonb)
  returns table(row_number int, status text, affiliate_product_id uuid, error text)
admin_finalize_import_batch(p_batch_id uuid) returns import_batches
admin_revert_import_batch(p_batch_id uuid) returns void  -- admin only
```

```ts
// apps/admin/src/pages/gear/import-parser.ts
export interface ParsedCatalogueRow {
  rowNumber: number;
  externalRef: string;
  title: string;
  brand: string | null;
  sport: Sport | null;
  category: string | null;
  skillLevel: string | null;
  ageRange: string | null;
  description: string | null;
  retailer: string;
  price: number;
  currency: string;
  affiliateUrl: string;
  inStock: boolean;
}
export function parseCatalogueRows(
  text: string,
  delimiter?: "," | "\t",
): { rows: ParsedCatalogueRow[]; errors: Array<{ rowNumber: number; column: string; message: string }> };
```

### Failure modes

| Failure | Behaviour |
|---|---|
| A CSV row fails validation (bad price, unknown sport, malformed URL) | That row's `import_rows.status = 'failed'` with a named error; every other row in the batch still commits (D3's savepoint isolation) |
| A required header is missing from the file | Whole file rejected before any row is processed, named in the preview; no partial import attempted |
| The browser tab closes mid-import | Rows already sent in completed chunks are committed; re-uploading the SAME file is safe, `external_ref` matching updates already-imported rows in place rather than duplicating them |
| An admin-uploaded image exceeds 10MB or the wrong MIME type | Storage itself refuses the `PUT`; the DB row is never created (no orphaned `affiliate_product_images` row pointing at a nonexistent object) |
| The `admin_add_affiliate_product_image` RPC call fails after a successful Storage upload | A small number of unreferenced Storage objects accumulate, accepted as harmless, the same class ADR-011 D3 already accepts for an abandoned ingest preview |
| A `data_entry`-only actor edits an approved row | `review_status` reverts to `submitted`, the product leaves the shopper feed immediately (D1b) |
| `admin_revert_import_batch` is called on a batch that already had some rows manually edited since import | Restores each row's pre-import `before` snapshot via the ordinary upsert RPC, overwriting the manual edit; this is a real, named limitation, not silently handled, surfaced to the caller in the revert's result |
| A tester's queue grows faster than they can review (a large import, not auto-submitted) | Imported rows land as `draft`; nothing is auto-submitted, so the operator chooses when to push a batch into review, bounding the queue's growth rate to a deliberate action, not the import's own speed |

### Non-goals

- Auto-submitting imported rows into review without an explicit operator action.
- Batch-level (one click, whole batch) approval; review stays per-product even for a large
  import, see Open questions.
- The "one product per block" free-text paste format (D7).
- Any change to `gear-ingest`'s own fetch/robots/extraction behaviour (ADR-011 D3), which this
  ADR treats as one input source among several, unchanged.
- Any change to the owned catalogue (`products`/`product_variants`); Scope above states what
  carries over and what does not.
- A generic role-granting RPC; `admin_set_catalogue_role` is intentionally restricted to exactly
  the two roles this ADR adds.

## Data flow

```mermaid
flowchart TD
  A1[Drop CSV or paste TSV/CSV] --> A2[parseCatalogueRows]
  A2 --> A3{Required headers present?}
  A3 -->|no| A4[File rejected, named header]
  A3 -->|yes| A5[Preview grid, per-row errors shown]
  A5 --> A6[Operator confirms] --> A7[admin_create_import_batch]
  A7 --> A8[Chunked admin_import_catalogue_rows, 200 rows/call]
  A8 --> A9{Per row, savepoint isolated}
  A9 -->|external_ref found| A10[Update product + offer]
  A9 -->|not found| A11[Create product draft + offer]
  A9 -->|validation fails| A12[import_rows.status=failed, error recorded]
  A10 --> A13
  A11 --> A13[admin_finalize_import_batch]
  A13 --> A14[Batch summary: succeeded/failed]
  A14 --> A15[Operator: Submit N for review]
  A15 --> A16[admin_submit_affiliate_product_for_review, per product]
  A16 --> A17[review_status=submitted]

  R1[/gear/review queue] --> R2{catalogue_reviewer decision}
  R2 -->|approve| R3[admin_review_affiliate_product: approved, active=true]
  R2 -->|reject| R4[admin_review_affiliate_product: rejected, reason recorded]
  R4 --> A15

  S1[Shopper browse] --> S2{active AND review_status='approved'}
  R3 --> S2
  S2 -->|yes| S3[Visible in shop]
  S2 -->|no| S4[Never returned]
```

## New secrets

None. Every new write path runs under an authenticated JWT already minted by Supabase Auth, or
the existing `SUPABASE_SERVICE_ROLE_KEY` `gear-ingest` already holds; the Storage `manual/`
prefix upload is a bucket RLS policy change, not a new credential.

## Open questions

1. **No PRD-04 FR citation exists for this feature.** Recorded up top; build should not start
   before PRD-04 gains the corresponding FRs, or the founder explicitly accepts this ADR's brief
   as the authority in lieu, per CLAUDE.md's traceability rule.
2. **Batch-level review.** If import volume regularly produces queues in the hundreds or
   thousands, should a `catalogue_reviewer` be able to approve an entire trusted batch at once
   rather than product by product? Not built here (Non-goals); a founder call once real volume
   is observed, not before.
3. **Should `data_entry`/`catalogue_reviewer` visibility be per-person** (a data entry hire sees
   only their own drafts) rather than shared across the whole small team as designed here? Kept
   shared deliberately (D2/D4), reconsider if the team grows past a size where shared visibility
   stops being "easy to manage and see" and starts being noisy.
4. **Exact roster**: who gets `data_entry` and who gets `catalogue_reviewer` (the "tester
   account")? A founder decision made through `admin_set_catalogue_role`, not this ADR's to
   assign.
