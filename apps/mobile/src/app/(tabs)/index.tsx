import { spacing, radii } from '@atlitos/theme';
import { router } from 'expo-router';
import { Heart, LayoutGrid } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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

  const isGuest = status === 'guest';
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
        hasUnreadNotifications={false}
        avatarUri={me?.avatarUrl ?? undefined}
        onPressNotifications={() => {
          if (isGuest) openGate();
        }}
        onPressProfile={() => {
          if (isGuest) openGate();
        }}
      />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing['4xl'] }}>
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
                Fund a verified athlete's gear or fees directly, once Empower ships.
              </Text>
              <Button variant="secondary" disabled={!isGuest} onPress={openGate}>
                <Text style={[textStyle('label'), { color: colors.text }]}>
                  {isGuest ? 'Donate' : 'Coming soon'}
                </Text>
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
