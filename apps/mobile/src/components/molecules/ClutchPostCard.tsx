import { useClutch } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { Clip } from '@atlitos/types';
import * as Haptics from 'expo-haptics';
import { EllipsisVertical, Heart, MessageCircle, Share2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ClipVideo } from '@/components/molecules/clip-video';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
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
  active = false,
  onLike,
  onComment,
  onShare,
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

  // BUG-02. Every tile in every profile grid rendered blank, on purpose and
  // permanently. `mapClipRow` sets `thumbUrl` only when `clips.thumb_path` is
  // already an absolute http URL, and it never is: the column holds a path into
  // the PRIVATE clips bucket, so `isHttpUrl` is false for every row and the
  // poster was always undefined. hooks.ts even says it is waiting for "a
  // signed-thumb seam"; this is that seam.
  //
  // The feed variant already receives a signed `posterUrl` because the feed
  // screen mints one per visible card. The grid has no such owner, so the tile
  // mints its own. `get-clip-playback-url` returns `thumbUrl` beside the video
  // URL and applies the same authorisation, so the owner still sees their own
  // pending or rejected clips and nobody else does.
  //
  // Safe to do per tile: FlatList virtualises the grid, so only tiles that are
  // actually on screen ever mount and call this. Skipped entirely when a poster
  // was passed in or the row already had a usable URL.
  const clutch = useClutch(supabase);
  const [mintedThumb, setMintedThumb] = useState<string | undefined>(undefined);
  const needsThumb = variant === 'thumb' && !posterUrl && !clip.thumbUrl;

  useEffect(() => {
    if (!needsThumb) return;
    let cancelled = false;
    void (async () => {
      try {
        const playback = await clutch.getPlaybackUrl(clip.id);
        if (!cancelled && playback.thumbUrl) setMintedThumb(playback.thumbUrl);
      } catch {
        // A clip whose bytes never landed, or one this viewer may not see,
        // legitimately has no poster. The tile keeps its surface colour rather
        // than showing a broken image.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsThumb, clip.id, clutch]);

  const thumbSource = posterUrl ?? clip.thumbUrl ?? mintedThumb;

  if (variant === 'thumb') {
    // Single Pressable, only non-interactive children (no nested pressables).
    return (
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open clip, ${clip.likes} likes`}
        className="aspect-square flex-1 overflow-hidden rounded-sm bg-surface-muted active:opacity-90"
      >
        {thumbSource ? (
          <Image source={{ uri: thumbSource }} className="absolute inset-0 h-full w-full" resizeMode="cover" />
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
