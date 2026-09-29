import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';
import { Search, Sparkles } from 'lucide-react-native';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
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
 *
 * The input is UNCONTROLLED (BUG-058). As a controlled input (`value` passed
 * straight through), fast typing dropped characters ("badminton" arrived as
 * "bon", "turf" as "t") because each keystroke re-renders the whole search
 * screen and the native field was reset to a stale `value` while JS caught
 * up. Now the native field owns the text and reports it up through
 * `onChangeText`; `value` is still honoured when the screen changes it
 * itself (a suggestion chip, a recent search, the clear button): `''` clears
 * in place, any other text remounts the field with that text. `autoFocus`
 * applies to the first mount only, so a chip fills the field and puts the
 * keyboard away instead of reopening it.
 */
function SearchBar({
  variant = 'plain',
  placeholder,
  onPress,
  className,
  editable,
  value,
  onChangeText,
  autoFocus,
  ...props
}: SearchBarProps) {
  const colors = useThemeColors();
  const resolvedPlaceholder = placeholder ?? (variant === 'ai' ? 'What are you looking for...' : 'Search');
  const inputRef = useRef<TextInput>(null);
  const lastText = useRef(value ?? '');
  // The text a mount STARTS with, fixed for that mount. React Native derives a
  // TextInput's text from `defaultValue` when there is no `value` and pushes
  // it into the native field whenever it changes, so a `defaultValue` that
  // tracked every keystroke made the field controlled again and letters were
  // still dropped. It only changes together with `mountKey`.
  const mountText = useRef(value ?? '');
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    const next = value ?? '';
    if (next === lastText.current) return;
    lastText.current = next;
    if (next === '') {
      inputRef.current?.clear();
      return;
    }
    mountText.current = next;
    setMountKey((key) => key + 1);
  }, [value]);

  const handleChangeText = (text: string) => {
    lastText.current = text;
    onChangeText?.(text);
  };

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
        key={mountKey}
        ref={inputRef}
        defaultValue={mountText.current}
        onChangeText={handleChangeText}
        autoFocus={mountKey === 0 ? autoFocus : false}
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
