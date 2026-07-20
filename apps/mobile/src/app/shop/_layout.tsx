import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the shop route group (PRD-07 section 3: "all screens live in the
 * consumer Expo app under the shop and account route groups"). Every screen
 * here renders its own in-screen back header via AppBar, matching the
 * `(auth)`/`(onboarding)`/`courts` stacks, so nothing gets a second native
 * header stacked on top of that.
 */
export default function ShopLayout() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
