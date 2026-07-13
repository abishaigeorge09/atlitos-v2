import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';
import { BadgeCheck } from 'lucide-react-native';
import { Image, View } from 'react-native';

export type AvatarSize = 32 | 40 | 56 | 80;

export interface AvatarProps {
  uri?: string;
  name?: string;
  size?: AvatarSize;
  verifiedBadge?: boolean;
}

const BADGE_SIZE: Record<AvatarSize, number> = { 32: 12, 40: 14, 56: 18, 80: 22 };
const INITIALS_TEXT_CLASS: Record<AvatarSize, string> = {
  32: 'text-xs',
  40: 'text-sm',
  56: 'text-lg',
  80: 'text-2xl',
};

function initialsOf(name?: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Avatar. Locked API per SPEC Section 5.1 #7: `size` 32|40|56|80,
 * `verifiedBadge?`. Falls back to initials on an accentTint circle when no
 * `uri` is given. `verifiedBadge` renders a lucide BadgeCheck at the bottom
 * right corner in accent on a bg-colored halo, the v1 pattern for verified
 * coaches/UPAs.
 */
function Avatar({ uri, name, size = 40, verifiedBadge }: AvatarProps) {
  const colors = useThemeColors();
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image source={{ uri }} style={dimension} accessibilityLabel={name ? `${name}'s avatar` : 'Avatar'} />
      ) : (
        <View
          style={[dimension, { backgroundColor: colors.accentTint }]}
          className="items-center justify-center"
        >
          <Text className={cn('font-sans-semibold', INITIALS_TEXT_CLASS[size])} style={{ color: colors.accent }}>
            {initialsOf(name)}
          </Text>
        </View>
      )}
      {verifiedBadge ? (
        <View className="absolute bottom-0 right-0 items-center justify-center rounded-pill bg-bg p-xs">
          <BadgeCheck size={BADGE_SIZE[size]} color={colors.accent} strokeWidth={2} />
        </View>
      ) : null}
    </View>
  );
}

export { Avatar };
