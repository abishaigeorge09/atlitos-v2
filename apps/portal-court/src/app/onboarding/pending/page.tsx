"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, RefreshCw } from "lucide-react";

import { Eyebrow } from "@atlitos/ui-web";
import { createClient } from "@/lib/supabase/client";
import { useOnboardingDraft } from "../onboarding-draft";
import type { VenueRow } from "@/lib/onboarding";
import { venueStatusPill, StatusPill } from "@/components/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";

/**
 * PRD-03 FR-6: the partner's venue verification status, always visible,
 * with the admin's rejection reason and an edit-and-resubmit path when
 * rejected. Reads `venues.status`/`venues.rejection_reason` directly
 * (`venues_select_own` RLS); there is no `verification_requests` read path
 * for a non-admin caller (`0003_moderation_audit.sql` only ships a 'coach'
 * ownership select policy), so this screen never queries that table.
 */
export default function PendingStep() {
  const router = useRouter();
  const draft = useOnboardingDraft();
  const supabase = useMemo(() => createClient(), []);
  const [venue, setVenue] = useState<VenueRow | null>(null);
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
    const { data, error: venueError } = await supabase
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

    const latest = (data?.[0] as VenueRow | undefined) ?? null;
    if (!latest) {
      router.replace("/onboarding/venue-details");
      return;
    }

    if (latest.status === "verified") {
      router.replace("/dashboard");
      return;
    }

    setVenue(latest);
    setStatus("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  function handleEditAndResubmit() {
    // Local draft only: the rejected venue itself is left untouched
    // (status/rejection_reason are admin-locked fields, see
    // 0009_courts.sql's lock_venue_admin_fields trigger); the next
    // submit_venue_verification call creates a fresh venue+courts+
    // verification_request row, see use-onboarding-guard's comment.
    draft.reset();
    router.push("/onboarding/venue-details");
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (status === "error" || !venue) {
    return <ErrorState description={error ?? "Failed to load your venue's status."} onRetry={load} />;
  }

  const pill = venueStatusPill(venue.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>Onboarding</Eyebrow>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Verification status</h1>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="size-4" strokeWidth={1.75} />
            {venue.name}
          </CardTitle>
          <StatusPill label={pill.label} tone={pill.tone} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {venue.status === "pending" ? (
            <p className="text-sm text-muted-foreground">
              An Atlitos admin is reviewing your venue. This usually takes one to two business days. You will see
              your dashboard unlock here once it is approved.
            </p>
          ) : null}

          {venue.status === "rejected" ? (
            <>
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {venue.rejection_reason ?? "Your venue was not approved."}
              </p>
              <Button type="button" className="w-fit" onClick={handleEditAndResubmit}>
                Edit and resubmit
              </Button>
            </>
          ) : null}

          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={load}>
            <RefreshCw className="size-4" strokeWidth={1.75} />
            Check again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
