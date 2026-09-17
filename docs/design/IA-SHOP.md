# Information architecture: the shop as a search

One page. Every screen the PRD-07 section 11 work touches, what reaches it, what it holds,
and the main task path from a cold start. Agree this before any screen is built.

## Consumer app (`apps/mobile`)

| Screen | Route | Reached from | Contains |
|---|---|---|---|
| Shop | `/(tabs)/shop` | tab bar | AI search field (focused on tap, not on open), sport chips, price ceiling chip, result grid of `GearResultCard`. Empty query: recent products. No category page. |
| Compare | `/shop/affiliate/[id]` | a result card, a search hit from Home search | Image, brand, title, attributes, description, `OfferRow` list cheapest first, "Purchase completes on the retailer, Atlitos may earn a commission" line. |
| Retailer | external browser | "Buy on X" on an `OfferRow` | The retailer's page, via the stored affiliate URL. Leaves the app. |
| Home search | existing `SearchBar variant="ai"` on Home | Home | Unchanged; affiliate hits route to Compare as today. |

Removed from navigation while `shop.owned_enabled = false`: `/shop/cart`, `/shop/checkout`,
`/shop/orders`, `/shop/order/[id]`, `/shop/product/[id]`, `/shop/category/[sport]`. The
routes stay in the bundle; the tab, the cart icon and the wishlist heart are not rendered,
and a deep link to them redirects to `/shop`.

### Main task path, cold start

Open app, tap Shop, type "light racket for a 12 year old starting badminton", tap a card,
read three prices, tap "Buy on Tennis Hub", buy on Tennis Hub. Four taps, one typed query,
no account required.

## Admin (`apps/admin`)

| Screen | Route | Reached from | Contains |
|---|---|---|---|
| Gear list | `/gear` | sidebar Gear | Exists (0120). Gains columns: image present, offers alive n of m, last checked, health state. Gains an Attention filter chip. |
| New gear item | `/gear/create` | Gear list, New gear item | New top section "Add from a link": URL field, Fetch, then the extracted fields shown for review with the image preview; Save. The manual form (0120) sits below as the fallback and the editor. |
| Gear item | `/gear/show/:id` | Gear list row, after create | Exists (0120). Gains per offer: last check outcome, checked at, Re-check now. Gains the AI suggestion box when the last recheck could not parse the page. |
| Catalog health | `/gear/health` | sidebar Gear, Health tab | Every product, worst first. Columns as FR-49. Bulk select, Delist, List, Re-check now. |

### Main task path, cold start

Sign in, Gear, New gear item, paste an Amazon URL, Fetch, check the image and price, Save.
Under a minute. Next morning: Gear, Health, Attention filter, delist the two that are gone.

## What is deliberately not a screen

- No retailer management page. `retailer_programmes` is seeded by migration; adding one is a
  migration with the affiliate tag template, because a tag is a credential-like value.
- No price history page. `last_price_change_at` feeds the strikethrough only.
- No embedding or vector admin. Embeddings are invisible infrastructure; a null one shows
  as "search: keyword only" on the Gear item, nothing more.
