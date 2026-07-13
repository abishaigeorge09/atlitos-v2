import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';
import { Eye, EyeOff } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Pressable, TextInput, View } from 'react-native';

export type InputType = 'text' | 'password' | 'phone' | 'pincode' | 'multiline';

export interface InputProps
  extends Omit<ComponentProps<typeof TextInput>, 'secureTextEntry' | 'multiline' | 'keyboardType'> {
  type?: InputType;
  label?: string;
  error?: string;
  required?: boolean;
  containerClassName?: string;
}

/**
 * Input. Locked API per SPEC Section 5.1 #2: `type`
 * text|password|phone|pincode|multiline, `label`, `error`, `required`.
 * Labels end with "*" when required, per the v1 designs. surfaceMuted fill,
 * radius.sm, border outline, 2px accent outline on focus, danger outline on
 * error, per DESIGN-LANGUAGE's "Inputs" component tone.
 */
const Input = forwardRef<TextInput, InputProps>(function Input(
  { type = 'text', label, error, required, containerClassName, className, onFocus, onBlur, ...props },
  ref,
) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [secure, setSecure] = useState(type === 'password');

  const isMultiline = type === 'multiline';
  const keyboardType = type === 'phone' || type === 'pincode' ? 'number-pad' : 'default';
  const borderColorClass = error ? 'border-danger' : focused ? 'border-accent' : 'border-border';
  const borderWidthClass = focused || error ? 'border-2' : 'border';

  return (
    <View className={cn('gap-xs', containerClassName)}>
      {label ? (
        <Text className="text-sm font-sans-semibold text-text">
          {label}
          {required ? <Text className="text-danger">{' *'}</Text> : null}
        </Text>
      ) : null}
      <View
        className={cn(
          'flex-row items-center rounded-sm bg-surface-muted px-md',
          borderWidthClass,
          borderColorClass,
          isMultiline ? 'min-h-24 items-start py-md' : 'h-11',
        )}
      >
        <TextInput
          ref={ref}
          className={cn('flex-1 font-sans text-base text-text', isMultiline && 'min-h-16', className)}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={secure}
          multiline={isMultiline}
          keyboardType={keyboardType}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />
        {type === 'password' ? (
          <Pressable
            onPress={() => setSecure((current) => !current)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={secure ? 'Show password' : 'Hide password'}
            className="pl-sm"
          >
            {secure ? (
              <EyeOff size={20} color={colors.textTertiary} strokeWidth={1.75} />
            ) : (
              <Eye size={20} color={colors.textTertiary} strokeWidth={1.75} />
            )}
          </Pressable>
        ) : null}
      </View>
      {error ? <Text className="text-xs text-danger">{error}</Text> : null}
    </View>
  );
});

export { Input };
