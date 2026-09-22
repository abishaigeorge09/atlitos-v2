# Admin UX rebuild: status and resume point

Status: PHASE A2 AND A3 IN INTEGRATION (2026-09-22)
Plan: `docs/PLAN-ADMIN-UX.md` (Gate 2, self gated under the autonomy directive).
Direction: `docs/design/DIRECTION-ADMIN.md` (Gate 1, answered 2026-09-22).
IA: `docs/design/IA-ADMIN.md`. References: `docs/design/references/admin/stripe-*.png`.

## What the founder asked for

2026-09-19: "The admin portal is not clear. The entire user experience, where the elements are
pasted, is not great. The whole sidebar and the whole experience of each page are not great, and
the link also doesn't really add in." 2026-09-22: "build the best admin page so we can track
everything (gear, the affiliates with their display, filling them in, everything)", then "resume
and dont stop till all screens are done".

## Where things are

| Step | State | Where |
|---|---|---|
| Gate 1 direction | ANSWERED | `## Gate 1 response` in DIRECTION-ADMIN.md |
| Gate 2 plan | WRITTEN, self gated | `docs/PLAN-ADMIN-UX.md` |
| A1 shell, kit, tokens, kitchen sink | MERGED to main | PR #8, main `4c66289` |
| A2-T1 gear and venues | built, merged into the integration branch | `pages/gear/{list,show,form,health}.tsx`, `pages/venues/*`, `pages/gear/gear.css` |
| A2-T2 operations | built, merged into the integration branch | `pages/{dashboard,verification,bookings,orders}/*` plus one `.css` each |
| A2-T3 community and settings | in flight | `pages/{moderation,reports,drills,users,fee-config,products}/*` |
| A2-T4 e2e sync | done | `apps/e2e/specs/money/admin.spec.ts` now expects `/dashboard` after sign in |
| A3-T1 ingest client | built | `pages/gear/create.tsx` rewritten as one form, `pages/gear/api.ts`, new `pages/gear/ingest-guidance.ts` |
| A3-T2 ingest server | built and proven | `supabase/functions/gear-ingest/index.ts`, `supabase/migrations/XXXX_retailer_programme_fetchable.sql` |
| A3-T3 evidence | written | `docs/qa/evidence/admin-ux/walkthrough-a3.mjs` |
| Screenshot matrix and axe | harness written, run pending | `docs/qa/evidence/admin-ux/capture-matrix.mjs` |
| ux-critic on the integrated tree | pending | |
| DoD, PR, merge | pending | branch `admin-ux/integration-a2` |

## Proofs taken so far

- `scripts/verify-gear-ingest-honesty.mjs`: 22 of 22 checks pass against the local stack. A
  supported retailer answering 503 or 403 now returns `RETAILER_UNAVAILABLE` with the upstream
  status and the partial draft; an `amazon.in` URL returns it with no request made at all
  (asserted by the fixture server seeing zero hits); a 200 page with no product still returns
  `NO_PRODUCT_FOUND`; a JSON-LD page still returns a full draft.
- `apps/admin`: `tsc --noEmit` clean, `eslint src` 0 errors (7 pre existing warnings),
  `vite build` green on the integrated tree.
- A1 merged behind a green `scripts/dod.sh` (invariants, typecheck, lint, build).
- T1 and T2 each captured their own routes light and dark at 1440 into
  `docs/qa/evidence/admin-ux/phase-A2/t{1,2}/` and read the PNGs back.

## Open, in order

1. A2-T3 lands, merge it into `admin-ux/integration-a2`.
2. Run `docs/qa/evidence/admin-ux/capture-matrix.mjs phase-A2` (every route, both themes, both
   viewports, plus axe) and `walkthrough-a3.mjs`. Both need the machine under load 25.
3. ux-critic on the integrated tree.
4. `scripts/dod.sh`, PR to main, merge, then number the `XXXX_` migration per `docs/BRANCHING.md`
   and deploy `gear-ingest` plus the migration to production.

## How to resume

1. Read this file, then `docs/PLAN-ADMIN-UX.md`.
2. `git checkout admin-ux/integration-a2`.
3. Local stack up (`supabase start`), fixtures seeded:
   `psql "$DB_URL" -f supabase/seed/local_seed_admin_ux.sql` after the other seed files and
   `scripts/seed-demo-users.mjs`. That file exists because five admin lists had zero rows
   locally, so every page rendered an empty state and proved nothing.
4. Dev server: `cd apps/admin && VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=$(supabase status -o env | grep ^ANON_KEY | cut -d= -f2 | tr -d '"') pnpm exec vite --port 5199`.
   Login `admin@atlitos.dev` / `AtlitosDemo!2026`. The sandbox refuses to read `.env*`, which is
   why the env is passed inline.

## Traps this phase hit

- The `builder` agent type provisions its own worktree; pre-creating one and naming it in the
  dispatch makes every command in that agent fail. Tell the builder to use its own sandbox
  worktree and to report the branch name back.
- The main checkout's `node_modules` went stale after PR #8 added `cmdk`; `tsc` failed with a
  missing module until `pnpm install` ran at the root.
- Local Supabase auth returns a 504 `request_timeout` when the machine is loaded, which looks
  exactly like a broken login page. Check `uptime` before believing it.
- Another project's iOS build drove this Mac to load 275. Every render pass waits for load under
  25 (CLAUDE.md), because captures taken above it fabricate failures.
- Sign in now lands on `/dashboard`, not `/verification`; five assertions in `admin.spec.ts`
  moved with it.

## Related, not this phase

- OAuth providers configured and proven (PRs #5, #6). Founder still owes: Google consent screen
  to In production before 8 Oct; the Apple App ID has Push Notifications unchecked.
- The seed catalogue in production (8 products, fake ASINs, tag `atlitos-21`) is still to delist.
- PRD-04 gaps deliberately not built: refunds, user suspend and reinstate, feature flags, support
  tickets, audit log viewer. `admin.spec.ts` AD-04 and AD-06 assert their absence.
