import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';
import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

export interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  autoFocus?: boolean;
}

/**
 * OTPInput. Locked API per SPEC Section 5.1 #3: 6 boxes, auto-advance.
 * `length` defaults to 6. Each box is a single-character TextInput; typing a
 * digit auto-advances focus to the next box, backspace on an empty box moves
 * focus back to the previous box and clears it (standard OTP UX).
 */
function OTPInput({ length = 6, value, onChange, error, autoFocus }: OTPInputProps) {
  const colors = useThemeColors();
  const inputs = useRef<Array<TextInput | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function setDigit(index: number, char: string) {
    const next = digits.slice();
    next[index] = char;
    onChange(next.join('').slice(0, length));
    if (char && index < length - 1) {
      inputs.current[index + 1]?.focus();
    }
  }

  function handleKeyPress(index: number, key: string) {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      const next = digits.slice();
      next[index - 1] = '';
      onChange(next.join('').slice(0, length));
      inputs.current[index - 1]?.focus();
    }
  }

  return (
    <View className="flex-row gap-sm">
      {digits.map((digit, index) => (
        <TextInput
          // Positional, fixed-length boxes that are never reordered, index is a stable key here.
          key={index}
          ref={(element) => {
            inputs.current[index] = element;
          }}
          value={digit}
          onChangeText={(text) => setDigit(index, text.slice(-1).replace(/[^0-9]/g, ''))}
          onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
          onFocus={() => setFocusedIndex(index)}
          onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
          keyboardType="number-pad"
          maxLength={1}
          autoFocus={autoFocus && index === 0}
          placeholderTextColor={colors.textTertiary}
          className={cn(
            'h-12 w-11 rounded-sm bg-surface-muted text-center font-mono text-xl text-text',
            error ? 'border-2 border-danger' : focusedIndex === index ? 'border-2 border-accent' : 'border border-border',
          )}
        />
      ))}
    </View>
  );
}

export { OTPInput };
