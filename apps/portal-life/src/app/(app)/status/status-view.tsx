"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleAlert,
  CircleDashed,
  FileText,
  RotateCcw,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { UpaApplication } from "@/lib/empower";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { StatusPill, upaStatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

// Human labels for the staff flagged field (PRD-05 FR-8). Falls back to the
// raw column name so an unmapped field still reads sensibly.
const FIELD_LABELS: Record<string, string> = {
  story_headline: "Story headline",
  story_body: "Your story",
  sport: "Sport",
  region: "Region",
  state: "State",
  photo_url: "Profile photo",
  evidence: "Certificate or video",
};

function fieldLabel(field: string | null): string {
  if (!field) return "an item in your application";
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

const ROADMAP = [
  { key: "submitted", label: "Submitted", hint: "We received your application." },
  { key: "under_review", label: "Under review", hint: "Our team is reviewing your story and evidence." },
  { key: "verified", label: "Verified", hint: "Your profile is live for sponsors." },
] as const;

// Where the applicant sits on the linear roadmap. needs_info and rejected are
// branches off under_review, so they render at that index.
function roadmapIndex(status: UpaApplication["status"]): number {
  switch (status) {
    case "submitted":
      return 0;
    case "under_review":
    case "needs_info":
    case "rejected":
      return 1;
    case "verified":
      return 2;
    default:
      return 0;
  }
}

export function StatusView({
  userId,
  initialApplication,
}: {
  userId: string;
  initialApplication: UpaApplication | null;
}) {
  const router = useRouter();
  const [application, setApplication] = useState(initialApplication);
  const [state, setState] = useState<"ready" | "error">("ready");

  const reload = useCallback(async () => {
    const supabase = createClient();
    // Explicit owner filter: upa_applications is permissive-OR (0049), so this
    // never trusts RLS alone to scope to the caller's own row.
    const { data, error } = await supabase
      .from("upa_applications")
      .select("*")
      .eq("applicant_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      setState("error");
      return;
    }
    setApplication(data ?? null);
    setState("ready");
  }, [userId]);

  // Realtime: any change to this applicant's own application rows refetches.
  // On a flip to verified we refresh the auth session first so the new upa
  // role reaches the JWT (0050 note), then re-render the shell.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`upa-status-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "upa_applications",
          filter: `applicant_user_id=eq.${userId}`,
        },
        async (payload) => {
          const next = payload.new as Partial<UpaApplication> | null;
          if (next?.status === "verified") {
            await supabase.auth.refreshSession();
            router.refresh();
          }
          reload();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, reload, router]);

  const header = (
    <PageHeader
      eyebrow="Verification"
      title="Your application status"
      description="Track where your application stands and what is left."
    />
  );

  if (state === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description="We could not load your application." onRetry={reload} />
      </div>
    );
  }

  // No application yet: invite the applicant to start (PRD-05 FR-1).
  if (!application) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <EmptyState
          icon={FileText}
          title="You have not applied yet"
          description="Tell your story, add your sport and region, and share a certificate or match video to apply for support."
        />
        <div className="flex justify-center">
          <Button size="lg" render={<Link href="/apply" />}>
            Start your application
            <ArrowRight />
          </Button>
        </div>
      </div>
    );
  }

  const pill = upaStatusPill(application.status);
  const activeIndex = roadmapIndex(application.status);

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}

      <Card>
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-base font-semibold text-foreground">
                {application.story_headline}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                Applied {formatDate(application.created_at)}
              </span>
            </div>
            <StatusPill label={pill.label} tone={pill.tone} />
          </div>

          <ol className="flex flex-col gap-4">
            {ROADMAP.map((step, index) => {
              const done = index < activeIndex || application.status === "verified";
              const current = index === activeIndex && application.status !== "verified";
              return (
                <li key={step.key} className="flex items-start gap-3">
                  <span
                    className={
                      done
                        ? "mt-0.5 flex size-6 items-center justify-center rounded-full bg-[color-mix(in_oklch,hsl(var(--color-success)),transparent_84%)] text-[hsl(var(--color-success))]"
                        : current
                          ? "mt-0.5 flex size-6 items-center justify-center rounded-full bg-accent text-primary"
                          : "mt-0.5 flex size-6 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                    }
                  >
                    {done ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : current ? (
                      <CircleDashed className="size-3.5" strokeWidth={2} />
                    ) : (
                      <CircleDashed className="size-3.5 opacity-50" strokeWidth={2} />
                    )}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={
                        done || current
                          ? "text-sm font-medium text-foreground"
                          : "text-sm font-medium text-muted-foreground"
                      }
                    >
                      {step.label}
                    </span>
                    <span className="text-sm text-muted-foreground">{step.hint}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {application.status === "needs_info" ? (
        <Card className="border-[hsl(var(--color-warning))]/30">
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center gap-2 text-[hsl(var(--color-warning))]">
              <CircleAlert className="size-4" strokeWidth={1.75} />
              <span className="text-sm font-semibold">We need a little more</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Our team needs an update to {fieldLabel(application.needs_info_field)} before we can
              verify you. Open your application to fix it, your other answers are saved.
            </p>
            <div>
              <Button render={<Link href={`/apply?resume=${application.id}`} />}>
                Update your application
                <ArrowRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {application.status === "rejected" ? (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center gap-2 text-destructive">
              <CircleAlert className="size-4" strokeWidth={1.75} />
              <span className="text-sm font-semibold">Not approved this time</span>
            </div>
            {application.rejection_reason ? (
              <p className="text-sm text-muted-foreground">{application.rejection_reason}</p>
            ) : null}
            {application.reapply_after ? (
              <p className="text-sm text-muted-foreground">
                You can reapply from{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {formatDate(application.reapply_after)}
                </span>
                . Strengthen your story and evidence before you do.
              </p>
            ) : (
              <div>
                <Button render={<Link href="/apply" />}>
                  <RotateCcw className="size-4" strokeWidth={1.75} />
                  Reapply now
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {application.status === "verified" ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center gap-2 text-[hsl(var(--color-success))]">
              <BadgeCheck className="size-4" strokeWidth={1.75} />
              <span className="text-sm font-semibold">You are verified</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Your profile is live for sponsors. Add the gear you need and start tracking funding.
            </p>
            <div className="flex gap-2">
              <Button render={<Link href="/home" />}>
                Go to your dashboard
                <ArrowRight />
              </Button>
              <Button variant="outline" render={<Link href="/wishlist" />}>
                Manage wishlist
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
