import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@atlitos/types";

import { createClient } from "@/lib/supabase/server";

export type UpaApplication = Database["public"]["Tables"]["upa_applications"]["Row"];
export type WishlistItem = Database["public"]["Tables"]["upa_wishlist_items"]["Row"];
export type GratitudePost = Database["public"]["Tables"]["gratitude_posts"]["Row"];
export type UpaEvidence = Database["public"]["Tables"]["upa_evidence"]["Row"];

/** One supporter, grouped by donor. display_name is the finalize-time opt-in
 * snapshot (0067), null renders "A Sponsor" (PRD-05 FR-17). */
export interface Supporter {
  display_name: string | null;
  amount: number;
  last_at: string;
}

/** A published gratitude post shown back to the UPA on its own seat. */
export interface MoneySummaryGratitude {
  id: string;
  body: string;
  photo_url: string | null;
  wishlist_item_id: string;
  item_title: string | null;
  created_at: string;
}

/**
 * The read-only money-in source for the portal (0084 upa_money_summary).
 * total_raised is LEDGER derived (upa_fund_balance); items is a per-item map of
 * DERIVED funded amounts (sum of donations by item), never the funded_amount
 * cache. Scoped inside the SECURITY DEFINER RPC to owner or verified upa.
 */
export interface UpaMoneySummary {
  upa_id: string;
  total_raised: number;
  donor_count: number;
  items: Record<string, number>;
  supporters: Supporter[];
  gratitude: MoneySummaryGratitude[];
}

/**
 * Read the UPA's own money-in summary. Owner scope is enforced inside the RPC
 * (applicant_user_id = auth.uid()), and the caller only ever passes its own
 * verified application id, so this never crosses owners.
 */
export async function getMoneySummary(upaId: string): Promise<UpaMoneySummary | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("upa_money_summary", { p_upa_id: upaId });
  return (data as unknown as UpaMoneySummary | null) ?? null;
}

/**
 * The applicant's own current application row, or null if they never applied.
 *
 * PERMISSIVE-OR DISCIPLINE (CLAUDE.md, 0049 header): upa_applications carries a
 * public `status = 'verified'` policy BESIDE the owner policy, so an unscoped
 * select returns every verified UPA's row too. This ALWAYS carries its own
 * explicit `.eq('applicant_user_id', userId)` filter so it can never return
 * another owner's row. RLS is the ceiling, this filter is the scope.
 */
export async function getOwnApplication(userId: string): Promise<UpaApplication | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("upa_applications")
    .select("*")
    .eq("applicant_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Authenticated user or redirect to sign in. */
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/signin");
  }
  return user;
}

/**
 * The verified route guard (PRD-05 FR-9): Dashboard, Wishlist, Gratitude and
 * Profile Preview require a verified application. Any non verified state
 * redirects to /status. Returns the user and the verified application so the
 * caller can scope every follow up read by application id.
 */
export async function requireVerifiedApplication(): Promise<{
  user: User;
  application: UpaApplication;
}> {
  const user = await requireUser();
  const application = await getOwnApplication(user.id);
  if (!application || application.status !== "verified") {
    redirect("/status");
  }
  return { user, application };
}
