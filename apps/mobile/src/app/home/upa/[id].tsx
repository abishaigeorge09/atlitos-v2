import { useEmpower, toApiError, type UpaProfile } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { BadgeCheck, HeartHandshake, RefreshCw, SearchX, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { WishlistGrid, type WishlistItem } from '@/components/organisms/WishlistGrid';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'notfound' | 'error';

/**
 * UPA Public Profile, `/home/upa/[id]`. AT-120, PRD-06 FR-1/FR-4/FR-5/FR-16;
 * screen spec 3.2. The single read goes through `public_upa_profile`, which
 * returns null for any non verified id, so an unverified or deactivated UPA is
 * unresolvable by direct id regardless of how the id was obtained (the not
 * found state, FR-16). Total raised is ledger derived by the RPC; each item's
 * progress is its own funded_amount (the legitimate per item use). A funded
 * item disables Fund This and shows a Funded marker (FR-5); the general Donate
 * CTA stays active even when every item is funded (goes to the general fund).
 */
export default function UpaProfileScreen() {
  const colors = useThemeColors();
  const empower = useEmpower(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<UpaProfile | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const row = await empower.getUpaProfile(id);
      if (!row) {
        setState('notfound');
        return;
      }
      setProfile(row);
      setState('ready');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [empower, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Athlete" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={220} />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={160} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'notfound') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Athlete" onPressBack={() => router.back()} />
        <EmptyState
          icon={SearchX}
          title="Athlete not found"
          body="This profile is not available. Browse verified athletes on the Empower hub."
          ctaLabel="Back to Empower"
          onCtaPress={() => router.replace('/home/empower')}
        />
      </SafeAreaView>
    );
  }

  if (state === 'error' || !profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Athlete" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load profile</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const items: WishlistItem[] = profile.items.map((item) => {
    const funded = item.status === 'funded' || item.status === 'delivered';
    return {
      kind: 'upa',
      id: item.id,
      title: item.title,
      cost: item.cost,
      fundedAmount: item.fundedAmount,
      funded,
      onPress: () => router.push(`/home/donate/${profile.id}?itemId=${item.id}`),
      onFund: () => router.push(`/home/donate/${profile.id}?itemId=${item.id}`),
    };
  });

  const header = (
    <View style={{ gap: spacing.lg, marginBottom: spacing.md }}>
      <View style={{ borderRadius: radii.xl, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
        {profile.photoUrl ? (
          <Image source={{ uri: profile.photoUrl }} style={{ width: '100%', height: 220 }} resizeMode="cover" />
        ) : (
          <View style={{ width: '100%', height: 220, alignItems: 'center', justifyContent: 'center' }}>
            <HeartHandshake size={48} color={colors.textTertiary} strokeWidth={1.5} />
          </View>
        )}
      </View>

      <View style={{ gap: spacing.sm }}>
        <View className="flex-row items-center gap-xs">
          <BadgeCheck size={18} color={colors.success} strokeWidth={2} />
          <Text style={[textStyle('caption'), { color: colors.success }]}>Verified athlete</Text>
        </View>
        <Text style={[textStyle('h1'), { color: colors.text }]}>{profile.headline}</Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
          {SPORT_LABEL[profile.sport]}, {profile.region}, {profile.state}
        </Text>
        <Text style={[textStyle('body'), { color: colors.text }]}>{profile.body}</Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: radii.xl,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          padding: spacing.lg,
        }}
      >
        <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Raised to date</Text>
        <Text style={[textStyle('numericLg'), { color: colors.text }]}>{formatINR(profile.totalRaised)}</Text>
      </View>

      <Button onPress={() => router.push(`/home/donate/${profile.id}`)}>
        <HeartHandshake size={18} color={colors.inkOnAccent} strokeWidth={2} />
        <Text style={{ color: colors.inkOnAccent }}>Donate to this athlete</Text>
      </Button>

      <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Wishlist</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Athlete" onPressBack={() => router.back()} />
      <WishlistGrid
        variant="upa"
        items={items}
        header={header}
        emptyComponent={
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
            No wishlist items yet. You can still support this athlete with a general donation above.
          </Text>
        }
      />
    </SafeAreaView>
  );
}
