import type { CreatorProfile } from '@atlitos/api';
import { inkOnMedia, radii, spacing } from '@atlitos/theme';
import type { Clip, ClipStatus } from '@atlitos/types';
import { EllipsisVertical, Film, TriangleAlert, UserPlus, Users } from 'lucide-react-native';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { ClutchPostCard } from '@/components/molecules/ClutchPostCard';
import { useNavBarInset } from '@/components/ui/bottom-nav';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type Status } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { Avatar } from '@/components/ui/avatar';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** Clip lifecycle status to the shared StatusPill vocabulary, for the own
 * profile grid where a clip can be pending/rejected, not only published. */
const CLIP_STATUS_PILL: Partial<Record<ClipStatus, Status>> = {
  uploading: 'pending',
  processing: 'pending',
  ready: 'underReview',
  rejected: 'rejected',
  removed: 'removed',
};

export interface ClutchProfileViewProps {
  profile: CreatorProfile | null;
  clips: Clip[];
  state: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  /** Own profile hides the follow button, shows every clip status, and can
   * offer an upload CTA. A visitor sees the follow button and published only. */
  isOwn: boolean;
  /** SCALE-MEDIA M-4. Signed poster URL per clip id, from the BATCH playback
   * endpoint (`useClipPosters`). Without it every tile fell back to
   * `clip.thumbUrl`, which `mapClipRow` sets to undefined for a raw private
   * bucket path, so both profile surfaces this component backs rendered grids
   * of blank tiles. Optional so a caller that has not wired the batch yet
   * degrades to the old blank tile rather than crashing. */
  posterUrls?: Record<string, string>;
  /** Clips whose poster mint is still in flight (`useClipPosters`). Those
   * tiles pulse; a tile that is merely posterless does not. Before this, the
   * two looked identical for the ~3 seconds the batch takes, which on device
   * read as the batch endpoint failing. */
  pendingPosterIds?: Set<string>;
  followBusy?: boolean;
  /** Keyset pagination. `getCreatorClips`/`getMyClips` are bounded to
   * CLUTCH_GRID_PAGE_SIZE (24), so without this a creator with more than 24
   * published clips silently lost the rest: the grid simply stopped, with no
   * spinner, no end marker and nothing to scroll to. Both are optional so a
   * caller that has not wired continuation still renders. */
  onEndReached?: () => void;
  /** True while the next page is in flight, drives the footer. */
  loadingMore?: boolean;
  /** False once the server has returned a short page, which is what turns the
   * footer from "loading" into "that is all of them". */
  hasMore?: boolean;
  onRetry: () => void;
  onToggleFollow?: () => void;
  onOpenClip: (clipId: string) => void;
  onUpload?: () => void;
  /** Own profile only. Opens the per clip owner menu (delete the clip, turn
   * its comments off). Before this the own grid had no per clip affordance at
   * all, so the founder decision of 2026-08-13 had nowhere to surface. */
  onOpenClipMenu?: (clip: Clip) => void;
}

function StatItem({ value, label }: { value: number; label: string }) {
  const colors = useThemeColors();
  return (
    <View className="items-center">
      <Text className="font-mono-semibold text-lg text-text">{value}</Text>
      <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

/**
 * Shared Clutch profile body for both the public creator profile (PRD-01 3.4
 * FR-46) and the athlete's own profile. Header (avatar, channel, stat row) +
 * a three-column clip grid. Follow routes through `toggle_follow` (owned by
 * the screen). Numeric stats and per-tile like counts render mono/tabular.
 */
export function ClutchProfileView({
  profile,
  clips,
  state,
  errorMessage,
  isOwn,
  posterUrls,
  pendingPosterIds,
  followBusy,
  onEndReached,
  loadingMore = false,
  hasMore = false,
  onRetry,
  onToggleFollow,
  onOpenClip,
  onUpload,
  onOpenClipMenu,
}: ClutchProfileViewProps) {
  const colors = useThemeColors();
  const navInset = useNavBarInset();

  if (state === 'loading') {
    // SPEC Section 9: "every screen ships 4 states: loading skeleton, never
    // spinner only". A centered spinner over an empty screen was the same
    // shape as the blank-tile finding: it says something is happening but
    // nothing about what is about to appear.
    return (
      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        <View className="flex-row items-center gap-lg">
          <Skeleton shape="circle" width={80} height={80} />
          <View className="flex-1 gap-sm">
            <Skeleton shape="line" width="60%" />
            <Skeleton shape="line" width="40%" />
          </View>
        </View>
        <Skeleton shape="line" width="45%" />
        <View className="flex-row gap-xs">
          <Skeleton shape="card" className="flex-1" height={110} />
          <Skeleton shape="card" className="flex-1" height={110} />
          <Skeleton shape="card" className="flex-1" height={110} />
        </View>
        <View className="flex-row gap-xs">
          <Skeleton shape="card" className="flex-1" height={110} />
          <Skeleton shape="card" className="flex-1" height={110} />
          <Skeleton shape="card" className="flex-1" height={110} />
        </View>
      </View>
    );
  }

  if (state === 'error' || !profile) {
    return (
      <View className="flex-1 items-center justify-center gap-md p-lg">
        <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
        <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load profile</Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
          {errorMessage ?? 'Something went wrong. Please try again.'}
        </Text>
        <Button variant="secondary" onPress={onRetry}>
          <Text style={{ color: colors.text }}>Retry</Text>
        </Button>
      </View>
    );
  }

  return (
    <FlatList
      data={clips}
      keyExtractor={(item) => item.id}
      numColumns={3}
      columnWrapperStyle={{ gap: spacing.xs }}
      contentContainerStyle={{ gap: spacing.xs, paddingBottom: navInset + spacing.xl }}
      // Keyset continuation for the 24 clip page. `onEndReached` can fire more
      // than once per scroll, so the guard against a duplicate page request
      // lives in the caller's `loadMore` (the same shape CoachBrowseList uses)
      // rather than in a flag here.
      onEndReached={onEndReached ? () => onEndReached() : undefined}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        onEndReached && clips.length > 0 ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
            {loadingMore ? (
              <ActivityIndicator color={colors.accent} />
            ) : hasMore ? null : (
              <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                That is every clip.
              </Text>
            )}
          </View>
        ) : null
      }
      ListHeaderComponent={
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <View className="flex-row items-center gap-lg">
            <Avatar uri={profile.avatarUrl ?? undefined} name={profile.name} size={80} />
            <View className="flex-1 flex-row items-center justify-around">
              {/* `clipCount` is `creator_stats.published_clips_count`,
                  published only. On a VISITOR's profile the grid is
                  `getCreatorClips`, also published only, so "Clips" describes
                  the tiles beneath it. On the OWNER's own profile the grid is
                  `getMyClips`, which returns EVERY status on purpose (PRD-01
                  FR-44 requires the owner to see their own uploading, under
                  review and rejected clips), so the same word read as a count
                  of the tiles and disagreed with them: "8 Clips" over twelve
                  tiles including Under review and Cancelled.

                  Resolved by fixing the LABEL, not the number. Counting the
                  grid instead would report `clips.length`, which is capped at
                  CLUTCH_GRID_PAGE_SIZE, so a creator with forty clips would
                  read "24" and the header would start lying about a total it
                  is the only source of. Filtering the owner's grid to
                  published would match, but deletes the FR-44 requirement.
                  The number is server computed, unpaginated and identical to
                  the one visitors see; only the word claiming it describes
                  the grid was wrong. */}
              <StatItem value={profile.clipCount} label={isOwn ? 'Published' : 'Clips'} />
              <StatItem value={profile.followerCount} label="Followers" />
              <StatItem value={profile.followingCount} label="Following" />
            </View>
          </View>

          <View style={{ gap: spacing.xs }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>{profile.channel}</Text>
            {profile.name !== profile.channel ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{profile.name}</Text>
            ) : null}
          </View>

          {isOwn ? (
            onUpload ? (
              <Button onPress={onUpload}>
                <Film size={20} strokeWidth={1.75} color={colors.inkOnAccent} />
                <Text style={{ color: colors.inkOnAccent }}>Post a clip</Text>
              </Button>
            ) : null
          ) : (
            <Button
              variant={profile.followedByMe ? 'secondary' : 'primary'}
              loading={followBusy}
              onPress={onToggleFollow}
            >
              {profile.followedByMe ? (
                <Users size={20} strokeWidth={1.75} color={colors.text} />
              ) : (
                <UserPlus size={20} strokeWidth={1.75} color={colors.inkOnAccent} />
              )}
              <Text style={{ color: profile.followedByMe ? colors.text : colors.inkOnAccent }}>
                {profile.followedByMe ? 'Following' : 'Follow'}
              </Text>
            </Button>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
          <Film size={40} color={colors.textTertiary} strokeWidth={1.75} />
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {isOwn ? 'You have not posted any clips yet.' : 'No clips yet.'}
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const pill = isOwn ? CLIP_STATUS_PILL[item.status] : undefined;
        return (
          // maxWidth caps a lone last-row tile at one third instead of the
          // full-width stretch numColumns+flex-1 would otherwise give it.
          <View className="flex-1" style={{ maxWidth: '33%' }}>
            <ClutchPostCard
              clip={item}
              variant="thumb"
              posterUrl={posterUrls?.[item.id]}
              posterPending={pendingPosterIds?.has(item.id)}
              onOpen={() => onOpenClip(item.id)}
            />
            {pill ? (
              <View className="absolute left-xs top-xs" style={{ pointerEvents: 'none' }}>
                <StatusPill status={pill} />
              </View>
            ) : null}
            {isOwn && onOpenClipMenu ? (
              // Overlaid on the tile rather than added as a row below it, so
              // the three column grid keeps its geometry. The 44 point target
              // sits inside the tile's top right corner.
              //
              // B5 FIX. `colors.textInverse` is #14100B (near black) in dark
              // mode, painted directly on an arbitrary video thumbnail with no
              // scrim it read as a near invisible glyph on a dark photo. The
              // fix used elsewhere in the app for exactly this shape (an icon
              // over arbitrary media, both themes): a small `colors.overlay`
              // pill BEHIND the icon, same as the wishlist remove heart
              // (WishlistGrid.tsx) and the cover photo "Change" chip
              // (app/profile/edit.tsx). The 44pt Pressable stays the touch
              // target; the pill is a smaller, non-interactive visual chip
              // centered inside it.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clip options"
                hitSlop={4}
                onPress={() => onOpenClipMenu(item)}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  height: 44,
                  width: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    pointerEvents: 'none',
                    height: 28,
                    width: 28,
                    borderRadius: radii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.overlay,
                  }}
                >
                  <EllipsisVertical size={18} strokeWidth={2} color={inkOnMedia} />
                </View>
              </Pressable>
            ) : null}
          </View>
        );
      }}
    />
  );
}
