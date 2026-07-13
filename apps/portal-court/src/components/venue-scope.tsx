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
 * Loads every venue the signed-in partner owns (RLS `venues_select_own`,
 * 0009_courts.sql) once, and holds "which venue is the dashboard currently
 * scoped to" as shared client state. Every /dashboard/* page below the
 * layout reads this instead of re-fetching venues itself, and PRD-03's
 * venue switcher (out of this pass's UI scope, single-venue is the realistic
 * P2 demo scenario per PRD-03's open question 6) can be added on top of this
 * same context later without touching the pages.
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
    const { data, error: queryError } = await supabase
      .from("venues")
      .select("*")
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
