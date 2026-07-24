import { useNotifications, useShop, type ShopProduct } from '@atlitos/api';
import { spacing, radii } from '@atlitos/theme';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight, GraduationCap, Heart, LayoutGrid } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/ui/product-card';
import { SearchBar } from '@/components/ui/search-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home tab. PRD-01 3.2 locks the full Home layout (AppBar, SearchBar,
 * LocationBar, category chips, ad carousel, Clutch preview, empower rail,
 * Shop/Learn entries), but every one of those sections reads from a domain
 * (search, clutch, empower, commerce) that is still `TODO(PN)` in
 * packages/api/src/hooks.ts, owned by a later phase. This screen ships what
 * AT-3 owns honestly: a real AppBar wired to real session state, one real
 * guest gate on a mutating tap (FR-3), and the dev-only link to the
 * component showcase this task calls for. States: loading (profile still
 * resolving for a signed-in session), populated (guest or signed-in).
 */
export default function HomeScreen() {
  const colors = useThemeColors();
  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);
  const meLoading = useSessionStore((state) => state.meLoading);
  const signOut = useSessionStore((state) => state.signOut);
  const continueAsGuest = useSessionStore((state) => state.continueAsGuest);

  const [gateVisible, setGateVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  const notifications = useNotifications(supabase);
  const shop = useShop(supabase);
  const isGuest = status === 'guest';

  // Real Shop rail (PRD-01 3.2). Public browse, no owner scope and no login
  // gate: a guest sees gear here too. Failure leaves the rail hidden rather
  // than blocking Home. First page only, the rail links through to the full
  // catalog for the rest.
  const [shopProducts, setShopProducts] = useState<ShopProduct[]>([]);
  useEffect(() => {
    let active = true;
    shop
      .listProducts()
      .then((rows) => {
        if (active) setShopProducts(rows.slice(0, 8));
      })
      .catch(() => {
        if (active) setShopProducts([]);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const greetingName = me?.name?.trim().split(/\s+/)[0];
  const showLoading = status === 'signed_in' && meLoading && !me;

  function openGate() {
    setGateVisible(true);
  }

  async function handleLogout() {
    // FR-65: logout clears the session and returns the app to guest mode at
    // Home, not to the login screen.
    setLoggingOut(true);
    try {
      await signOut();
      await continueAsGuest();
    } finally {
      setLoggingOut(false);
    }
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

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing['4xl'] }}>
        <SearchBar variant="ai" onPress={() => router.push('/home/search')} />

        {showLoading ? (
          <View style={{ gap: spacing.sm }}>
            <Skeleton shape="line" width="60%" />
            <Skeleton shape="line" width="90%" />
            <Skeleton shape="card" />
          </View>
        ) : (
          <>
            <View style={{ gap: spacing.xs }}>
              <Text style={[textStyle('h1'), { color: colors.text }]}>
                {greetingName ? `Welcome back, ${greetingName}.` : 'Welcome to Atlitos.'}
              </Text>
              <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                {isGuest
                  ? 'Browsing as a guest. Log in to book, buy and post.'
                  : 'Coaches, courts, gear and clips roll out here over the next phases.'}
              </Text>
            </View>

            {shopProducts.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[textStyle('h3'), { color: colors.text }]}>Shop</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="See all gear"
                    onPress={() => router.push('/shop')}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
                  >
                    <Text style={[textStyle('label'), { color: colors.accent }]}>See all</Text>
                    <ChevronRight size={16} color={colors.accent} strokeWidth={1.75} />
                  </Pressable>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.md }}
                >
                  {shopProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      variant="row"
                      className="w-64"
                      imageUri={product.imageUrl}
                      title={product.title}
                      price={product.priceFrom}
                      onPress={() =>
                        router.push({ pathname: '/shop/product/[id]', params: { id: product.id } })
                      }
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View
              style={{
                gap: spacing.sm,
                padding: spacing.lg,
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Heart size={20} color={colors.accent} strokeWidth={1.75} />
                <Text style={[textStyle('h3'), { color: colors.text }]}>Support an athlete</Text>
              </View>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                Fund a verified athlete's gear or fees directly through Empower.
              </Text>
              <Button variant="secondary" onPress={() => router.push('/home/empower')}>
                <Text style={[textStyle('label'), { color: colors.text }]}>Explore Empower</Text>
              </Button>
            </View>

            <View
              style={{
                gap: spacing.sm,
                padding: spacing.lg,
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <GraduationCap size={20} color={colors.accent} strokeWidth={1.75} />
                <Text style={[textStyle('h3'), { color: colors.text }]}>Train and level up</Text>
              </View>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                Complete drills to earn XP, climb your roadmap and unlock milestones.
              </Text>
              <Button variant="secondary" onPress={() => router.push('/learn')}>
                <Text style={[textStyle('label'), { color: colors.text }]}>Open Learn</Text>
              </Button>
            </View>

            {__DEV__ ? (
              <Button variant="text" onPress={() => router.push('/dev')}>
                <LayoutGrid size={16} color={colors.accent} strokeWidth={1.75} />
                <Text style={[textStyle('label'), { color: colors.accent }]}>Component showcase</Text>
              </Button>
            ) : null}

            {status === 'signed_in' ? (
              <Button variant="text" loading={loggingOut} onPress={() => void handleLogout()}>
                <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Log out</Text>
              </Button>
            ) : null}
          </>
        )}
      </ScrollView>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
