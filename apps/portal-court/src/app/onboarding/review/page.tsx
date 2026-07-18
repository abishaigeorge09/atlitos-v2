"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";

import { formatINR } from "@atlitos/theme";
import { Eyebrow } from "@atlitos/ui-web";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { createClient } from "@/lib/supabase/client";
import { sportLabel } from "@/lib/format";
import { venueStatusPill, StatusPill } from "@/components/status-pill";
import type { CourtRow, VenuePhotoRow, VenueRow } from "@/lib/onboarding";
import { MIN_VENUE_PHOTOS } from "@/lib/onboarding";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";

/**
 * PRD-03 3.1's "Review and submit" step. By the time a partner reaches
 * here, `submit_venue_verification` has already run (at the end of the
 * Courts step) and the venue already carries `status='pending'`; this
 * screen is a read only confirmation of what was submitted, not a second
 * write, then hands off to `/onboarding/pending` (FR-6).
 */
export default function ReviewStep() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [venue, setVenue] = useState<VenueRow | null>(null);
  const [courts, setCourts] = useState<CourtRow[]>([]);
  const [photos, setPhotos] = useState<VenuePhotoRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated.");
      setStatus("error");
      return;
    }

    // Owner filter required: venues RLS also exposes other partners'
    // verified venues (public browse policy), never rely on RLS alone here.
    const { data: venues, error: venueError } = await supabase
      .from("venues")
      .select("*")
      .eq("partner_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (venueError) {
      setError(venueError.message);
      setStatus("error");
      return;
    }

    const latest = (venues?.[0] as VenueRow | undefined) ?? null;
    if (!latest) {
      router.replace("/onboarding/venue-details");
      return;
    }

    const [courtsResult, photosResult] = await Promise.all([
      supabase.from("courts").select("*").eq("venue_id", latest.id).order("created_at", { ascending: true }),
      supabase.from("venue_photos").select("*").eq("venue_id", latest.id).order("position", { ascending: true }),
    ]);

    if (courtsResult.error || photosResult.error) {
      setError(courtsResult.error?.message ?? photosResult.error?.message ?? "Failed to load your submission.");
      setStatus("error");
      return;
    }

    if ((photosResult.data?.length ?? 0) < MIN_VENUE_PHOTOS) {
      router.replace("/onboarding/photos");
      return;
    }

    setVenue(latest);
    setCourts((courtsResult.data as CourtRow[]) ?? []);
    setPhotos((photosResult.data as VenuePhotoRow[]) ?? []);
    setStatus("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (status === "error" || !venue) {
    return <ErrorState description={error ?? "Failed to load your submission."} onRetry={load} />;
  }

  const pill = venueStatusPill(venue.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>Onboarding</Eyebrow>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Review your submission</h1>
        <p className="text-sm text-muted-foreground">
          Your venue is already submitted for verification. Confirm everything looks right.
        </p>
      </div>

      <OnboardingSteps current="review" />

      <Card>
        <CardHeader className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4" strokeWidth={1.75} />
            {venue.name}
          </CardTitle>
          <StatusPill label={pill.label} tone={pill.tone} />
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            {venue.address}, {venue.city} {venue.pincode}
          </p>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">Courts ({courts.length})</span>
            <div className="flex flex-col gap-2">
              {courts.map((court) => (
                <div key={court.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span className="text-sm font-medium text-foreground">
                    {court.name} <span className="font-normal text-muted-foreground">({sportLabel(court.sport)})</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatINR(court.base_price_per_hour)}/hr
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">Photos ({photos.length})</span>
            <div className="flex flex-wrap gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="size-20 overflow-hidden rounded-lg border border-border bg-secondary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={supabase.storage.from("venue-media").getPublicUrl(photo.storage_path).data.publicUrl}
                    alt="Venue"
                    className="size-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>

          <Button type="button" className="w-fit" onClick={() => router.push("/onboarding/pending")}>
            Done, view status
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
