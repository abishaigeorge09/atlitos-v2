"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { createClient } from "@/lib/supabase/client";
import type { Database as AppDatabase } from "@atlitos/types";

export type VenueRow = AppDatabase["public"]["Tables"]["venues"]["Row"];

type Status = "loading" | "empty" | "error" | "ready";

interface VenueScopeState {
  status: Status;
  venues: VenueRow[];
  selectedVenueId: string | null;
  selectedVenue: VenueRow | null;
  setSelectedVenueId: (id: string) => void;
  error: string | null;
  refresh: () => void;
}

const VenueScopeContext = createContext<VenueScopeState | null>(null);

/**
 * Loads every venue the signed-in partner owns or has an accepted staff
 * membership in, once, and holds "which venue is the dashboard currently
 * scoped to" as shared client state. Every /dashboard/* page below the
 * layout reads this instead of re-fetching venues itself.
 *
 * `venues` carries a `venues_select_public` RLS policy so consumer browse
 * can read every verified venue regardless of owner (PRD-03 intentionally
 * keeps verified venues publicly readable). That means a plain
 * `.from("venues").select("*")` here would return every other partner's
 * verified venues too, not just this partner's own. RLS still fails closed
 * on every other /dashboard/* table (court_bookings etc. require
 * `is_court_partner_or_staff`), but the picker itself has to filter
 * explicitly to `partner_user_id = auth.uid()` OR an accepted `venue_staff`
 * row, the same ownership condition `is_court_partner_or_staff` already
 * checks server side.
 */
export function VenueScopeProvider({ children }: { children: ReactNode }) {
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedVenueId, setSelectedVenueIdState] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not signed in.");
      setStatus("error");
      return;
    }

    const { data: staffRows, error: staffError } = await supabase
      .from("venue_staff")
      .select("venue_id")
      .eq("user_id", user.id)
      .not("accepted_at", "is", null);

    if (staffError) {
      setError(staffError.message);
      setStatus("error");
      return;
    }

    const staffVenueIds = (staffRows ?? []).map((r) => r.venue_id);
    const ownedOrStaffedFilter =
      staffVenueIds.length > 0
        ? `partner_user_id.eq.${user.id},id.in.(${staffVenueIds.join(",")})`
        : `partner_user_id.eq.${user.id}`;

    const { data, error: queryError } = await supabase
      .from("venues")
      .select("*")
      .or(ownedOrStaffedFilter)
      .order("created_at", { ascending: true });

    if (queryError) {
      setError(queryError.message);
      setStatus("error");
      return;
    }

    const rows = data ?? [];
    setVenues(rows);
    setSelectedVenueIdState((prev) => (prev && rows.some((v) => v.id === prev) ? prev : (rows[0]?.id ?? null)));
    setStatus(rows.length === 0 ? "empty" : "ready");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedVenue = venues.find((v) => v.id === selectedVenueId) ?? null;

  return (
    <VenueScopeContext.Provider
      value={{
        status,
        venues,
        selectedVenueId,
        selectedVenue,
        setSelectedVenueId: setSelectedVenueIdState,
        error,
        refresh: load,
      }}
    >
      {children}
    </VenueScopeContext.Provider>
  );
}

export function useVenueScope(): VenueScopeState {
  const ctx = useContext(VenueScopeContext);
  if (!ctx) {
    throw new Error("useVenueScope must be used within a VenueScopeProvider");
  }
  return ctx;
}
