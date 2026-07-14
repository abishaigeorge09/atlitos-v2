"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SPORTS } from "@atlitos/types";

import {
  emptyDraftCourt,
  emptyDraftDetails,
  type DraftCourt,
  type DraftVenueDetails,
} from "@/lib/onboarding";

const STORAGE_KEY = "atlitos.portal-court.onboarding-draft.v1";

interface StoredDraft {
  details: DraftVenueDetails;
  courts: DraftCourt[];
  venueId: string | null;
}

interface OnboardingDraftState {
  details: DraftVenueDetails;
  setDetails: (details: DraftVenueDetails) => void;
  courts: DraftCourt[];
  setCourts: (courts: DraftCourt[]) => void;
  /** Set once `submit_venue_verification` has run (FR-5), so the Photos and
   * Review steps know which venue id to attach uploads/summaries to without
   * re-fetching on every keystroke. */
  venueId: string | null;
  setVenueId: (id: string) => void;
  /** Clears local draft state only; never touches the database. Called after
   * a wizard run completes (venue created) or when starting a fresh
   * edit-and-resubmit pass (FR-6) with newly prefilled values. */
  reset: (next?: Partial<StoredDraft>) => void;
}

const OnboardingDraftContext = createContext<OnboardingDraftState | null>(null);

function readStored(): StoredDraft {
  if (typeof window === "undefined") {
    return { details: emptyDraftDetails(), courts: [emptyDraftCourt(SPORTS[0])], venueId: null };
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed.courts?.length) parsed.courts = [emptyDraftCourt(SPORTS[0])];
    return parsed;
  } catch {
    return { details: emptyDraftDetails(), courts: [emptyDraftCourt(SPORTS[0])], venueId: null };
  }
}

/**
 * Holds the onboarding wizard's in-progress venue details and courts across
 * `/onboarding/venue-details` -> `/onboarding/courts` -> `/onboarding/photos`
 * navigations (each a separate route/page, so plain component state would
 * not survive the navigation). Backed by `sessionStorage` purely so a
 * refresh mid-wizard does not lose typed input; nothing here is a database
 * write, that only happens via `submitVenueVerification` at the end of the
 * Courts step.
 */
export function OnboardingDraftProvider({ children }: { children: ReactNode }) {
  const [details, setDetailsState] = useState<DraftVenueDetails>(() => readStored().details);
  const [courts, setCourtsState] = useState<DraftCourt[]>(() => readStored().courts);
  const [venueId, setVenueIdState] = useState<string | null>(() => readStored().venueId);

  const persist = useCallback((next: StoredDraft) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  useEffect(() => {
    persist({ details, courts, venueId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, courts, venueId]);

  const setDetails = useCallback((next: DraftVenueDetails) => setDetailsState(next), []);
  const setCourts = useCallback((next: DraftCourt[]) => setCourtsState(next), []);
  const setVenueId = useCallback((id: string) => setVenueIdState(id), []);

  const reset = useCallback((next?: Partial<StoredDraft>) => {
    const fresh: StoredDraft = {
      details: next?.details ?? emptyDraftDetails(),
      courts: next?.courts ?? [emptyDraftCourt(SPORTS[0])],
      venueId: next?.venueId ?? null,
    };
    setDetailsState(fresh.details);
    setCourtsState(fresh.courts);
    setVenueIdState(fresh.venueId);
    persist(fresh);
  }, [persist]);

  const value = useMemo<OnboardingDraftState>(
    () => ({ details, setDetails, courts, setCourts, venueId, setVenueId, reset }),
    [details, setDetails, courts, setCourts, venueId, setVenueId, reset],
  );

  return <OnboardingDraftContext.Provider value={value}>{children}</OnboardingDraftContext.Provider>;
}

export function useOnboardingDraft(): OnboardingDraftState {
  const ctx = useContext(OnboardingDraftContext);
  if (!ctx) throw new Error("useOnboardingDraft must be used within an OnboardingDraftProvider");
  return ctx;
}
