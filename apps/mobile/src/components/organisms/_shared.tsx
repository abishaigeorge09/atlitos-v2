import { Button } from '@/components/ui/button';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { radii, spacing } from '@atlitos/theme';
import { Star } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

/**
 * Small internal building blocks shared by the organism components in this
 * folder (32-42 of the locked SPEC.md component library). Several of these
 * stand in for atoms/molecules that are earlier numbers in the same 42
 * component list (Input #2, StarRating #6, StatusPill #8, Stepper #10,
 * BillSummary #25) and are being built on a separate track. These are
 * intentionally minimal, token traced, and local to this folder so the
 * organisms compile and render correctly now; once the canonical
 * atoms/molecules land at their own file paths, callers should swap these
 * for the real components instead of extending these further.
 *
 * Per docs/phases/PHASE-1-SPIKE.md, these use the StyleSheet + textStyle() /
 * useThemeColors() token pattern throughout (not the className/nativewind
 * pattern), since they need the full @atlitos/theme typography scale
 * (title/h2/body/callout/label/caption/numeric*) which is not expressed as
 * Tailwind font size utilities. The existing className based `Button` is
 * composed in as an opaque child, which is coexistence, not mixing within
 * one component.
 */

// TextField, stands in for the locked `Input` atom (multiline supported).
export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function TextField({ label, error, style, multiline, ...props }: TextFieldProps) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Text style={[textStyle('label'), { color: colors.textSecondary }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textTertiary}
        multiline={multiline}
        style={[
          textStyle('body'),
          {
            color: colors.text,
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.sm,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.border,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            minHeight: multiline ? 96 : 48,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
        {...props}
      />
      {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

// StarRating, stands in for the locked `StarRating` atom.
export interface StarRatingProps {
  mode?: 'display' | 'input';
  value: number;
  count?: number;
  onChange?: (value: number) => void;
  size?: number;
}

export function StarRating({ mode = 'display', value, count, onChange, size = 20 }: StarRatingProps) {
  const colors = useThemeColors();
  const stars = [1, 2, 3, 4, 5];
  return (
    <View style={styles.row}>
      <View style={[styles.row, { gap: spacing.xs }]}>
        {stars.map((star) => {
          const filled = star <= Math.round(value);
          const Wrapper = mode === 'input' ? Pressable : View;
          return (
            <Wrapper
              key={star}
              accessibilityRole={mode === 'input' ? 'button' : undefined}
              style={mode === 'input' ? styles.tapTarget : undefined}
              hitSlop={8}
              onPress={mode === 'input' ? () => onChange?.(star) : undefined}
            >
              <Star
                size={size}
                color={filled ? colors.accent : colors.borderStrong}
                fill={filled ? colors.accent : 'transparent'}
                strokeWidth={1.75}
              />
            </Wrapper>
          );
        })}
      </View>
      <Text style={[textStyle('numericSm'), { color: colors.textSecondary, marginLeft: spacing.xs }]}>
        {value.toFixed(1)}/5{count !== undefined ? ` (${count})` : ''}
      </Text>
    </View>
  );
}

// StatusPill, stands in for the locked `StatusPill` atom.
export type StatusPillTone = 'success' | 'warning' | 'info' | 'danger' | 'neutral';

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: StatusPillTone }) {
  const colors = useThemeColors();
  const toneColor: Record<StatusPillTone, { bg: string; fg: string }> = {
    success: { bg: colors.successTint, fg: colors.success },
    warning: { bg: colors.warningTint, fg: colors.warning },
    info: { bg: colors.infoTint, fg: colors.info },
    danger: { bg: colors.dangerTint, fg: colors.danger },
    neutral: { bg: colors.surfaceMuted, fg: colors.textSecondary },
  };
  const { bg, fg } = toneColor[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      <Text style={[textStyle('label'), { color: fg }]}>{label}</Text>
    </View>
  );
}

// BillSummary, stands in for the locked `BillSummary` molecule. Every money
// screen uses this shared line item plus mono total pattern, per CLAUDE.md's
// financial invariant ("no hand rolled price breakdowns").
export interface BillSummaryLine {
  label: string;
  amount: string;
}

export function BillSummary({ lines, total }: { lines: BillSummaryLine[]; total: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.sm }}>
      {lines.map((line) => (
        <View key={line.label} style={styles.between}>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{line.label}</Text>
          <Text style={[textStyle('numericBase'), { color: colors.text }]}>{line.amount}</Text>
        </View>
      ))}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
      <View style={styles.between}>
        <Text style={[textStyle('h3'), { color: colors.text }]}>Total</Text>
        <Text style={[textStyle('numericLg'), { color: colors.text }]}>{total}</Text>
      </View>
    </View>
  );
}

// Stepper, stands in for the locked `Stepper` atom.
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.row, { gap: spacing.xs }]}>
      {steps.map((step, index) => {
        const active = index === current;
        const done = index < current;
        return (
          <React.Fragment key={step}>
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
              <View
                style={{
                  height: 32,
                  width: 32,
                  borderRadius: radii.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done || active ? colors.accent : colors.surfaceMuted,
                }}
              >
                <Text
                  style={[
                    textStyle('numericSm'),
                    { color: done || active ? colors.inkOnAccent : colors.textTertiary },
                  ]}
                >
                  {index + 1}
                </Text>
              </View>
              <Text
                style={[
                  textStyle('caption'),
                  { color: active ? colors.text : colors.textTertiary, maxWidth: 72 },
                ]}
                numberOfLines={1}
              >
                {step}
              </Text>
            </View>
            {index < steps.length - 1 ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  flex: 1,
                  backgroundColor: done ? colors.accent : colors.border,
                }}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

export { Button };

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tapTarget: { height: 44, width: 44, alignItems: 'center', justifyContent: 'center' },
});
