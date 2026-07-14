"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { Eyebrow } from "@atlitos/ui-web";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { useOnboardingDraft } from "../onboarding-draft";
import { createClient } from "@/lib/supabase/client";
import {
  deleteVenuePhoto,
  fetchLatestOnboardingVenue,
  uploadVenuePhoto,
  MIN_VENUE_PHOTOS,
  MAX_VENUE_PHOTOS,
  type VenuePhotoRow,
} from "@/lib/onboarding";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";

type LoadStatus = "loading" | "ready" | "error";

/**
 * PRD-03 FR-3: a minimum of 3 and maximum of 12 venue photos, uploaded to
 * the `venue-media` bucket (`0014_venue_media_bucket.sql`) and recorded in
 * `venue_photos`. This step runs after the Courts step's
 * `submit_venue_verification` call, since the storage RLS policy requires
 * the venue to already exist and be owned by the caller before any upload
 * to `{venue_id}/...` is allowed; see `CourtsStep`'s header comment for why
 * the wizard is ordered this way instead of PRD-03 3.1's prose order.
 */
export default function PhotosStep() {
  const router = useRouter();
  const draft = useOnboardingDraft();
  const [venueId, setVenueId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<VenuePhotoRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    const supabase = createClient();

    try {
      const { venue } = await fetchLatestOnboardingVenue(supabase);

      if (!venue) {
        router.replace("/onboarding/venue-details");
        return;
      }
      if (venue.status === "verified") {
        router.replace("/dashboard");
        return;
      }

      setVenueId(venue.id);
      draft.setVenueId(venue.id);

      const { data, error: photosError } = await supabase
        .from("venue_photos")
        .select("*")
        .eq("venue_id", venue.id)
        .order("position", { ascending: true });

      if (photosError) throw new Error(photosError.message);
      setPhotos((data as VenuePhotoRow[]) ?? []);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your venue's photos.");
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !venueId) return;
    const remaining = MAX_VENUE_PHOTOS - photos.length;
    const toUpload = Array.from(files).slice(0, Math.max(0, remaining));

    setUploading(true);
    setError(null);
    const supabase = createClient();
    try {
      let position = photos.length;
      for (const file of toUpload) {
        await uploadVenuePhoto(supabase, venueId, file, position);
        position += 1;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(photo: VenuePhotoRow) {
    const supabase = createClient();
    try {
      await deleteVenuePhoto(supabase, photo);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that photo.");
    }
  }

  const supabase = useMemo(() => createClient(), []);
  const canContinue = photos.length >= MIN_VENUE_PHOTOS;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>Onboarding</Eyebrow>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Add photos of your venue</h1>
        <p className="text-sm text-muted-foreground">
          Upload at least 3 photos, up to 12. Clear daylight shots of the courts work best.
        </p>
      </div>

      <OnboardingSteps current="photos" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Photos ({photos.length} of {MAX_VENUE_PHOTOS})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status === "loading" ? <Skeleton className="h-32 w-full" /> : null}
          {status === "error" ? <ErrorState description={error ?? "Failed to load."} onRetry={load} /> : null}

          {status === "ready" ? (
            <>
              <div className="flex flex-wrap gap-3">
                {photos.map((photo) => (
                  <div key={photo.id} className="group relative size-24 overflow-hidden rounded-lg border border-border bg-secondary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={supabase.storage.from("venue-media").getPublicUrl(photo.storage_path).data.publicUrl}
                      alt="Venue"
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleDelete(photo)}
                      className="absolute top-1 right-1 rounded-md bg-card/90 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
                {photos.length < MAX_VENUE_PHOTOS ? (
                  <label className="flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground">
                    {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" strokeWidth={1.75} />}
                    <span className="text-xs">Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleUpload(e.target.files)}
                    />
                  </label>
                ) : null}
              </div>

              {photos.length < MIN_VENUE_PHOTOS ? (
                <p className="text-xs text-muted-foreground">
                  Add {MIN_VENUE_PHOTOS - photos.length} more photo{MIN_VENUE_PHOTOS - photos.length === 1 ? "" : "s"} to continue.
                </p>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => router.push("/onboarding/courts")}>
                  Back
                </Button>
                <Button type="button" disabled={!canContinue} className="w-fit" onClick={() => router.push("/onboarding/review")}>
                  Continue to review
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
