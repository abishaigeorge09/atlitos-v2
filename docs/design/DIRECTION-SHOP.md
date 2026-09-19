# Direction: the shop as a search

Scope: the shop surfaces in PRD-07 section 11 (shop home, result card, compare screen) and
the admin catalog health page. Everything else in the app keeps `DESIGN-LANGUAGE.md` as is;
this document adds nothing to the token set, it spends it.

Reference images sit beside the kitchen sink screenshot: `references/google-shopping-grid.jpg`
and `references/google-shopping-compare.jpg`. Notes in `TASTE.md`, reference 5.

## The signature move, in one sentence (direction C, approved)

**A flat white photo tile with the product alone on it, and under it the brand, the price,
and the store the price came from, in that order, every time.**

(Direction A's sentence, the display-sized orange price, was rejected on 17 September and
is kept below for the record.)

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

**2026-09-17, direction A (price-led): REJECTED.** Founder's words: "I just don't like how
the text has been put. I can't see where I'm actually seeing this link from, and the way
the number is big, I just don't like it. It doesn't give me the professional feeling that
Google does. I think throughout the app, we have messed up the formatting and different
sizes. This is not the industry standard. I just don't like how it visualizes, so maybe
fix that and give me another version."

Read as three requirements for direction B: the retailer is named on the card; the price
is small and calm, not a display number; one compact type scale, the way Google's card is
all 13 to 14 px. Direction B follows.

### Direction B: Google's card, Atlitos's ground

Rendered in `references/kitchen-shop-b-light.png` and `-dark.png`. Components
`GearResultTile` and `OfferRow dense`.

- No card box. An image tile on the surface colour, then four quiet lines on the page ground.
- **Two type sizes on the whole surface: 13 and 12.** Title 13 regular, price 13 semibold mono
  in ink, retailer 12, freshness 12. The price is never a display number.
- **The retailer is on the card**: a store glyph and "Amazon.in & 2 more". The glyph is the
  one accent; it means "this is where the price is from".
- A dropped price shows the old one struck through in grey, only when the nightly check saw
  the drop.
- Compare rows: retailer 13 semibold, the word "Cheapest" in accent as the one accent,
  price 13 semibold mono in ink, freshness 12, a text link "Buy on X".

Signature sentence for B: **the shop is a calm grid of white tiles on cream, where every
price is a small ink number sitting on the name of the store it came from.**

Scarcity for B: surfaces 2 (`bg`, `surface` tile), sizes 2 on the grid (3 on compare with
its title), radius 1, accent 1 per tile (store glyph) and 1 per compare screen ("Cheapest").

**2026-09-17, direction B: not accepted.** Founder's words: "Have the images that are
displayed as flat images instead of the corners. Look at how the images are displayed in
Amazon. I want it like that, and just the whole formatting itself. See if we can make it a
bit better." A phone capture of Amazon's grid was attached; `references/amazon-in-grid.png`
is the desktop equivalent captured for the repo.

### Direction C: Amazon's card

Rendered in `references/kitchen-shop-c-light.png` and `-dark.png`. Component `GearResultTile`.

- **Flat square image tile, no corners, no border**, white surface so retailer photos shot on
  white blend into the tile; product centred at 80 percent.
- Text stack in Amazon's order: **brand bold 13**, title regular 13 up to three lines,
  **price 18 semibold mono in ink**, the old price struck through with "(9% off)" beside it
  when the nightly check saw a drop, retailer line with the store glyph, freshness.
- Three sizes on the tile: 18, 13, 12. One accent: the store glyph. Radius: none on tiles.
- Compare rows unchanged from B (dense): "Cheapest" is the one accent.

Signature sentence for C: **a flat white photo tile with the product alone on it, and under
it the brand, the price, and the store the price came from, in that order, every time.**

**2026-09-17, direction C: APPROVED.** Founder: "Approve C". Direction C is the locked
direction for every shop surface in PRD-07 section 11. Directions A and B stay in the
kitchen sink for the record and are not to be built.
