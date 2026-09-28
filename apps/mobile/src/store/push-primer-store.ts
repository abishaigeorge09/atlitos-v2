import { create } from 'zustand';

import { canOfferPushPrompt } from '@/lib/push';

/**
 * Launch runbook 3.6. The notification permission is asked for only once it
 * has an obvious reason: after the first coaching booking or group join, and
 * behind a one line explanation (PushPrimerGate, mounted in the root layout).
 * A "Not now" leaves the system prompt unused, so it can be offered again at
 * the next milestone.
 */
interface PushPrimerState {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

export const usePushPrimerStore = create<PushPrimerState>((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));

/** Call after a booking or group join is confirmed. Shows the primer only if
 * the system has never been asked on this device. */
export async function offerPushPrimer(): Promise<void> {
  if (await canOfferPushPrompt()) usePushPrimerStore.getState().show();
}
