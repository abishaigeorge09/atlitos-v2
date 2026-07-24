import { duration, spacing } from '@atlitos/theme';
import { Portal } from '@rn-primitives/portal';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { LoginGateSheet } from '@/components/organisms/LoginGateSheet';
import { useThemeColors } from '@/theme/use-theme-colors';

export interface LoginGateModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Presentation wrapper around `LoginGateSheet` (SPEC.md organism #37):
 * a bottom sheet overlay so any screen can gate a guest's mutating tap
 * (PRD-01 FR-3) without hand rolling its own overlay. `onLogin` and
 * `onRegister` both close the sheet and hand off to the real auth screens;
 * PRD-01 FR-4 (returning the guest to their in-progress screen after auth)
 * is satisfied for free here because the gated screen underneath never
 * unmounts, expo-router just stacks login/register on top of it.
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
 */
export function LoginGateModal({ visible, onClose }: LoginGateModalProps) {
  const colors = useThemeColors();

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
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={onClose}
        />
        <SlideUp>
          <View style={{ paddingBottom: spacing['2xl'] }}>
            <LoginGateSheet onLogin={handleLogin} onRegister={handleRegister} onClose={onClose} />
          </View>
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
