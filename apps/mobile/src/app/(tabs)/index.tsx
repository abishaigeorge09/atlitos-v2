import { useNotifications } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { router, useFocusEffect } from 'expo-router';
import { RefreshCw, WifiOff, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { BrandFooter } from '@/components/organisms/home/BrandFooter';
import { CategoriesRow } from '@/components/organisms/home/CategoriesRow';
import { ClutchPreviewCard } from '@/components/organisms/home/ClutchPreviewCard';
import { EmpowerRail } from '@/components/organisms/home/EmpowerRail';
import { FeaturedSportCard } from '@/components/organisms/home/FeaturedSportCard';
import { HomeHeader } from '@/components/organisms/home/HomeHeader';
import { LocationSheet } from '@/components/organisms/home/LocationSheet';
import { PromoCarousel } from '@/components/organisms/home/PromoCarousel';
import { RecentlyViewedRail } from '@/components/organisms/home/RecentlyViewedRail';
import { useNavBarInset } from '@/components/ui/bottom-nav';
import { Button } from '@/components/ui/button';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { usePendingAuthAction } from '@/hooks/use-pending-auth-action';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { DONATIONS_ENABLED } from '@/lib/feature-flags';

/**
 * Home tab. PRD-01 3.2 content on the Playo layout (founder, 2026-09-30):
 * greeting header with the city picker, then white cards on a grey canvas.
 * Order: SearchBar, promo carousel, Play by sport, featured sport card
 * with coach faces, recently viewed (falling back to Shop), Clutch in the
 * dark spotlight card, Donate to Empower rail, brand footer. Each section is its own small component under
 * `components/organisms/home/`, reading its own domain hook and hiding
 * itself quietly on an empty result or a read error, so a slow or missing
 * domain (Clutch, Empower, promo banners) never blocks the sections that
 * did load. One ScrollView, pull to refresh reloads every section via
 * `reloadKey`, matching the loading skeleton contract each section already
 * carries individually.
 */
export default function HomeScreen() {
  const colors = useThemeColors();
  const navInset = useNavBarInset();
  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);
  const requiresAuthGate = status !== 'signed_in';

  // NAV-01. The cart badge in the header. Refreshed on focus rather than once
  // on mount, so returning from Shop after adding something shows the new
  // count instead of a stale one. Guests have no cart, so it stays 0 and the
  // button opens the login gate.
  // RECONCILIATION 2026-09-14: a cart count badge for the app bar (origin/main
  // f1a5fa2) was NOT taken. It fetched the whole cart on every Home focus for
  // every signed in user, purely to draw a number. Revisit with a cached count.

  const [gateVisible, setGateVisible] = useState(false);
  // F8 (P5 fix pass, PRD-01 FR-4): the Notifications and Profile taps below
  // used to be dropped when the gate opened.
  const { requireAuth, clearPendingAction } = usePendingAuthAction(requiresAuthGate);
  const [hasUnread, setHasUnread] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Launch runbook 5.7. Which network backed rails loaded on the last pass.
  // When every one of them failed (offline, or the backend unreachable), Home
  // shows one retry card instead of a page of silently empty sections.
  const [railResults, setRailResults] = useState<Record<string, boolean>>({});
  const reportRail = useCallback((key: string, ok: boolean) => {
    setRailResults((previous) => (previous[key] === ok ? previous : { ...previous, [key]: ok }));
  }, []);
  const onPromoLoaded = useCallback((ok: boolean) => reportRail('promo', ok), [reportRail]);
  const onClutchLoaded = useCallback((ok: boolean) => reportRail('clutch', ok), [reportRail]);
  const railKeys = Object.keys(railResults);
  const everyRailFailed = railKeys.length >= 2 && railKeys.every((key) => railResults[key] === false);
  const [refreshing, setRefreshing] = useState(false);
  const [setupCardDismissed, setSetupCardDismissed] = useState(false);
  const [locationSheetVisible, setLocationSheetVisible] = useState(false);

  // BUG-056: without this Home showed "Location is off, showing Hyderabad"
  // on every launch, even with permission granted, until Courts ran the
  // location request. Never shows the OS dialog (see the store action).
  const resolveLocationIfAnswered = useLocationStore((state) => state.resolveIfAlreadyAnswered);
  const profileCity = me?.city ?? null;
  useEffect(() => {
    void resolveLocationIfAnswered(profileCity);
  }, [resolveLocationIfAnswered, profileCity]);

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


  function onRefresh() {
    setRefreshing(true);
    setRailResults({});
    setReloadKey((key) => key + 1);
    // Each section reloads itself off `reloadKey`; there is no single
    // "everything settled" promise across five independent domain reads, so
    // the spinner clears optimistically rather than waiting on all of them.
    setTimeout(() => setRefreshing(false), 600);
  }

  // Track D defect 2: after "Explore the app first", Home nudges (never
  // forces) finishing onboarding while the profile still has no city.
  const showFinishSetup = status === 'signed_in' && me != null && !me.city && !setupCardDismissed;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      {/* Playo layout (founder, 2026-09-30): greeting header with the city
          picker, then white cards on the grey canvas. */}
      <HomeHeader
        hasUnreadNotifications={hasUnread}
        onPressProfile={() =>
          // The profile lives on the You tab (FB-001), so the avatar switches
          // to that tab instead of pushing a duplicate /profile screen.
          requireAuth(() => router.push('/(tabs)/you'), openGate)
        }
        onPressLocation={() => setLocationSheetVisible(true)}
        onPressChat={() => requireAuth(() => router.push('/(tabs)/chat'), openGate)}
        onPressNotifications={() => requireAuth(() => router.push('/notifications'), openGate)}
        onPressBookings={() => requireAuth(() => router.push('/(tabs)/coaching/bookings'), openGate)}
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          gap: spacing.lg,
          paddingBottom: navInset + spacing.xl,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <SearchBar variant="ai" className="h-12 rounded-lg border-0 bg-card" onPress={() => router.push('/home/search')} />

        {showFinishSetup ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Pressable
              accessibilityRole="button"
              style={{ flex: 1, gap: spacing.xs }}
              onPress={() => router.push('/(onboarding)/role-select')}
            >
              <Text style={{ color: colors.text }}>Finish setting up</Text>
              <Text style={{ color: colors.textSecondary }}>
                Pick your role and city to unlock coaches, courts and Learn near you.
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss finish setup"
              // 16pt icon + 14 each side = the 44pt minimum (BUG-064).
              hitSlop={14}
              onPress={() => setSetupCardDismissed(true)}
            >
              <X size={16} color={colors.textTertiary} strokeWidth={1.75} />
            </Pressable>
          </View>
        ) : null}

        {everyRailFailed ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              alignItems: 'center',
              gap: spacing.sm,
              padding: spacing.lg,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <WifiOff size={28} color={colors.textSecondary} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Could not load Home</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              Check your connection and try again.
            </Text>
            <Button variant="secondary" onPress={onRefresh}>
              <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
              <Text style={{ color: colors.text }}>Try again</Text>
            </Button>
          </View>
        ) : null}

        <PromoCarousel reloadKey={reloadKey} onLoaded={onPromoLoaded} />

        <CategoriesRow />

        <FeaturedSportCard reloadKey={reloadKey} />

        <RecentlyViewedRail reloadKey={reloadKey} framed />

        <ClutchPreviewCard reloadKey={reloadKey} onLoaded={onClutchLoaded} framed />

        {DONATIONS_ENABLED ? <EmpowerRail reloadKey={reloadKey} /> : null}

        <BrandFooter />

        {/* Launch runbook 5.6: the duplicate Log out row that sat here is gone.
            Sign out lives in Settings, Account, which returns to guest
            browsing the same way. */}
      </ScrollView>

      <LocationSheet visible={locationSheetVisible} onClose={() => setLocationSheetVisible(false)} />

      <LoginGateModal
        visible={gateVisible}
        onClose={() => setGateVisible(false)}
        onDismiss={clearPendingAction}
      />
    </SafeAreaView>
  );
}
