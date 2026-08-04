import { pressScale, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowRight, ClipboardList, Dumbbell } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthReveal, AuthScene } from '@/components/organisms/auth/AuthScene';
import { Button } from '@/components/ui/button';
import { setOnboardingDeferred } from '@/lib/onboarding-deferred';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type RoleHref = '/(onboarding)/player-setup/0' | '/(onboarding)/coach-setup/0';

interface RoleOption {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  href: RoleHref;
}

const ROLES: RoleOption[] = [
  {
    icon: Dumbbell,
    eyebrow: 'Play and train',
    title: 'I am a player',
    body: 'Book coaches and courts, buy gear, and track your progress.',
    href: '/(onboarding)/player-setup/0',
  },
  {
    icon: ClipboardList,
    eyebrow: 'Coach and earn',
    title: 'I am a coach',
    body: 'List your sessions and pricing, and get discovered by players.',
    href: '/(onboarding)/coach-setup/0',
  },
];

function RoleCard({
  role,
  selected,
  onPress,
}: {
  role: RoleOption;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const Icon = role.icon;
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPressIn={() => {
        if (!reduced) scale.value = withTiming(pressScale, { duration: 120 });
      }}
      onPressOut={() => {
        if (!reduced) scale.value = withTiming(1, { duration: 160 });
      }}
      onPress={onPress}
      style={[
        {
          gap: spacing.md,
          padding: spacing.xl,
          borderRadius: radii['2xl'],
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.accent : colors.border,
          backgroundColor: selected ? colors.accentTint : colors.card,
        },
        animatedStyle,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            height: 56,
            width: 56,
            borderRadius: radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? colors.accent : colors.accentTint,
          }}
        >
          <Icon size={28} color={selected ? colors.inkOnAccent : colors.accent} strokeWidth={1.75} />
        </View>
        <ArrowRight size={22} color={selected ? colors.accent : colors.textTertiary} strokeWidth={2} />
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text style={[textStyle('overline'), { color: colors.accent }]}>{role.eyebrow}</Text>
        <Text style={[textStyle('h2'), { color: colors.text }]}>{role.title}</Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{role.body}</Text>
      </View>
    </AnimatedPressable>
  );
}

/**
 * Role select. PRD-01 3.1 "Player or Coach. This PRD only continues the
 * Player branch"; coach-setup is PRD-02's wizard, this screen is the shared
 * fork point for both.
 *
 * Visual: player vs coach as two big tactile cards over the shared AuthScene
 * aurora, each with a press scale and a selected accent state before it
 * routes into that branch. Routing and the deferred onboarding path are
 * unchanged.
 */
export default function RoleSelectScreen() {
  const colors = useThemeColors();
  const [selected, setSelected] = useState<RoleHref | null>(null);

  function handleSelect(href: RoleHref) {
    setSelected(href);
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
    <AuthScene>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.xl, justifyContent: 'center' }}>
          <AuthReveal index={0}>
            <View style={{ gap: spacing.xs }}>
              <Text style={[textStyle('overline'), { color: colors.accent }]}>Set up your Atlitos</Text>
              <Text style={[textStyle('h1'), { color: colors.text }]}>How will you use Atlitos.</Text>
              <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                You can add the other role later from your account.
              </Text>
            </View>
          </AuthReveal>

          <View style={{ gap: spacing.md }}>
            {ROLES.map((role, i) => (
              <AuthReveal key={role.title} index={i + 1}>
                <RoleCard role={role} selected={selected === role.href} onPress={() => handleSelect(role.href)} />
              </AuthReveal>
            ))}
          </View>

          <AuthReveal index={ROLES.length + 1}>
            <Button variant="text" onPress={handleExploreFirst}>
              <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Explore the app first</Text>
            </Button>
          </AuthReveal>
        </View>
      </SafeAreaView>
    </AuthScene>
  );
}
