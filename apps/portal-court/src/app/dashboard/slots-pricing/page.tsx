"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { VenueSwitcher } from "@/components/venue-switcher";
import { useVenueScope } from "@/components/venue-scope";
import { createClient } from "@/lib/supabase/client";
import type { Database as AppDatabase } from "@atlitos/types";
import { dayOfWeekLabel, sportLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

type CourtRow = AppDatabase["public"]["Tables"]["courts"]["Row"];
type WindowRow = AppDatabase["public"]["Tables"]["court_availability_windows"]["Row"];
type BlackoutRow = AppDatabase["public"]["Tables"]["court_blackouts"]["Row"];
type PricingRuleRow = AppDatabase["public"]["Tables"]["court_pricing_rules"]["Row"];

const DOW_OPTIONS = [0, 1, 2, 3, 4, 5, 6];

export default function SlotsPricingPage() {
  const scope = useVenueScope();
  const [courts, setCourts] = useState<CourtRow[] | null>(null);
  const [courtsStatus, setCourtsStatus] = useState<"loading" | "error" | "ready">("loading");
  const [courtsError, setCourtsError] = useState<string | null>(null);
  const [selectedCourtId, setSelectedCourtId] = useState<string | null>(null);

  const loadCourts = useCallback(async () => {
    if (!scope.selectedVenueId) return;
    setCourtsStatus("loading");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("courts")
      .select("*")
      .eq("venue_id", scope.selectedVenueId)
      .order("created_at", { ascending: true });

    if (error) {
      setCourtsError(error.message);
      setCourtsStatus("error");
      return;
    }
    setCourts(data ?? []);
    setSelectedCourtId((prev) => (prev && data?.some((c) => c.id === prev) ? prev : (data?.[0]?.id ?? null)));
    setCourtsStatus("ready");
  }, [scope.selectedVenueId]);

  useEffect(() => {
    loadCourts();
  }, [loadCourts]);

  const header = (
    <PageHeader
      eyebrow="Slots and pricing"
      title="Availability and pricing rules"
      action={<VenueSwitcher />}
    />
  );

  if (scope.status === "loading" || (scope.status === "ready" && courtsStatus === "loading")) {
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
          icon={CalendarClock}
          title="Set availability once a venue is verified"
          description="Define weekly windows, blackout dates, base pricing and peak pricing rules per court."
        />
      </div>
    );
  }

  if (courtsStatus === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description={courtsError ?? "Could not load courts."} onRetry={loadCourts} />
      </div>
    );
  }

  if (!courts || courts.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <EmptyState
          icon={CalendarClock}
          title="Add a court first"
          description="Add at least one court on the Venues page before setting availability and pricing."
        />
      </div>
    );
  }

  const selectedCourt = courts.find((c) => c.id === selectedCourtId) ?? courts[0]!;

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}
      <Select value={selectedCourt.id} onChange={(e) => setSelectedCourtId(e.target.value)} className="w-64">
        {courts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({sportLabel(c.sport)})
          </option>
        ))}
      </Select>

      <BasePriceCard court={selectedCourt} onChanged={loadCourts} />
      <AvailabilityCard courtId={selectedCourt.id} />
      <BlackoutsCard courtId={selectedCourt.id} />
      <PricingRulesCard court={selectedCourt} />
    </div>
  );
}

function BasePriceCard({ court, onChanged }: { court: CourtRow; onChanged: () => void }) {
  const [value, setValue] = useState(String(court.base_price_per_hour));
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(String(court.base_price_per_hour)), [court.base_price_per_hour]);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    await supabase.from("courts").update({ base_price_per_hour: Number(value) }).eq("id", court.id);
    setSaving(false);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Base price</CardTitle>
      </CardHeader>
      <CardContent className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="base-price">Rupees per hour</Label>
          <Input id="base-price" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className="w-40 font-mono tabular-nums" />
        </div>
        <Button size="sm" disabled={saving || Number(value) === court.base_price_per_hour} onClick={save}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AvailabilityCard({ courtId }: { courtId: string }) {
  const [windows, setWindows] = useState<WindowRow[] | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [openTime, setOpenTime] = useState("06:00");
  const [closeTime, setCloseTime] = useState("23:00");
  const [duration, setDuration] = useState("60");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("court_availability_windows")
      .select("*")
      .eq("court_id", courtId)
      .order("day_of_week", { ascending: true });
    if (queryError) {
      setError(queryError.message);
      setStatus("error");
      return;
    }
    setWindows(data ?? []);
    setStatus("ready");
  }, [courtId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addWindow(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("court_availability_windows").insert({
      court_id: courtId,
      day_of_week: Number(dayOfWeek),
      open_time: openTime,
      close_time: closeTime,
      slot_duration_minutes: Number(duration),
    });
    setSubmitting(false);
    if (insertError) {
      setFormError(insertError.message);
      return;
    }
    load();
  }

  async function removeWindow(id: string) {
    const supabase = createClient();
    await supabase.from("court_availability_windows").delete().eq("id", id);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Weekly availability</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status === "loading" ? <Skeleton className="h-24 w-full" /> : null}
        {status === "error" ? <ErrorState description={error ?? "Failed to load."} onRetry={load} /> : null}
        {status === "ready" ? (
          <>
            {(windows ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No availability windows set yet, this court has no bookable slots.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {(windows ?? []).map((w) => (
                  <div key={w.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-foreground">{dayOfWeekLabel(w.day_of_week)}</span>{" "}
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {w.open_time.slice(0, 5)} to {w.close_time.slice(0, 5)}, {w.slot_duration_minutes} min slots
                      </span>
                    </span>
                    <Button variant="ghost" size="icon-sm" onClick={() => removeWindow(w.id)}>
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={addWindow} className="grid gap-2 sm:grid-cols-5">
              <Select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                {DOW_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {dayOfWeekLabel(d)}
                  </option>
                ))}
              </Select>
              <Input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} />
              <Input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
              <Input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Minutes" />
              <Button type="submit" disabled={submitting} size="sm">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : (
                  <>
                    <Plus className="size-4" strokeWidth={1.75} />
                    Add window
                  </>
                )}
              </Button>
            </form>
            {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BlackoutsCard({ courtId }: { courtId: string }) {
  const [blackouts, setBlackouts] = useState<BlackoutRow[] | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("court_blackouts")
      .select("*")
      .eq("court_id", courtId)
      .order("start_date", { ascending: true });
    if (queryError) {
      setError(queryError.message);
      setStatus("error");
      return;
    }
    setBlackouts(data ?? []);
    setStatus("ready");
  }, [courtId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addBlackout(event: React.FormEvent) {
    event.preventDefault();
    if (!startDate || !endDate || !reason.trim()) {
      setFormError("Start date, end date and reason are all required.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("court_blackouts").insert({
      court_id: courtId,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (insertError) {
      setFormError(insertError.message);
      return;
    }
    setStartDate("");
    setEndDate("");
    setReason("");
    load();
  }

  async function removeBlackout(id: string) {
    const supabase = createClient();
    await supabase.from("court_blackouts").delete().eq("id", id);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Blackout dates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status === "loading" ? <Skeleton className="h-20 w-full" /> : null}
        {status === "error" ? <ErrorState description={error ?? "Failed to load."} onRetry={load} /> : null}
        {status === "ready" ? (
          <>
            {(blackouts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No blackout dates. This court is bookable every day its availability windows allow.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {(blackouts ?? []).map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span>
                      <span className="font-mono tabular-nums text-foreground">{b.start_date}</span> to{" "}
                      <span className="font-mono tabular-nums text-foreground">{b.end_date}</span>{" "}
                      <span className="text-muted-foreground">{b.reason}</span>
                    </span>
                    <Button variant="ghost" size="icon-sm" onClick={() => removeBlackout(b.id)}>
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={addBlackout} className="grid gap-2 sm:grid-cols-4">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              <Input placeholder="Reason, maintenance, private event" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button type="submit" disabled={submitting} size="sm">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : (
                  <>
                    <Plus className="size-4" strokeWidth={1.75} />
                    Add blackout
                  </>
                )}
              </Button>
            </form>
            {formError ? <p className="text-xs text-destructive sm:col-span-4">{formError}</p> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

type PriceMode = "multiplier" | "fixed";

function PricingRulesCard({ court }: { court: CourtRow }) {
  const [rules, setRules] = useState<PricingRuleRow[] | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [dowStart, setDowStart] = useState("5");
  const [dowEnd, setDowEnd] = useState("6");
  const [timeStart, setTimeStart] = useState("18:00");
  const [timeEnd, setTimeEnd] = useState("22:00");
  const [mode, setMode] = useState<PriceMode>("multiplier");
  const [value, setValue] = useState("1.5");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("court_pricing_rules")
      .select("*")
      .eq("court_id", court.id)
      .order("created_at", { ascending: true });
    if (queryError) {
      setError(queryError.message);
      setStatus("error");
      return;
    }
    setRules(data ?? []);
    setStatus("ready");
  }, [court.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function addRule(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("court_pricing_rules").insert({
      court_id: court.id,
      day_of_week_start: Number(dowStart),
      day_of_week_end: Number(dowEnd),
      time_start: timeStart,
      time_end: timeEnd,
      multiplier: mode === "multiplier" ? Number(value) : null,
      fixed_price: mode === "fixed" ? Number(value) : null,
    });
    setSubmitting(false);
    if (insertError) {
      setFormError(
        insertError.code === "23P01"
          ? "This overlaps an existing peak pricing rule on this court. Adjust the days or time range."
          : insertError.message,
      );
      return;
    }
    load();
  }

  async function toggleActive(rule: PricingRuleRow) {
    const supabase = createClient();
    await supabase.from("court_pricing_rules").update({ active: !rule.active }).eq("id", rule.id);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Peak pricing rules</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status === "loading" ? <Skeleton className="h-24 w-full" /> : null}
        {status === "error" ? <ErrorState description={error ?? "Failed to load."} onRetry={load} /> : null}
        {status === "ready" ? (
          <>
            {(rules ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No peak pricing rules. Every slot bills at the base price.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {(rules ?? []).map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-foreground">
                        {dayOfWeekLabel(r.day_of_week_start, true)} to {dayOfWeekLabel(r.day_of_week_end, true)}
                      </span>{" "}
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {r.time_start.slice(0, 5)} to {r.time_end.slice(0, 5)},{" "}
                        {r.fixed_price != null ? `₹${r.fixed_price} flat` : `${r.multiplier}x base`}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{r.active ? "Active" : "Inactive"}</span>
                      <Switch checked={r.active} onCheckedChange={() => toggleActive(r)} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={addRule} className="grid gap-2 sm:grid-cols-6">
              <Select value={dowStart} onChange={(e) => setDowStart(e.target.value)}>
                {DOW_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {dayOfWeekLabel(d, true)}
                  </option>
                ))}
              </Select>
              <Select value={dowEnd} onChange={(e) => setDowEnd(e.target.value)}>
                {DOW_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {dayOfWeekLabel(d, true)}
                  </option>
                ))}
              </Select>
              <Input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
              <Input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
              <Select value={mode} onChange={(e) => setMode(e.target.value as PriceMode)}>
                <option value="multiplier">Multiplier</option>
                <option value="fixed">Fixed price</option>
              </Select>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" strokeWidth={1.75} />}
                </Button>
              </div>
            </form>
            {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
