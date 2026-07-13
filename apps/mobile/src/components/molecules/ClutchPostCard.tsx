import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';
import type { Clip } from '@atlitos/types';
import * as Haptics from 'expo-haptics';
import { Heart, MessageCircle, Share2 } from 'lucide-react-native';
import { Image, Pressable, View } from 'react-native';

/**
 * SPEC #23. Two variants: `feed` (full video card with engagement rail, per
 * SPEC "video thumb, channel, likes, timestamp, top comment, View all N
 * comments") and `thumb` (square grid tile for a creator profile grid, a
 * flagged extension: SPEC only describes the feed context in prose).
 */
export type ClutchPostCardVariant = 'feed' | 'thumb';

export interface ClutchPostCardProps {
  clip: Clip;
  variant?: ClutchPostCardVariant;
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

export function ClutchPostCard({ clip, variant = 'feed', onLike, onComment, onShare, onOpen }: ClutchPostCardProps) {
  const colors = useThemeColors();

  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLike?.();
  };

  if (variant === 'thumb') {
    return (
      <Pressable
        onPress={onOpen}
        role="button"
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
    <Pressable
      onPress={onOpen}
      role="button"
      className="overflow-hidden rounded-md bg-text"
      style={{ width: '100%', aspectRatio: 9 / 16 }}
    >
      {clip.thumbUrl ? (
        <Image source={{ uri: clip.thumbUrl }} className="absolute inset-0 h-full w-full" resizeMode="cover" />
      ) : null}

      <View className="absolute inset-x-0 bottom-0 gap-xs p-md" style={{ right: 64 }}>
        <View className="flex-row items-center gap-sm">
          <Text className="font-sans-semibold text-text-inverse">{clip.channel}</Text>
          <Text className="text-xs text-text-inverse opacity-80">{timeAgo(clip.createdAt)}</Text>
        </View>
        {clip.topComment ? (
          <Text className="text-xs text-text-inverse opacity-90" numberOfLines={1}>
            {clip.topComment.username}: {clip.topComment.text}
          </Text>
        ) : null}
        {clip.commentCount > 0 ? (
          <Pressable onPress={onComment} hitSlop={8}>
            <Text className="text-xs text-text-inverse opacity-75">
              View all {clip.commentCount} comments
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View className="absolute bottom-md right-md items-center gap-lg">
        <Pressable onPress={handleLike} role="button" className="min-h-11 min-w-11 items-center justify-center gap-xs">
          <Heart
            size={24}
            strokeWidth={1.75}
            color={clip.likedByMe ? colors.danger : colors.textInverse}
            fill={clip.likedByMe ? colors.danger : 'transparent'}
          />
          <Text className="font-mono text-xs text-text-inverse">{clip.likes}</Text>
        </Pressable>
        <Pressable onPress={onComment} role="button" className="min-h-11 min-w-11 items-center justify-center gap-xs">
          <MessageCircle size={24} strokeWidth={1.75} color={colors.textInverse} />
          <Text className="font-mono text-xs text-text-inverse">{clip.commentCount}</Text>
        </Pressable>
        <Pressable onPress={onShare} role="button" className="min-h-11 min-w-11 items-center justify-center gap-xs">
          <Share2 size={24} strokeWidth={1.75} color={colors.textInverse} />
          <Text className="text-xs text-text-inverse">Share</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default ClutchPostCard;
