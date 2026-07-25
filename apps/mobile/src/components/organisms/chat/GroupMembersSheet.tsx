import type { ChatThreadMember } from '@atlitos/types';
import { duration, radii, spacing } from '@atlitos/theme';
import { Portal } from '@rn-primitives/portal';
import { X } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

export interface GroupMembersSheetProps {
  visible: boolean;
  groupName: string;
  members: ChatThreadMember[];
  loading: boolean;
  onClose: () => void;
}

/**
 * Group thread members sheet (COACH-TRAININGS-GAP.md screen 17): the seated
 * roster of a training group's chat thread, opened from the conversation
 * screen's AppBar. Same in-tree Portal + absolute scrim + slide up pattern
 * as `LoginGateModal`, not a native RN `Modal`, for the same verified a11y
 * and navigation-ordering reasons documented there.
 */
export function GroupMembersSheet({ visible, groupName, members, loading, onClose }: GroupMembersSheetProps) {
  const colors = useThemeColors();

  if (!visible) return null;

  return (
    <Portal name="group-members-sheet">
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={onClose}
        />
        <SlideUp>
          <View
            style={{
              borderTopLeftRadius: radii['2xl'],
              borderTopRightRadius: radii['2xl'],
              backgroundColor: colors.surface,
              padding: spacing.xl,
              paddingBottom: spacing['2xl'],
              gap: spacing.lg,
              maxHeight: '70%',
            }}
          >
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-semibold text-lg text-text">{groupName}</Text>
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

            {loading ? (
              <View style={{ gap: spacing.md }}>
                {[0, 1, 2].map((key) => (
                  <View key={key} className="flex-row items-center gap-md">
                    <Skeleton shape="circle" />
                    <Skeleton shape="line" width="50%" />
                  </View>
                ))}
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ gap: spacing.md }}>
                {members.map((member) => (
                  <View key={member.id} className="flex-row items-center gap-md">
                    <Avatar uri={member.avatarUrl} name={member.name} size={40} />
                    <Text className="text-base text-text">{member.name}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </SlideUp>
      </View>
    </Portal>
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
