import { sizedImageUrl, toApiError, useClutch, type CreatorProfile } from '@atlitos/api';
import { COVER_IMAGE_SIZE } from '@/lib/image-sizes';
import { inkOnMedia, spacing } from '@atlitos/theme';
import type { ApiError, Clip, ClipStatus } from '@atlitos/types';
import { router } from 'expo-router';
import { Bookmark, Heart, LayoutGrid, LogIn, RotateCcw, Settings, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { ClutchPostCard } from '@/components/molecules/ClutchPostCard';
import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { useClipPosters } from '@/hooks/use-clip-posters';
import { Avatar } from '@/components/ui/avatar';
import { useNavBarInset } from '@/components/ui/bottom-nav';
import { Button } from '@/components/ui/button';
import { StatusPill, type Status } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** Clip lifecycle status to the shared StatusPill vocabulary, for the posts
 * grid where an own clip can be pending/rejected, not only published. Same
 * map as ClutchProfileView. `failed` (CT-6) is deliberately absent: it gets
 * its own overlay + Retry affordance below instead of a pill, since it is
 * the one status that carries an actionable next step, not just a label. */
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

type ProfileTab = 'posts' | 'liked' | 'saved';

/**
 * The unified own social profile (Track C, Instagram style): cover banner,
 * overlapping avatar, name, @handle, bio, Following/Followers counts, then three
 * content tabs: my posts (any status, with a status label on non-published
 * clips), liked clips, and saved clips. The Following/Followers counts are the
 * only follow affordance here (a tap opens the dedicated Follows screen); the
 * social profile no longer carries the shop wishlist, which lives in the Shop
 * area (`/account/wishlist`).
 *
 * GRID POSTERS: `clips.thumb_path` is a raw private-bucket path that cannot load
 * as an <Image> source, so each grid tile shows a SIGNED poster minted via the
 * batch CT-1 endpoint (`getPlaybackUrls`, kind "thumb", ceil(n/24) calls with
 * concurrency <= 4 instead of one call per clip, Phase 3 LAUNCH P1-1), never
 * clip.thumbUrl. Guests get the standard login gate.
 *
 * FAILED CLIPS (CT-6, P1-6): an own clip stuck in `failed` (a technical
 * upload/processing failure, not moderation) shows its failure_reason and a
 * Retry tile instead of a poster; Retry calls retryFailedClip (the owner
 * scoped retry_failed_clip RPC, then a fresh stream-upload-url mint) and
 * routes to Upload pre-filled to finish the re-upload.
 */
export default function ProfileScreen({ asTab = false }: { asTab?: boolean } = {}) {
  const colors = useThemeColors();
  const navInset = useNavBarInset();
  const clutch = useClutch(supabase);
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
  const [saved, setSaved] = useState<Clip[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('posts');

  // Keyset continuation for the posts tab. Liked and saved are separate,
  // already bounded reads (limit 100) with no cursor plumbing of their own.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // P1-6 (CT-6): per-clip Retry busy/error state, keyed by clip id, so one
  // tile's retry never disables the whole grid.
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});

  const load = useCallback(
    async (silent: boolean) => {
      if (!myId) return;
      if (!silent) {
        setState('loading');
        setError(null);
      }
      try {
        const [creator, myClipsPage, likedClips, savedClips] = await Promise.all([
          clutch.getCreator(myId),
          clutch.getMyClips(),
          clutch.listLikedClips(),
          clutch.listSavedClips(),
        ]);
        setProfile(creator);
        setClips(myClipsPage.items);
        setNextCursor(myClipsPage.nextCursor);
        setLiked(likedClips);
        setSaved(savedClips);
        setState(creator ? 'ready' : 'error');
      } catch (err) {
        setError(toApiError(err));
        setState('error');
      }
    },
    [clutch, myId],
  );

  useEffect(() => {
    if (myId) void load(false);
  }, [load, myId]);

  const gridClips = tab === 'posts' ? clips : tab === 'liked' ? liked : saved;

  // Signed posters for the active grid, in BATCHES (P1-1, CT-1). This was a
  // hand rolled copy of `useClipPosters`, which is why the blank-tile-while-
  // loading finding existed here too and had to be fixed twice. It now shares
  // the hook, so the pending/empty distinction (and the missing rejection
  // handler on the batch call) is fixed for every grid at once.
  const { posterUrls, pendingPosterIds, resetPosters } = useClipPosters(gridClips);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Re-mint posters on an explicit pull to refresh (a save/unsave elsewhere
      // may have changed the saved grid).
      resetPosters();
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load, resetPosters]);

  /** Appends the next page of own clips. Posts tab only: `liked` and `saved`
   * are separate bounded reads with no cursor of their own. */
  const loadMore = useCallback(async () => {
    if (tab !== 'posts' || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await clutch.getMyClips(nextCursor);
      setClips((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // A failed tail page leaves the shown grid intact; scrolling refires.
    } finally {
      setLoadingMore(false);
    }
  }, [clutch, loadingMore, nextCursor, tab]);

  /** P1-6 (CT-6). Retry a `failed` own clip: RPC failed -> uploading, then a
   * fresh stream-upload-url mint against the same row, then route to Upload
   * pre-filled with this clip's id/caption/sport so the athlete can pick a
   * replacement file and finish the post. */
  const handleRetry = useCallback(
    async (clip: Clip) => {
      if (retryingId) return;
      setRetryingId(clip.id);
      setRetryErrors((prev) => {
        const next = { ...prev };
        delete next[clip.id];
        return next;
      });
      try {
        await clutch.retryFailedClip(clip);
        setClips((prev) =>
          prev.map((c) => (c.id === clip.id ? { ...c, status: 'uploading', failureReason: null } : c)),
        );
        router.push({
          pathname: '/(tabs)/clutch/upload',
          params: { retryClipId: clip.id, retryCaption: clip.caption, retrySport: clip.sport },
        });
      } catch (err) {
        setRetryErrors((prev) => ({ ...prev, [clip.id]: toApiError(err).message }));
      } finally {
        setRetryingId(null);
      }
    },
    [clutch, retryingId],
  );

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
    { key: 'posts', icon: LayoutGrid, label: 'My clips' },
    { key: 'liked', icon: Heart, label: 'Liked clips' },
    { key: 'saved', icon: Bookmark, label: 'Saved clips' },
  ];

  const header = (
    <View>
      {/* Cover banner. A real image when set, otherwise a subtle vertical
          gradient placeholder (token stops), never a flat empty band. */}
      <View style={{ height: COVER_HEIGHT, width: '100%' }}>
        {profile.coverUrl ? (
          <Image
            // SCALE-MEDIA M-6. Covers go up at camera resolution into the same
            // public `avatars` bucket as avatars, and `Avatar` sizing never
            // touched them. A phone width banner, so hero width at the banner
            // ratio. `profile/edit.tsx` asks for the SAME size on purpose, so
            // the two screens share one transformed object.
            source={{ uri: sizedImageUrl(profile.coverUrl, COVER_IMAGE_SIZE) }}
            style={{ height: COVER_HEIGHT, width: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="cover-wash" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.surface} />
                <Stop offset="1" stopColor={colors.surfaceMuted} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#cover-wash)" />
          </Svg>
        )}
      </View>

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {/* Avatar overlaps the banner on the left; the edit/settings actions sit
            opposite it, anchored to the same baseline so neither floats over the
            empty band. */}
        <View
          style={{
            marginTop: -(AVATAR_SIZE / 2),
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
          }}
        >
          <Avatar uri={profile.avatarUrl ?? undefined} name={profile.name} size={AVATAR_SIZE} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.xs }}>
            <Button variant="secondary" size="sm" onPress={() => router.push('/profile/edit')}>
              <Text style={[textStyle('label'), { color: colors.text }]}>Edit profile</Text>
            </Button>
            <Button variant="secondary" size="sm" onPress={() => router.push('/settings')} accessibilityLabel="Settings">
              <Settings size={16} strokeWidth={1.75} color={colors.text} />
              <Text style={[textStyle('label'), { color: colors.text }]}>Settings</Text>
            </Button>
          </View>
        </View>

        {/* Name block, left aligned to sit under the avatar rather than fighting
            it with a centered title. */}
        <View style={{ gap: spacing.xs }}>
          <Text style={[textStyle('h2'), { color: colors.text }]}>{profile.name}</Text>
          {profile.handle ? (
            <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>@{profile.handle}</Text>
          ) : null}
          {profile.bio ? <Text style={[textStyle('callout'), { color: colors.text }]}>{profile.bio}</Text> : null}
        </View>

        {/* Stat row: the ONLY follow affordance. Each count opens the dedicated
            Follows screen at the matching segment. */}
        <View style={{ flexDirection: 'row', gap: spacing.xl }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See who you follow"
            onPress={() => router.push({ pathname: '/profile/follows', params: { segment: 'following' } })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
          >
            <Text style={[textStyle('numericBase'), { color: colors.text }]}>{profile.followingCount}</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Following</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See your followers"
            onPress={() => router.push({ pathname: '/profile/follows', params: { segment: 'followers' } })}
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
    </View>
  );

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
  );

  const emptyCopy =
    tab === 'posts'
      ? 'You have not posted any clips yet.'
      : tab === 'liked'
        ? 'Clips you like show up here.'
        : 'Clips you save show up here. Tap the bookmark on any clip to keep it.';
  const EmptyIcon = tab === 'posts' ? LayoutGrid : tab === 'liked' ? Heart : Bookmark;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {topBar}
      <FlatList
        key={tab}
        data={gridClips}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={{ gap: spacing.xs }}
        contentContainerStyle={{ gap: spacing.xs, paddingBottom: navInset + spacing.xl }}
        ListHeaderComponent={header}
        refreshControl={refreshControl}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          tab === 'posts' && gridClips.length > 0 ? (
            <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
              {loadingMore ? (
                <ActivityIndicator color={colors.accent} />
              ) : nextCursor === null ? (
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>That is every clip.</Text>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
            <EmptyIcon size={40} color={colors.textTertiary} strokeWidth={1.75} />
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>{emptyCopy}</Text>
          </View>
        }
        renderItem={({ item }) => {
          // Status label only on the own-posts grid (a liked/saved clip is
          // always published, see listLikedClips/listSavedClips).
          const pill = tab === 'posts' ? CLIP_STATUS_PILL[item.status] : undefined;
          // P1-6: a failed own clip is never silently dead, its tile carries
          // the reason plus a working Retry, not just a status label.
          const isFailed = tab === 'posts' && item.status === 'failed';
          const isRetrying = retryingId === item.id;
          const retryError = retryErrors[item.id];
          return (
            // maxWidth caps a lone last-row tile at one third instead of the
            // full-width stretch numColumns+flex-1 would otherwise give it.
            <View className="flex-1" style={{ maxWidth: '33%' }}>
              <ClutchPostCard
                clip={item}
                variant="thumb"
                posterUrl={posterUrls[item.id]}
                posterPending={pendingPosterIds.has(item.id)}
                onOpen={
                  isFailed
                    ? undefined
                    : () => router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: item.id } })
                }
              />
              {pill ? (
                <View className="absolute left-xs top-xs" style={{ pointerEvents: 'none' }}>
                  <StatusPill status={pill} />
                </View>
              ) : null}
              {isFailed ? (
                <View
                  className="absolute inset-0 items-center justify-center gap-xs p-xs"
                  style={{ backgroundColor: colors.overlay }}
                >
                  <TriangleAlert size={18} color={inkOnMedia} strokeWidth={1.75} />
                  <Text
                    style={[textStyle('caption'), { color: inkOnMedia, textAlign: 'center' }]}
                    numberOfLines={2}
                  >
                    {retryError ?? item.failureReason ?? 'Upload failed'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry upload"
                    disabled={isRetrying}
                    onPress={() => void handleRetry(item)}
                    className="flex-row items-center gap-xs rounded-pill bg-surface px-sm py-xs"
                  >
                    {isRetrying ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <RotateCcw size={12} strokeWidth={1.75} color={colors.text} />
                    )}
                    <Text style={[textStyle('caption'), { color: colors.text }]}>
                      {isRetrying ? 'Retrying' : 'Retry'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
