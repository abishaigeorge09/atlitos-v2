import { useClutch, type CreatorProfile } from '@atlitos/api';
import type { ApiError, Clip } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { Flag } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClutchProfileView } from '@/components/organisms/ClutchProfileView';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { ModerationSheet, type ModerationTarget } from '@/components/organisms/moderation/ModerationSheet';
import { AppBar } from '@/components/ui/app-bar';
import { useClipPosters } from '@/hooks/use-clip-posters';
import { usePendingAuthAction } from '@/hooks/use-pending-auth-action';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Public creator profile (PRD-01 3.4 FR-46): header stats + published clip
 * grid + Follow. Follow routes through the `toggle_follow` RPC; a guest tap
 * gates to login (FR-3). Reads a creator's clips filtered to `published` in
 * the data lane (never their pending clips).
 */
export default function ClutchCreatorScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clutch = useClutch(supabase);
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const myId = useSessionStore((state) => state.me?.id ?? null);

  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  // Keyset continuation for the 24 clip grid page. `null` after a page load
  // means the server said this was the last page; `loadingMore` guards against
  // onEndReached firing more than once per scroll, which FlatList does.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);
  const [moderationTarget, setModerationTarget] = useState<ModerationTarget | null>(null);
  // F8 (P5 fix pass, PRD-01 FR-4): both Follow and opening the report/block
  // sheet used to be dropped when the gate opened; see the hook's docblock.
  const { requireAuth, clearPendingAction } = usePendingAuthAction(requiresAuthGate);
  // M-4: the grid's posters, in ONE batch call. getCreatorClips is bounded to
  // CLUTCH_GRID_PAGE_SIZE, which is the batch's own chunk size, so a creator
  // profile is exactly one request no matter how many clips they have.
  const { posterUrls, pendingPosterIds } = useClipPosters(clips);

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const [creator, page] = await Promise.all([clutch.getCreator(id), clutch.getCreatorClips(id)]);
      setProfile(creator);
      setClips(page.items);
      setNextCursor(page.nextCursor);
      setState(creator ? 'ready' : 'error');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [clutch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Appends the next page. Never refetches page 1, and every call still carries
  // the same bounded limit, so the "one batch call per grid page" property the
  // page size exists for survives pagination.
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextCursor || !id) return;
    setLoadingMore(true);
    try {
      const page = await clutch.getCreatorClips(id, nextCursor);
      setClips((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // A failed tail page leaves the shown grid intact; scrolling refires
      // onEndReached, so the retry is the natural gesture rather than a full
      // screen error over clips that loaded fine.
    } finally {
      setLoadingMore(false);
    }
  }, [clutch, id, loadingMore, nextCursor]);

  function toggleFollow() {
    if (!profile) return;
    requireAuth(async () => {
      setFollowBusy(true);
      const prev = profile;
      setProfile({
        ...profile,
        followedByMe: !profile.followedByMe,
        followerCount: profile.followerCount + (profile.followedByMe ? -1 : 1),
      });
      try {
        const result = await clutch.toggleFollow(profile.id);
        setProfile((p) =>
          p ? { ...p, followedByMe: result.following, followerCount: result.followerCount } : p,
        );
      } catch {
        setProfile(prev);
      } finally {
        setFollowBusy(false);
      }
    }, () => setGateVisible(true));
  }

  const isOwnProfile = myId != null && myId === id;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title={profile?.channel ?? 'Creator'} onPressBack={() => router.back()} />
      {!isOwnProfile && profile ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.lg }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Report or block ${profile.channel}`}
            hitSlop={8}
            onPress={() =>
              requireAuth(
                () =>
                  setModerationTarget({
                    type: 'user',
                    entityId: profile.id,
                    userId: profile.id,
                    userName: profile.channel,
                  }),
                () => setGateVisible(true),
              )
            }
            className="min-h-11 flex-row items-center gap-xs px-sm py-xs"
          >
            <Flag size={16} strokeWidth={1.75} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      <ClutchProfileView
        profile={profile}
        clips={clips}
        state={state}
        errorMessage={error?.message}
        isOwn={myId != null && myId === id}
        posterUrls={posterUrls}
        pendingPosterIds={pendingPosterIds}
        followBusy={followBusy}
        onEndReached={() => void loadMore()}
        loadingMore={loadingMore}
        hasMore={nextCursor !== null}
        onRetry={() => void load()}
        onToggleFollow={() => void toggleFollow()}
        onOpenClip={(clipId) => router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: clipId } })}
      />
      <LoginGateModal
        visible={gateVisible}
        onClose={() => setGateVisible(false)}
        onDismiss={clearPendingAction}
      />

      <ModerationSheet
        visible={moderationTarget !== null}
        target={moderationTarget}
        onClose={() => setModerationTarget(null)}
        onBlocked={() => router.back()}
      />
    </SafeAreaView>
  );
}
