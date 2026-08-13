import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

/**
 * F8 (P5 fix pass, PRD-01 FR-4, LAUNCH-PHASE-5-STATUS.md P5-22). Every
 * `requireAuth`-shaped gate in this app followed the same pattern:
 * `if (requiresAuthGate) { open the LoginGateModal; return; }`, which
 * discarded the gated action outright. A guest tapped Like, the gate opened,
 * they logged in, and the like never applied, because nothing stored or
 * replayed what they were trying to do. `LoginGateModal`'s own docstring
 * used to claim FR-4 ("returning the guest to their in-progress screen after
 * auth") was "satisfied for free"; that was true for the SCREEN (it never
 * unmounts across the login round trip, login/register just stack on top
 * via `router.push`) and false for the ACTION, and the overclaim is why this
 * went unnoticed through review.
 *
 * One shared hook rather than one-off ref+effect wiring per screen, found at
 * 18 call sites across `apps/mobile/src` (`grep -rln "state.status !==
 * 'signed_in'"`). All of them gate a cheap, idempotent, non-money action
 * (like, save, follow, join, report/block, upload navigation): safe to
 * replay automatically once signed in. This hook must NEVER be reached for
 * a charge or a money-bearing state transition (CLAUDE.md's financial
 * invariant); those need to land the guest back on a re-confirmation step
 * instead of silently completing, which this hook does not attempt.
 *
 * Usage:
 * ```
 * const { requireAuth, clearPendingAction } = usePendingAuthAction(requiresAuthGate);
 * ...
 * requireAuth(() => doTheThing(), () => setGateVisible(true));
 * ...
 * <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} onDismiss={clearPendingAction} />
 * ```
 */
export function usePendingAuthAction(requiresAuthGate: boolean) {
  const pendingRef = useRef<(() => void) | null>(null);

  const requireAuth = useCallback(
    (action: () => void, openGate: () => void) => {
      if (requiresAuthGate) {
        pendingRef.current = action;
        openGate();
        return;
      }
      action();
    },
    [requiresAuthGate],
  );

  // Fires once per guest-to-signed-in transition. Guarded by the ref itself,
  // so it is a no-op on every other render, including initial mount and any
  // render where `requiresAuthGate` is already false.
  useEffect(() => {
    if (requiresAuthGate) return;
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    pending();
  }, [requiresAuthGate]);

  // An explicit dismiss (backdrop tap, X, hardware BACK) means the guest
  // chose not to continue; wire this to `LoginGateModal`'s `onDismiss` so
  // the queued action does not survive to fire against a later, unrelated
  // sign-in.
  const clearPendingAction = useCallback(() => {
    pendingRef.current = null;
  }, []);

  // Leaving this screen (a different bottom tab, backgrounding, or
  // navigating away) clears any queued action so it cannot fire later
  // against screen state the guest is no longer looking at.
  useFocusEffect(
    useCallback(() => {
      return () => {
        pendingRef.current = null;
      };
    }, []),
  );

  return { requireAuth, clearPendingAction };
}
