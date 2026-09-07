import {
  toApiError,
  useClutch,
  useWishlist,
  type CreatorProfile,
  type FollowListEntry,
  type WishlistEntry,
} from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { ApiError, Clip, ClipStatus } from '@atlitos/types';
import { router } from 'expo-router';
import { Bookmark, Heart, LayoutGrid, LogIn, Settings, TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClutchPostCard } from '@/components/molecules/ClutchPostCard';
import { EmptyState } from '@/components/organisms/EmptyState';
import { WishlistGrid } from '@/components/organisms/WishlistGrid';
import { AppBar } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { StatusPill, type Status } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** Clip lifecycle status to the shared StatusPill vocabulary, for the posts
 * grid where an own clip can be pending/rejected, not only published. Same
 * map as ClutchProfileView. */
const CLIP_STATUS_PILL: Partial<Record<ClipStatus, Status>> = {
  uploading: 'pending',
  processing: 'pending',
  ready: 'underReview',
  rejected: 'rejected',
  removed: 'removed',
};

const AVATAR_SIZE = 80 as const;
/** Cover banner height, derived from the spacing scale (no raw literal). */
const COVER_HEIGHT = spacing['4xl'] * 4;

type ProfileTab = 'posts' | 'liked' | 'follows' | 'wishlist';
type FollowSegment = 'following' | 'followers';

/**
 * The unified own profile (Track C, Instagram-style reference): cover photo,
 * overlapping avatar, name, @handle, bio, Following/Followers counts, then
 * four icon tabs: my posts grid (any status, with a status label on
 * non-published clips), liked posts grid, follow lists, and my wishlist.
 * The wishlist tab is PRIVATE by construction: `useWishlist.listWishlist`
 * only ever reads the caller's own `product_wishlist_items` rows (explicit
 * owner filter), and this screen is reachable only for the signed-in self.
 * Guests get the standard login gate.
 */
export default function ProfileScreen({ asTab = false }: { asTab?: boolean } = {}) {
  const colors = useThemeColors();
  const clutch = useClutch(supabase);
  const wishlist = useWishlist(supabase);
  const status = useSessionStore((state) => state.status);
  const myId = useSessionStore((state) => state.me?.id ?? null);
  const isGuest = status === 'guest';

  // When rendered as the "You" bottom tab (asTab), there is no back stack, so
  // the screen shows a plain centered title instead of the pushed backTitle
  // AppBar. The pushed /profile route (reached from the Home avatar shortcut
  // and Trainings MySportsCard) keeps its back chevron.
  const topBar = asTab ? (
    <View style={{ height: spacing['5xl'], alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[textStyle('h3'), { color: colors.text }]}>Profile</Text>
    </View>
  ) : (
    <AppBar variant="backTitle" title="Profile" onPressBack={() => router.back()} />
  );

  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [liked, setLiked] = useState<Clip[]>([]);
  const [following, setFollowing] = useState<FollowListEntry[]>([]);
  const [followers, setFollowers] = useState<FollowListEntry[]>([]);
  const [wishlistEntries, setWishlistEntries] = useState<WishlistEntry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('posts');
  const [segment, setSegment] = useState<FollowSegment>('following');

  const load = useCallback(
    async (silent: boolean) => {
      if (!myId) return;
      if (!silent) {
        setState('loading');
        setError(null);
      }
      try {
        const [creator, myClips, likedClips, followingList, followersList, wishlistRows] = await Promise.all([
          clutch.getCreator(myId),
          clutch.getMyClips(),
          clutch.listLikedClips(),
          clutch.listFollowing(myId),
          clutch.listFollowers(myId),
          wishlist.listWishlist(),
        ]);
        setProfile(creator);
        setClips(myClips);
        setLiked(likedClips);
        setFollowing(followingList);
        setFollowers(followersList);
        setWishlistEntries(wishlistRows);
        setState(creator ? 'ready' : 'error');
      } catch (err) {
        setError(toApiError(err));
        setState('error');
      }
    },
    // wishlist (useWishlist) is intentionally not a dep: unlike useClutch it
    // is not memoized and would refire this callback every render (the F1
    // lesson documented on useClutch). supabase is a module singleton, so the
    // api objects only ever wrap the same client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clutch, myId],
  );

  useEffect(() => {
    if (myId) void load(false);
  }, [load, myId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (isGuest || !myId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        {topBar}
        <View className="flex-1 items-center justify-center">
          <EmptyState
            icon={LogIn}
            title="Sign in to see your profile"
            body="Create an account to post clips, follow athletes and build your channel."
            ctaLabel="Sign in"
            onCtaPress={() => router.push('/(auth)/login')}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        {topBar}
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        {topBar}
        <View className="flex-1 items-center justify-center gap-md p-lg">
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load profile</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load(false)}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const tabs: Array<{ key: ProfileTab; icon: typeof LayoutGrid; label: string }> = [
    { key: 'posts', icon: LayoutGrid, label: 'My posts' },
    { key: 'liked', icon: Heart, label: 'Liked posts' },
    { key: 'follows', icon: Users, label: 'Follows' },
    { key: 'wishlist', icon: Bookmark, label: 'My wishlist' },
  ];

  const header = (
    <View>
      {profile.coverUrl ? (
        <Image source={{ uri: profile.coverUrl }} style={{ height: COVER_HEIGHT, width: '100%' }} resizeMode="cover" />
      ) : (
        <View style={{ height: COVER_HEIGHT, width: '100%', backgroundColor: colors.surfaceMuted }} />
      )}

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        <View
          style={{
            marginTop: -(AVATAR_SIZE / 2),
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
          }}
        >
          <Avatar uri={profile.avatarUrl ?? undefined} name={profile.name} size={AVATAR_SIZE} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Button variant="secondary" size="sm" onPress={() => router.push('/profile/edit')}>
              <Text style={[textStyle('label'), { color: colors.text }]}>Edit profile</Text>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => router.push('/settings')}
              accessibilityLabel="Settings"
            >
              <Settings size={16} strokeWidth={1.75} color={colors.text} />
              <Text style={[textStyle('label'), { color: colors.text }]}>Settings</Text>
            </Button>
          </View>
        </View>

        <View style={{ gap: spacing.xs, alignItems: 'center' }}>
          <Text style={[textStyle('h2'), { color: colors.text, textAlign: 'center' }]}>{profile.name}</Text>
          {profile.handle ? (
            <Text style={[textStyle('numericSm'), { color: colors.textSecondary, textAlign: 'center' }]}>
              @{profile.handle}
            </Text>
          ) : null}
          {profile.bio ? (
            <Text style={[textStyle('callout'), { color: colors.text, textAlign: 'center' }]}>{profile.bio}</Text>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.xl, justifyContent: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See who you follow"
            onPress={() => {
              setSegment('following');
              setTab('follows');
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
          >
            <Text style={[textStyle('numericBase'), { color: colors.text }]}>{profile.followingCount}</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Following</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See your followers"
            onPress={() => {
              setSegment('followers');
              setTab('follows');
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
          >
            <Text style={[textStyle('numericBase'), { color: colors.text }]}>{profile.followerCount}</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Followers</Text>
          </Pressable>
        </View>
      </View>

      <View
        style={{
          marginTop: spacing.lg,
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        {tabs.map(({ key, icon: Icon, label }) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => setTab(key)}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: spacing.md,
                borderBottomWidth: 2,
                borderBottomColor: active ? colors.accent : 'transparent',
              }}
            >
              <Icon size={22} strokeWidth={1.75} color={active ? colors.accent : colors.textTertiary} />
            </Pressable>
          );
        })}
      </View>

      {tab === 'follows' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.sm }}>
          {(
            [
              { key: 'following', label: 'Following' },
              { key: 'followers', label: 'Followers' },
            ] as Array<{ key: FollowSegment; label: string }>
          ).map(({ key, label }) => {
            const active = segment === key;
            return (
              <Button
                key={key}
                variant={active ? 'primary' : 'secondary'}
                size="sm"
                onPress={() => setSegment(key)}
              >
                <Text style={[textStyle('label'), { color: active ? colors.inkOnAccent : colors.text }]}>
                  {label}
                </Text>
              </Button>
            );
          })}
        </View>
      ) : null}
    </View>
  );

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
  );

  if (tab === 'wishlist') {
    // PRIVATE tab: listWishlist reads only the caller's own rows.
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        {topBar}
        <WishlistGrid
          variant="product"
          header={header}
          refreshControl={refreshControl}
          emptyComponent={
            <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
              <Bookmark size={40} color={colors.textTertiary} strokeWidth={1.75} />
              <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                Nothing saved yet. Tap the heart on any gear to keep it here.
              </Text>
            </View>
          }
          items={wishlistEntries.map((entry) => ({
            kind: 'product' as const,
            id: entry.productId,
            title: entry.product.title,
            price: entry.product.priceFrom,
            imageUrl: entry.product.imageUrl,
            availableStock: entry.product.availableStock,
            onPress: () => router.push({ pathname: '/shop/product/[id]', params: { id: entry.productId } }),
            onRemove: () => {
              setWishlistEntries((current) => current.filter((row) => row.productId !== entry.productId));
              wishlist
                .toggle(entry.productId)
                .catch(() => undefined)
                .finally(() => void load(true));
            },
          }))}
        />
      </SafeAreaView>
    );
  }

  if (tab === 'follows') {
    const rows = segment === 'following' ? following : followers;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        {topBar}
        <FlatList
          key="follows"
          data={rows}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          refreshControl={refreshControl}
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
              onPress={() =>
                router.push({ pathname: '/(tabs)/clutch/creator/[id]', params: { id: item.id } })
              }
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
      </SafeAreaView>
    );
  }

  const gridClips = tab === 'posts' ? clips : liked;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {topBar}
      <FlatList
        key={tab}
        data={gridClips}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={{ gap: spacing.xs }}
        contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.xl }}
        ListHeaderComponent={header}
        refreshControl={refreshControl}
        ListEmptyComponent={
          <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
            {tab === 'posts' ? (
              <LayoutGrid size={40} color={colors.textTertiary} strokeWidth={1.75} />
            ) : (
              <Heart size={40} color={colors.textTertiary} strokeWidth={1.75} />
            )}
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {tab === 'posts'
                ? 'You have not posted any clips yet.'
                : 'Clips you like show up here.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          // Status label only on the own-posts grid (a liked clip is always
          // published, see listLikedClips).
          const pill = tab === 'posts' ? CLIP_STATUS_PILL[item.status] : undefined;
          return (
            // maxWidth caps a lone last-row tile at one third instead of the
            // full-width stretch numColumns+flex-1 would otherwise give it.
            <View className="flex-1" style={{ maxWidth: '33%' }}>
              <ClutchPostCard
                clip={item}
                variant="thumb"
                onOpen={() =>
                  router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: item.id } })
                }
              />
              {pill ? (
                <View className="absolute left-xs top-xs" style={{ pointerEvents: 'none' }}>
                  <StatusPill status={pill} />
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
