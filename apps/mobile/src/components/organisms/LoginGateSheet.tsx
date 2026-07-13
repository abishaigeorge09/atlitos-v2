import { Button } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { spacing } from '@atlitos/theme';
import { X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

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

  return (
    <View
      style={{
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        backgroundColor: colors.surface,
        padding: spacing.xl,
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
        <Text style={[textStyle('h2'), { color: colors.text, textAlign: 'center' }]}>
          Want to hit the spotlight?
        </Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
          Sign in to book sessions, track progress and join the community.
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Button onPress={onLogin}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Login</Text>
        </Button>
        <Button variant="secondary" onPress={onRegister}>
          <Text style={[textStyle('label'), { color: colors.text }]}>Register</Text>
        </Button>
      </View>
    </View>
  );
}
