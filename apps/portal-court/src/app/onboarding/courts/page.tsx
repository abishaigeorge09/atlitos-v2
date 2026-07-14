"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { SPORTS, type Sport } from "@atlitos/types";

import { Eyebrow } from "@atlitos/ui-web";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { useOnboardingDraft } from "../onboarding-draft";
import { useOnboardingGuard } from "../use-onboarding-guard";
import { createClient } from "@/lib/supabase/client";
import { emptyDraftCourt, submitVenueVerification, fetchLatestOnboardingVenue } from "@/lib/onboarding";
import { sportLabel } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * PRD-03 FR-4/FR-5: add one or more courts, then Continue calls
 * `submit_venue_verification` (0009_courts.sql), the only path that can
 * create a venue. This is deliberately where the actual database write
 * happens in this wizard, not on a later "Review and submit" screen: the
 * Photos step (FR-3) needs a real `venue_id` to upload against
 * (`venue-media`'s storage RLS keys off an existing, owned venue), so the
 * venue + courts + `verification_requests` row must all exist before the
 * partner can add photos. The `/onboarding/review` step further down the
 * wizard is a read only confirmation of what this call already created, not
 * a second submission.
 */
export default function CourtsStep() {
  const router = useRouter();
  const draft = useOnboardingDraft();
  const guard = useOnboardingGuard();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (guard.status === "checking") {
    return <Skeleton className="h-96 w-full" />;
  }

  function updateCourt(index: number, patch: Partial<(typeof draft.courts)[number]>) {
    draft.setCourts(draft.courts.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  const courtsValid = draft.courts.length > 0 && draft.courts.every((c) => c.name.trim() && c.basePricePerHour);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.details.name.trim()) {
      // The partner navigated here directly without finishing venue-details.
      router.replace("/onboarding/venue-details");
      return;
    }
    if (!courtsValid) {
      setError("Every court needs a name and a base price.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const supabase = createClient();

    try {
      await submitVenueVerification(supabase, draft.details, draft.courts);
      const { venue } = await fetchLatestOnboardingVenue(supabase);
      if (venue) {
        draft.setVenueId(venue.id);
      }
      router.push("/onboarding/photos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your venue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>Onboarding</Eyebrow>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Add your courts</h1>
        <p className="text-sm text-muted-foreground">
          Add at least one court with its sport and base price. You can add more later.
        </p>
      </div>

      <OnboardingSteps current="courts" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Courts</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {draft.courts.map((court, index) => (
              <div key={index} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-4">
                <Select value={court.sport} onChange={(e) => updateCourt(index, { sport: e.target.value as Sport })}>
                  {SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {sportLabel(s)}
                    </option>
                  ))}
                </Select>
                <Input
                  placeholder="Court name"
                  required
                  value={court.name}
                  onChange={(e) => updateCourt(index, { name: e.target.value })}
                />
                <Input
                  placeholder="Capacity"
                  type="number"
                  min={1}
                  value={court.capacity}
                  onChange={(e) => updateCourt(index, { capacity: e.target.value })}
                />
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Base price/hr"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={court.basePricePerHour}
                    onChange={(e) => updateCourt(index, { basePricePerHour: e.target.value })}
                  />
                  {draft.courts.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => draft.setCourts(draft.courts.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => draft.setCourts([...draft.courts, emptyDraftCourt(SPORTS[0])])}
            >
              <Plus className="size-4" strokeWidth={1.75} />
              Add another court
            </Button>

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={() => router.push("/onboarding/venue-details")}>
                Back
              </Button>
              <Button type="submit" disabled={submitting} className="w-fit">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Create venue and continue
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
