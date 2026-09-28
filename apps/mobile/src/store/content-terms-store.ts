import { create } from 'zustand';

import { useSessionStore } from '@/store/session-store';

/**
 * 0138, launch runbook 3.3. Before a person's first clip upload, comment or
 * chat message, they agree once to the content rules (zero tolerance for
 * objectionable content or abusive users). The server refuses the insert with
 * CONTENT_TERMS_REQUIRED until they have, so this gate is the friendly path,
 * not the enforcement.
 *
 * `ensureContentTerms()` resolves true at once when the signed in user has
 * already agreed, otherwise it opens the sheet (ContentTermsGate, mounted once
 * in the root layout) and resolves with the person's answer.
 */
interface ContentTermsState {
  visible: boolean;
  resolver: ((agreed: boolean) => void) | null;
  open: () => Promise<boolean>;
  settle: (agreed: boolean) => void;
}

export const useContentTermsStore = create<ContentTermsState>((set, get) => ({
  visible: false,
  resolver: null,
  open: () =>
    new Promise<boolean>((resolve) => {
      // A second request while the sheet is up shares the first answer.
      const previous = get().resolver;
      set({
        visible: true,
        resolver: (agreed) => {
          previous?.(agreed);
          resolve(agreed);
        },
      });
    }),
  settle: (agreed) => {
    const resolver = get().resolver;
    set({ visible: false, resolver: null });
    resolver?.(agreed);
  },
}));

export function ensureContentTerms(): Promise<boolean> {
  const me = useSessionStore.getState().me;
  if (me?.contentTermsAcceptedAt) return Promise.resolve(true);
  return useContentTermsStore.getState().open();
}

/** True for the ApiError the server raises when the gate was skipped (a stale
 * profile, or a second device). Callers reopen the sheet on it. */
export function isContentTermsRequired(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'CONTENT_TERMS_REQUIRED';
}
