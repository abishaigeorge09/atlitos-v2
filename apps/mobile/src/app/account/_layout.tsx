import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the account route group (PRD-07 section 3: shop screens live
 * under the shop group, the wishlist and address book under account). Each
 * screen renders its own AppBar back header, so no native header stacks on
 * top of it, matching every other nested stack in this app.
 */
export default function AccountLayout() {
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
