import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';
import { Search, Sparkles } from 'lucide-react-native';
import type { ComponentProps } from 'react';
import { Pressable, TextInput, View } from 'react-native';

export type SearchBarVariant = 'plain' | 'ai';

export interface SearchBarProps extends Omit<ComponentProps<typeof TextInput>, 'placeholder'> {
  variant?: SearchBarVariant;
  placeholder?: string;
  /** Renders as a non-editable entry point that navigates instead of a live TextInput. */
  onPress?: () => void;
}

/**
 * SearchBar. Locked API per SPEC Section 5.1 #4: `variant` plain|ai,
 * `placeholder`. The `ai` variant carries a lucide Sparkles icon and
 * defaults its placeholder to "What are you looking for...", opening the AI
 * Search screen (SPEC 6.2, /home/search). `onPress` lets Home render this as
 * a tappable entry point rather than a live input.
 */
function SearchBar({ variant = 'plain', placeholder, onPress, className, editable, ...props }: SearchBarProps) {
  const colors = useThemeColors();
  const resolvedPlaceholder = placeholder ?? (variant === 'ai' ? 'What are you looking for...' : 'Search');

  const content = (
    <View
      className={cn(
        'h-11 flex-row items-center gap-sm rounded-sm border border-border bg-surface-muted px-md',
        className,
      )}
    >
      {variant === 'ai' ? (
        <Sparkles size={20} color={colors.accent} strokeWidth={1.75} />
      ) : (
        <Search size={20} color={colors.textTertiary} strokeWidth={1.75} />
      )}
      <TextInput
        style={{ pointerEvents: onPress ? 'none' : 'auto' }}
        editable={onPress ? false : editable}
        placeholder={resolvedPlaceholder}
        placeholderTextColor={colors.textTertiary}
        className="flex-1 font-sans text-base text-text"
        {...props}
      />
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={resolvedPlaceholder}>
        {content}
      </Pressable>
    );
  }

  return content;
}

export { SearchBar };
