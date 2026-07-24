import { useNotifications } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { BrandFooter } from '@/components/organisms/home/BrandFooter';
import { CategoriesRow } from '@/components/organisms/home/CategoriesRow';
import { ClutchPreviewCard } from '@/components/organisms/home/ClutchPreviewCard';
import { EmpowerRail } from '@/components/organisms/home/EmpowerRail';
import { LocationRow } from '@/components/organisms/home/LocationRow';
import { PromoCarousel } from '@/components/organisms/home/PromoCarousel';
import { RecentlyViewedRail } from '@/components/organisms/home/RecentlyViewedRail';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home tab, rebuilt to PRD-01 3.2's approved mockup layout. Order:
 * AppBar + SearchBar + LocationRow, categories row, promo carousel,
 * recently viewed (falling back to Shop), Clutch preview, Donate to
 * Empower rail, brand footer. Each section is its own small component under
 * `components/organisms/home/`, reading its own domain hook and hiding
 * itself quietly on an empty result or a read error, so a slow or missing
 * domain (Clutch, Empower, promo banners) never blocks the sections that
 * did load. One ScrollView, pull to refresh reloads every section via
 * `reloadKey`, matching the loading skeleton contract each section already
 * carries individually.
 */
export default function HomeScreen() {
  const colors = useThemeColors();
  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);
  const isGuest = status === 'guest';

  const signOut = useSessionStore((state) => state.signOut);
  const continueAsGuest = useSessionStore((state) => state.continueAsGuest);

  const [gateVisible, setGateVisible] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const notifications = useNotifications(supabase);

  // Refresh the bell badge whenever Home regains focus (returning from the
  // notifications screen where the user may have marked things read).
  // Owner-scoped count in useNotifications; fails silent so the badge never
  // blocks Home.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'signed_in') {
        setHasUnread(false);
        return;
      }
      let active = true;
      notifications
        .unreadCount()
        .then((count) => {
          if (active) setHasUnread(count > 0);
        })
        .catch(() => {
          if (active) setHasUnread(false);
        });
      return () => {
        active = false;
      };
    }, [status]),
  );

  function openGate() {
    setGateVisible(true);
  }

  async function handleLogout() {
    // FR-65: logout clears the session and returns the app to guest mode at
    // Home, not to the login screen. The mockup's own layout has no sign out
    // affordance and nothing elsewhere in the app exposes one yet, so this
    // stays as a quiet text row at the very end of the scroll rather than
    // being dropped along with the rest of the old placeholder layout.
    setLoggingOut(true);
    try {
      await signOut();
      await continueAsGuest();
    } finally {
      setLoggingOut(false);
    }
  }

  function onRefresh() {
    setRefreshing(true);
    setReloadKey((key) => key + 1);
    // Each section reloads itself off `reloadKey`; there is no single
    // "everything settled" promise across five independent domain reads, so
    // the spinner clears optimistically rather than waiting on all of them.
    setTimeout(() => setRefreshing(false), 600);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar
        variant="brand"
        hasUnreadNotifications={hasUnread}
        avatarUri={me?.avatarUrl ?? undefined}
        onPressNotifications={() => {
          if (isGuest) {
            openGate();
            return;
          }
          router.push('/notifications');
        }}
        onPressProfile={() => {
          if (isGuest) {
            openGate();
            return;
          }
          router.push('/profile');
        }}
      />

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing['4xl'] }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <View style={{ gap: spacing.sm }}>
          <SearchBar variant="ai" onPress={() => router.push('/home/search')} />
          <LocationRow />
        </View>

        <CategoriesRow />

        <PromoCarousel reloadKey={reloadKey} />

        <RecentlyViewedRail reloadKey={reloadKey} />

        <ClutchPreviewCard reloadKey={reloadKey} />

        <EmpowerRail reloadKey={reloadKey} />

        <BrandFooter />

        {status === 'signed_in' ? (
          <Button variant="text" loading={loggingOut} onPress={() => void handleLogout()}>
            <Text style={{ color: colors.textSecondary }}>Log out</Text>
          </Button>
        ) : null}
      </ScrollView>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
