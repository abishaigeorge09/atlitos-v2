import { fontSize, radii, spacing, vendorBrand } from '@atlitos/theme';
import { useColorScheme } from 'nativewind';
import type { ReactNode } from 'react';
// React Native's own Text, not the app's: the app Text applies the Urbanist
// class, and these labels must be the system font on both plates.
import { ActivityIndicator, Pressable, Text, View, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { isAppleSignInAvailable } from '@/lib/oauth';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Third party sign in buttons, PRD-01 3.1.
 *
 * On the icons: the house rule is lucide names only, and it holds for product
 * iconography. It cannot apply here. Lucide deliberately ships no brand
 * marks, so there is no lucide equivalent to stand in for, and both providers
 * mandate their own mark on their sign in button. Both marks are inline SVG
 * (the official four colour G, and the Apple logo) so they need no remote
 * asset and render identically offline.
 *
 * Both buttons share one plate: the Login button's 48pt height, a pill, and
 * the same label in the system font at the same size (founder, 2026-09-30:
 * the two labels did not match). Apple's native AppleAuthenticationButton
 * draws its own label at a size tied to its height with no font prop, so it
 * could never sit level with Google's. Apple's HIG allows a custom Sign in
 * with Apple button that uses the Apple logo, a black or white plate and the
 * system font, which is what this draws; the system font on both keeps them
 * identical.
 */

const SOCIAL_BUTTON_HEIGHT = 48;
const APPLE_MARK_SIZE = 18;

/** Shared label: system font (no fontFamily), same size and weight on both. */
const socialLabel: TextStyle = { fontSize: fontSize.lg, fontWeight: '600', lineHeight: 22 };

/** Apple logo, inline. */
function AppleMark({ color }: { color: string }) {
  return (
    <Svg width={APPLE_MARK_SIZE} height={APPLE_MARK_SIZE} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </Svg>
  );
}

const GOOGLE_MARK_SIZE = 18;

/** Official Google "G", drawn inline rather than pulled from a CDN. */
function GoogleMark() {
  return (
    <Svg width={GOOGLE_MARK_SIZE} height={GOOGLE_MARK_SIZE} viewBox="0 0 48 48">
      <Path
        fill={vendorBrand.googleBlue}
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill={vendorBrand.googleGreen}
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill={vendorBrand.googleYellow}
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill={vendorBrand.googleRed}
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

interface PlateProps {
  label: string;
  mark: ReactNode;
  surface: string;
  ink: string;
  border?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/** One plate for both providers, so height, radius and label always match. */
function ProviderPlate({ label, mark, surface, ink, border, onPress, loading, disabled }: PlateProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      disabled={isDisabled}
      onPress={onPress}
      // Pressed feedback is an `active:` class; NativeWind's interop on a
      // Pressable drops a `({ pressed }) => style` callback.
      className="active:opacity-80"
      style={isDisabled ? { opacity: 0.6 } : undefined}
    >
      {/* The plate is an inner View with a plain style object, which
          NativeWind's Pressable interop cannot interfere with. */}
      <View
        style={{
          height: SOCIAL_BUTTON_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          borderRadius: radii.pill,
          backgroundColor: surface,
          borderWidth: border ? 1 : 0,
          borderColor: border,
        }}
      >
        {loading ? (
          <ActivityIndicator color={ink} />
        ) : (
          <>
            {mark}
            <Text style={[socialLabel, { color: ink }]}>{label}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export interface GoogleSignInButtonProps {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/** White plate with the four colour G. Google's plate and ink are fixed by
 * their brand rules, so they are not themed. On a light page a hairline keeps
 * the white plate reading as a button (launch runbook 3.7). */
export function GoogleSignInButton({ onPress, loading, disabled }: GoogleSignInButtonProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  return (
    <ProviderPlate
      label="Sign in with Google"
      mark={<GoogleMark />}
      surface={vendorBrand.googleButtonSurface}
      ink={vendorBrand.googleButtonInk}
      border={colorScheme === 'dark' ? undefined : colors.borderStrong}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
    />
  );
}

export interface AppleSignInButtonProps {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/** Black plate on a light page, white on a dark one, so it is always
 * visible (Apple HIG). Renders nothing off iOS, where the native sheet does
 * not exist. */
export function AppleSignInButton({ onPress, loading, disabled }: AppleSignInButtonProps) {
  const { colorScheme } = useColorScheme();
  if (!isAppleSignInAvailable()) return null;
  const dark = colorScheme === 'dark';
  const surface = dark ? vendorBrand.appleWhite : vendorBrand.appleBlack;
  const ink = dark ? vendorBrand.appleBlack : vendorBrand.appleWhite;
  return (
    <ProviderPlate
      label="Sign in with Apple"
      mark={<AppleMark color={ink} />}
      surface={surface}
      ink={ink}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
    />
  );
}
