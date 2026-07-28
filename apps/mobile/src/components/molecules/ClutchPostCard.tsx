import { spacing } from '@atlitos/theme';
import type { Clip } from '@atlitos/types';
import * as Haptics from 'expo-haptics';
import { Heart, MessageCircle, Share2 } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ClipVideo } from '@/components/molecules/clip-video';
import { Text } from '@/components/ui/text';
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
  /** True only for the single on-screen card, drives muted autoplay. */
  active?: boolean;
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onOpen?: () => void;
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
  active = false,
  onLike,
  onComment,
  onShare,
  onOpen,
}: ClutchPostCardProps) {
  const colors = useThemeColors();

  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Haptics unavailable (web/simulator), not fatal.
    });
    onLike?.();
  };

  if (variant === 'thumb') {
    // Single Pressable, only non-interactive children (no nested pressables).
    return (
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open clip, ${clip.likes} likes`}
        className="aspect-square flex-1 overflow-hidden rounded-sm bg-surface-muted active:opacity-90"
      >
        {clip.thumbUrl ? (
          <Image source={{ uri: clip.thumbUrl }} className="absolute inset-0 h-full w-full" resizeMode="cover" />
        ) : null}
        <View className="absolute bottom-xs left-xs flex-row items-center gap-xs">
          <Heart size={16} strokeWidth={2} color={colors.textInverse} fill={colors.textInverse} />
          <Text className="font-mono text-xs text-text-inverse">{clip.likes}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View className="h-full w-full overflow-hidden bg-text">
      {/* 1. Playback surface (poster + video), non-interactive. The poster is
          the signed thumb URL from the feed, falling back to any absolute
          clip.thumbUrl. */}
      <ClipVideo url={playbackUrl} thumbUrl={posterUrl ?? clip.thumbUrl} active={active} />

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

      {/* 5. Action rail. box-none wrapper; each action is its own Pressable. */}
      <View className="absolute bottom-md right-md items-center gap-lg" style={{ pointerEvents: 'box-none' }}>
        <Pressable
          onPress={handleLike}
          accessibilityRole="button"
          accessibilityLabel={clip.likedByMe ? 'Unlike' : 'Like'}
          className="min-h-11 min-w-11 items-center justify-center gap-xs"
        >
          <Heart
            size={24}
            strokeWidth={1.75}
            color={clip.likedByMe ? colors.danger : colors.textInverse}
            fill={clip.likedByMe ? colors.danger : 'transparent'}
          />
          <Text className="font-mono text-xs text-text-inverse">{clip.likes}</Text>
        </Pressable>
        <Pressable
          onPress={onComment}
          accessibilityRole="button"
          accessibilityLabel="Comments"
          className="min-h-11 min-w-11 items-center justify-center gap-xs"
        >
          <MessageCircle size={24} strokeWidth={1.75} color={colors.textInverse} />
          <Text className="font-mono text-xs text-text-inverse">{clip.commentCount}</Text>
        </Pressable>
        <Pressable
          onPress={onShare}
          accessibilityRole="button"
          accessibilityLabel="Share"
          className="min-h-11 min-w-11 items-center justify-center gap-xs"
        >
          <Share2 size={24} strokeWidth={1.75} color={colors.textInverse} />
          <Text className="text-xs text-text-inverse">Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default ClutchPostCard;
