import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * F2 (P5 fix pass, LAUNCH-PHASE-5-STATUS.md P5-22, P5-ANDROID-FINDINGS.md
 * finding A-2). Android hardware BACK did nothing against `LoginGateModal`
 * and, by the same code shape, every other Portal-rendered overlay
 * (`GroupMembersSheet`, `ModerationSheet`): none of them are a native RN
 * `Modal`, deliberately (see `LoginGateModal.tsx`'s docblock, a verified a11y
 * and navigation-ordering fix), and native `Modal` is the only component that
 * gets BACK-closes-it behavior for free via `onRequestClose`. Nothing in the
 * codebase intercepted the key event for the Portal pattern
 * (`grep -rln BackHandler apps/mobile/src` returned nothing before this fix).
 *
 * One shared hook rather than one-off `BackHandler` wiring per sheet, so the
 * next Portal-based overlay gets this for free by calling it. Call
 * unconditionally from the sheet component (hooks rule); it is a no-op
 * whenever `visible` is false. `BackHandler` itself is a no-op API on iOS
 * (there is no hardware back key), so this is safe to call on every platform
 * without a `Platform.OS` guard.
 */
export function usePortalBackDismiss(visible: boolean, onClose: () => void) {
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      // Absorb the press: the overlay closes instead of the screen
      // underneath navigating, or the app exiting.
      return true;
    });
    return () => subscription.remove();
  }, [visible, onClose]);
}
