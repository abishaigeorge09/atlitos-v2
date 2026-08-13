import { radii, spacing } from '@atlitos/theme';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * The one place the app admits, in plain words, that part of the session did
 * not come up. SCALE-INGRESS.md Gap B and section 2.
 *
 * It exists because the two failures it covers used to be handled in opposite
 * and equally wrong ways. A returning signed-in user whose profile fetch failed
 * was stopped dead on a full screen wall with no route into the app, while a
 * guest whose anonymous mint was refused was let straight in with no
 * explanation at all and a retry loop that would run forever without ever
 * telling them anything. Both now do the same thing: enter the app, keep
 * working on what is genuinely available, and say something true here.
 *
 * Two rules this component holds to:
 *
 *   - It is NEVER a blocker. It renders in the normal document flow above the
 *     tab content, so it can be ignored completely and every surface behind it
 *     still works. There is no overlay, no modal and no dismiss-to-continue.
 *   - It only appears once the automatic retries have actually given up. While
 *     the background loop is still working, showing a warning would be noise
 *     about a problem that is about to fix itself.
 *
 * The retry button matters more than it looks. It is the only retry in either
 * loop that is a person rather than a timer, which is exactly why it is the
 * one worth spending a rate limit token on.
 */
export function SessionDegradedBanner() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);
  const meGaveUp = useSessionStore((state) => state.meGaveUp);
  const guestMintGaveUp = useSessionStore((state) => state.guestMintGaveUp);
  const refreshMe = useSessionStore((state) => state.refreshMe);
  const retryGuestMint = useSessionStore((state) => state.retryGuestMint);

  const profileDegraded = status === 'signed_in' && me == null && meGaveUp;
  const mintDegraded = status === 'guest_unminted' && guestMintGaveUp;

  if (!profileDegraded && !mintDegraded) return null;

  // Copy rule (CLAUDE.md): no em dashes, no hyphens, no emoji, and nothing
  // that overstates what is wrong. Both lines below say what still works
  // before they say what does not.
  const message = profileDegraded
    ? 'Browsing works, but we could not load your profile. Tap to try again.'
    : 'Browsing works, but saving and booking need a connection. Tap to try again.';

  const onRetry = profileDegraded ? () => void refreshMe() : retryGuestMint;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={message}
      onPress={onRetry}
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: spacing.sm,
        paddingHorizontal: spacing.lg,
        backgroundColor: colors.warningTint,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
      }}
    >
      <CloudOff size={16} strokeWidth={1.75} color={colors.warning} />
      <Text style={[textStyle('caption'), { color: colors.text, flex: 1 }]}>{message}</Text>
      <View
        style={{
          height: 28,
          width: 28,
          borderRadius: radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surface,
        }}
      >
        <RefreshCw size={14} strokeWidth={1.75} color={colors.text} />
      </View>
    </Pressable>
  );
}
