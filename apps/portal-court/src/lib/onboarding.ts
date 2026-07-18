import type { createClient } from "@/lib/supabase/client";
import type { Sport } from "@atlitos/types";

type AtlitosSupabaseClient = ReturnType<typeof createClient>;

/**
 * Client wiring for PRD-03 FR-1 through FR-7 (partner onboarding and venue
 * verification submission). Every write here goes through the RPCs
 * `0009_courts.sql` already ships (`submit_venue_verification`) or through
 * plain PostgREST inserts the same migration's RLS already allows a
 * `court_partner` to make against their own venue (`venue_photos`); nothing
 * here writes `venues.status` or `venues.rejection_reason` directly, those
 * fields are locked to the admin verification RPCs by
 * `lock_venue_admin_fields` (FIELD_LOCKED on any other caller).
 *
 * Kept as one small typed module (mirrors the doc-comment-per-call
 * convention `packages/api/src/hooks.ts`'s `useCourts` uses) rather than
 * scattering raw `.rpc()`/`.from()` calls across the wizard's step
 * components, so the FR-to-call mapping stays in one place.
 */

export type VenueRow = {
  id: string;
  name: string;
  address: string;
  city: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  description: string | null;
  status: "pending" | "verified" | "rejected";
  rejection_reason: string | null;
  created_at: string;
};

export type CourtRow = {
  id: string;
  venue_id: string;
  sport: Sport;
  name: string;
  capacity: number | null;
  base_price_per_hour: number;
  active: boolean;
};

export type VenuePhotoRow = {
  id: string;
  venue_id: string;
  storage_path: string;
  position: number;
};

export interface DraftVenueDetails {
  name: string;
  address: string;
  city: string;
  pincode: string;
  lat: string;
  lng: string;
  description: string;
}

export interface DraftCourt {
  sport: Sport;
  name: string;
  capacity: string;
  basePricePerHour: string;
}

export const MIN_VENUE_PHOTOS = 3;
export const MAX_VENUE_PHOTOS = 12;

/**
 * The partner's most recently created venue, if any, plus enough of its
 * courts/photos to drive the onboarding router's step decisions (FR-2
 * through FR-6). The explicit `partner_user_id` filter is REQUIRED: RLS on
 * venues is permissive-OR (`venues_select_own` plus `venues_select_public`),
 * so an unscoped select also returns every other partner's verified venues,
 * which routed brand new partners into a dashboard/onboarding redirect loop.
 */
export async function fetchLatestOnboardingVenue(
  supabase: AtlitosSupabaseClient,
): Promise<{ venue: VenueRow | null; photoCount: number; courtCount: number }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const { data: venues, error: venueError } = await supabase
    .from("venues")
    .select("*")
    .eq("partner_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (venueError) throw new Error(venueError.message);

  const venue = (venues?.[0] as VenueRow | undefined) ?? null;
  if (!venue) {
    return { venue: null, photoCount: 0, courtCount: 0 };
  }

  const [photosResult, courtsResult] = await Promise.all([
    supabase.from("venue_photos").select("id", { count: "exact", head: true }).eq("venue_id", venue.id),
    supabase.from("courts").select("id", { count: "exact", head: true }).eq("venue_id", venue.id),
  ]);

  if (photosResult.error) throw new Error(photosResult.error.message);
  if (courtsResult.error) throw new Error(courtsResult.error.message);

  return {
    venue,
    photoCount: photosResult.count ?? 0,
    courtCount: courtsResult.count ?? 0,
  };
}

/**
 * FR-2, FR-4, FR-5: the only path that can ever create a venue
 * (`venues_insert_own`'s plain RLS policy requires `has_role('court_partner')`
 * already true, which nothing else grants). Atomically grants the
 * `court_partner` role, creates the venue (`status='pending'`), its courts,
 * and the `verification_requests` row. Photos are deliberately not part of
 * this call (see the wizard's `courts` step comment for why they are
 * uploaded as a separate step against the venue id this returns), so the
 * payload here never includes a `photos` array even though the RPC accepts
 * one.
 */
export async function submitVenueVerification(
  supabase: AtlitosSupabaseClient,
  details: DraftVenueDetails,
  courts: DraftCourt[],
): Promise<string> {
  const { data, error } = await supabase.rpc("submit_venue_verification", {
    p_payload: {
      name: details.name.trim(),
      address: details.address.trim(),
      city: details.city.trim(),
      pincode: details.pincode.trim(),
      lat: details.lat || null,
      lng: details.lng || null,
      description: details.description.trim() || null,
      courts: courts.map((c) => ({
        sport: c.sport,
        name: c.name.trim(),
        capacity: c.capacity || null,
        basePricePerHour: c.basePricePerHour,
      })),
    },
  });

  if (error) throw new Error(error.message);
  // The RPC returns the new verification_requests id; the caller only needs
  // to know it succeeded and can re-fetch the venue id from `venues`.
  return data as string;
}

/**
 * FR-3: upload one venue photo to the `venue-media` bucket
 * (`0014_venue_media_bucket.sql`, path convention `{venue_id}/{filename}`,
 * RLS requires the venue to already exist and be owned by the caller) and
 * record it in `venue_photos` (`venue_photos_insert_own`).
 */
export async function uploadVenuePhoto(
  supabase: AtlitosSupabaseClient,
  venueId: string,
  file: File,
  position: number,
): Promise<void> {
  const path = `${venueId}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from("venue-media").upload(path, file);
  if (uploadError) throw new Error(uploadError.message);

  const { error: insertError } = await supabase
    .from("venue_photos")
    .insert({ venue_id: venueId, storage_path: path, position });
  if (insertError) throw new Error(insertError.message);
}

export async function deleteVenuePhoto(
  supabase: AtlitosSupabaseClient,
  photo: VenuePhotoRow,
): Promise<void> {
  await supabase.storage.from("venue-media").remove([photo.storage_path]);
  const { error } = await supabase.from("venue_photos").delete().eq("id", photo.id);
  if (error) throw new Error(error.message);
}

export function emptyDraftCourt(defaultSport: Sport): DraftCourt {
  return { sport: defaultSport, name: "", capacity: "", basePricePerHour: "" };
}

export function emptyDraftDetails(): DraftVenueDetails {
  return { name: "", address: "", city: "", pincode: "", lat: "", lng: "", description: "" };
}
