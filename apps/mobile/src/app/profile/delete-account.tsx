import {
  accountDeletionBlockerFromError,
  accountDeletionBlockerMessage,
  toApiError,
  useAccountDeletion,
  type AccountDeletionPreview,
} from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { AlertTriangle, Archive, LogIn, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Delete account (Apple App Store Guideline 5.1.1(v), Google Play account
 * deletion policy). An account created in the app must be deletable from
 * inside the app; the atlitos.com/delete-account web page is a
 * request-by-email mechanism and does not satisfy either policy on its own.
 *
 * Deliberately hard to hit by accident: reaching this screen is one tap, but
 * completing it needs the word DELETE typed exactly. There is no way to
 * trigger the request from the Settings row alone.
 *
 * Every count on this screen comes from `account_deletion_preview()` (0098),
 * never from copy written here, so what the user is told about their own
 * account is true for their own account.
 *
 * FINANCIAL INVARIANT: this screen writes nothing. It calls one read only RPC
 * and one edge function. Deletion runs entirely server side.
 */

/** The typed confirmation. Compared case sensitively, so a stray tap cannot pass. */
const CONFIRM_WORD = 'DELETE';

function Row({ label, value }: { label: string; value: number }) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={[textStyle('callout'), { color: colors.textSecondary, flex: 1 }]}>{label}</Text>
      <Text style={[textStyle('numericSm'), { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function Card({
  tone,
  icon: Icon,
  title,
  body,
  children,
}: {
  tone: 'danger' | 'muted';
  icon: typeof Trash2;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const colors = useThemeColors();
  const accent = tone === 'danger' ? colors.danger : colors.textSecondary;
  return (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.lg,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: tone === 'danger' ? colors.danger : colors.border,
        backgroundColor: tone === 'danger' ? colors.dangerTint : colors.card,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon size={18} strokeWidth={1.75} color={accent} />
        <Text style={[textStyle('label'), { color: accent }]}>{title}</Text>
      </View>
      <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{body}</Text>
      {children}
    </View>
  );
}

export default function DeleteAccountScreen() {
  const colors = useThemeColors();
  const deletionApi = useAccountDeletion(supabase);

  const status = useSessionStore((state) => state.status);
  const signOut = useSessionStore((state) => state.signOut);
  const continueAsGuest = useSessionStore((state) => state.continueAsGuest);

  const isSignedIn = status === 'signed_in';

  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await deletionApi.preview();
        if (!cancelled) setPreview(result);
      } catch (caught) {
        if (!cancelled) setError(toApiError(caught).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // deletionApi is rebuilt per render from a module singleton client, so
    // depending on it here would refetch forever. The session identity is what
    // actually changes what this reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const blockerMessage = useMemo(() => {
    if (!preview?.blocker) return null;
    return accountDeletionBlockerMessage(preview.blocker, preview.blockerCount);
  }, [preview]);

  const canDelete = confirmText === CONFIRM_WORD && !preview?.blocker && !deleting;

  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deletionApi.deleteAccount();
      // Signed out, then back to silent guest browsing, the same landing the
      // Settings sign out uses. Never a login wall.
      await signOut();
      await continueAsGuest();
      router.replace('/(tabs)');
    } catch (caught) {
      const apiError = toApiError(caught);
      const blocker = accountDeletionBlockerFromError(apiError);
      setError(
        blocker
          ? accountDeletionBlockerMessage(blocker, preview?.blockerCount ?? 0)
          : 'Could not delete your account. Please try again.',
      );
      setDeleting(false);
    }
  }

  if (!isSignedIn) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Delete account" onPressBack={() => router.back()} />
        <EmptyState
          icon={LogIn}
          title="Sign in first"
          body="You need to be signed in to delete an account."
          ctaLabel="Sign in"
          onCtaPress={() => router.push("/(auth)/login")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Delete account" onPressBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}
      >
        {loading ? (
          <View style={{ paddingVertical: spacing['4xl'], alignItems: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            <Card
              tone="danger"
              icon={AlertTriangle}
              title="This cannot be undone"
              body="Deleting removes your profile, your clips, who you follow and your saved items. You will be signed out and you will not be able to sign back in to this account."
            >
              {preview ? (
                <View style={{ marginTop: spacing.xs }}>
                  <Row label="Clips" value={preview.removed.clips} />
                  <Row label="Following and followers" value={preview.removed.follows} />
                  <Row label="Saved addresses" value={preview.removed.addresses} />
                  <Row label="Saved items" value={preview.removed.savedItems} />
                  <Row label="Items in your cart" value={preview.removed.cartItems} />
                </View>
              ) : null}
            </Card>

            <Card
              tone="muted"
              icon={Archive}
              title="What we have to keep"
              body="Payment, order, booking and donation records are kept for tax and legal reasons, exactly as our privacy policy says. Your name is removed from them and from any message or comment you left, so other people see a deleted profile instead of you."
            >
              {preview ? (
                <View style={{ marginTop: spacing.xs }}>
                  <Row label="Orders" value={preview.retained.orders} />
                  <Row label="Payments" value={preview.retained.payments} />
                  <Row label="Donations" value={preview.retained.donations} />
                  <Row label="Coaching sessions" value={preview.retained.sessions} />
                  <Row label="Court bookings" value={preview.retained.courtBookings} />
                </View>
              ) : null}
            </Card>

            {blockerMessage ? (
              <Card tone="muted" icon={AlertTriangle} title="Not just yet" body={blockerMessage} />
            ) : (
              <View style={{ gap: spacing.sm }}>
                <Text style={[textStyle('label'), { color: colors.text }]}>
                  Type {CONFIRM_WORD} to confirm
                </Text>
                <TextInput
                  value={confirmText}
                  onChangeText={setConfirmText}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!deleting}
                  accessibilityLabel={`Type ${CONFIRM_WORD} to confirm account deletion`}
                  placeholder={CONFIRM_WORD}
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    textStyle('body'),
                    {
                      color: colors.text,
                      borderWidth: 1,
                      borderColor: confirmText === CONFIRM_WORD ? colors.danger : colors.border,
                      backgroundColor: colors.card,
                      borderRadius: radii.md,
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                    },
                  ]}
                />
                <Button
                  variant="destructive"
                  disabled={!canDelete}
                  onPress={() => void handleDelete()}
                >
                  {deleting ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <Trash2 size={18} strokeWidth={1.75} color={colors.textInverse} />
                  )}
                  <Text style={[textStyle('label'), { color: colors.textInverse }]}>
                    {deleting ? 'Deleting your account' : 'Delete my account'}
                  </Text>
                </Button>
                <Button variant="secondary" disabled={deleting} onPress={() => router.back()}>
                  <Text style={[textStyle('label'), { color: colors.text }]}>Keep my account</Text>
                </Button>
              </View>
            )}

            {error ? (
              <Text style={[textStyle('caption'), { color: colors.danger }]}>{error}</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
