"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { fetchLatestOnboardingVenue, MIN_VENUE_PHOTOS, type CourtRow } from "@/lib/onboarding";
import { useOnboardingDraft } from "./onboarding-draft";

type GuardResult =
  | { status: "checking" }
  | { status: "fresh" }
  | { status: "edit-rejected" };

/**
 * Shared entry guard for the `venue-details` and `courts` steps (both of
 * which end, on their own Continue action, in a `submit_venue_verification`
 * call that creates a brand new `venues` row, FR-2/FR-4/FR-5). Once a venue
 * has been created it must not be possible to land back on these two steps
 * and accidentally create a second one:
 *
 *   - no venue yet, or the latest venue was rejected: these steps render
 *     normally ("fresh" for a first-time partner, "edit-rejected" prefills
 *     the draft from the rejected venue's own current fields/courts for
 *     FR-6's "edit and resubmit").
 *   - a venue already exists and is not rejected (pending, mid-photos, or
 *     fully pending/verified): there is nothing left to (re)create, so the
 *     guard redirects onward to whichever step `/onboarding`'s own router
 *     would have picked.
 */
export function useOnboardingGuard(): GuardResult {
  const router = useRouter();
  const draft = useOnboardingDraft();
  const [result, setResult] = useState<GuardResult>({ status: "checking" });
  const prefilled = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const { venue, photoCount } = await fetchLatestOnboardingVenue(supabase);

      if (cancelled) return;

      if (!venue) {
        setResult({ status: "fresh" });
        return;
      }

      if (venue.status === "verified") {
        router.replace("/dashboard");
        return;
      }

      if (venue.status !== "rejected") {
        router.replace(photoCount < MIN_VENUE_PHOTOS ? "/onboarding/photos" : "/onboarding/pending");
        return;
      }

      // Rejected: prefill the draft from the rejected venue once, so both
      // the venue-details and courts steps show the partner's previous
      // answers instead of a blank form (FR-6, "the partner can edit and
      // resubmit"). Submitting again creates a new venue+courts+
      // verification_request row (see submitVenueVerification's own
      // comment); the rejected row is left as-is, it is simply no longer
      // the venue any onboarding route points at.
      if (!prefilled.current && !draft.venueId) {
        prefilled.current = true;
        const { data: courts } = await supabase
          .from("courts")
          .select("*")
          .eq("venue_id", venue.id)
          .order("created_at", { ascending: true });

        if (cancelled) return;

        draft.reset({
          details: {
            name: venue.name,
            address: venue.address,
            city: venue.city,
            pincode: venue.pincode,
            lat: venue.lat?.toString() ?? "",
            lng: venue.lng?.toString() ?? "",
            description: venue.description ?? "",
          },
          courts: (courts as CourtRow[] | null ?? []).map((c) => ({
            sport: c.sport,
            name: c.name,
            capacity: c.capacity?.toString() ?? "",
            basePricePerHour: c.base_price_per_hour.toString(),
          })),
        });
      }

      setResult({ status: "edit-rejected" });
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}
