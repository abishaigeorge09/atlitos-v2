import {
  rnFontFamily,
  type NumericVariant,
  type TextVariant,
  type TextVariantStyle,
  numericVariants,
  textVariants,
} from '@atlitos/theme';
import type { TextStyle } from 'react-native';

/**
 * Resolves an `@atlitos/theme` text or numeric variant to a React Native
 * `TextStyle`, mapping the (family, weight) token pair to the
 * expo-google-fonts loaded font name per `rnFontFamily`. Screens should
 * always go through this instead of hand rolling font styles.
 */
export function textStyle(variant: TextVariant | NumericVariant): TextStyle {
  const spec: TextVariantStyle =
    variant in textVariants
      ? textVariants[variant as TextVariant]
      : numericVariants[variant as NumericVariant];

  const familyWeights: Record<string, string> = rnFontFamily[spec.fontFamily];

  const style: TextStyle = {
    fontFamily: familyWeights[spec.fontWeight],
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
  };

  if (spec.letterSpacing !== undefined) {
    style.letterSpacing = spec.letterSpacing;
  }
  if (spec.letterSpacingEm !== undefined) {
    style.letterSpacing = spec.letterSpacingEm * spec.fontSize;
  }
  if (spec.uppercase) {
    style.textTransform = 'uppercase';
  }
  if (spec.tabularNums) {
    style.fontVariant = ['tabular-nums'];
  }

  return style;
}
