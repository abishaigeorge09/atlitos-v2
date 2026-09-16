import { radii, spacing, vendorBrand } from '@atlitos/theme';
import * as AppleAuthentication from 'expo-apple-authentication';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/ui/text';
import { isAppleSignInAvailable } from '@/lib/oauth';
import { textStyle } from '@/theme/text-style';

/**
 * Third party sign in buttons, PRD-01 3.1.
 *
 * On the icons: the house rule is lucide names only, and it holds for product
 * iconography. It cannot apply here. Lucide deliberately ships no brand
 * marks, so there is no lucide equivalent to stand in for, and both providers
 * mandate their own mark on their sign in button. Apple additionally rejects
 * a hand rolled button, which is why Apple's own native
 * `AppleAuthenticationButton` is used rather than a styled Pressable. The
 * Google mark below is the official four colour G, inline so it needs no
 * remote asset and renders identically offline.
 */

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

export interface GoogleSignInButtonProps {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * White pill matching the login reference. Deliberately NOT a `Button`
 * variant: that component's API is locked to primary/ghost/text/destructive
 * (SPEC 5.1 #1) and a provider button is not a fifth product variant, it is
 * a vendor surface with its own mandated look.
 */
export function GoogleSignInButton({ onPress, loading, disabled }: GoogleSignInButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign in with Google"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1 })}
    >
      {/* The plate is an inner View, not the Pressable itself. Pressable's
          style is a callback here, and NativeWind's interop on a Pressable
          with no className has dropped it before, which renders the label as
          dark ink on the dark page and the button reads as missing. A plain
          View takes a plain style object and cannot be interfered with. */}
      <View
        style={{
          height: 44,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          borderRadius: radii.pill,
          backgroundColor: vendorBrand.googleButtonSurface,
        }}
      >
        {loading ? (
          <ActivityIndicator color={vendorBrand.googleButtonInk} />
        ) : (
          <>
            <GoogleMark />
            {/* Google's mark sits on white by their brand rules, so this
                label colour is fixed to their spec rather than themed. */}
            <Text style={[textStyle('button'), { color: vendorBrand.googleButtonInk }]}>
              Sign in with Google
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export interface AppleSignInButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

/**
 * Apple's own native button. Renders nothing off iOS, where the native sheet
 * does not exist.
 */
export function AppleSignInButton({ onPress, disabled }: AppleSignInButtonProps) {
  if (!isAppleSignInAvailable()) return null;

  return (
    <View style={{ opacity: disabled ? 0.6 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={radii.pill}
        style={{ height: 44, width: '100%' }}
        onPress={onPress}
      />
    </View>
  );
}
