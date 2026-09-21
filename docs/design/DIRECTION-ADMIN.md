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

The kit is a shared surface, not a single locked screen the way `DIRECTION-SHOP.md`'s grid and
compare rows are, so the honest budget here is kit-wide token usage, grepped from
`apps/admin/src/components/kit/`, `apps/admin/src/layout/` and the kitchen sink page itself,
not asserted from memory.

| Thing | Used | Tokens |
|---|---|---|
| Ground and card surfaces | 4 | `--color-bg`, `--color-surface`, `--color-surface-muted`, `--color-card` |
| Radii | 5 | `--radius-sm` (buttons, inputs), `--radius-md` (sidebar items, table cells), `--radius-lg` (cards, table wrap), `--radius-xl` (image tiles, none used at present), `--radius-pill` (badges) |
| Type sizes (base scale) | 5 | `--text-xs`, `--text-sm`, `--text-base`, `--text-md`, `--text-lg` |
| Type sizes (named variants) | 3 | `--type-title-size` (page titles), `--type-overline-size` (eyebrows), `--type-numericLg-size` (KPI tiles) |
| Badge tones | 4 | neutral, success, warning, danger, exactly the plan's four, no fifth added |
| Accent family | 3 vars, 1 hue | `--color-accent`, `--color-accent-pressed`, `--color-accent-tint`, all one orange; used for the primary button fill, the active nav item, the active tab underline, focus rings and the save bar's primary action |
| Semantic colours | 3 | `--color-success`, `--color-warning`, `--color-danger` (plus `--color-info`, present in tokens.css but not yet consumed by a kit component) |

A2's page rewrites are where the per-screen budget (closer to `DIRECTION-SHOP.md`'s discipline
of naming exactly which 2 or 3 sizes a single list page uses) gets enforced; this document
records what the shared kit makes available, not what one screen should spend.

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

(pending, not run in this task)

## Gate 1 response

(pending founder review)
