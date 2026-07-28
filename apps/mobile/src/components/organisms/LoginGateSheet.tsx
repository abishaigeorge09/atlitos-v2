import { Button } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { radii, spacing } from '@atlitos/theme';
import { X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * SPEC.md organism #37. Guest gate sheet, verbatim copy per SPEC.md:
 * "Want to hit the spotlight?"
 */
export interface LoginGateSheetProps {
  onLogin: () => void;
  onRegister: () => void;
  onClose?: () => void;
}

export function LoginGateSheet({ onLogin, onRegister, onClose }: LoginGateSheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        borderTopLeftRadius: radii['2xl'],
        borderTopRightRadius: radii['2xl'],
        backgroundColor: colors.surface,
        padding: spacing.xl,
        // Extend the surface background through the bottom safe area (BUG-003)
        // so the Register button clears the home indicator instead of hitting
        // the device edge, and no dead space shows below the sheet.
        paddingBottom: spacing.xl + insets.bottom,
        gap: spacing.lg,
      }}
    >
      {onClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          onPress={onClose}
          style={{ alignSelf: 'flex-end', height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={24} color={colors.textSecondary} strokeWidth={1.75} />
        </Pressable>
      ) : null}

      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <Text
          accessible
          accessibilityLabel="Want to hit the spotlight?"
          style={[textStyle('h2'), { color: colors.text, textAlign: 'center' }]}
        >
          Want to hit the spotlight?
        </Text>
        <Text
          accessible
          accessibilityLabel="Sign in to book sessions, track progress and join the community."
          style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}
        >
          Sign in to book sessions, track progress and join the community.
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Button accessibilityLabel="Login" onPress={onLogin}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Login</Text>
        </Button>
        <Button accessibilityLabel="Register" variant="secondary" onPress={onRegister}>
          <Text style={[textStyle('label'), { color: colors.text }]}>Register</Text>
        </Button>
      </View>
    </View>
  );
}
