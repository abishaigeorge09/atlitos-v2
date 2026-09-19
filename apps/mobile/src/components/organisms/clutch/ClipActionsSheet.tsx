import { duration, radii, spacing } from '@atlitos/theme';
import { Portal } from '@rn-primitives/portal';
import { MessageCircle, MessageCircleOff, Trash2, X } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { usePortalBackDismiss } from '@/hooks/use-portal-back-dismiss';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

export interface ClipActionsSheetProps {
  visible: boolean;
  /** Current state of the clip's comment thread, so the row reads as the
   * action it performs rather than as a state label. */
  commentsEnabled: boolean;
  busy?: boolean;
  /** B2. A failed toggle (FORBIDDEN, or a network failure, both silent
   * before this fix: profile.tsx caught the error but ClutchProfileView only
   * renders `state === 'error'`, which this per action failure never set, so
   * the button just looked dead). Rendered inline rather than closing the
   * sheet, so the owner sees why nothing happened and can retry. No hyphens,
   * no em dashes in the copy, per the house style. */
  errorMessage?: string | null;
  onToggleComments: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Per clip owner menu, for both the own profile grid and the full screen
 * clip viewer (founder decision 2026-08-13: delete your own clip, plus
 * comments off per clip, NOT a full audience model). Before this the own
 * profile grid had no per clip affordance of any kind, so neither control
 * had anywhere to live.
 *
 * Same in-tree Portal + absolute scrim + slide up pattern as
 * `GroupMembersSheet`/`ModerationSheet`, deliberately NOT a native RN
 * `Modal`, plus the same `usePortalBackDismiss` wiring so Android hardware
 * BACK closes it.
 *
 * Delete is styled with the danger token and does NOT act here: it hands back
 * to the caller, which raises a confirm before anything is destroyed.
 */
export function ClipActionsSheet({
  visible,
  commentsEnabled,
  busy = false,
  errorMessage,
  onToggleComments,
  onDelete,
  onClose,
}: ClipActionsSheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  usePortalBackDismiss(visible, onClose);

  if (!visible) return null;

  return (
    <Portal name="clip-actions-sheet">
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'box-none' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={busy ? undefined : onClose}
        />
        <SlideUp>
          <View
            accessibilityViewIsModal
            style={{
              borderTopLeftRadius: radii['2xl'],
              borderTopRightRadius: radii['2xl'],
              backgroundColor: colors.surface,
              paddingTop: spacing.lg,
              paddingHorizontal: spacing.lg,
              // Extend the surface through the bottom safe area (BUG-008) so
              // the last row clears the home indicator on every device.
              paddingBottom: spacing.lg + insets.bottom,
              gap: spacing.xs,
            }}
          >
            <View className="flex-row items-center justify-between">
              <Text style={[textStyle('h3'), { color: colors.text }]}>Clip options</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                onPress={onClose}
                className="h-11 w-11 items-center justify-center"
              >
                <X size={22} color={colors.textSecondary} strokeWidth={1.75} />
              </Pressable>
            </View>

            <ActionRow
              label={commentsEnabled ? 'Turn off comments' : 'Turn on comments'}
              hint={
                commentsEnabled
                  ? 'Stops new comments. Existing ones stay.'
                  : 'Lets people comment on this clip again.'
              }
              icon={commentsEnabled ? MessageCircleOff : MessageCircle}
              color={colors.text}
              disabled={busy}
              onPress={onToggleComments}
            />

            <ActionRow
              label="Delete clip"
              hint="Removes it from your profile and the feed."
              icon={Trash2}
              color={colors.danger}
              disabled={busy}
              onPress={onDelete}
            />

            {errorMessage ? (
              <Text style={[textStyle('caption'), { color: colors.danger, paddingTop: spacing.xs }]}>
                {errorMessage}
              </Text>
            ) : null}
          </View>
        </SlideUp>
      </View>
    </Portal>
  );
}

function ActionRow({
  label,
  hint,
  icon: Icon,
  color,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  icon: typeof Trash2;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 56,
        paddingVertical: spacing.sm,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={22} strokeWidth={1.75} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[textStyle('label'), { color }]}>{label}</Text>
        <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{hint}</Text>
      </View>
    </Pressable>
  );
}

function SlideUp({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    Animated.timing(translateY, { toValue: 0, duration: duration.base, useNativeDriver: true }).start();
  }, [translateY]);

  return (
    <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}
