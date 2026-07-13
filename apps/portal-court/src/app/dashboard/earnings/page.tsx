"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { BillSummary } from "@atlitos/ui-web";
import { formatINR } from "@atlitos/theme";

import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { VenueSwitcher } from "@/components/venue-switcher";
import { useVenueScope } from "@/components/venue-scope";
import { createClient } from "@/lib/supabase/client";
import { formatDate, isoDaysAgo, todayIso } from "@/lib/format";
import { transferStatusPill, StatusPill } from "@/components/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EarningsChart } from "@/components/earnings-chart";

interface EarningsData {
  grossThisMonth: number;
  platformFeeThisMonth: number;
  netThisMonth: number;
  pendingBalance: number;
  lastPayout: { amount: number; date: string } | null;
  chartPoints: { date: string; amount: number }[];
  transfers: { id: string; amount: number; status: "processing" | "paid" | "failed"; razorpay_transfer_id: string | null; created_at: string }[];
  payoutLinked: boolean;
}

const CHART_DAYS = 14;

export default function EarningsPage() {
  const scope = useVenueScope();
  const [data, setData] = useState<EarningsData | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!scope.selectedVenueId) return;
    setStatus("loading");
    const supabase = createClient();
    const venueId = scope.selectedVenueId;

    const { data: courts, error: courtsError } = await supabase.from("courts").select("id").eq("venue_id", venueId);
    if (courtsError) {
      setError(courtsError.message);
      setStatus("error");
      return;
    }
    const courtIds = (courts ?? []).map((c) => c.id);

    const monthStart = `${todayIso().slice(0, 7)}-01`;
    const chartStart = isoDaysAgo(CHART_DAYS - 1);

    const [bookingsResult, ledgerResult, payoutAccountResult] = await Promise.all([
      courtIds.length
        ? supabase
            .from("court_bookings")
            .select("date, subtotal, gst, platform_fee, total, status")
            .in("court_id", courtIds)
            .in("status", ["confirmed", "completed"])
            .gte("date", chartStart)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("ledger_entries")
        .select("amount, direction, created_at")
        .eq("account_type", "court_partner")
        .eq("account_ref", venueId),
      supabase.from("payout_accounts").select("id").eq("owner_type", "court_partner").eq("owner_id", venueId).maybeSingle(),
    ]);

    if (bookingsResult.error || ledgerResult.error) {
      setError(bookingsResult.error?.message ?? ledgerResult.error?.message ?? "Failed to load earnings.");
      setStatus("error");
      return;
    }

    const bookings = bookingsResult.data ?? [];
    const monthBookings = bookings.filter((b) => b.date >= monthStart);
    const grossThisMonth = monthBookings.reduce((sum, b) => sum + b.total, 0);
    const platformFeeThisMonth = monthBookings.reduce((sum, b) => sum + b.platform_fee, 0);
    const netThisMonth = grossThisMonth - platformFeeThisMonth;

    const chartPoints: { date: string; amount: number }[] = [];
    for (let i = CHART_DAYS - 1; i >= 0; i -= 1) {
      const d = isoDaysAgo(i);
      chartPoints.push({ date: d, amount: bookings.filter((b) => b.date === d).reduce((sum, b) => sum + b.total, 0) });
    }

    const pendingCredits = (ledgerResult.data ?? []).reduce((sum, e) => sum + e.amount, 0);

    let transfers: EarningsData["transfers"] = [];
    let lastPayout: EarningsData["lastPayout"] = null;
    let transferredTotal = 0;
    const payoutAccountId = payoutAccountResult.data?.id;

    if (payoutAccountId) {
      const { data: transferRows } = await supabase
        .from("transfers")
        .select("id, amount, status, razorpay_transfer_id, created_at")
        .eq("payout_account_id", payoutAccountId)
        .order("created_at", { ascending: false });
      transfers = transferRows ?? [];
      transferredTotal = transfers.reduce((sum, t) => sum + t.amount, 0);
      const paid = transfers.find((t) => t.status === "paid");
      if (paid) lastPayout = { amount: paid.amount, date: paid.created_at };
    }

    setData({
      grossThisMonth,
      platformFeeThisMonth,
      netThisMonth,
      pendingBalance: Math.max(0, pendingCredits - transferredTotal),
      lastPayout,
      chartPoints,
      transfers,
      payoutLinked: !!payoutAccountId,
    });
    setStatus("ready");
  }, [scope.selectedVenueId]);

  useEffect(() => {
    load();
  }, [load]);

  const header = <PageHeader eyebrow="Earnings" title="Earnings and payouts" action={<VenueSwitcher />} />;

  if (scope.status === "loading" || (scope.status === "ready" && status === "loading")) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <Skeleton className="h-64 w-full" />
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
          icon={Wallet}
          title="Earnings show up after your first venue is verified"
          description="Gross bookings, platform fee and net payable, plus your transfer history, land here."
        />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description={error ?? "Failed to load earnings."} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Pending balance</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{formatINR(data.pendingBalance)}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Last payout</CardTitle>
          </CardHeader>
          <CardContent>
            {data.lastPayout ? (
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {formatINR(data.lastPayout.amount)}{" "}
                <span className="text-sm font-normal text-muted-foreground">{formatDate(data.lastPayout.date.slice(0, 10))}</span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">No payouts yet</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Payout account</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-sm text-foreground">{data.payoutLinked ? "Linked" : "Not linked yet"}</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">This month</CardTitle>
        </CardHeader>
        <CardContent>
          <BillSummary
            rows={[
              { label: "Gross bookings", amount: data.grossThisMonth },
              { label: "Platform fee", amount: -data.platformFeeThisMonth, emphasis: "muted" },
            ]}
            total={data.netThisMonth}
            totalLabel="Net payable"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Earnings, trailing {CHART_DAYS} days</CardTitle>
        </CardHeader>
        <CardContent>
          <EarningsChart points={data.chartPoints} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transfer history</CardTitle>
        </CardHeader>
        <CardContent>
          {data.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {data.payoutLinked ? "No transfers yet." : "Link a payout account to start receiving transfers."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transfers.map((t) => {
                  const pill = transferStatusPill(t.status);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs tabular-nums">{formatDate(t.created_at.slice(0, 10))}</TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">{formatINR(t.amount)}</TableCell>
                      <TableCell>
                        <StatusPill label={pill.label} tone={pill.tone} />
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                        {t.razorpay_transfer_id ?? "Not available"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
