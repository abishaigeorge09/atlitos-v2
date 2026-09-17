# Direction: the shop as a search

Scope: the shop surfaces in PRD-07 section 11 (shop home, result card, compare screen) and
the admin catalog health page. Everything else in the app keeps `DESIGN-LANGUAGE.md` as is;
this document adds nothing to the token set, it spends it.

Reference images sit beside the kitchen sink screenshot: `references/google-shopping-grid.jpg`
and `references/google-shopping-compare.jpg`. Notes in `TASTE.md`, reference 5.

## The signature move, in one sentence

**The price on every card is the only accent-coloured text on the shop, set in the mono face
and sized like a heading, so a shop screen with the wordmark cropped off is still a grid of
orange numbers on cream tiles.**

That is the thumbnail test. Google Shopping's grid is recognisable by the product-on-white
tiles; ours is recognisable by the numbers. Sport gear photography is not ours to control,
so the number is where the identity lives.

## The three rules that make it

1. **Search first.** The Shop tab opens on the AI search field with the keyboard closed and
   sport chips under it. The grid is the answer to a query (empty query = recent). There is no
   category page.
2. **One accent per tile.** The "from" price is the accent. Nothing else on a card is orange:
   not the brand, not the retailer count, not a badge. The compare screen keeps one accent
   too: the cheapest in-stock row's price.
3. **Freshness is quiet and always present.** Every price the app shows was fetched, so every
   price carries when ("checked 6 h ago") in the tertiary text colour. Never hidden, never
   loud.

## Scarcity budget for these surfaces

| Thing | Budget | Used |
|---|---|---|
| Ground and card surfaces | 2 | `surface` (page), `surfaceMuted` (image tile) |
| Type sizes on a card | 3 | title (body), price (display sm, mono), meta (caption) |
| Type sizes on compare | 4 | the three above plus the screen title |
| Radii | 1 | `radii.md` on tiles and rows; no pills except the existing Chip |
| Accent uses per screen | 1 | the price (grid), the cheapest price (compare) |
| Semantic colours | 2 | `success` for in stock, `warning` for out of stock; `danger` only in admin health |

Above the cap: none. The admin health page uses the admin token set and adds one semantic,
`danger`, for a gone link, because admin is where a red state is an instruction.

## Components rendered in the kitchen sink (full and sparse)

- `GearResultCard`: full (image, brand, 3 stores, price, checked 2 h ago) and sparse (no
  image placeholder tile, 1 store, checked 9 days ago).
- `OfferRow`: full (cheapest, in stock, checked 6 h ago) and sparse (out of stock, dimmed,
  checked 12 days ago, no buy action).
- `HealthBadge` set: ok, price changed, out of stock, gone, blocked, unchecked.

## ux-critic verdict

2026-09-17, second pass after three blocking findings (accent border on the cheapest row,
a fourth type size in the sparse card, a fifth on compare) were fixed: thumbnail PASS on
the grid of six, signature PASS (one accent per card and per row), scarcity PASS (3 sizes
on the card, 4 on compare, one radius, two surfaces). APPROVE.

## Gate 1 response

_Awaiting the founder. Record the date and their words here; `phase-planner` refuses to
plan while this section is empty._
