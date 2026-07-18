import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { MIN_VENUE_PHOTOS } from "@/lib/onboarding";

/**
 * `/onboarding` itself is a pure router, not a screen: it looks at the
 * partner's most recently created venue (there is at most one in the
 * realistic P2 single-venue demo scenario per PRD-03's open question 6) and
 * sends them to whichever step is still incomplete.
 *
 *   no venue yet            -> venue-details (FR-2)
 *   venue exists, <3 photos -> photos (FR-3, whether the venue is pending
 *                              because it is brand new, or pending again
 *                              after an edit-and-resubmit pass, FR-6)
 *   venue verified          -> dashboard, nothing left to onboard
 *   otherwise (pending or rejected, photos already satisfied)
 *                            -> pending, the FR-6 status screen
 */
export default async function OnboardingIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin?next=/onboarding");
  }

  // Explicit owner filter required: venues RLS is permissive-OR (own plus
  // public-verified), so an unscoped select sees other partners' venues and
  // routes a brand new partner into a dashboard/onboarding redirect loop.
  const { data: venues } = await supabase
    .from("venues")
    .select("id, status")
    .eq("partner_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const venue = venues?.[0];

  if (!venue) {
    redirect("/onboarding/venue-details");
  }

  if (venue.status === "verified") {
    redirect("/dashboard");
  }

  const { count } = await supabase
    .from("venue_photos")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venue.id);

  if ((count ?? 0) < MIN_VENUE_PHOTOS) {
    redirect("/onboarding/photos");
  }

  redirect("/onboarding/pending");
}
