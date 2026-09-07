import { useMemo } from "react";
import type { ApiError, ApiErrorCode, OrderStatus, Sport } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapEdgeFunctionError, mapPostgrestError } from "./errors";
import { readRefundSummary, type RefundSummary } from "./refunds";

/**
 * `@atlitos/api`'s shopper commerce lane (AT-74 to AT-80, P4 Track C), per
 * docs/architecture/API-MAPPING.md "shop" / "wishlist (gear)" and
 * docs/prd/PRD-07-shopper.md. Deliberately its own file rather than filling
 * in `hooks.ts`'s old `useShop`/`useWishlist` placeholders in place, matching
 * how `use-coaching.ts` split the athlete half of coaching out of `hooks.ts`.
 *
 * Three rules run through every function below and none of them are optional.
 *
 * 1. **Available stock, never raw stock.** Every shopper facing quantity is
 *    read from the `product_variant_availability` view (0033, AT-67), which
 *    is the ONE definition of what a shopper may buy: raw
 *    `product_variants.stock` minus held, unexpired reservations. Nothing in
 *    this file selects `product_variants.stock`, and nothing re-derives the
 *    subtraction, so the PDP and the checkout cannot disagree.
 *    (PHASE-4-STATUS.md D2.)
 *
 * 2. **Owner filters in app code, always.** `products`, `product_variants`,
 *    `product_media` and `categories` carry a public browse policy, and they
 *    sit inside the same joined queries as the strictly owner scoped
 *    `cart_items`, `orders`, `addresses` and `product_wishlist_items`. RLS is
 *    permissive OR, so every read of an owner scoped table below carries its
 *    own explicit `.eq("user_id", user.id)` regardless of what RLS would have
 *    done. CLAUDE.md records the four times this repo was bitten by skipping
 *    that.
 *
 * 3. **Clients never write money rows.** Cart mutations go through the
 *    `add_to_cart` / `update_cart_item` RPCs (0034), which revalidate stock
 *    server side and cap rather than silently rounding up. The `orders`,
 *    `order_items`, `order_timeline`, `payment_intents` and
 *    `stock_reservations` rows are all written by service role edge
 *    functions; this file only reads them. The direct cart upsert path is
 *    closed by both policy and grant, so there is nothing to fall back to.
 */

// ---------------------------------------------------------------------------
// Shared row shapes
// ---------------------------------------------------------------------------

/** The gear image bucket. Product media rows carry a storage path; the bucket
 * itself is provisioned alongside PRD-04's admin catalog CRUD (AT-81, Track
 * D). Until a media row exists this resolver is never called, and screens
 * render a token driven placeholder rather than a broken image. */
const PRODUCT_MEDIA_BUCKET = "product-media";

export interface ShopVariant {
  id: string;
  productId: string;
  sku: string;
  size: string | null;
  color: string | null;
  /** `effective_price` from the availability view: the variant's price
   * override when it has one, otherwise the product base price. Never
   * recomputed client side. */
  price: number;
  /** AVAILABLE stock, not raw inventory. See rule 1 in the file header. */
  availableStock: number;
}

export interface ShopProduct {
  id: string;
  title: string;
  description: string | null;
  sport: Sport | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  basePrice: number;
  /** FR-2's recommendation field. Heuristic in v1, the contract is preserved
   * for an LLM ranked value later. */
  recommendedRank: number | null;
  imageUrl?: string;
  imageUrls: string[];
  variants: ShopVariant[];
  /** Lowest variant price, the "from" figure the browse grid shows. Falls
   * back to `basePrice` for a product with no variants yet. */
  priceFrom: number;
  /** Sum of available stock across every variant. Zero means the whole
   * product is unbuyable right now, which the grid dims and the PDP explains
   * per variant. */
  availableStock: number;
}

// ---------------------------------------------------------------------------
// Affiliate marketplace (0086, WS4). External products the shopper compares
// across retailers and clicks out to buy, rather than the owned products they
// cart and check out in-app. A `source` discriminator keeps the two apart on
// every shape the UI touches so a screen can never treat an affiliate row as a
// cartable owned product (it has no variants, no stock, no in-app checkout).
// ---------------------------------------------------------------------------

/** One retailer's offer on an affiliate product: its price and the outbound,
 * commission-bearing link the click-out opens. Prices are ingested server side
 * (no client write), so nothing here is ever recomputed or set client side. */
export interface ProductOffer {
  id: string;
  retailer: string;
  price: number;
  currency: string;
  affiliateUrl: string;
  inStock: boolean;
  lastCheckedAt: string;
}

export interface AffiliateProduct {
  /** Discriminates an affiliate product from an owned `ShopProduct` at every
   * call site that could receive either. */
  source: "affiliate";
  id: string;
  title: string;
  brand: string | null;
  sport: Sport | null;
  categoryName: string | null;
  skillLevel: string | null;
  ageRange: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Every retailer offer, sorted cheapest in-stock first. The head of an
   * in-stock-sorted list is the "cheapest" the compare view highlights. */
  offers: ProductOffer[];
  /** Lowest in-stock offer price, the "from" figure the browse card shows.
   * Null only when every offer is out of stock. */
  bestPrice: number | null;
}

export interface CartLine {
  cartItemId: string;
  variantId: string;
  productId: string;
  title: string;
  variantLabel: string;
  imageUrl?: string;
  unitPrice: number;
  qty: number;
  availableStock: number;
  /** FR-12's block: the line asks for more than is available right now, so
   * Proceed To Buy stays disabled until the shopper reduces it or removes the
   * line. Derived from live availability at read time, not remembered from
   * whatever `add_to_cart` said earlier. */
  exceedsStock: boolean;
  lineTotal: number;
}

export interface CartMutationOutcome {
  cartItemId: string;
  variantId: string;
  qty: number;
  requestedQty: number;
  availableStock: number;
  /** True when the server wrote a smaller quantity than was asked for.
   * PRD-07 FR-9 requires the shopper be told; this drives a real notice. */
  capped: boolean;
}

export interface AddressRecord {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export interface AddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
}

export interface OrderBill {
  subtotal: number;
  deliveryCharges: number;
  gstAndOthers: number;
  donationRoundup: number;
  total: number;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  total: number;
  createdAt: string;
  itemCount: number;
}

export interface OrderItemLine {
  id: string;
  /** Snapshot columns, frozen at order time. A later admin price or title
   * edit must not rewrite what a shopper was charged (PRD-07 FR-25). */
  title: string;
  variantLabel: string;
  qty: number;
  unitPrice: number;
}

export interface OrderTimelineEntry {
  id: string;
  status: OrderStatus;
  note: string | null;
  location: string | null;
  createdAt: string;
}

export interface OrderFeedbackRecord {
  id: string;
  rating: number;
  remarks: string | null;
  createdAt: string;
}

/** The delivery address AS SHIPPED, read from the `orders.ship_to_*` snapshot
 * columns written once by `place_order_from_draft` (0038, AT-72). Never the
 * `addresses` foreign key join: that row stays editable and deletable, so
 * joining it lets a later address edit retroactively rewrite where a past
 * order went, which is the same bug class the item price snapshot forbids.
 * `orders.address_id` survives only as "which saved address was picked", for
 * Reorder and support, and nothing renders from it. */
export interface OrderShipTo {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: string;
  /** Read straight off the `orders` row's stored money columns, never
   * recomputed against current prices (PRD-07 FR-25). */
  bill: OrderBill;
  shipTo: OrderShipTo;
  items: OrderItemLine[];
  timeline: OrderTimelineEntry[];
  feedback: OrderFeedbackRecord | null;
}

/** Commerce fee configuration, read from `fee_config` (readable by any
 * authenticated user, `fee_config_select_authenticated`, 0010). The client
 * uses these only to PREVIEW the bill on the checkout screen; the `checkout`
 * edge function re-derives every figure server side and rejects a mismatch
 * with PRICE_MISMATCH, so nothing here is ever authoritative. */
export interface CommerceFeeConfig {
  deliveryFlat: number;
  /** `commerce.gst_percent` is stored as a FRACTION, not a whole percentage:
   * 0.18 means 18 percent. This is the convention `book-court` and the
   * `checkout` edge function both already use (`subtotal * config.value`), so
   * the field is named for the fraction it holds rather than the percentage
   * it represents. Multiplying by 100 anywhere is a bug. */
  gstRate: number;
  /** PHASE-4-STATUS.md founder decision 2 (2026-07-20): the roundup is the
   * distance from the pre roundup total up to the next multiple of this
   * value, not a flat figure. Config driven so it stays a config change. */
  donationRoundupMultiple: number;
}

export interface CheckoutLineInput {
  productVariantId: string;
  qty: number;
}

export interface CheckoutInput {
  items: CheckoutLineInput[];
  addressId: string;
  /** Whether the shopper ticked the roundup box. Sent alongside the derived
   * amount so the server can tell "opted in, roundup happens to be zero"
   * apart from "did not opt in" without inferring it from a zero. */
  donationRoundupOptedIn: boolean;
  bill: OrderBill;
}

export interface CheckoutResult {
  paymentIntentId: string;
  razorpayOrderId: string;
  keyId: string;
  amountPaise: number;
  currency: string;
  /** The server's own recomputed bill. On success it matches what was sent;
   * this is what the screen re-renders through `BillSummary` either way, so a
   * silently corrected figure can never be hidden from the shopper. */
  bill: OrderBill;
}

export interface VerifyOrderPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifyOrderPaymentResult {
  orderId: string;
  orderNumber: string | null;
  status: OrderStatus;
  outcome: "captured" | "already_processed";
}

// ---------------------------------------------------------------------------
// Row shapes for the PostgREST selects below. Hand written rather than
// inferred, matching `hooks.ts`'s courts queries: the embedded-view selects
// here are deep enough that the generated inference is unreadable at the call
// site, and an explicit `.returns<T[]>()` documents the query's shape next to
// the query itself.
// ---------------------------------------------------------------------------

interface AvailabilityQueryRow {
  product_variant_id: string | null;
  product_id: string | null;
  sku: string | null;
  size: string | null;
  color: string | null;
  effective_price: number | null;
  available_stock: number | null;
}

interface ProductQueryRow {
  id: string;
  title: string;
  description: string | null;
  sport: Sport | null;
  category_id: string | null;
  base_price: number;
  recommended_rank: number | null;
  categories: { id: string; name: string; slug: string } | null;
  product_media: { storage_path: string; position: number; is_primary: boolean }[] | null;
  product_variant_availability: AvailabilityQueryRow[] | null;
}

const PRODUCT_SELECT = `
  id, title, description, sport, category_id, base_price, recommended_rank,
  categories ( id, name, slug ),
  product_media ( storage_path, position, is_primary ),
  product_variant_availability ( product_variant_id, product_id, sku, size, color, effective_price, available_stock )
`;

interface OfferQueryRow {
  id: string;
  retailer: string;
  price: number;
  currency: string;
  affiliate_url: string;
  in_stock: boolean;
  last_checked_at: string;
}

interface AffiliateProductQueryRow {
  id: string;
  title: string;
  brand: string | null;
  sport: Sport | null;
  skill_level: string | null;
  age_range: string | null;
  description: string | null;
  image_url: string | null;
  categories: { id: string; name: string; slug: string } | null;
  product_offers: OfferQueryRow[] | null;
}

const AFFILIATE_SELECT = `
  id, title, brand, sport, skill_level, age_range, description, image_url,
  categories ( id, name, slug ),
  product_offers ( id, retailer, price, currency, affiliate_url, in_stock, last_checked_at )
`;

/** Map an affiliate product row, sorting its offers cheapest in-stock first so
 * the head of the list is the retailer the compare view highlights. In-stock
 * offers always sort ahead of out-of-stock ones regardless of price, because a
 * cheaper price the shopper cannot actually buy is not the cheapest offer. */
function mapAffiliateProductRow(row: AffiliateProductQueryRow): AffiliateProduct {
  const offers = (row.product_offers ?? [])
    .map(
      (o): ProductOffer => ({
        id: o.id,
        retailer: o.retailer,
        price: o.price,
        currency: o.currency,
        affiliateUrl: o.affiliate_url,
        inStock: o.in_stock,
        lastCheckedAt: o.last_checked_at,
      }),
    )
    .sort((a, b) => {
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
      return a.price - b.price;
    });
  const inStockPrices = offers.filter((o) => o.inStock).map((o) => o.price);

  return {
    source: "affiliate",
    id: row.id,
    title: row.title,
    brand: row.brand,
    sport: row.sport,
    categoryName: row.categories?.name ?? null,
    skillLevel: row.skill_level,
    ageRange: row.age_range,
    description: row.description,
    imageUrl: row.image_url,
    offers,
    bestPrice: inStockPrices.length > 0 ? Math.min(...inStockPrices) : null,
  };
}

function resolveMediaUrls(
  client: AtlitosClient,
  media: { storage_path: string; position: number; is_primary: boolean }[] | null,
): string[] {
  return [...(media ?? [])]
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.position - b.position;
    })
    .map((row) => client.storage.from(PRODUCT_MEDIA_BUCKET).getPublicUrl(row.storage_path).data.publicUrl);
}

function mapVariantRow(row: AvailabilityQueryRow): ShopVariant {
  return {
    id: row.product_variant_id ?? "",
    productId: row.product_id ?? "",
    sku: row.sku ?? "",
    size: row.size,
    color: row.color,
    price: row.effective_price ?? 0,
    availableStock: row.available_stock ?? 0,
  };
}

function mapProductRow(client: AtlitosClient, row: ProductQueryRow): ShopProduct {
  const variants = (row.product_variant_availability ?? [])
    .map(mapVariantRow)
    .sort((a, b) => (a.size ?? "").localeCompare(b.size ?? ""));
  const imageUrls = resolveMediaUrls(client, row.product_media);
  const prices = variants.map((variant) => variant.price).filter((price) => price > 0);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sport: row.sport,
    categoryId: row.category_id,
    categoryName: row.categories?.name ?? null,
    categorySlug: row.categories?.slug ?? null,
    basePrice: row.base_price,
    recommendedRank: row.recommended_rank,
    imageUrl: imageUrls[0],
    imageUrls,
    variants,
    priceFrom: prices.length > 0 ? Math.min(...prices) : row.base_price,
    availableStock: variants.reduce((sum, variant) => sum + variant.availableStock, 0),
  };
}

/** Human readable variant label, used for the PDP selector and the cart line.
 * A variant may carry a size, a color, both, or neither (a one size product),
 * so this never assumes a size exists. */
export function variantLabel(variant: Pick<ShopVariant, "size" | "color" | "sku">): string {
  const parts = [variant.size, variant.color].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : variant.sku;
}

/** Requires an authenticated user id for every owner scoped read and write.
 * Returns the id rather than letting a null through, because a null user id
 * silently turns `.eq("user_id", null)` into a query that matches nothing and
 * looks like an empty cart instead of a signed out session. */
async function requireUserId(client: AtlitosClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error) {
    const apiError: ApiError = { code: "UNAUTHENTICATED", message: error.message, status: 401 };
    throw apiError;
  }
  if (!data.user) {
    const apiError: ApiError = {
      code: "UNAUTHENTICATED",
      message: "Sign in to continue.",
      status: 401,
    };
    throw apiError;
  }
  return data.user.id;
}

/** The `addresses.pincode` CHECK is a bare constraint (`^[0-9]{6}$`,
 * 0001_identity.sql), not a named-prefix RAISE, so Postgres reports 23514
 * rather than a `PINCODE_INVALID:` message the shared mapper would recognize.
 * Translating it here keeps PRD-07 FR-15's inline field error a real error
 * code instead of a message substring match at the screen. */
function mapAddressWriteError(error: { message: string; code?: string }): ApiError {
  if (error.code === "23514" && error.message.includes("pincode")) {
    return {
      code: "PINCODE_INVALID",
      message: "Enter a valid 6 digit pincode.",
      field: "pincode",
      status: 400,
    };
  }
  return mapPostgrestError(error);
}

// ---------------------------------------------------------------------------
// shop. Browse, PDP, cart, addresses, checkout, orders, feedback.
// ---------------------------------------------------------------------------

export interface ProductListFilters {
  /** Category slug from the route (`/shop/category/[sport]`). Omitted, or
   * "all", browses the whole catalog. */
  categorySlug?: string;
  sport?: Sport;
  /** FR-3's search bar. Matches product title, or the category name, case
   * insensitively. */
  query?: string;
}

/** Newest-first page size for order history. */
const ORDER_HISTORY_PAGE_SIZE = 100;

export function useShop(client: AtlitosClient) {
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
    /** v1 `products` list. PRD-07 FR-1/FR-2/FR-3. `products` is public browse
     * (`active = true` in the policy) and carries no per user rows, so there
     * is no owner filter to apply here; the explicit `.eq("active", true)`
     * mirrors the policy so PostgREST pushes it down rather than leaning on
     * RLS alone, same shape `listCourts` uses. */
    async listProducts(filters: ProductListFilters = {}): Promise<ShopProduct[]> {
      let query = client.from("products").select(PRODUCT_SELECT).eq("active", true);

      if (filters.categorySlug && filters.categorySlug !== "all") {
        query = query.eq("categories.slug", filters.categorySlug).not("categories", "is", null);
      }
      if (filters.sport) {
        query = query.eq("sport", filters.sport);
      }
      if (filters.query?.trim()) {
        const term = filters.query.trim().replace(/[%,()]/g, "");
        // Title match only at the PostgREST level; the category half of FR-3
        // is applied below against the already hydrated category name,
        // because `or()` cannot reach across an embedded resource.
        query = query.ilike("title", `%${term}%`);
      }

      const { data, error } = await query.returns<ProductQueryRow[]>();
      if (error) throw mapPostgrestError(error);

      const products = (data ?? []).map((row) => mapProductRow(client, row));

      // FR-1's "default relevance order": recommended products first by rank,
      // then the rest alphabetically, so the grid is stable between loads
      // rather than falling back to Postgres insertion order.
      return products.sort((a, b) => {
        const rankA = a.recommendedRank ?? Number.POSITIVE_INFINITY;
        const rankB = b.recommendedRank ?? Number.POSITIVE_INFINITY;
        if (rankA !== rankB) return rankA - rankB;
        return a.title.localeCompare(b.title);
      });
    },

    /** FR-3's second half. Applied client side over an already fetched page
     * because the category name lives on an embedded resource; exposed as its
     * own function so the screen does not reimplement the predicate. */
    filterBySearch(products: ShopProduct[], rawQuery: string): ShopProduct[] {
      const term = rawQuery.trim().toLowerCase();
      if (!term) return products;
      return products.filter(
        (product) =>
          product.title.toLowerCase().includes(term) ||
          (product.categoryName ?? "").toLowerCase().includes(term),
      );
    },

    /** FR-2's Recommended Gears rail. `recommended_rank` is the recommendation
     * field on the product read; products without one are not recommended. */
    async listRecommended(limit = 10): Promise<ShopProduct[]> {
      const { data, error } = await client
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("active", true)
        .not("recommended_rank", "is", null)
        .order("recommended_rank", { ascending: true })
        .limit(limit)
        .returns<ProductQueryRow[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row) => mapProductRow(client, row));
    },

    /** Category chips. Reads `shopper_categories`, never `categories` directly:
     * a category with no active product renders a chip that leads to an empty
     * grid. Found in the P4 evidence pass, where a fixture category surfaced to
     * shoppers because categories carry no `active` column of their own. */
    async listCategories(): Promise<{ id: string; name: string; slug: string }[]> {
      const { data, error } = await client
        .from("shopper_categories")
        .select("id, name, slug")
        .order("name");
      if (error) throw mapPostgrestError(error);
      // Postgres views generate every column as nullable even where the
      // underlying `categories` columns are `not null`, the same typegen
      // quirk `AvailabilityQueryRow` above absorbs. Narrow it here rather
      // than asserting it away, so a genuinely null row is dropped instead
      // of rendering a chip with an undefined slug that routes nowhere.
      return (data ?? []).flatMap((row) =>
        row.id !== null && row.name !== null && row.slug !== null
          ? [{ id: row.id, name: row.name, slug: row.slug }]
          : [],
      );
    },

    /** PDP read. PRD-07 FR-4: every variant with its own price and its own
     * AVAILABLE stock, read through the view. Returns null for a delisted or
     * missing product so the screen can route to its not found state rather
     * than throwing. */
    async getProduct(productId: string): Promise<ShopProduct | null> {
      const { data, error } = await client
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("id", productId)
        .eq("active", true)
        .maybeSingle<ProductQueryRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;
      return mapProductRow(client, data);
    },

    // -----------------------------------------------------------------------
    // affiliate marketplace (0086, WS4)
    // -----------------------------------------------------------------------

    /** Affiliate catalog list. `affiliate_products` is public browse
     * (`active = true` in the policy, no per-user rows), the same shape
     * `listProducts` uses; the `.eq("active", true)` mirrors the policy so
     * PostgREST pushes it down rather than leaning on RLS alone. Offers are
     * embedded and sorted cheapest in-stock first per product. */
    async listAffiliateProducts(filters: { sport?: Sport; query?: string } = {}): Promise<AffiliateProduct[]> {
      let query = client
        .from("affiliate_products")
        .select(AFFILIATE_SELECT)
        .eq("active", true);
      if (filters.sport) query = query.eq("sport", filters.sport);
      if (filters.query?.trim()) {
        const term = filters.query.trim().replace(/[%,()]/g, "");
        query = query.ilike("title", `%${term}%`);
      }

      const { data, error } = await query.returns<AffiliateProductQueryRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? [])
        .map(mapAffiliateProductRow)
        .sort((a, b) => (a.bestPrice ?? Number.POSITIVE_INFINITY) - (b.bestPrice ?? Number.POSITIVE_INFINITY));
    },

    /** Affiliate PDP + compare view read. Returns null for a delisted or
     * missing product so the screen routes to its not found state. The offer
     * list comes back cheapest in-stock first, which is exactly the order the
     * compare view renders and which puts the cheapest retailer at the head for
     * highlighting. */
    async getAffiliateProduct(productId: string): Promise<AffiliateProduct | null> {
      const { data, error } = await client
        .from("affiliate_products")
        .select(AFFILIATE_SELECT)
        .eq("id", productId)
        .eq("active", true)
        .maybeSingle<AffiliateProductQueryRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;
      return mapAffiliateProductRow(data);
    },

    // -----------------------------------------------------------------------
    // cart
    // -----------------------------------------------------------------------

    /** PRD-07 FR-8 and FR-11. Persisted `cart_items`, read with an explicit
     * owner filter (rule 2), joined to the availability view so the unit
     * price and the stock ceiling are both live at read time rather than
     * whatever the client cached when the line was added. */
    async getCart(): Promise<CartLine[]> {
      const userId = await requireUserId(client);

      interface CartQueryRow {
        id: string;
        qty: number;
        product_variant_id: string;
        product_variant_availability: AvailabilityQueryRow | null;
        product_variants: {
          id: string;
          products: {
            id: string;
            title: string;
            product_media: { storage_path: string; position: number; is_primary: boolean }[] | null;
          } | null;
        } | null;
      }

      const { data, error } = await client
        .from("cart_items")
        .select(
          `id, qty, product_variant_id,
           product_variant_availability ( product_variant_id, product_id, sku, size, color, effective_price, available_stock ),
           product_variants ( id, products ( id, title, product_media ( storage_path, position, is_primary ) ) )`,
        )
        // Explicit owner filter. `cart_items` is owner scoped, but it is read
        // here inside a join with three publicly browsable tables, which is
        // exactly the configuration CLAUDE.md warns about.
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .returns<CartQueryRow[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row) => {
        const availability = row.product_variant_availability;
        const product = row.product_variants?.products ?? null;
        const unitPrice = availability?.effective_price ?? 0;
        const availableStock = availability?.available_stock ?? 0;
        const images = resolveMediaUrls(client, product?.product_media ?? null);

        return {
          cartItemId: row.id,
          variantId: row.product_variant_id,
          productId: product?.id ?? availability?.product_id ?? "",
          title: product?.title ?? "",
          variantLabel: variantLabel({
            size: availability?.size ?? null,
            color: availability?.color ?? null,
            sku: availability?.sku ?? "",
          }),
          imageUrl: images[0],
          unitPrice,
          qty: row.qty,
          availableStock,
          exceedsStock: row.qty > availableStock,
          lineTotal: unitPrice * row.qty,
        };
      });
    },

    /** PRD-07 FR-9 via `add_to_cart` (0034). Additive. The RPC revalidates
     * available stock server side and CAPS the line rather than raising, so
     * the notice and the capped line both persist; it raises OUT_OF_STOCK
     * only when there is nothing to cap to. The direct upsert path is closed
     * by both policy and grant, so this RPC is the only way in. */
    async addToCart(variantId: string, qty = 1): Promise<CartMutationOutcome> {
      const { data, error } = await client.rpc("add_to_cart", {
        p_variant_id: variantId,
        p_qty: qty,
      });
      if (error) throw mapPostgrestError(error);
      return mapCartMutation(data);
    },

    /** PRD-07 FR-9 via `update_cart_item` (0034). Absolute set, same capping
     * rule. Refuses qty <= 0; removal is `removeCartItem` below. */
    async updateCartItem(variantId: string, qty: number): Promise<CartMutationOutcome> {
      const { data, error } = await client.rpc("update_cart_item", {
        p_variant_id: variantId,
        p_qty: qty,
      });
      if (error) throw mapPostgrestError(error);
      return mapCartMutation(data);
    },

    /** PRD-07 FR-10. A plain own row delete, carrying its owner filter
     * explicitly (rule 2) even though the delete policy already scopes it. */
    async removeCartItem(cartItemId: string): Promise<void> {
      const userId = await requireUserId(client);
      const { error } = await client.from("cart_items").delete().eq("id", cartItemId).eq("user_id", userId);
      if (error) throw mapPostgrestError(error);
    },

    // -----------------------------------------------------------------------
    // addresses
    // -----------------------------------------------------------------------

    /** PRD-07 FR-30 / FR-14. Explicit owner filter (rule 2), default first. */
    async listAddresses(): Promise<AddressRecord[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("addresses")
        .select("id, line1, line2, city, state, pincode, is_default")
        .eq("user_id", userId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row) => ({
        id: row.id,
        line1: row.line1,
        line2: row.line2,
        city: row.city,
        state: row.state,
        pincode: row.pincode,
        isDefault: row.is_default,
      }));
    },

    async createAddress(input: AddressInput): Promise<AddressRecord> {
      const userId = await requireUserId(client);
      if (input.isDefault) await clearDefaultAddress(client, userId);

      const { data, error } = await client
        .from("addresses")
        .insert({
          user_id: userId,
          line1: input.line1,
          line2: input.line2 ?? null,
          city: input.city,
          state: input.state,
          pincode: input.pincode,
          is_default: input.isDefault ?? false,
        })
        .select("id, line1, line2, city, state, pincode, is_default")
        .single();
      if (error) throw mapAddressWriteError(error);

      return {
        id: data.id,
        line1: data.line1,
        line2: data.line2,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
        isDefault: data.is_default,
      };
    },

    async updateAddress(addressId: string, input: AddressInput): Promise<void> {
      const userId = await requireUserId(client);
      if (input.isDefault) await clearDefaultAddress(client, userId);

      const { error } = await client
        .from("addresses")
        .update({
          line1: input.line1,
          line2: input.line2 ?? null,
          city: input.city,
          state: input.state,
          pincode: input.pincode,
          is_default: input.isDefault ?? false,
        })
        .eq("id", addressId)
        .eq("user_id", userId);
      if (error) throw mapAddressWriteError(error);
    },

    async setDefaultAddress(addressId: string): Promise<void> {
      const userId = await requireUserId(client);
      await clearDefaultAddress(client, userId);
      const { error } = await client
        .from("addresses")
        .update({ is_default: true })
        .eq("id", addressId)
        .eq("user_id", userId);
      if (error) throw mapPostgrestError(error);
    },

    /** PRD-07 FR-30 / AC-F3. The 0036 trigger raises `ADDRESS_IN_USE` when an
     * in flight order still references this address, and
     * `ADDRESS_ON_PAST_ORDER` when only delivered or cancelled orders do. Both
     * are prefixed RAISEs, so the shared mapper turns them into real codes and
     * the screen renders an inline explanation rather than a Postgres string. */
    async deleteAddress(addressId: string): Promise<void> {
      const userId = await requireUserId(client);
      const { error } = await client.from("addresses").delete().eq("id", addressId).eq("user_id", userId);
      if (error) throw mapPostgrestError(error);
    },

    // -----------------------------------------------------------------------
    // fee config + checkout
    // -----------------------------------------------------------------------

    /** Reads the three commerce `fee_config` keys the checkout preview needs.
     * Missing keys resolve to zero (and the roundup multiple to 10, the
     * founder's decided target) rather than throwing, so a catalog that is
     * seeded before its fee rows still renders a bill; the server's own
     * re-derivation is what actually decides the charge either way. */
    async getCommerceFeeConfig(): Promise<CommerceFeeConfig> {
      const { data, error } = await client
        .from("fee_config")
        .select("key, value")
        .eq("domain", "commerce");
      if (error) throw mapPostgrestError(error);

      // Keys are stored bare within their domain (`delivery_flat`, not
      // `commerce.delivery_flat`), matching how the `checkout` edge function
      // reads them via `getActiveFeeConfig(supabase, "commerce", key)`. The
      // dotted spelling is accepted as a fallback only because SCHEMA.md and
      // PHASE-4-STATUS.md both refer to these keys by their dotted names.
      const byKey = new Map((data ?? []).map((row) => [row.key, row.value]));
      const read = (key: string, fallback: number) =>
        byKey.get(key) ?? byKey.get(`commerce.${key}`) ?? fallback;

      return {
        deliveryFlat: read("delivery_flat", 0),
        gstRate: read("gst_percent", 0),
        donationRoundupMultiple: read("donation_roundup_multiple", 10),
      };
    },

    /** PRD-07 FR-17. Calls the `checkout` edge function (AT-71, Track B) with
     * the full client computed bill. The client never writes the order row;
     * `checkout` re-prices every line, reserves stock, and only then creates
     * the Razorpay order. FR-19's `PRICE_MISMATCH` and FR-20's `OUT_OF_STOCK`
     * both come back as mapped `ApiError`s with no charge having occurred.
     *
     * Contract, per PHASE-4-STATUS.md and the shape `book-court` established.
     * Track B owns the function; this is coded against the contract rather
     * than waiting on it, and the response reader tolerates the bill being
     * absent so a partially shipped function surfaces a real error instead of
     * a crash. */
    async checkout(input: CheckoutInput): Promise<CheckoutResult> {
      const { data, error } = await client.functions.invoke("checkout", {
        body: {
          items: input.items.map((item) => ({
            product_variant_id: item.productVariantId,
            qty: item.qty,
          })),
          address_id: input.addressId,
          // The shipped `checkout` function reads `donation_roundup` as a
          // BOOLEAN opt in and derives the amount itself, per the founder's
          // decision that the roundup is derived rather than client supplied.
          // Sending the amount here instead would be read as "opted in" only
          // when non zero, which silently loses the opt in on exactly the
          // zero roundup edge case. The amount is omitted deliberately: the
          // server compares subtotal, delivery, GST and total, and a
          // disagreeing roundup necessarily shows up in the total.
          donation_roundup: input.donationRoundupOptedIn,
          subtotal: input.bill.subtotal,
          delivery_charges: input.bill.deliveryCharges,
          gst_and_others: input.bill.gstAndOthers,
          total: input.bill.total,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        payment_intent_id: string;
        razorpay_order_id: string;
        key_id: string;
        amount: number;
        currency: string;
        bill?: {
          subtotal: number;
          delivery_charges: number;
          gst_and_others: number;
          donation_roundup: number;
          total: number;
        };
      };

      return {
        paymentIntentId: body.payment_intent_id,
        razorpayOrderId: body.razorpay_order_id,
        keyId: body.key_id,
        amountPaise: body.amount,
        currency: body.currency,
        bill: body.bill
          ? {
              subtotal: body.bill.subtotal,
              deliveryCharges: body.bill.delivery_charges,
              gstAndOthers: body.bill.gst_and_others,
              donationRoundup: body.bill.donation_roundup,
              total: body.bill.total,
            }
          : input.bill,
      };
    },

    /** The commerce branch of the existing shared `verify-payment` gate, the
     * client callback fallback to `razorpay-webhook` (PAYMENTS.md). The order
     * row is created by the finalize handler under service role, so the order
     * id only exists in this response, never before it (PRD-07 FR-21, FR-23). */
    async verifyOrderPayment(input: VerifyOrderPaymentInput): Promise<VerifyOrderPaymentResult> {
      const { data, error } = await client.functions.invoke("verify-payment", {
        body: {
          razorpay_order_id: input.razorpayOrderId,
          razorpay_payment_id: input.razorpayPaymentId,
          razorpay_signature: input.razorpaySignature,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        order_id?: string;
        entity_id?: string;
        order_number?: string;
        status?: OrderStatus;
        outcome: "captured" | "already_processed";
      };

      return {
        orderId: body.order_id ?? body.entity_id ?? "",
        orderNumber: body.order_number ?? null,
        status: body.status ?? "placed",
        outcome: body.outcome,
      };
    },

    // -----------------------------------------------------------------------
    // orders
    // -----------------------------------------------------------------------

    /** PRD-07 FR-27. Every lifecycle state, newest first, explicit owner
     * filter (rule 2). */
    async listMyOrders(): Promise<OrderListItem[]> {
      const userId = await requireUserId(client);

      interface OrderListQueryRow {
        id: string;
        order_number: string;
        status: OrderStatus;
        total: number;
        created_at: string;
        order_items: { qty: number }[] | null;
      }

      const { data, error } = await client
        .from("orders")
        .select("id, order_number, status, total, created_at, order_items ( qty )")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        // SCALING: bounded. Orders accumulate for the life of the account and
        // this list had no ceiling, so it got slower every purchase.
        .limit(ORDER_HISTORY_PAGE_SIZE)
        .returns<OrderListQueryRow[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        status: row.status,
        total: row.total,
        createdAt: row.created_at,
        itemCount: (row.order_items ?? []).reduce((sum, item) => sum + item.qty, 0),
      }));
    },

    /** PRD-07 FR-24 and FR-25. The bill recap reads the `orders` row's stored
     * money columns; the item lines read the snapshot columns. Neither is
     * recomputed against current prices. */
    async getOrder(orderId: string): Promise<OrderDetail | null> {
      const userId = await requireUserId(client);

      interface OrderDetailQueryRow {
        id: string;
        order_number: string;
        status: OrderStatus;
        created_at: string;
        subtotal: number;
        delivery_charges: number;
        gst_and_others: number;
        donation_roundup: number;
        total: number;
        ship_to_line1: string;
        ship_to_line2: string | null;
        ship_to_city: string;
        ship_to_state: string;
        ship_to_pincode: string;
        order_items: {
          id: string;
          product_title_snapshot: string;
          variant_label_snapshot: string;
          qty: number;
          unit_price: number;
        }[] | null;
        order_timeline: {
          id: string;
          status: OrderStatus;
          note: string | null;
          location: string | null;
          created_at: string;
        }[] | null;
        // A to-one embed: order_feedback has UNIQUE(order_id), so PostgREST
        // returns a single object or null here, NOT an array. Reading it as an
        // array (the old shape) made every rated order read its feedback as
        // null, so the rating form reappeared on a delivered, already-rated
        // order and the read-only confirmation never rendered. Found in the P4
        // evidence pass (order #ATL00009, feedback row bfc6fa72).
        order_feedback: { id: string; rating: number; remarks: string | null; created_at: string } | null;
      }

      const { data, error } = await client
        .from("orders")
        .select(
          `id, order_number, status, created_at, subtotal, delivery_charges, gst_and_others, donation_roundup, total,
           ship_to_line1, ship_to_line2, ship_to_city, ship_to_state, ship_to_pincode,
           order_items ( id, product_title_snapshot, variant_label_snapshot, qty, unit_price ),
           order_timeline ( id, status, note, location, created_at ),
           order_feedback ( id, rating, remarks, created_at )`,
        )
        .eq("id", orderId)
        .eq("user_id", userId)
        .maybeSingle<OrderDetailQueryRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;

      // Tolerate both shapes defensively (a PostgREST version that returned an
      // array would otherwise silently reintroduce the null-feedback bug), but
      // the schema guarantees to-one.
      const feedbackRow = Array.isArray(data.order_feedback)
        ? (data.order_feedback[0] ?? null)
        : (data.order_feedback ?? null);

      return {
        id: data.id,
        orderNumber: data.order_number,
        status: data.status,
        createdAt: data.created_at,
        bill: {
          subtotal: data.subtotal,
          deliveryCharges: data.delivery_charges,
          gstAndOthers: data.gst_and_others,
          donationRoundup: data.donation_roundup,
          total: data.total,
        },
        shipTo: {
          line1: data.ship_to_line1,
          line2: data.ship_to_line2,
          city: data.ship_to_city,
          state: data.ship_to_state,
          pincode: data.ship_to_pincode,
        },
        items: (data.order_items ?? []).map((item) => ({
          id: item.id,
          title: item.product_title_snapshot,
          variantLabel: item.variant_label_snapshot,
          qty: item.qty,
          unitPrice: item.unit_price,
        })),
        timeline: [...(data.order_timeline ?? [])]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((entry) => ({
            id: entry.id,
            status: entry.status,
            note: entry.note,
            location: entry.location,
            createdAt: entry.created_at,
          })),
        feedback: feedbackRow
          ? {
              id: feedbackRow.id,
              rating: feedbackRow.rating,
              remarks: feedbackRow.remarks,
              createdAt: feedbackRow.created_at,
            }
          : null,
      };
    },

    /** AT-148 (AT-88, PRD-04 FR-24). READ any refund issued against a
     * commerce order so its detail screen can surface the amount and status
     * to the shopper who is owed it. Commerce refunds carry
     * `entity_id = order id` (PAYMENTS.md), except the late-capture branch that
     * points at a payment_intent because no order exists, which by definition
     * has no order detail screen to show. Pure read against `refunds` (the
     * payer may select their own row); no money is written here. */
    async getOrderRefund(orderId: string): Promise<RefundSummary | null> {
      return readRefundSummary(client, "commerce", orderId);
    },

    /** PRD-07 FR-26. Both halves are enforced in the database, not here:
     * 0032's insert policy requires the order to be `delivered`, and
     * `UNIQUE(order_id)` makes it a one time action. A second submit comes
     * back as a 23505 the shared mapper turns into VALIDATION, and the screen
     * has already switched to its read only view by then. Feedback is not a
     * money row or a status field, so this is a permitted client insert. */
    async submitOrderFeedback(orderId: string, rating: number, remarks?: string): Promise<OrderFeedbackRecord> {
      const { data, error } = await client
        .from("order_feedback")
        .insert({ order_id: orderId, rating, remarks: remarks?.trim() || null })
        .select("id, rating, remarks, created_at")
        .single();
      if (error) throw mapPostgrestError(error);

      return { id: data.id, rating: data.rating, remarks: data.remarks, createdAt: data.created_at };
    },
  }), [client]);
}

export type UseShopResult = ReturnType<typeof useShop>;

async function clearDefaultAddress(client: AtlitosClient, userId: string): Promise<void> {
  const { error } = await client
    .from("addresses")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("is_default", true);
  if (error) throw mapPostgrestError(error);
}

function mapCartMutation(data: unknown): CartMutationOutcome {
  const row = data as {
    cart_item_id: string | null;
    product_variant_id: string | null;
    qty: number | null;
    requested_qty: number | null;
    available_stock: number | null;
    capped: boolean | null;
  };

  return {
    cartItemId: row.cart_item_id ?? "",
    variantId: row.product_variant_id ?? "",
    qty: row.qty ?? 0,
    requestedQty: row.requested_qty ?? 0,
    availableStock: row.available_stock ?? 0,
    capped: row.capped ?? false,
  };
}

// ---------------------------------------------------------------------------
// wishlist (gear). RPC toggle + PostgREST list. See API-MAPPING.md
// "wishlist (gear)".
// ---------------------------------------------------------------------------

export interface WishlistEntry {
  productId: string;
  product: ShopProduct;
  savedAt: string;
}

export function useWishlist(client: AtlitosClient) {
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
    /** PRD-07 FR-28. Live price and available stock at display time, read
     * through the same product mapper the browse grid uses, so a wishlisted
     * item can never show a price the PDP disagrees with. Explicit owner
     * filter on `product_wishlist_items` (rule 2): the joined `products` is
     * public browse and will happily return everyone's rows to an unscoped
     * select. */
    async listWishlist(): Promise<WishlistEntry[]> {
      const userId = await requireUserId(client);

      interface WishlistQueryRow {
        product_id: string;
        created_at: string;
        products: ProductQueryRow | null;
      }

      const { data, error } = await client
        .from("product_wishlist_items")
        .select(`product_id, created_at, products ( ${PRODUCT_SELECT} )`)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .returns<WishlistQueryRow[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? [])
        .filter((row): row is WishlistQueryRow & { products: ProductQueryRow } => row.products !== null)
        .map((row) => ({
          productId: row.product_id,
          product: mapProductRow(client, row.products),
          savedAt: row.created_at,
        }));
    },

    /** PRD-07 FR-6. `toggle_product_wishlist` (0034) is an atomic
     * insert-or-delete in one CTE statement, which is why this is an RPC and
     * not a client read-then-write: the latter races with itself on a double
     * tap. Returns true when the product is now wishlisted. */
    async toggle(productId: string): Promise<boolean> {
      const { data, error } = await client.rpc("toggle_product_wishlist", { p_product_id: productId });
      if (error) throw mapPostgrestError(error);
      return Boolean(data);
    },

    /** The set of product ids this shopper has saved, for the PDP and grid
     * hearts. Explicit owner filter (rule 2). */
    async listWishlistedProductIds(): Promise<string[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("product_wishlist_items")
        .select("product_id")
        .eq("user_id", userId);
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map((row) => row.product_id);
    },
  }), [client]);
}

export type UseWishlistResult = ReturnType<typeof useWishlist>;

/** Narrow an unknown thrown value to `ApiError` at a screen's catch site.
 * Every function in this file throws the mapped shape, but a Razorpay sheet
 * dismissal throws a plain `Error`, and the checkout screen has to tell the
 * two apart without casting the second into a lie (the same normalization
 * `courts/book/pay.tsx` does inline). */
export function isApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && "code" in error && "status" in error;
}

export function toApiError(error: unknown, fallbackCode: ApiErrorCode = "INTERNAL"): ApiError {
  if (isApiError(error)) return error;
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
    status: 500,
  };
}
