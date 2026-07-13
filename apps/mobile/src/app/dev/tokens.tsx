import { radii, spacing } from '@atlitos/theme';
import { Moon, Sun } from 'lucide-react-native';
import { colorScheme as nwColorScheme } from 'nativewind';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text as UIText } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Dev token reference: color swatches (surfaces, text, lines, accent,
 * semantic), the full type scale (UI variants + numeric mono variants) and a
 * spacing ruler. Reads @atlitos/theme directly, same source every component
 * traces to, so this screen is always correct by construction, never a hand
 * copied swatch list. Companion to dev/gallery.tsx: gallery shows components
 * in context, this shows the raw values behind them.
 */

const SWATCH_GROUPS: Array<{ label: string; keys: Array<keyof ReturnType<typeof useThemeColors>> }> = [
  { label: 'Surfaces', keys: ['bg', 'surface', 'surfaceMuted', 'card'] },
  { label: 'Text', keys: ['text', 'textSecondary', 'textTertiary', 'textInverse'] },
  { label: 'Lines', keys: ['border', 'borderStrong'] },
  { label: 'Accent', keys: ['accent', 'accentPressed', 'accentTint', 'inkOnAccent'] },
  { label: 'Success', keys: ['success', 'successTint'] },
  { label: 'Warning', keys: ['warning', 'warningTint'] },
  { label: 'Info', keys: ['info', 'infoTint'] },
  { label: 'Danger', keys: ['danger', 'dangerTint'] },
];

const TEXT_VARIANTS = ['display', 'title', 'h1', 'h2', 'h3', 'body', 'callout', 'label', 'caption', 'overline'] as const;
const NUMERIC_VARIANTS = ['numericDisplay', 'numericLg', 'numericBase', 'numericSm'] as const;
const SPACING_KEYS = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] as const;
const RADIUS_KEYS = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', 'pill'] as const;

function Eyebrow({ children }: { children: string }) {
  const colors = useThemeColors();
  return <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>{children}</Text>;
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ width: 108, gap: spacing.xs }}>
      <View
        style={{
          height: 56,
          borderRadius: radii.md,
          backgroundColor: hex,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      />
      <Text style={[textStyle('caption'), { color: colors.text }]}>{name}</Text>
      <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>{hex}</Text>
    </View>
  );
}

export default function TokensScreen() {
  const colors = useThemeColors();
  const [dark, setDark] = useState(false);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    // nativewind's colorScheme.set(), not RN's Appearance.setColorScheme
    // (react-native-web does not implement manual overrides and throws),
    // see src/app/dev/gallery.tsx's ThemeToggle for the fuller writeup.
    nwColorScheme.set(next ? 'dark' : 'light');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View>
          <Text style={[textStyle('h3'), { color: colors.text }]}>Design tokens</Text>
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
            Colors, type scale, spacing, straight from @atlitos/theme
          </Text>
        </View>
        <Button variant="secondary" size="sm" onPress={toggle}>
          {dark ? <Moon size={16} strokeWidth={1.75} color={colors.text} /> : <Sun size={16} strokeWidth={1.75} color={colors.text} />}
          <UIText className="text-sm">{dark ? 'Dark' : 'Light'}</UIText>
        </Button>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'], gap: spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: spacing.lg, paddingTop: spacing.lg }}>
          <Eyebrow>Color</Eyebrow>
          {SWATCH_GROUPS.map((group) => (
            <View key={group.label} style={{ gap: spacing.sm }}>
              <Text style={[textStyle('label'), { color: colors.textSecondary }]}>{group.label}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                {group.keys.map((key) => (
                  <Swatch key={String(key)} name={String(key)} hex={colors[key] as string} />
                ))}
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />

        <View style={{ gap: spacing.md }}>
          <Eyebrow>Type scale, Inter</Eyebrow>
          {TEXT_VARIANTS.map((variant) => (
            <View key={variant} style={{ gap: 2 }}>
              <Text style={[textStyle(variant), { color: colors.text }]}>
                {variant === 'overline' ? 'section label' : 'The quick brown fox'}
              </Text>
              <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>{variant}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />

        <View style={{ gap: spacing.md }}>
          <Eyebrow>Numeric scale, JetBrains Mono, tabular figures</Eyebrow>
          {NUMERIC_VARIANTS.map((variant) => (
            <View key={variant} style={{ gap: 2 }}>
              <Text style={[textStyle(variant), { color: colors.text }]}>₹2,31,000</Text>
              <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>{variant}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />

        <View style={{ gap: spacing.md }}>
          <Eyebrow>Spacing ruler, 4pt base scale</Eyebrow>
          {SPACING_KEYS.map((key) => (
            <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text style={[textStyle('numericSm'), { color: colors.textTertiary, width: 48 }]}>{key}</Text>
              <View style={{ height: 16, width: spacing[key], backgroundColor: colors.accent, borderRadius: radii.xs }} />
              <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>{spacing[key]}px</Text>
            </View>
          ))}
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />

        <View style={{ gap: spacing.md }}>
          <Eyebrow>Radii</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            {RADIUS_KEYS.map((key) => (
              <View key={key} style={{ alignItems: 'center', gap: spacing.xs }}>
                <View
                  style={{
                    height: 56,
                    width: 56,
                    borderRadius: radii[key],
                    backgroundColor: colors.surfaceMuted,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
                <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>{key}</Text>
                <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>{radii[key]}px</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
