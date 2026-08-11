import { duration } from '@atlitos/theme';
import { Portal } from '@rn-primitives/portal';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { LoginGateSheet } from '@/components/organisms/LoginGateSheet';
import { usePortalBackDismiss } from '@/hooks/use-portal-back-dismiss';
import { useThemeColors } from '@/theme/use-theme-colors';

export interface LoginGateModalProps {
  visible: boolean;
  onClose: () => void;
  /** F8 (P5 fix pass): fires ONLY for an explicit dismiss, backdrop tap, the
   * sheet's own Close control, or hardware BACK, never for Log in/Register
   * (those are the guest proceeding to auth, not backing out). `onClose`
   * fires in every case (dismiss and proceed) purely to hide the sheet, same
   * as before this prop existed. A caller that queues a gated action while
   * the gate is up (see clutch/index.tsx's `requireAuth`) needs this signal
   * to clear that queued action on a genuine dismiss, without which it would
   * survive to fire against a later, unrelated sign-in. Optional and
   * additive; every other call site of this component is unaffected. */
  onDismiss?: () => void;
}

/**
 * Presentation wrapper around `LoginGateSheet` (SPEC.md organism #37):
 * a bottom sheet overlay so any screen can gate a guest's mutating tap
 * (PRD-01 FR-3) without hand rolling its own overlay. `onLogin` and
 * `onRegister` both close the sheet and hand off to the real auth screens.
 *
 * PRD-01 FR-4 CORRECTION (F8, P5 fix pass): this component only satisfies
 * the SCREEN half of "returning the guest to their in-progress screen after
 * auth" for free (the gated screen underneath never unmounts, expo-router
 * just stacks login/register on top of it, and `router.back()` after auth
 * reveals it again). It does NOT satisfy the ACTION half. This component has
 * no memory of what the guest was trying to do; that is the caller's job.
 * `clutch/index.tsx`'s `requireAuth` is the reference implementation: a
 * guest tapped Like, the gate opened, they logged in, and the like never
 * applied, because nothing stored or replayed the tapped action. A previous
 * version of this docstring claimed FR-4 was "satisfied for free" here
 * without that caveat, which is exactly how the bug went unnoticed through
 * review: the claim was true for the screen and false for the action, and
 * nobody reading it caught the difference. If your caller queues an action
 * behind this gate, use `onDismiss` (below) to clear it on an explicit
 * dismiss, and never auto-replay a queued action that would complete a
 * charge or a money-bearing state transition without the guest
 * re-confirming (CLAUDE.md's financial invariant); land them back on the
 * confirmation step instead.
 *
 * Deliberately NOT a native RN `Modal`, for two verified-on-device reasons
 * (Maestro suite findings, .maestro/README.md):
 *
 * 1. Accessibility containment. Content hosted inside a native `Modal`'s
 *    window never made it into the iOS accessibility tree here; VoiceOver
 *    (and Maestro) saw only the "Close" control, not the heading or the
 *    Login/Register buttons, even with explicit accessibilityLabel props.
 * 2. Navigation ordering. `router.push` fired while the native modal window
 *    was still dismissing was swallowed on iOS, so Login closed the sheet
 *    but never reached the login screen, killing guest conversion.
 *
 * Instead the sheet renders in-tree through the root `PortalHost`
 * (`src/app/_layout.tsx` mounts it above the navigator), an absolute fill
 * scrim plus the same sheet visual. Same copy, same styling, and both
 * problems disappear because there is no second native window involved.
 * `ConfirmSheet` still ships on native `Modal` and carries the same a11y
 * containment risk; migrating it is a recorded follow up, not this change.
 *
 * F2 (P5 fix pass): the Portal pattern above gets none of native `Modal`'s
 * free hardware-BACK-closes-it behavior on Android, so `usePortalBackDismiss`
 * wires it explicitly.
 */
export function LoginGateModal({ visible, onClose, onDismiss }: LoginGateModalProps) {
  const colors = useThemeColors();

  function handleDismiss() {
    onDismiss?.();
    onClose();
  }

  usePortalBackDismiss(visible, handleDismiss);

  function handleLogin() {
    onClose();
    router.push('/(auth)/login');
  }

  function handleRegister() {
    onClose();
    router.push('/(auth)/register');
  }

  if (!visible) return null;

  return (
    <Portal name="login-gate">
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'box-none' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={handleDismiss}
        />
        <SlideUp>
          {/* The sheet surface owns its own bottom safe-area padding now
              (BUG-003); the old transparent paddingBottom wrapper here sat
              OUTSIDE the surface and read as dead space below the sheet. */}
          <LoginGateSheet onLogin={handleLogin} onRegister={handleRegister} onClose={handleDismiss} />
        </SlideUp>
      </View>
    </Portal>
  );
}

/** Entrance slide for the sheet, standing in for the native modal's
 * `animationType="slide"` so the conversion stays visually equivalent. */
function SlideUp({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    Animated.timing(translateY, { toValue: 0, duration: duration.base, useNativeDriver: true }).start();
  }, [translateY]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        transform: [{ translateY }],
      }}
    >
      {children}
    </Animated.View>
  );
}
