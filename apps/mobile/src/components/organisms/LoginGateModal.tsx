import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Modal, Pressable, View } from 'react-native';

import { LoginGateSheet } from '@/components/organisms/LoginGateSheet';
import { useThemeColors } from '@/theme/use-theme-colors';

export interface LoginGateModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Presentation wrapper around `LoginGateSheet` (SPEC.md organism #37):
 * a bottom sheet backed by a native `Modal` so any screen can gate a guest's
 * mutating tap (PRD-01 FR-3) without hand rolling its own overlay. `onLogin`
 * and `onRegister` both close the sheet and hand off to the real auth
 * screens; PRD-01 FR-4 (returning the guest to their in-progress screen
 * after auth) is satisfied for free here because the gated screen underneath
 * never unmounts, expo-router just stacks login/register on top of it.
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        {/* Swallow the close-on-backdrop tap so it doesn't bubble to the
         * overlay Pressable above when the user taps the sheet itself. */}
        <Pressable onPress={(event) => event.stopPropagation()}>
          <View style={{ paddingBottom: spacing['2xl'] }}>
            <LoginGateSheet onLogin={handleLogin} onRegister={handleRegister} onClose={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
