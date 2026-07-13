"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, LayoutDashboard, PieChart, Wallet } from "lucide-react";
import { formatINR } from "@atlitos/theme";

import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { VenueSwitcher } from "@/components/venue-switcher";
import { useVenueScope } from "@/components/venue-scope";
import { createClient } from "@/lib/supabase/client";
import { isoDaysAgo, timeToMinutes, todayIso } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface OverviewData {
  todayBookings: number;
  weekRevenue: number;
  occupancyPercent: number | null;
}

export default function OverviewPage() {
  const scope = useVenueScope();
  const [data, setData] = useState<OverviewData | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!scope.selectedVenueId) return;
    setStatus("loading");
    const supabase = createClient();
    const venueId = scope.selectedVenueId;
    const today = todayIso();
    const weekAgo = isoDaysAgo(6);
    const dow = new Date().getDay();

    const { data: courts, error: courtsError } = await supabase
      .from("courts")
      .select("id")
      .eq("venue_id", venueId)
      .eq("active", true);

    if (courtsError) {
      setError(courtsError.message);
      setStatus("error");
      return;
    }
    const courtIds = (courts ?? []).map((c) => c.id);

    if (courtIds.length === 0) {
      setData({ todayBookings: 0, weekRevenue: 0, occupancyPercent: null });
      setStatus("ready");
      return;
    }

    const [todayBookingsResult, weekBookingsResult, windowsResult, blackoutsResult] = await Promise.all([
      supabase
        .from("court_bookings")
        .select("id", { count: "exact", head: true })
        .in("court_id", courtIds)
        .eq("date", today)
        .not("status", "in", "(cancelled,expired)"),
      supabase
        .from("court_bookings")
        .select("total, status")
        .in("court_id", courtIds)
        .in("status", ["confirmed", "completed"])
        .gte("date", weekAgo)
        .lte("date", today),
      supabase.from("court_availability_windows").select("court_id, open_time, close_time, slot_duration_minutes").in("court_id", courtIds).eq("day_of_week", dow),
      supabase.from("court_blackouts").select("court_id").in("court_id", courtIds).lte("start_date", today).gte("end_date", today),
    ]);

    if (todayBookingsResult.error || weekBookingsResult.error || windowsResult.error || blackoutsResult.error) {
      setError(
        todayBookingsResult.error?.message ??
          weekBookingsResult.error?.message ??
          windowsResult.error?.message ??
          blackoutsResult.error?.message ??
          "Failed to load overview.",
      );
      setStatus("error");
      return;
    }

    const blackedOutCourtIds = new Set((blackoutsResult.data ?? []).map((b) => b.court_id));
    const totalSlotsToday = (windowsResult.data ?? [])
      .filter((w) => !blackedOutCourtIds.has(w.court_id))
      .reduce((sum, w) => {
        const minutes = timeToMinutes(w.close_time) - timeToMinutes(w.open_time);
        return sum + Math.max(0, Math.floor(minutes / w.slot_duration_minutes));
      }, 0);

    const weekRevenue = (weekBookingsResult.data ?? []).reduce((sum, b) => sum + b.total, 0);

    setData({
      todayBookings: todayBookingsResult.count ?? 0,
      weekRevenue,
      occupancyPercent: totalSlotsToday > 0 ? Math.round(((todayBookingsResult.count ?? 0) / totalSlotsToday) * 100) : null,
    });
    setStatus("ready");
  }, [scope.selectedVenueId]);

  useEffect(() => {
    load();
  }, [load]);

  const header = <PageHeader eyebrow="Overview" title="Your venue at a glance" action={<VenueSwitcher />} />;

  if (scope.status === "loading" || (scope.status === "ready" && status === "loading")) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  if (scope.status === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description={scope.error ?? "Could not load your venues."} onRetry={scope.refresh} />
      </div>
    );
  }

  if (scope.status === "empty") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <EmptyState
          icon={LayoutDashboard}
          title="Overview arrives once your first venue is verified"
          description="Bookings, occupancy and payouts across your venue will show up here."
        />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description={error ?? "Failed to load overview."} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Bookings today</CardTitle>
            <CalendarCheck className="size-4 text-muted-foreground" strokeWidth={1.75} />
          </CardHeader>
          <CardContent>
            <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">{data.todayBookings}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Revenue this week</CardTitle>
            <Wallet className="size-4 text-muted-foreground" strokeWidth={1.75} />
          </CardHeader>
          <CardContent>
            <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">{formatINR(data.weekRevenue)}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Occupancy today</CardTitle>
            <PieChart className="size-4 text-muted-foreground" strokeWidth={1.75} />
          </CardHeader>
          <CardContent>
            <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
              {data.occupancyPercent === null ? "No slots today" : `${data.occupancyPercent}%`}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
