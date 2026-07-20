import { radii, spacing } from '@atlitos/theme';
import type { LucideIcon } from 'lucide-react-native';
import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * AT-84. The one confirm-then-act dialog commerce uses, for removing a cart
 * line (PRD-07 FR-10) and deleting a saved address (FR-30).
 *
 * It exists because `Alert.alert` does not. AT-64 established that
 * `Alert.alert` is inert under react-native-web, so the ten existing confirm
 * dialogs in this app are silent no-ops on web and unverified natively, which
 * means that path is currently unproven on BOTH targets. Commerce introduces
 * two more destructive confirmations and neither may inherit that.
 *
 * This is built on React Native's `Modal`, which react-native-web genuinely
 * implements (it is what `LoginGateModal` already ships on both targets), so
 * the confirm actually blocks and the confirm handler actually fires in a
 * browser. No `Platform.OS` branch, no `.native.ts` sibling, one code path.
 *
 * AT-84's scope is strictly the two commerce call sites. This does not close
 * AT-64, which still owns the ten existing ones; it stops the count growing
 * and gives AT-64 a component to migrate onto.
 *
 * Every value routes through `@atlitos/theme`, icons are lucide only, and the
 * copy props carry no emoji, no hyphens and no em dashes, per the house style.
 */
export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  /** Optional lucide icon reference, never an emoji. */
  icon?: LucideIcon;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive styling for a remove or delete. Non destructive confirms use
   * the primary accent fill instead. */
  destructive?: boolean;
  /** Keeps the confirm button in its spinner state while the action runs, so
   * a slow delete cannot be double fired. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSheet({
  visible,
  title,
  body,
  icon: Icon,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const colors = useThemeColors();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <Pressable
        accessibilityLabel={cancelLabel}
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
        onPress={loading ? undefined : onCancel}
      >
        {/* Swallow taps on the sheet itself so they do not bubble to the
         * backdrop and dismiss it, the same guard LoginGateModal uses. */}
        <Pressable onPress={(event) => event.stopPropagation()}>
          <View
            accessibilityViewIsModal
            style={{
              borderTopLeftRadius: radii['2xl'],
              borderTopRightRadius: radii['2xl'],
              backgroundColor: colors.surface,
              padding: spacing.xl,
              paddingBottom: spacing['3xl'],
              gap: spacing.lg,
            }}
          >
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              {Icon ? (
                <View
                  style={{
                    height: 56,
                    width: 56,
                    borderRadius: radii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: destructive ? colors.dangerTint : colors.accentTint,
                  }}
                >
                  <Icon size={24} strokeWidth={1.75} color={destructive ? colors.danger : colors.accent} />
                </View>
              ) : null}
              <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>{title}</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                {body}
              </Text>
            </View>

            <View style={{ gap: spacing.sm }}>
              <Button variant={destructive ? 'destructive' : 'primary'} loading={loading} onPress={onConfirm}>
                <Text
                  style={[
                    textStyle('label'),
                    { color: destructive ? colors.textInverse : colors.inkOnAccent },
                  ]}
                >
                  {confirmLabel}
                </Text>
              </Button>
              <Button variant="secondary" disabled={loading} onPress={onCancel}>
                <Text style={[textStyle('label'), { color: colors.text }]}>{cancelLabel}</Text>
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default ConfirmSheet;
