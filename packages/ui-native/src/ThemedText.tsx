import { Text, type TextProps } from "react-native";
import {
  type ColorPalette,
  type NumericVariant,
  type TextVariant,
  fontWeight,
  getTheme,
  numericVariants,
  rnFontFamily,
  textVariants,
  type ThemeMode,
} from "@atlitos/theme";

/**
 * Placeholder proving the ui-native token pattern for P1: every RN style
 * value resolves through @atlitos/theme, never a raw hex or px literal.
 * P1 rebuilds the full 42-component library on react-native-reusables in
 * this package (docs/PLAN.md); ThemedText is the one component that ships
 * in the P0 shell so later components have a working example to extend.
 */

const allVariants = { ...textVariants, ...numericVariants };

/** Color tokens ThemedText is allowed to render with, all string valued. */
type TextTone = Extract<
  keyof ColorPalette,
  "text" | "textSecondary" | "textTertiary" | "textInverse" | "accent" | "danger" | "success"
>;

export interface ThemedTextProps extends TextProps {
  /** Typography token, from either the prose scale or the mono numeric scale. */
  variant?: TextVariant | NumericVariant;
  /** Color token, resolved against `mode`. Defaults to the primary ink. */
  tone?: TextTone;
  /** Theme mode to resolve `tone` against until an app level theme provider lands in P1. */
  mode?: ThemeMode;
}

export function ThemedText({ variant = "body", tone = "text", mode = "light", style, ...rest }: ThemedTextProps) {
  const theme = getTheme(mode);
  const tokenStyle = allVariants[variant];
  const isNumeric = "tabularNums" in tokenStyle && tokenStyle.tabularNums === true;

  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: rnFontFamily[tokenStyle.fontFamily][tokenStyle.fontWeight],
          fontWeight: fontWeight[tokenStyle.fontWeight],
          fontSize: tokenStyle.fontSize,
          lineHeight: tokenStyle.lineHeight,
          letterSpacing:
            "letterSpacingEm" in tokenStyle && tokenStyle.letterSpacingEm !== undefined
              ? tokenStyle.letterSpacingEm * tokenStyle.fontSize
              : "letterSpacing" in tokenStyle
                ? tokenStyle.letterSpacing
                : undefined,
          textTransform: "uppercase" in tokenStyle && tokenStyle.uppercase ? "uppercase" : undefined,
          fontVariant: isNumeric ? ["tabular-nums"] : undefined,
          color: theme.colors[tone],
        },
        style,
      ]}
    >
      {rest.children}
    </Text>
  );
}
