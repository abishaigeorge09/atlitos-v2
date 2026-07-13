import type { Sport } from '@atlitos/types';
import { create } from 'zustand';

/**
 * In-memory answers for the player and coach setup wizards. `[step].tsx`
 * routes are real, back-able, deep-linkable screens (one per wizard step,
 * per this task's routing spec), so each step's answers cannot live in a
 * single screen component's local state, they would reset on every
 * step-to-step navigation. This store is the shared draft both wizards
 * write to and read from as the user moves between steps; it is cleared on
 * successful submit (or when the user backs all the way out to role select).
 */

export interface PlayerDraft {
  sports: Sport[];
  avatarUrl: string | null;
  city: string;
  state: string;
}

export interface CertificateDraft {
  name: string;
  localUri: string | null;
  storagePath: string | null;
  uploadError: string | null;
}

export interface SessionTypeDraft {
  name: string;
  durationMinutes: string;
  price: string;
}

export interface AvailabilityWindowDraft {
  dayOfWeek: number; // 0-6, Sunday first
  from: string; // "HH:MM"
  to: string; // "HH:MM"
}

export interface CoachDraft {
  sport: Sport | null;
  avatarUrl: string | null;
  experienceYears: string;
  coachingStyle: string;
  certificates: CertificateDraft[];
  sessionTypes: SessionTypeDraft[];
  availabilityWindows: AvailabilityWindowDraft[];
  city: string;
  state: string;
  bio: string;
}

const emptyPlayerDraft: PlayerDraft = { sports: [], avatarUrl: null, city: '', state: '' };

const emptyCoachDraft: CoachDraft = {
  sport: null,
  avatarUrl: null,
  experienceYears: '',
  coachingStyle: '',
  certificates: [],
  sessionTypes: [],
  availabilityWindows: [],
  city: '',
  state: '',
  bio: '',
};

interface OnboardingDraftState {
  player: PlayerDraft;
  setPlayer: (patch: Partial<PlayerDraft>) => void;
  resetPlayer: () => void;

  coach: CoachDraft;
  setCoach: (patch: Partial<CoachDraft>) => void;
  resetCoach: () => void;
}

export const useOnboardingDraft = create<OnboardingDraftState>((set) => ({
  player: emptyPlayerDraft,
  setPlayer: (patch) => set((state) => ({ player: { ...state.player, ...patch } })),
  resetPlayer: () => set({ player: emptyPlayerDraft }),

  coach: emptyCoachDraft,
  setCoach: (patch) => set((state) => ({ coach: { ...state.coach, ...patch } })),
  resetCoach: () => set({ coach: emptyCoachDraft }),
}));
