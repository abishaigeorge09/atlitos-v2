import { cn } from '@/lib/utils';
import * as Haptics from 'expo-haptics';
import { ChevronDown, MapPin } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 16: LocationBar. Pin icon, current location, chevron, opens the
 * city picker on press. 44pt minimum touch target via min-h-11.
 */
export interface LocationBarProps {
  location: string;
  onPress?: () => void;
  className?: string;
}

function LocationBar({ location, onPress, className }: LocationBarProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
          // Haptics unavailable, not fatal.
        });
        onPress?.();
      }}
      accessibilityRole="button"
      className={cn('min-h-11 flex-row items-center gap-xs self-start rounded-pill px-md active:bg-surface-muted', className)}
    >
      <MapPin size={16} strokeWidth={1.75} color={colors.accent} />
      <Text className="font-sans-medium text-sm text-text">{location}</Text>
      <ChevronDown size={16} strokeWidth={1.75} color={colors.textTertiary} />
    </Pressable>
  );
}

export { LocationBar };
