import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronRight, ClipboardList, Dumbbell } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { setOnboardingDeferred } from '@/lib/onboarding-deferred';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

interface RoleOption {
  icon: LucideIcon;
  title: string;
  body: string;
  href: '/(onboarding)/player-setup/0' | '/(onboarding)/coach-setup/0';
}

const ROLES: RoleOption[] = [
  {
    icon: Dumbbell,
    title: 'I am a player',
    body: 'Book coaches and courts, buy gear, and track your progress.',
    href: '/(onboarding)/player-setup/0',
  },
  {
    icon: ClipboardList,
    title: 'I am a coach',
    body: 'List your sessions and pricing, and get discovered by players.',
    href: '/(onboarding)/coach-setup/0',
  },
];

/**
 * Role select. PRD-01 3.1 "Player or Coach. This PRD only continues the
 * Player branch"; coach-setup is PRD-02's wizard, this screen is the shared
 * fork point for both.
 */
export default function RoleSelectScreen() {
  const colors = useThemeColors();

  function handleSelect(href: RoleOption['href']) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Haptics unavailable, not fatal.
    });
    router.push(href);
  }

  function handleExploreFirst() {
    // Track D defect 2: onboarding must not trap. Remember the choice so
    // splash stops forcing this screen on later launches; Home's
    // finish-setup card stays as the nudge until a city is set.
    void setOnboardingDeferred();
    router.replace('/(tabs)');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, padding: spacing.lg, gap: spacing.xl, justifyContent: 'center' }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[textStyle('h1'), { color: colors.text }]}>How will you use Atlitos.</Text>
          <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
            You can add the other role later from your account.
          </Text>
        </View>

        <View style={{ gap: spacing.md }}>
          {ROLES.map((role) => {
            const Icon = role.icon;
            return (
              <Pressable
                key={role.title}
                accessibilityRole="button"
                onPress={() => handleSelect(role.href)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  padding: spacing.lg,
                  borderRadius: radii.xl,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                }}
              >
                <View
                  style={{
                    height: 48,
                    width: 48,
                    borderRadius: radii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.accentTint,
                  }}
                >
                  <Icon size={24} color={colors.accent} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={[textStyle('h3'), { color: colors.text }]}>{role.title}</Text>
                  <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{role.body}</Text>
                </View>
                <ChevronRight size={20} color={colors.textTertiary} strokeWidth={1.75} />
              </Pressable>
            );
          })}
        </View>

        <Button variant="text" onPress={handleExploreFirst}>
          <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Explore the app first</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
