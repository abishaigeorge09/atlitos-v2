# Direction: the admin portal rebuilt against Stripe and Shopify

Scope: the admin kit (`apps/admin/src/components/kit/`), the shell (`Sidebar.tsx`, `Header.tsx`,
`nav.ts`, `ThemeToggle.tsx`), and every existing admin page that renders inside that shell
unchanged. This document is Gate 1 for Part B of `snappy-foraging-meadow.md`: the design
direction, judged from the kitchen sink at `/_kitchen`, before any page gets rewritten (that is
Phase A2, gated separately by `docs/PLAN-ADMIN-UX.md`).

## Reference images

`docs/design/references/admin/` (Mobbin captures of the live Stripe dashboard):

- `stripe-home.png`: search field left of the chrome controls, a grouped sidebar with plain
  items above a `Products` group with a disclosure, KPI numbers under a `Today` heading.
- `stripe-overview-dashboard.png`, `stripe-transactions-list.png`: status count tabs above a
  filter chip row, a dense table with right aligned amounts and payment method glyphs, a plain
  result count under the table.
- `stripe-payment-link-detail.png`: breadcrumb style eyebrow (`PAYMENT LINK`), one title, a tab
  row (`Overview` / `Payments and analytics`), a 2fr/1fr layout of sectioned cards with a sticky
  preview card on the right.
- `stripe-billing-tabs.png`, `stripe-data-table.png`: tab rows and dense table conventions,
  cross checked against the transactions list.

What is taken: the grouped sidebar with section labels, the search-first header, status count
tabs above a filter row, the sectioned 2fr/1fr detail layout with a sticky right column, dense
tables with right aligned numeric columns. What is not taken: Stripe's purple accent (Atlitos
keeps its own orange), the "Test mode" toggle and app-store icon (no admin equivalent), the
promotional banner cards on the home screen.

## The signature move, in one sentence

**A quiet paper page with one orange action per screen and every number in mono, right
aligned, so the state of the business reads at a glance.**

## The three rules that make it

1. **No page renders its own title.** Every list, detail and create screen opens with
   `PageHeader`: a breadcrumb, one title, an optional description, one primary action, and
   secondary actions folded next to it. This is a rule, not a suggestion, because before this
   kit every page hand rolled its own heading and the type scale drifted.
2. **Every number that is a readout goes through `<Mono>`, right aligned when it is a table
   column.** Prices, counts, offer totals, KPI tiles. This is the standing CLAUDE.md rule
   ("numeric readouts render in JetBrains Mono with tabular figures, everywhere, no
   exceptions"), enforced here by `DataTable`'s `numeric` column flag rather than left to each
   page to remember.
3. **One destructive action always gets a named confirm.** `ConfirmDialog` takes the record
   name in its body (`recordName`), so "delete this offer" always resolves to "delete this
   offer, Amazon.in, Rs 1,899", never a bare "are you sure".

## Scarcity budget, counted from the kit as shipped

Two different counts, kept apart because the ux-critic caught them conflated on 2026-09-21:

**Available in `apps/admin/src/styles/tokens.css`** (generated from `packages/theme`): 12 `--text-*`
sizes and 12 `--type-*-size` named variants. The kitchen sink's "1. Tokens" section is a
reference sheet and renders all of them on purpose; that section is not a screen.

**Spent by the kit and the shell**, from a real grep of `apps/admin/src/components/kit` and
`apps/admin/src/layout` (rerun it; if the numbers move, this table is wrong):

```
$ grep -rhoE 'var\(--(text|type)-[a-zA-Z0-9-]+' apps/admin/src/components/kit apps/admin/src/layout | sort | uniq -c | sort -rn
  14 var(--text-base
  11 var(--text-sm
   3 var(--text-xs
   2 var(--text-md
   2 var(--text-lg
   1 var(--type-title-size      (page title, PageHeader)
   1 var(--type-title-line
   1 var(--type-title-tracking
   1 var(--type-h2-size         (dialog title)
$ grep -rhoE 'var\(--radius-[a-z]+' ... | sort | uniq -c
  12 var(--radius-sm    6 var(--radius-lg    2 var(--radius-md    2 var(--radius-pill
$ grep -rhoE 'var\(--color-(bg|surface|surface-muted|card)\b' ... | sort | uniq -c
  14 var(--color-surface-muted    7 var(--color-card    6 var(--color-surface    2 var(--color-bg
```

| Thing | Spent | Where |
|---|---|---|
| Type sizes, base scale | 5 | xs (captions, badges), sm (table cells, hints), base (body, inputs), md (card titles), lg (KPI numbers) |
| Type sizes, named | 2 | `title` (page title), `h2` (dialog title) |
| Radii | 4 | sm (buttons, inputs, chips), md (nav items, cells), lg (cards, table wrap), pill (badges) |
| Ground and card surfaces | 4 | bg (page), surface (header, sidebar), surface-muted (inputs, image tiles, skeletons), card |
| Badge tones | 4 | neutral, success, warning, danger, from `src/lib/status.ts` |
| Accent family | 3 vars, 1 hue | accent, accent-pressed, accent-tint: primary button, active nav, active tab, focus ring, save bar |
| Semantic colours | 3 | success, warning, danger; `info` exists in tokens.css and is unused |

Per screen this lands at 4 sizes on a list page (title, sm cells, base body, xs meta) and 5 on a
form (adds md card titles), which is the plan's cap. `--radius-xl` is available and unused.

## Components rendered in the kitchen sink

Every kit component, per Part B section B4 (A1-T3): `PageHeader`, `FilterBar`, `DataTable`
(full, sparse, filtered empty, true empty, skeleton), `Tabs`, `Badge` (all four tones), `Button`
(all four variants, both sizes, loading, disabled), `Field`, `Input`, `Select`, `Textarea`,
`Skeleton` / `TableSkeleton` / `DetailSkeleton`, `EmptyState`, `ConfirmDialog`, `SaveBar` (clean,
dirty, invalid, saving), `DetailLayout` (populated and sparse), `Card`, `Mono` KPI tiles,
`CommandPalette` (Cmd K over the grouped nav, cmdk backed; not screenshotted open by
`capture-kitchen.mjs` since it is a shell level overlay rather than a kitchen sink section, but
verified open in a real browser during this task, which caught and fixed a real bug: cmdk's
`Command.Dialog` puts a passed `className` on its inner `[cmdk-root]`, not on the Radix dialog
content it renders, so the palette first shipped unstyled and inline rather than as a centered
overlay). The Add from a link block covers its three named outcomes (fetched
draft, `NO_PRODUCT_FOUND` partial prefill, the Amazon locked URL message) as static sample
states, not a live ingest call.

## ux-critic verdict

2026-09-21, Gate 1 for `apps/admin/src/components/kit/` and the shell
(`Sidebar.tsx`, `Header.tsx`, `nav.ts`, `ThemeToggle.tsx`), judged from `/_kitchen` at 1440x960,
dark and light, plus a live pass over `/dashboard`, `/gear`, `/gear/create`, `/verification`,
`/login` on the running admin dev server (`localhost:5199`). Reference: the six Stripe Mobbin
captures in `docs/design/references/admin/` (opened for this review), each cross checked
against `IA-ADMIN.md`.

**(1) Thumbnail test: PASS.** The kit-rendered screens (kitchen sink, `/dashboard`, `/gear`,
`/verification`) read as Atlitos, not a Stripe or Refine default: the orange accent
(`--color-accent`, hsl(18 100% 50%)), Urbanist headings (distinctive single-story `a` and
geometric `q`, confirmed rendering, not a system-font fallback), and JetBrains Mono right
aligned numerics (`Rs 0.00`, `₹1,899`, KPI tiles) are visible together on every kit screen.
Scope note: `/login` and `/gear/create` still render in the old plain Refine style (centered
card login, unstyled form headings) since neither is in this gate's scope
(`DIRECTION-ADMIN.md`'s own scope line: shell + kit, existing pages "unchanged" until A2). Not
counted against this test, but flagged under (6) below since the founder's complaint was about
the whole experience.

**(2) Signature move: PASS.** "A quiet paper page with one orange action per screen and every
number in mono, right aligned" is visible without being told on `/gear` (one orange "Add gear"
button, `PRODUCT`/`PRICE` columns with `₹1,899`-style mono right aligned), the dashboard KPI
row (`Rs 0.00`, `6`, `42`, mono), and the kitchen sink's `DataTable`, `SaveBar`, and `ConfirmDialog`
sections (record name and price both mono in "Amazon.in, ₹1,899").

**(3) Scarcity: BLOCK.** The budget table undercounts the kit's actual type tokens by roughly
3x, and the table's own header claims these numbers are "grepped from the kit as shipped...
not asserted from memory." Verified by grep against `apps/admin/src/styles/tokens.css`:
- Claimed "Type sizes (base scale): 5" (`--text-xs/sm/base/md/lg`). Actual: **12** `--text-*`
  tokens at root scope (adds `--text-callout`, `--text-button`, `--text-xl`, `--text-2xl`,
  `--text-3xl`, `--text-4xl`, `--text-5xl`, none named in the doc).
- Claimed "Type sizes (named variants): 3" (`--type-title-size`, `--type-overline-size`,
  `--type-numericLg-size`). Actual: **15** `--type-*-size` variants at root scope: `display`,
  `title`, `h1`, `h2`, `h3`, `body`, `callout`, `button`, `label`, `caption`, `overline`,
  `numericDisplay`, `numericLg`, `numericBase`, `numericSm`. The kitchen sink's own "1. Tokens"
  section renders 10 of these (`display` through `overline`) plus all 4 numeric sizes in a
  single screenshot, so the undercount is visible on the page being graded, not just in the
  file.
- Radii (5, `sm`/`md`/`lg`/`xl`/`pill`), badge tones (4), and the accent family (3 vars, 1 hue)
  all check out exactly against `tokens.css` and the kitchen sink render. Only the type row is
  wrong, but it is wrong by the largest margin of any counted category in this document, and it
  is the category most visible on every text-bearing screen.
- Severity: blocking. Fix is to either recount the table against the real token file, or to cut
  the unused sizes so the table becomes true again; either is a Gate 1 requirement, not a nit,
  per this document's own claim that the count is measured rather than remembered.

**(4) Information architecture: PASS.** Live sidebar order and grouping
(Home/Dashboard; Operations/Verification,Venues,Bookings,Orders; Catalog/Gear,Catalog
health,Products; Community/Moderation,Reports,Drills,Users; Settings/Fee config) matches
`IA-ADMIN.md` exactly, confirmed by reading the rendered sidebar at `/dashboard`. Stripe
reference patterns named in `IA-ADMIN.md`/`DIRECTION-ADMIN.md` are all present in the kitchen
sink: grouped sidebar with section labels, search-first header (`Header.tsx`, search left of
the theme toggle), status/tab row above a filter row (`Tabs`, `FilterBar`), dense table with
right aligned mono columns, 2fr/1fr `DetailLayout` with a sticky right column, `SaveBar`,
`ConfirmDialog` with the named record, and all three populated/sparse/empty/skeleton table
states plus the three named "Add from a link" outcomes.

**(5) Defects:**
- **Should fix.** `.ak-header` (`apps/admin/src/layout/shell.css:177`, rendered from
  `apps/admin/src/layout/Header.tsx`) has no `position: sticky`. On the kitchen sink itself,
  which is long, scrolling down loses the search field, the Cmd K entry point, and the theme
  toggle until the page is scrolled back to the top. Today's real pages are short enough that
  this does not bite, but any future long form or table (or the kitchen sink itself, which is
  the artifact this gate is judged from) reproduces it. Screenshot:
  `ss_7902jma5u` shows the header back in view only after scrolling fully to top; scrolled
  screenshots `ss_2833ngak8`, `ss_2800b47m2`, `ss_8259whsxg`, `ss_3282zmvhp`, `ss_7943147bi`,
  `ss_4555jzwl1` (all `/_kitchen`, this session) show no header at all.
- **Note.** The 1024px collapsed-rail breakpoint (`Sidebar.tsx:21`,
  `narrow = window.innerWidth < 1024`) could not be visually re-verified in this session: the
  browser tool's `resize_window` reported success at 1024x768 and again at 800x600, but the
  tab's rendered screenshot stayed 1456x840 both times, so no real narrow render was captured.
  The collapse logic reads correctly off the source (`isRail = collapsed || narrow`), but this
  is a code read, not a render, and should get an explicit re-check before Gate 2.
- **Note.** Focus visibility, both themes' contrast, font loading, and the command palette are
  clean: Tab produces a visible orange focus ring (`/dashboard`, tabbed to "Verification"),
  light and dark badge/button contrast both read clearly at zoom, Urbanist and JetBrains Mono
  both render (not a system-font fallback, confirmed at 2x zoom), and Cmd K opens a correctly
  themed palette in both light (white card) and dark (near-black card) rather than a
  mismatched overlay.
- **Note, not a defect at this gate.** `/gear` (real, unconverted page) and `/gear/create`
  (real, unconverted page) do not yet open with the kit's `PageHeader` (no breadcrumb over
  "Gear", `/gear/create` still shows the old "Back to gear" arrow and hand-rolled heading). This
  matches `DIRECTION-ADMIN.md`'s own scope line that existing pages render "unchanged" until
  Phase A2, so it is not scored against this gate, but it is the reason finding (6) below is
  qualified rather than a flat pass.

**(6) Founder's three complaints, against what exists today:**
- "the admin portal is not clear": answered by the shell (grouped, labelled sidebar;
  search-first header; kit `PageHeader` breadcrumbs) wherever a page has adopted the kit
  (`/dashboard`, `/gear` list, `/verification`, kitchen sink). Not yet answered on pages still
  in the old style (`/gear/create`), which is explicitly A2's job, not this gate's.
- "elements are pasted": answered by the shared primitives (`DataTable`, `Badge`, `Button`,
  `SaveBar`, `ConfirmDialog`) replacing ad hoc markup on every kit-converted screen. Not yet
  true of `/gear/create`, which still hand rolls its form.
- "the whole sidebar and the whole experience of each page are not great": the sidebar is
  answered now (Stripe-pattern grouping, icons, collapses to a rail, orange active state). "Each
  page" is answered only where the kit has landed; pages waiting on A2 will need a second look
  before this complaint is fully closed.

**Overall: BLOCK, 1 blocking finding** (scarcity table drift, item 3 above). The should-fix
header sticky issue and the two notes do not block Gate 1 on their own, but should be tracked
before Gate 2 as A2 pages start shipping.

## Gate 1 response

**2026-09-22, founder, verbatim: "resume and dont stop till all screens are done".**

Read as: the direction stands, build every page on it. No change was requested to the signature
move, the grouping, the density default or the accent. The standing autonomy directive for Atlitos
(founder will not test; founder fingers are replaced by scripted real proofs) applies from here, so
Gate 2 (`docs/PLAN-ADMIN-UX.md`) is self gated on the same rule and each phase gate is re derived
by the approver from the running app, not asserted.

Batched founder inputs the plan asked for, resolved by default and reversible in a line each:
signature move as written above; nav grouping as in `IA-ADMIN.md` (Venues stays under
Operations); density default `comfortable`, `compact` behind the toggle, persisted.
