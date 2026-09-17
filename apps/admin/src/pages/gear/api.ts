import type { Db, Sport } from "@atlitos/types";

import { parseRpcError, type CommerceError } from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 admin, PRD-07 section 10 (affiliate model). The one place apps/admin
// talks to the affiliate gear catalog (0086: affiliate_products + product_offers).
// Same posture as pages/drills/api.ts: EVERY mutation routes through a 0120
// admin RPC, never a table write. The tables carry no client write grant at
// all, so a direct insert from the browser is refused by the database, not
// merely discouraged here.
//
//   * admin_upsert_affiliate_product(p_id, ...)  create (p_id null) or edit
//   * admin_set_affiliate_product_active(p_id, p_active)  list or delist
//   * admin_upsert_product_offer(product, retailer, price, url, ...)  one
//     retailer line; (product, retailer) is unique so re-entering a retailer
//     updates its price in place
//   * admin_delete_product_offer(p_id)  remove a wrong retailer line
//
// Reads: 0120 adds an admin SELECT policy on both tables so this list is the
// one surface that sees delisted products (the shopper surface keeps its
// active = true filter). Every narrowing is applied as its own explicit
// filter, per the permissive-OR rule in CLAUDE.md.

export type { CommerceError };

export type AffiliateProductRow = Db.AffiliateProductRow;
export type ProductOfferRow = Db.ProductOfferRow;

export interface GearInput {
  id?: string | null;
  title: string;
  brand: string | null;
  sport: Sport | null;
  categoryId: string | null;
  skillLevel: string | null;
  ageRange: string | null;
  description: string | null;
  imageUrl: string | null;
}

export interface OfferInput {
  retailer: string;
  price: number;
  affiliateUrl: string;
  inStock: boolean;
}

export interface GearListFilters {
  sport?: Sport;
  active?: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
}

/** A product with its offers folded in for the list and show screens. */
export interface GearWithOffers extends AffiliateProductRow {
  offers: ProductOfferRow[];
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseClient.rpc(fn, args);
  if (error) throw parseRpcError(error.message);
  return data as T;
}

export const gearApi = {
  upsertProduct: (input: GearInput) =>
    callRpc<AffiliateProductRow>("admin_upsert_affiliate_product", {
      p_id: input.id ?? null,
      p_title: input.title,
      p_brand: input.brand,
      p_sport: input.sport,
      p_category_id: input.categoryId,
      p_skill_level: input.skillLevel,
      p_age_range: input.ageRange,
      p_description: input.description,
      p_image_url: input.imageUrl,
    }),

  setProductActive: (id: string, active: boolean) =>
    callRpc<AffiliateProductRow>("admin_set_affiliate_product_active", { p_id: id, p_active: active }),

  upsertOffer: (productId: string, offer: OfferInput) =>
    callRpc<ProductOfferRow>("admin_upsert_product_offer", {
      p_affiliate_product_id: productId,
      p_retailer: offer.retailer,
      p_price: offer.price,
      p_affiliate_url: offer.affiliateUrl,
      p_in_stock: offer.inStock,
      p_currency: "INR",
    }),

  deleteOffer: (offerId: string) => callRpc<void>("admin_delete_product_offer", { p_id: offerId }),
};

const PRODUCT_SELECT =
  "id,title,brand,sport,category_id,skill_level,age_range,description,image_url,active,created_at,updated_at";
const OFFER_SELECT =
  "id,affiliate_product_id,retailer,price,currency,affiliate_url,in_stock,last_checked_at,created_at,updated_at";

export async function fetchGear(filters: GearListFilters = {}): Promise<GearWithOffers[]> {
  let query = supabaseClient.from("affiliate_products").select(PRODUCT_SELECT).order("created_at", { ascending: false });
  if (filters.sport) query = query.eq("sport", filters.sport);
  if (filters.active !== undefined) query = query.eq("active", filters.active);
  const { data, error } = await query;
  if (error) throw parseRpcError(error.message);
  const products = (data as AffiliateProductRow[]) ?? [];
  if (products.length === 0) return [];

  const { data: offers, error: offersError } = await supabaseClient
    .from("product_offers")
    .select(OFFER_SELECT)
    .in(
      "affiliate_product_id",
      products.map((p) => p.id),
    )
    .order("price", { ascending: true });
  if (offersError) throw parseRpcError(offersError.message);
  const byProduct = new Map<string, ProductOfferRow[]>();
  for (const offer of (offers as ProductOfferRow[]) ?? []) {
    const list = byProduct.get(offer.affiliate_product_id) ?? [];
    list.push(offer);
    byProduct.set(offer.affiliate_product_id, list);
  }
  return products.map((p) => ({ ...p, offers: byProduct.get(p.id) ?? [] }));
}

export async function fetchGearItem(id: string): Promise<GearWithOffers | null> {
  const { data, error } = await supabaseClient
    .from("affiliate_products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw parseRpcError(error.message);
  if (!data) return null;
  const { data: offers, error: offersError } = await supabaseClient
    .from("product_offers")
    .select(OFFER_SELECT)
    .eq("affiliate_product_id", id)
    .order("price", { ascending: true });
  if (offersError) throw parseRpcError(offersError.message);
  return { ...(data as AffiliateProductRow), offers: (offers as ProductOfferRow[]) ?? [] };
}

export async function fetchCategories(): Promise<CategoryOption[]> {
  const { data, error } = await supabaseClient.from("categories").select("id,name").order("name");
  if (error) throw parseRpcError(error.message);
  return (data as CategoryOption[]) ?? [];
}
