import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@atlitos/types";

import { createClient } from "@/lib/supabase/server";

export type UpaApplication = Database["public"]["Tables"]["upa_applications"]["Row"];
export type WishlistItem = Database["public"]["Tables"]["upa_wishlist_items"]["Row"];
export type GratitudePost = Database["public"]["Tables"]["gratitude_posts"]["Row"];
export type UpaEvidence = Database["public"]["Tables"]["upa_evidence"]["Row"];

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
