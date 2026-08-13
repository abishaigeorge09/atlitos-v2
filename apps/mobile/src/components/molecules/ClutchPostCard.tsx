import { spacing } from '@atlitos/theme';
import type { Clip } from '@atlitos/types';
import * as Haptics from 'expo-haptics';
import { Bookmark, BookmarkCheck, EllipsisVertical, Film, Heart, MessageCircle, Share2, WifiOff } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ClipVideo } from '@/components/molecules/clip-video';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * SPEC #23. Two variants: `feed` (full-bleed vertical video card with the
 * engagement rail, one per viewport in the vertical feed) and `thumb` (square
 * grid tile for a creator/own profile grid).
 *
 * PRESSABLE-OVERLAY PATTERN (DESIGN-LANGUAGE.md): the whole-card open tap is a
 * single absolute-fill <Pressable> rendered as a SIBLING behind the action
 * controls, never a wrapper around them. The caption and action-rail wrappers
 * are `pointerEvents="box-none"` Views, so taps on empty space fall through to
 * that overlay while the like/comment/share Pressables still capture their own
 * taps. This is the fix for the nested-<button> regression (4868df9); do not
 * reintroduce a card-level Pressable wrapping the inner ones.
 */
export type ClutchPostCardVariant = 'feed' | 'thumb';

export interface ClutchPostCardProps {
  clip: Clip;
  variant?: ClutchPostCardVariant;
  /** Short-lived signed MP4 URL for this card, minted by the feed per visible
   * card (feed variant only). Absent until minted; the poster carries it. */
  playbackUrl?: string;
  /** Short-lived SIGNED poster URL, minted alongside the playback URL. The
   * feed passes this rather than clip.thumbUrl because thumb_path is a raw
   * private-bucket path that cannot load as an <Image> source. */
  posterUrl?: string;
  /** Thumb variant only. True while this tile's signed poster is still being
   * minted by the grid's batch call. Without it a loading tile and a tile whose
   * poster does not exist rendered identically (a flat surface-muted square),
   * which on device read as the batch endpoint failing for the ~3 seconds the
   * mint takes. A loading state indistinguishable from a failure state is a
   * bug in its own right. */
  posterPending?: boolean;
  /** True only for the single on-screen card, drives muted autoplay. */
  active?: boolean;
  /** F1 (P5 fix pass): whether this card should hold a live `ClipVideo`
   * player at all. The caller (a FlatList feed) sets this true only for the
   * active card and its immediate neighbors; every other mounted-but-offscreen
   * card renders its poster as a plain `<Image>` instead. `useVideoPlayer`
   * allocates a real native decoder (ExoPlayer + MediaSession on Android) the
   * instant `ClipVideo` mounts, regardless of `active`, so gating mount is the
   * only way to bound concurrent players; `active` alone only controls
   * play/pause on an already-created player. Defaults to `true` so the single-
   * clip viewer (`clutch/post/[id].tsx` outside its own feed list) and the
   * thumb-grid callers keep prior behavior. */
  mountPlayer?: boolean;
  /** F6 (P5 fix pass): the full-feed action rail (icon + count/label stack,
   * `gap-lg` between items) was reused unmodified inside
   * `ClutchPreviewCard`'s compressed Home teaser tile (iOS QA finding
   * Obs-1), sized for a card close to full device height. `compactActions`
   * drops the text row under each icon and tightens the gap, cutting the
   * rail's footprint substantially so it fits any shorter/narrower card
   * without the label crowding the icon above it or the tile's edge.
   * Defaults to `false`, the full-feed rail, unchanged for the main feed
   * and the single-clip viewer. */
  compactActions?: boolean;
  /** SCALE-MEDIA M-1 (feed variant). True while this card's signed playback
   * mint is failing. The same call mints the poster, so a failure leaves the
   * card with neither a video nor a poster: without this it rendered as a bare
   * black rectangle with no error and nothing to tap. Non blocking by design,
   * the caption, the action rail and the open tap all keep working. */
  playbackFailed?: boolean;
  /** Manual retry for `playbackFailed`, after the bounded automatic backoff. */
  onRetryPlayback?: () => void;
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onSave?: () => void;
  onOpen?: () => void;
  /** App Store guideline 1.2. Opens the report and block sheet for this clip.
   * Absent on surfaces showing the viewer's OWN clips, where reporting
   * yourself is not a thing. */
  onReportOrBlock?: () => void;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ClutchPostCard({
  clip,
  variant = 'feed',
  playbackUrl,
  posterUrl,
  posterPending = false,
  active = false,
  mountPlayer = true,
  compactActions = false,
  playbackFailed = false,
  onRetryPlayback,
  onLike,
  onComment,
  onShare,
  onSave,
  onOpen,
  onReportOrBlock,
}: ClutchPostCardProps) {
  const colors = useThemeColors();

  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Haptics unavailable (web/simulator), not fatal.
    });
    onLike?.();
  };

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSave?.();
  };

  if (variant === 'thumb') {
    // Prefer the SIGNED poster URL minted by the grid over clip.thumbUrl:
    // thumb_path is a raw private-bucket path that cannot load as an <Image>
    // source, so without the signed poster the tile renders blank beige. Same
    // rule the feed card follows for its poster.
    const thumbSource = posterUrl ?? clip.thumbUrl;
    // A tile with no poster YET pulses; a tile whose poster came back empty
    // stays a solid surface. The like count is suppressed while pulsing so the
    // skeleton reads as one loading block rather than a half drawn tile.
    const showSkeleton = !thumbSource && posterPending;
    // Single Pressable, only non-interactive children (no nested pressables).
    return (
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={showSkeleton ? 'Loading clip' : `Open clip, ${clip.likes} likes`}
        className="aspect-square flex-1 overflow-hidden rounded-sm bg-surface-muted active:opacity-90"
      >
        {thumbSource ? (
          <Image source={{ uri: thumbSource }} className="absolute inset-0 h-full w-full" resizeMode="cover" />
        ) : showSkeleton ? (
          <Skeleton shape="tile" className="absolute inset-0 h-full w-full rounded-sm" />
        ) : (
          // Settled with no poster. An icon placeholder rather than a bare
          // fill, matching what CourtCard and ProductCard already do for a
          // missing image, so "no poster" reads as a state and not as a tile
          // that failed to paint.
          <View className="absolute inset-0 items-center justify-center">
            <Film size={24} strokeWidth={1.75} color={colors.textTertiary} />
          </View>
        )}
        {showSkeleton ? null : (
          <View className="absolute bottom-xs left-xs flex-row items-center gap-xs">
            <Heart size={16} strokeWidth={2} color={colors.textInverse} fill={colors.textInverse} />
            <Text className="font-mono text-xs text-text-inverse">{clip.likes}</Text>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <View className="h-full w-full overflow-hidden bg-text">
      {/* 1. Playback surface (poster + video), non-interactive. The poster is
          the signed thumb URL from the feed, falling back to any absolute
          clip.thumbUrl. F1: only the near-visible window mounts a real
          player (mountPlayer); every other virtualized card renders its
          poster as a plain Image so it never allocates a native decoder. */}
      {mountPlayer ? (
        <ClipVideo url={playbackUrl} thumbUrl={posterUrl ?? clip.thumbUrl} active={active} />
      ) : posterUrl ?? clip.thumbUrl ? (
        <Image
          source={{ uri: posterUrl ?? clip.thumbUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : null}

      {/* 1b. M-1 playback failure. Sits above the (empty) playback surface and
          BELOW the caption and action rail, so the card stays usable: this is
          a state, not a blocking error screen. Rendered only when there is no
          poster either, because a card still showing its poster is not the
          black rectangle this exists to replace. */}
      {playbackFailed && !posterUrl && !clip.thumbUrl ? (
        <View
          style={StyleSheet.absoluteFill}
          className="items-center justify-center gap-sm px-lg"
          pointerEvents="box-none"
        >
          <WifiOff size={28} strokeWidth={1.75} color={colors.textInverse} />
          <Text className="text-center text-sm text-text-inverse opacity-90">
            This clip could not load right now.
          </Text>
          {onRetryPlayback ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading this clip"
              hitSlop={8}
              onPress={onRetryPlayback}
              className="min-h-11 items-center justify-center rounded-pill px-lg"
              style={{ backgroundColor: colors.overlay }}
            >
              <Text className="font-sans-semibold text-sm text-text-inverse">Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* 2. Bottom scrim for caption legibility, never a touch target. */}
      <View
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none', top: '55%', backgroundColor: colors.overlay }]}
      />

      {/* 3. Whole-card open tap: a sibling overlay BEHIND the controls, never a
          wrapper around them. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={`Open clip by ${clip.channel}`}
        onPress={onOpen}
      />

      {/* 4. Caption block. box-none so empty space falls through to overlay
          (3); the inner "View all comments" Pressable still captures taps. */}
      <View className="absolute inset-x-0 bottom-0 gap-xs p-md" style={{ pointerEvents: 'box-none', right: spacing['6xl'] }}>
        <View className="flex-row items-center gap-sm">
          <Text className="font-sans-semibold text-text-inverse">{clip.channel}</Text>
          <Text className="font-mono text-xs text-text-inverse opacity-80">{timeAgo(clip.createdAt)}</Text>
        </View>
        {clip.caption ? (
          <Text className="text-sm text-text-inverse opacity-95" numberOfLines={2}>
            {clip.caption}
          </Text>
        ) : null}
        {clip.topComment ? (
          <Text className="text-xs text-text-inverse opacity-90" numberOfLines={1}>
            {clip.topComment.username}: {clip.topComment.text}
          </Text>
        ) : null}
        {clip.commentCount > 0 ? (
          <Pressable onPress={onComment} accessibilityRole="button" hitSlop={8} className="self-start py-xs">
            <Text className="text-xs text-text-inverse opacity-75">View all {clip.commentCount} comments</Text>
          </Pressable>
        ) : null}
      </View>

      {/* 5. Action rail. box-none wrapper; each action is its own Pressable.
          F6: `compactActions` (the Home teaser tile) drops the count/label
          row under each icon and tightens the gap, so the same four actions
          fit a much shorter rail footprint without crowding the tile edge
          or each other. */}
      <View
        className={cn('absolute bottom-md right-md items-center', compactActions ? 'gap-sm' : 'gap-lg')}
        style={{ pointerEvents: 'box-none' }}
      >
        <Pressable
          onPress={handleLike}
          accessibilityRole="button"
          accessibilityLabel={clip.likedByMe ? 'Unlike' : 'Like'}
          className={cn('min-h-11 min-w-11 items-center justify-center', compactActions ? '' : 'gap-xs')}
        >
          <Heart
            size={24}
            strokeWidth={1.75}
            color={clip.likedByMe ? colors.danger : colors.textInverse}
            fill={clip.likedByMe ? colors.danger : 'transparent'}
          />
          {compactActions ? null : <Text className="font-mono text-xs text-text-inverse">{clip.likes}</Text>}
        </Pressable>
        <Pressable
          onPress={onComment}
          accessibilityRole="button"
          accessibilityLabel="Comments"
          className={cn('min-h-11 min-w-11 items-center justify-center', compactActions ? '' : 'gap-xs')}
        >
          <MessageCircle size={24} strokeWidth={1.75} color={colors.textInverse} />
          {compactActions ? null : <Text className="font-mono text-xs text-text-inverse">{clip.commentCount}</Text>}
        </Pressable>
        <Pressable
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel={clip.savedByMe ? 'Remove from saved' : 'Save'}
          className={cn('min-h-11 min-w-11 items-center justify-center', compactActions ? '' : 'gap-xs')}
        >
          {clip.savedByMe ? (
            <BookmarkCheck size={24} strokeWidth={1.75} color={colors.accent} fill={colors.accent} />
          ) : (
            <Bookmark size={24} strokeWidth={1.75} color={colors.textInverse} />
          )}
          {compactActions ? null : <Text className="text-xs text-text-inverse">Save</Text>}
        </Pressable>
        {onReportOrBlock ? (
          <Pressable
            onPress={onReportOrBlock}
            accessibilityRole="button"
            accessibilityLabel="Report or block"
            className="min-h-11 min-w-11 items-center justify-center gap-xs"
          >
            <EllipsisVertical size={24} strokeWidth={1.75} color={colors.textInverse} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onShare}
          accessibilityRole="button"
          accessibilityLabel="Share"
          className={cn('min-h-11 min-w-11 items-center justify-center', compactActions ? '' : 'gap-xs')}
        >
          <Share2 size={24} strokeWidth={1.75} color={colors.textInverse} />
          {compactActions ? null : <Text className="text-xs text-text-inverse">Share</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export default ClutchPostCard;
