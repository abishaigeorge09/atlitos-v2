import { toApiError, useClutch, type FollowListEntry } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { ApiError } from '@atlitos/types';
import { router, useLocalSearchParams } from 'expo-router';
import { TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type FollowSegment = 'following' | 'followers';

/**
 * The dedicated Follows screen, reached from the profile's Following/Followers
 * counts (Phase 11 IA: the counts are the only follow affordance, no in-profile
 * tab). A Following/Followers segmented control switches the list; the incoming
 * `segment` param opens it on the count that was tapped. Both lists read only
 * the signed-in self's follows, capped at 100 (listFollowing/listFollowers).
 */
export default function FollowsScreen() {
  const colors = useThemeColors();
  const clutch = useClutch(supabase);
  const myId = useSessionStore((state) => state.me?.id ?? null);
  const { segment: segmentParam } = useLocalSearchParams<{ segment?: string }>();

  const [segment, setSegment] = useState<FollowSegment>(segmentParam === 'followers' ? 'followers' : 'following');
  const [following, setFollowing] = useState<FollowListEntry[]>([]);
  const [followers, setFollowers] = useState<FollowListEntry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!myId) return;
    setState('loading');
    setError(null);
    try {
      const [followingList, followersList] = await Promise.all([
        clutch.listFollowing(myId),
        clutch.listFollowers(myId),
      ]);
      setFollowing(followingList);
      setFollowers(followersList);
      setState('ready');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [clutch, myId]);

  useEffect(() => {
    void load();
  }, [load]);

  const segmentControl = (
    <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.sm }}>
      {(
        [
          { key: 'following', label: 'Following' },
          { key: 'followers', label: 'Followers' },
        ] as Array<{ key: FollowSegment; label: string }>
      ).map(({ key, label }) => {
        const active = segment === key;
        return (
          <Button key={key} variant={active ? 'primary' : 'secondary'} size="sm" onPress={() => setSegment(key)}>
            <Text style={[textStyle('label'), { color: active ? colors.inkOnAccent : colors.text }]}>{label}</Text>
          </Button>
        );
      })}
    </View>
  );

  if (!myId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Follows" onPressBack={() => router.back()} />
        <View className="flex-1 items-center justify-center">
          <EmptyState icon={Users} title="Sign in to see follows" body="Follow athletes to build your channel." />
        </View>
      </SafeAreaView>
    );
  }

  const rows = segment === 'following' ? following : followers;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Follows" onPressBack={() => router.back()} />
      {segmentControl}
      {state === 'loading' ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : state === 'error' ? (
        <View className="flex-1 items-center justify-center gap-md p-lg">
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load follows</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          ListEmptyComponent={
            <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
              <Users size={40} color={colors.textTertiary} strokeWidth={1.75} />
              <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                {segment === 'following'
                  ? 'You are not following anyone yet.'
                  : 'No followers yet. Post clips to grow your channel.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => router.push({ pathname: '/(tabs)/clutch/creator/[id]', params: { id: item.id } })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
              }}
            >
              <Avatar uri={item.avatarUrl ?? undefined} name={item.name} size={40} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={[textStyle('label'), { color: colors.text }]}>{item.name}</Text>
                {item.handle ? (
                  <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>@{item.handle}</Text>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
