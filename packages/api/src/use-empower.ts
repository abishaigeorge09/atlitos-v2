import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiError, Sport } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapEdgeFunctionError, mapPostgrestError } from "./errors";

/**
 * `@atlitos/api`'s Empower lane (AT-123, P6 Track D), per
 * docs/architecture/API-MAPPING.md "empower" and docs/prd/PRD-06-sponsor.md.
 * Its own file rather than filling `hooks.ts`'s `useEmpower` placeholder in
 * place, matching how `use-shop.ts` split the shopper commerce lane out of
 * `hooks.ts` (the placeholder there is removed, not left beside this, or the
 * two same-named exports would collide at the package root).
 *
 * Three rules run through every function here and none is optional.
 *
 * 1. **Ledger derived money, never a client sum and never funded_amount.** Every
 *    displayed fund total (the hub banner, a UPA's total raised, My Impact
 *    totals) comes from the deployed SECURITY DEFINER read RPCs
 *    (`get_empower_stats`, `public_upa_profile`, `upa_fund_balance`,
 *    `get_my_impact_summary`), which read `ledger_entries`. Nothing here sums
 *    `donations` client side, and `upa_wishlist_items.funded_amount` is only
 *    ever read as per item progress (a bar on a card), never as a money total
 *    (PHASE-6-STATUS.md trap 5, PRD-06 FR-3/FR-4).
 *
 * 2. **Verified only, filtered in app code.** `upa_applications` carries a
 *    permissive-OR public policy (verified rows are public, an owner reads
 *    their own in any status). RLS is not scoping, so the hub list carries its
 *    own explicit `.eq("status", "verified")` regardless (CLAUDE.md, PRD-06
 *    FR-1). A single UPA read goes through `public_upa_profile`, which returns
 *    null for any non verified id, so an unverified id is unresolvable however
 *    it was obtained (AT-128).
 *
 * 3. **Clients never write money or empower rows.** A donation moves only
 *    through the `donate` edge function and is captured by the shared
 *    `verify-payment` gate (the 4th finalize branch, entity_id = the donation
 *    id). This file never inserts `donations`/`payment_intents`/`ledger_entries`
 *    and never writes `funded_amount`/`status` (PRD-06 FR-8, FR-18).
 */

// ---------------------------------------------------------------------------
// General Fund anchor. The reserved sentinel account_ref the roundup pool
// lives at (PHASE-6-STATUS.md "The general fund account"). A ledger anchor,
// not a UPA row; exported so a screen can label a roundup donation without
// re-deriving it. The balance itself is always read via general_fund_balance().
// ---------------------------------------------------------------------------
export const GENERAL_FUND_ACCOUNT_REF = "00000000-0000-4000-a000-0000000f0000";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface EmpowerStats {
  /** Every upa_fund credit minus debit across all account_refs (specific UPAs
   * plus the General Fund), ledger derived. */
  totalRaised: number;
  /** The General Fund pool alone (checkout roundups). */
  generalFund: number;
  /** Verified UPAs whose own fund balance is positive. */
  athletesSupported: number;
  /** Wishlist items that reached funded or delivered. */
  itemsFunded: number;
}

export interface HubUpa {
  id: string;
  name: string;
  headline: string;
  sport: Sport;
  region: string;
  state: string;
  photoUrl?: string;
  /** Ledger derived total raised for this UPA (upa_fund_balance). */
  raised: number;
  /** The wishlist goal, the sum of item costs. A target, not a ledger total,
   * so summing the costs here is legitimate (unlike funded_amount). */
  goal: number;
}

export interface UpaWishlistItem {
  id: string;
  title: string;
  cost: number;
  /** Per item funding progress (the legitimate use of funded_amount). Drives
   * the item's progress bar and its funded state, never a fund money total. */
  fundedAmount: number;
  status: "open" | "funded" | "delivered";
}

export interface UpaProfile {
  id: string;
  headline: string;
  body: string;
  sport: Sport;
  region: string;
  state: string;
  photoUrl?: string;
  /** Ledger derived (upa_fund_balance), never a sum of funded_amount. */
  totalRaised: number;
  items: UpaWishlistItem[];
}

export interface DonateInput {
  upaId: string;
  itemId?: string;
  amount: number;
  /** The client's displayed total, echoed so the server can reject a drifted
   * price with PRICE_MISMATCH rather than silently charging a stale figure. */
  expectedTotal?: number;
}

export interface DonateResult {
  paymentIntentId: string;
  razorpayOrderId: string;
  keyId: string;
  amountPaise: number;
  /** The server's own re-priced amount in rupees, what the review re-renders
   * through the shared BillSummary either way (a corrected figure can never be
   * hidden). Derived from `amountPaise` when the server omits an explicit bill. */
  amountRupees: number;
}

export interface VerifyDonationPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifyDonationPaymentResult {
  donationId: string;
  outcome: "captured" | "already_processed";
}

export interface ImpactDonation {
  id: string;
  amount: number;
  method: "standalone" | "checkout_roundup";
  /** Null for a General Fund (roundup) donation. */
  upaId: string | null;
  /** The UPA story headline, or "General Fund" for a roundup (the RPC resolves
   * this so the client never labels it). */
  upaName: string;
  itemId: string | null;
  itemTitle: string | null;
  createdAt: string;
}

/** A gratitude post received on an item this donor funded (PRD-06 FR-14).
 * Queried separately from `get_my_impact_summary`, which does not carry it
 * (Track B flagged the gap); see `getMyImpact` below. */
export interface ImpactGratitude {
  id: string;
  body: string;
  photoUrl?: string;
  itemTitle: string | null;
  upaName: string | null;
  createdAt: string;
}

export interface MyImpact {
  totalGiven: number;
  athletesSupported: number;
  itemsFunded: number;
  donations: ImpactDonation[];
  gratitude: ImpactGratitude[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UPA_PHOTOS_BUCKET = "upa-photos";
const GRATITUDE_PHOTOS_BUCKET = "gratitude-photos";

/** `photo_url` may be a full URL (fixtures) or a storage path in the public
 * `upa-photos` bucket. Pass a full URL through untouched, resolve a bare path. */
function resolvePhoto(client: AtlitosClient, bucket: string, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//.test(value)) return value;
  return client.storage.from(bucket).getPublicUrl(value).data.publicUrl;
}

interface HubUpaQueryRow {
  id: string;
  story_headline: string;
  sport: Sport;
  region: string;
  state: string;
  photo_url: string | null;
  upa_wishlist_items: { cost: number }[] | null;
}

interface ProfileJson {
  id: string;
  story_headline: string;
  story_body: string;
  sport: Sport;
  region: string;
  state: string;
  photo_url: string | null;
  total_raised: number;
  items: { id: string; title: string; cost: number; funded_amount: number; status: UpaWishlistItem["status"] }[];
}

interface ImpactJson {
  total_given: number;
  athletes_supported: number;
  items_funded: number;
  donations: {
    id: string;
    amount: number;
    method: ImpactDonation["method"];
    upa_id: string | null;
    upa_name: string | null;
    item_id: string | null;
    item_title: string | null;
    created_at: string;
  }[];
}

// ---------------------------------------------------------------------------
// empower. Hub, profile, donate, My Impact.
// ---------------------------------------------------------------------------

export function useEmpower(client: AtlitosClient) {
  // Widen the schema generic so `from`/`rpc` accept the empower relations and
  // read RPCs: they land in Track A/B's migrations (0048-0056), not yet in the
  // generated `Database` type on this branch (the same escape hatch `useClutch`
  // documents in hooks.ts). Every result is re-narrowed through the interfaces
  // above; edge-function invokes stay on the typed client.
  const db = client as unknown as SupabaseClient;

  return {
    /** PRD-06 FR-3. The hub aggregate banner, platform wide and all time,
     * computed live from the ledger by `get_empower_stats` (never a cached
     * counter). Guest visible. */
    async getStats(): Promise<EmpowerStats> {
      const { data, error } = await db.rpc("get_empower_stats");
      if (error) throw mapPostgrestError(error);
      const json = (data ?? {}) as {
        total_raised?: number;
        general_fund?: number;
        athletes_supported?: number;
        items_funded?: number;
      };
      return {
        totalRaised: json.total_raised ?? 0,
        generalFund: json.general_fund ?? 0,
        athletesSupported: json.athletes_supported ?? 0,
        itemsFunded: json.items_funded ?? 0,
      };
    },

    /** PRD-06 FR-1/FR-2. The verified UPA grid. The `.eq("status","verified")`
     * is explicit (rule 2): the policy is permissive-OR, so an unfiltered read
     * by a signed-in UPA owner would surface their own non verified row into a
     * public browse. Each card's `raised` is ledger derived via
     * `upa_fund_balance` (never a sum of funded_amount, rule 1); the goal is the
     * sum of item costs (a target, not a ledger total). The whole verified set
     * is returned so a screen can filter the grid client side without moving the
     * stat banner (FR-2: filters affect the grid, not the stats). */
    async listUpas(): Promise<HubUpa[]> {
      const { data, error } = await db
        .from("upa_applications")
        .select("id, story_headline, sport, region, state, photo_url, upa_wishlist_items ( cost )")
        .eq("status", "verified")
        .order("created_at", { ascending: false })
        .returns<HubUpaQueryRow[]>();
      if (error) throw mapPostgrestError(error);

      const rows = data ?? [];
      const balances = await Promise.all(
        rows.map(async (row) => {
          const { data: bal, error: balError } = await db.rpc("upa_fund_balance", { p_account_ref: row.id });
          if (balError) throw mapPostgrestError(balError);
          return (bal as number | null) ?? 0;
        }),
      );

      return rows.map((row, index) => ({
        id: row.id,
        name: row.story_headline,
        headline: row.story_headline,
        sport: row.sport,
        region: row.region,
        state: row.state,
        photoUrl: resolvePhoto(client, UPA_PHOTOS_BUCKET, row.photo_url),
        raised: balances[index] ?? 0,
        goal: (row.upa_wishlist_items ?? []).reduce((sum, item) => sum + item.cost, 0),
      }));
    },

    /** PRD-06 FR-4/FR-16. A single public profile via `public_upa_profile`,
     * which returns null for any non verified id, so an unverified or
     * deactivated UPA is unresolvable by direct id. `totalRaised` is ledger
     * derived by the RPC; each item carries its funded_amount progress (the
     * legitimate per item use of that column). */
    async getUpaProfile(upaId: string): Promise<UpaProfile | null> {
      const { data, error } = await db.rpc("public_upa_profile", { p_upa_id: upaId });
      if (error) throw mapPostgrestError(error);
      if (!data) return null;
      const json = data as ProfileJson;
      return {
        id: json.id,
        headline: json.story_headline,
        body: json.story_body,
        sport: json.sport,
        region: json.region,
        state: json.state,
        photoUrl: resolvePhoto(client, UPA_PHOTOS_BUCKET, json.photo_url),
        totalRaised: json.total_raised,
        items: (json.items ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          cost: item.cost,
          fundedAmount: item.funded_amount,
          status: item.status,
        })),
      };
    },

    /** PRD-06 FR-7/FR-8/FR-15/FR-16. Calls the `donate` edge function with the
     * donor's JWT. The function re-validates the UPA is still verified and the
     * item not already funded at request time (independent of client cache),
     * enforces `MIN_AMOUNT`, re-prices, and creates the Razorpay order; it
     * writes ONLY the intent + staging row, never a `donations`/ledger row (the
     * capture handler does that). `NOT_FOUND`/`ITEM_FUNDED`/`MIN_AMOUNT`/
     * `PRICE_MISMATCH` come back as mapped `ApiError`s with no charge. */
    async donate(input: DonateInput): Promise<DonateResult> {
      const { data, error } = await client.functions.invoke("donate", {
        body: {
          upa_id: input.upaId,
          item_id: input.itemId,
          amount: input.amount,
          expected_total: input.expectedTotal,
          method: "standalone",
        },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        payment_intent_id: string;
        razorpay_order_id: string;
        key_id: string;
        amount: number;
        bill?: { donation?: number; total?: number };
      };

      return {
        paymentIntentId: body.payment_intent_id,
        razorpayOrderId: body.razorpay_order_id,
        keyId: body.key_id,
        amountPaise: body.amount,
        amountRupees: body.bill?.total ?? body.bill?.donation ?? body.amount / 100,
      };
    },

    /** The donation branch of the shared `verify-payment` gate, the client
     * callback fallback to `razorpay-webhook` (PAYMENTS.md). The `donations`
     * row is created by the finalize handler under service role, so the
     * donation id only exists in this response (`entity_id`), never before it. */
    async verifyDonationPayment(input: VerifyDonationPaymentInput): Promise<VerifyDonationPaymentResult> {
      const { data, error } = await client.functions.invoke("verify-payment", {
        body: {
          razorpay_order_id: input.razorpayOrderId,
          razorpay_payment_id: input.razorpayPaymentId,
          razorpay_signature: input.razorpaySignature,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as { entity_id?: string; donation_id?: string; outcome: "captured" | "already_processed" };
      return { donationId: body.donation_id ?? body.entity_id ?? "", outcome: body.outcome };
    },

    /** PRD-06 FR-12/FR-13/FR-14. My Impact, read exclusively from the ledger and
     * empower tables scoped to `auth.uid()` by `get_my_impact_summary` (never a
     * client sum, never another user's rows). Roundup donations come back with
     * `upa_id` null and the name "General Fund" (FR-11).
     *
     * The gratitude section (FR-14) is queried SEPARATELY: Track B flagged that
     * `get_my_impact_summary` does not carry gratitude received. So this reads
     * `gratitude_posts` for exactly the funded items this donor gave to, keyed
     * off the donation list's item ids, published and not soft deleted. A never
     * donated caller has no item ids, so no gratitude query runs and the caller
     * renders the empty state. */
    async getMyImpact(): Promise<MyImpact> {
      const { data, error } = await db.rpc("get_my_impact_summary");
      if (error) throw mapPostgrestError(error);
      const json = (data ?? { total_given: 0, athletes_supported: 0, items_funded: 0, donations: [] }) as ImpactJson;

      const donations: ImpactDonation[] = (json.donations ?? []).map((row) => ({
        id: row.id,
        amount: row.amount,
        method: row.method,
        upaId: row.upa_id,
        upaName: row.upa_id === null ? "General Fund" : row.upa_name ?? "A verified athlete",
        itemId: row.item_id,
        itemTitle: row.item_title,
        createdAt: row.created_at,
      }));

      const itemIds = Array.from(new Set(donations.map((d) => d.itemId).filter((id): id is string => id !== null)));
      const gratitude = itemIds.length > 0 ? await loadGratitude(db, itemIds, client) : [];

      return {
        totalGiven: json.total_given ?? 0,
        athletesSupported: json.athletes_supported ?? 0,
        itemsFunded: json.items_funded ?? 0,
        donations,
        gratitude,
      };
    },
  };
}

export type UseEmpowerResult = ReturnType<typeof useEmpower>;

interface GratitudeQueryRow {
  id: string;
  wishlist_item_id: string;
  body: string;
  photo_url: string | null;
  created_at: string;
  upa_applications: { story_headline: string } | null;
  upa_wishlist_items: { title: string } | null;
}

/** FR-14's separate gratitude read (the `get_my_impact_summary` gap). Scoped to
 * the passed item ids (the caller's own funded items), published and not soft
 * deleted. gratitude_posts is public only for a verified parent UPA, so a post
 * on an unverified UPA is invisible here regardless of the item id. */
async function loadGratitude(
  db: SupabaseClient,
  itemIds: string[],
  client: AtlitosClient,
): Promise<ImpactGratitude[]> {
  const { data, error } = await db
    .from("gratitude_posts")
    .select("id, wishlist_item_id, body, photo_url, created_at, upa_applications ( story_headline ), upa_wishlist_items ( title )")
    .in("wishlist_item_id", itemIds)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<GratitudeQueryRow[]>();
  if (error) throw mapPostgrestError(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    photoUrl: resolvePhoto(client, GRATITUDE_PHOTOS_BUCKET, row.photo_url),
    itemTitle: row.upa_wishlist_items?.title ?? null,
    upaName: row.upa_applications?.story_headline ?? null,
    createdAt: row.created_at,
  }));
}

/** Narrow an unknown thrown value to `ApiError` at a screen's catch site, the
 * same helper `use-shop.ts` exposes (a Razorpay sheet dismissal throws a plain
 * `Error`, and the donate screen has to tell the two apart). Re-declared here
 * rather than imported so the empower lane stays self contained. */
export function isEmpowerApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && "code" in error && "status" in error;
}
