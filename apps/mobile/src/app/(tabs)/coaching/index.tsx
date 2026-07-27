import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachBrowseList } from '@/components/organisms/coaching/CoachBrowseList';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Text } from '@/components/ui/text';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Coach discovery. PRD-01 FR-20/FR-21 (AT-52): the "Coaches" title and "My
 * sessions" shortcut render here; the sport chips, location line, and
 * CoachCard list are the shared CoachBrowseList organism (also embedded by
 * the Trainings module's Coaches tab, see
 * `(tabs)/trainings/(shell)/coaches.tsx`). Guest-open per FR-2, nothing
 * here mutates; the Book action gates on the profile screen instead,
 * matching Courts' own "gate lives on the detail screen" pattern.
 */
export default function CoachingIndexScreen() {
  const colors = useThemeColors();
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const [gateVisible, setGateVisible] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm }}>
        <View className="flex-row items-center justify-between">
          <Text style={[textStyle('h1'), { color: colors.text }]}>Coaches</Text>
          <Pressable
            accessibilityRole="button"
            className="min-h-11 flex-row items-center gap-xs rounded-pill px-md active:bg-surface-muted"
            onPress={() => {
              if (requiresAuthGate) {
                setGateVisible(true);
                return;
              }
              router.push('/(tabs)/coaching/bookings');
            }}
          >
            <CalendarClock size={18} strokeWidth={1.75} color={colors.accent} />
            <Text className="font-sans-semibold text-sm text-accent">My sessions</Text>
          </Pressable>
        </View>
      </View>

      <CoachBrowseList
        onOpenCoach={(coachId) => router.push({ pathname: '/(tabs)/coaching/coach/[id]', params: { id: coachId } })}
      />

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
