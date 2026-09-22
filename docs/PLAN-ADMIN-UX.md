# Plan: the admin portal rebuilt on the admin kit

Gate 2 for Part B of `~/.claude/plans/snappy-foraging-meadow.md`. Direction (Gate 1) is
`docs/design/DIRECTION-ADMIN.md`, approved 2026-09-22 ("resume and dont stop till all screens
are done"). IA is `docs/design/IA-ADMIN.md`. Architecture is ADR-012 in the direction doc: an
`ak-` kit on the existing tokens, no shadcn, no Tailwind in `apps/admin`.

Self gated 2026-09-22 under the Atlitos autonomy directive (founder will not test). Every phase
gate below is re derived by the approver from the running app; nothing is asserted from a diff.

## Scope

Every route in `apps/admin` renders on the kit: `PageHeader`, `FilterBar`, `Tabs`, `DataTable`,
`DetailLayout`, `SaveBar`, `ConfirmDialog`, `Skeleton`, `EmptyState`, `Badge` via
`src/lib/status.ts`, `Mono` for every numeric readout. Pages stop rendering their own titles,
stop using `style={{` for layout that the kit provides, and stop hand rolling hover, focus and
loading states. Plus the ingest flow fix (A3) the founder named ("the link does not really add
in").

Not in scope (PRD-04 gaps, one `docs/DEBT.md` line each, the approver rejects any new resource):
refunds, user suspend and reinstate, feature flags, support tickets, audit log viewer.

## Phases

### A1: shell and kit (done, integrate)

Branch `admin-ux/gate1-kitchen`, draft PR #8. Gate: every existing page renders inside the new
shell; `tsc`, lint, build green; the kitchen sink and shell captures exist in
`docs/design/references/`. Integration is a PR merge to main behind the DoD hook.

### A2: page rewrites

Gate: every route in `IA-ADMIN.md` opens with `PageHeader`; every list is a `DataTable` with a
`FilterBar` (search, result count) and a skeleton while loading; every detail is a
`DetailLayout`; every create or edit is sectioned cards with a `SaveBar`; every destructive or
irreversible action opens a `ConfirmDialog` naming the record; no page keeps a hand rolled
`<h1>`; `grep -rn 'outline: "none"' apps/admin/src` is zero; the frozen copy strings below are
byte identical; `tsc`, lint, build green; the screenshot matrix exists for every route in both
themes at 1440 and 1024; axe reports zero critical and zero serious in both themes.

Tracks, each in its own worktree, Sonnet:

| Track | Owns | Notes |
|---|---|---|
| A2-T1 gear and venues | `pages/gear/{list,show,form,health}.tsx`, `pages/gear/format.ts`, `pages/venues/{list,show,create}.tsx` | not `pages/gear/create.tsx` or `pages/gear/api.ts` (A3). Offer delete and bulk delist get a confirm. Founder's stated pain, first to land. |
| A2-T2 operations | `pages/verification/*.tsx`, `pages/bookings/*.tsx`, `pages/orders/*.tsx`, `pages/dashboard/*.tsx` | KPI tiles in mono. Order advance gets a confirm naming the order. Verification reject keeps its reason gate. |
| A2-T3 community and settings | `pages/moderation/*.tsx`, `pages/reports/*.tsx`, `pages/drills/*.tsx`, `pages/users/*.tsx`, `pages/fee-config/*.tsx`, `pages/products/*.tsx` | Moderation reject keeps its reason gate. No suspend or reinstate control anywhere (AD-06 asserts their absence). |
| A2-T4 e2e sync (after T1 to T3 merge) | `apps/e2e/specs/money/admin.spec.ts`, `apps/e2e/specs/admin-ux/*`, `docs/qa/evidence/admin-ux/capture-*.mjs` | AD-01, AD-04, AD-06 expect `/verification` after sign in; A1 sends `/` to `/dashboard`, so they change to `/dashboard`. Add `data-testid` to confirm dialog buttons. |

Shared files no track edits: `src/components/kit/**`, `src/layout/**`, `src/App.tsx`,
`src/components/ui.tsx`, `src/components/form.tsx`, `src/lib/status.ts`. A kit gap is reported
to the integrator, who makes the one change on the integration branch.

### A3: the ingest flow

Gate, proven by `docs/qa/evidence/admin-ux/walkthrough-a3.mjs` against the local fixture server:
a Decathlon URL prefills the manual form and saves one product with one offer; an Amazon URL
shows "Amazon India pages cannot be fetched automatically. Fill in the details and the link is
kept as the offer." with the URL locked as the offer link and the form ready; a page with no
product data prefills whatever the partial draft carried and names what is missing; every error
shows its code and one line of guidance.

| Track | Owns |
|---|---|
| A3-T1 client | `pages/gear/create.tsx` (one form state; Add from a link is a prefill source, not a second form), `pages/gear/api.ts` (`ingestFetch` returns the partial draft on 422, typed codes), new `pages/gear/ingest-guidance.ts` (copy per `UNSUPPORTED_RETAILER`, `ROBOTS_DISALLOWED`, `BLOCKED_TARGET`, `NO_PRODUCT_FOUND`, `RETAILER_UNAVAILABLE`, `INTERNAL`) |
| A3-T2 server | `supabase/functions/gear-ingest/index.ts` returns `RETAILER_UNAVAILABLE` with the upstream status on 5xx or 403 from a supported retailer; migration `NNNN_retailer_programme_fetchable.sql` adds `fetchable boolean not null default true` on `retailer_programmes` (`amazon_in` false); `SCHEMA.md`, `API-MAPPING.md` |
| A3-T3 evidence | `walkthrough-a3.mjs` with Amazon 503, Decathlon JSON-LD and no product fixtures; ADR-011 gains "D5, future option, not built: browser clipper" |

A3-T1 touches `pages/gear/form.tsx` only for the initial draft and locked offer URL props; it
lands after A2-T1 so the form is already on the kit.

## Frozen copy strings (e2e contract)

Byte identical, or `admin.spec.ts` goes red for a reason that is not a bug:

- `Sign in` (button), `Email`, `Password` (labels)
- `This account does not have admin access.`
- `Approve` (verification), `Reject`, `Confirm reject`, `A rejection reason is required.`
- `Approve and publish`, `Clip approved and published to the feed.`,
  `Clip rejected. The creator has been notified with the reason.`
- `Advance this order`
- Verification success toasts contain `approved` and `rejected` (case insensitive contains).
- No button matching `/refund/i`, `/suspend/i`, `/reinstate/i` anywhere; no text `Suspend` on
  `/users/show/:id`.

## Verification

- Screenshot matrix: every route (login, dashboard, 11 lists, each show with a seeded id, each
  create, `/gear/health`, `/_kitchen`) at 1440x960 and 1024x768, light and dark via
  `data-theme`, reduced motion forced, into `docs/qa/evidence/admin-ux/phase-A2/`.
- Axe on every route in both themes, tags `wcag2a` and `wcag2aa`: zero critical, zero serious,
  at most five moderate, each listed in the status doc with a home.
- Keyboard: Tab through the sidebar, Enter opens a row, Esc closes the dialog, Cmd K opens the
  palette.
- `admin.spec.ts` AD-01 to AD-07 green against the deployed admin after each merge.
- ux-critic pass on the integrated tree, advisory at this gate, blocking on any finding it
  marks blocking.

## Risks

1. E2e selectors are copy strings: frozen above, A2-T4 owns the spec.
2. Prasanth's login work touches `pages/login` and `Shell.tsx`: no track edits either.
3. `gen-tokens.ts` writes only the admin sheet; any `packages/theme` edit is additive.
4. 30 Sep: nothing here blocks the App Store submission; the admin is web only.
5. Native `<dialog>` a11y: Radix escape hatch, decided at A2 integration if axe flags it.
6. Scope creep into PRD-04 gaps: not built, DEBT lines instead.
7. Amazon 503 is today's behaviour: `fetchable` is data, copy says "cannot be fetched
   automatically", nothing about Amazon policy.
