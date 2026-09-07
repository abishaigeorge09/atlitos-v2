import { useProfile } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { SPORTS, type Sport } from '@atlitos/types';
import { router } from 'expo-router';
import {
  Bell,
  ChevronRight,
  LogIn,
  FileText,
  LifeBuoy,
  LogOut,
  ShieldCheck,
  Scale,
  UserRoundX,
  Trash2,
  Monitor,
  Moon,
  Palette,
  Sun,
  UserRoundPlus,
  UserRoundPen,
  Volleyball,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { applyTheme, type ThemePref } from '@/lib/apply-theme';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * App Store 5.1.1 needs the privacy policy reachable, and 1.2 needs a published
 * content policy plus a monitored contact, for any app carrying user content.
 * These live OUTSIDE the signed-in branch below so a guest can reach them too,
 * which is the whole point of a published policy.
 */
const LEGAL_LINKS: Array<{ key: string; icon: typeof Sun; label: string; url: string }> = [
  { key: 'privacy', icon: ShieldCheck, label: 'Privacy policy', url: 'https://www.atlitos.com/privacy' },
  { key: 'terms', icon: Scale, label: 'Terms of service', url: 'https://www.atlitos.com/terms' },
  { key: 'content', icon: FileText, label: 'Content policy', url: 'https://www.atlitos.com/content-policy' },
  {
    key: 'support',
    icon: LifeBuoy,
    label: 'Contact support',
    url: 'mailto:founder@synthsports.co?subject=Atlitos%20support',
  },
];

const SPORT_LABEL: Record<Sport, string> = {
  football: 'Football',
  cricket: 'Cricket',
  badminton: 'Badminton',
  tennis: 'Tennis',
};

const THEME_OPTIONS: Array<{ key: ThemePref; label: string; icon: typeof Sun }> = [
  { key: 'system', label: 'System', icon: Monitor },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

const NOTIFICATION_ROWS: Array<{ key: 'sessions' | 'messages' | 'promotions'; label: string; body: string }> = [
  { key: 'sessions', label: 'Session updates', body: 'Requests, confirmations and reminders for your sessions.' },
  { key: 'messages', label: 'Messages', body: 'New messages from your coaches and trainees.' },
  { key: 'promotions', label: 'Offers and news', body: 'Occasional deals, drops and Atlitos updates.' },
];

/** Section wrapper: label plus a card of rows, used for every group so the
 * three entry points render an identical surface. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[textStyle('label'), { color: colors.textSecondary }]}>{title}</Text>
      <View
        style={{
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** Tappable row with an icon, label and trailing chevron. */
function ActionRow({
  icon: Icon,
  label,
  tone = 'default',
  onPress,
}: {
  icon: typeof Sun;
  label: string;
  tone?: 'default' | 'danger';
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const color = tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
      }}
    >
      <Icon size={20} strokeWidth={1.75} color={color} />
      <Text style={[textStyle('body'), { color, flex: 1 }]}>{label}</Text>
      {tone === 'default' ? <ChevronRight size={18} strokeWidth={1.75} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

/**
 * The single Settings and Personalization surface (Phase 9 WS-personalization,
 * BUG-011/012/013). Rendered identically from three entry points: the You
 * bottom tab, a Settings entry on the Profile page, and a Settings entry in
 * the Trainings tab, so the same options are reachable from all three.
 *
 * Personalization is persisted to the caller's own users row through
 * useProfile.updateProfile (owner scoped, no money write, no RLS bypass):
 * preferred sports, city and state, appearance, and notification opt ins.
 * Appearance also applies live via nativewind. The Account section holds
 * Sign out (returns to silent guest browsing, never a login wall) and, for a
 * player who is not already a coach, a Become a coach entry that starts the
 * coach approval flow. Guests see appearance locally plus a prompt to sign in
 * for the profile bound options.
 */
export function SettingsContent() {
  const colors = useThemeColors();
  const profileApi = useProfile(supabase);

  const status = useSessionStore((s) => s.status);
  const me = useSessionStore((s) => s.me);
  const refreshMe = useSessionStore((s) => s.refreshMe);
  const signOut = useSessionStore((s) => s.signOut);
  const [deleting, setDeleting] = useState(false);

  /**
   * App Store 5.1.1(v). Two taps, not one: the first Alert states exactly what
   * survives deletion, because "delete my account" that quietly keeps order
   * history would be a worse surprise than the extra tap. The destructive
   * action is never the default button.
   */
  function confirmDeleteAccount() {
    Alert.alert(
      'Delete your account',
      'This permanently removes your profile, clips, comments, chats, saved addresses and cart. Your order and payment records are kept, without your name attached, because we are required to retain them. This cannot be undone.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Are you sure?', 'Deleting your account signs you out immediately and cannot be reversed.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete forever', style: 'destructive', onPress: () => void handleDeleteAccount() },
            ]);
          },
        },
      ],
    );
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await profileApi.deleteAccount();
      // Sign out locally straight away. The access token stays syntactically
      // valid until it expires; every server layer refuses it, but leaving it
      // on the device would show a signed-in shell over an account that is
      // gone. signOut() returns the app to guest, the same path as Sign out.
      await signOut();
    } catch (e) {
      const message = (e as { message?: string })?.message;
      Alert.alert('We could not delete your account', message ?? 'Please try again, or contact support.');
    } finally {
      setDeleting(false);
    }
  }
  const continueAsGuest = useSessionStore((s) => s.continueAsGuest);

  const isSignedIn = status === 'signed_in';
  const isCoach = me?.coachStatus === 'verified' || me?.coachStatus === 'pending_review';

  const [city, setCity] = useState(me?.city ?? '');
  const [state, setState] = useState(me?.state ?? '');
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optimistic mirrors so a toggle/chip reflects instantly while the write
  // lands; refreshMe reconciles from the row afterwards.
  const [themePref, setThemePref] = useState<ThemePref>(me?.theme ?? 'system');
  const [sports, setSports] = useState<Sport[]>(me?.sports ?? []);
  const [prefs, setPrefs] = useState(me?.notificationPrefs ?? { sessions: true, messages: true, promotions: false });

  // BUG-10. Every field above seeds from `me` with a useState INITIALISER,
  // which React evaluates once, on first mount. This screen is not guarded on
  // the profile having loaded (settings.tsx renders <SettingsContent /> flat),
  // so on any path where `me` resolves after mount -- a cold open straight to
  // Settings, a slow network, a signed-in user whose profile fetch is still in
  // flight -- the form rendered permanently empty and a Save would then write
  // those blanks back over real values.
  //
  // It looked fine in testing only because navigating from an already-warm app
  // meant `me` happened to be cached before this mounted.
  //
  // Sync once per account, keyed on the user id, and never after the member has
  // started editing: re-seeding under someone's fingers would discard their
  // typing every time `me` refetched.
  const seededForUserId = useRef<string | null>(null);
  useEffect(() => {
    if (!me?.id || seededForUserId.current === me.id) return;
    seededForUserId.current = me.id;
    setCity(me.city ?? '');
    setState(me.state ?? '');
    setThemePref(me.theme ?? 'system');
    setSports(me.sports ?? []);
    setPrefs(me.notificationPrefs ?? { sessions: true, messages: true, promotions: false });
  }, [me]);

  async function persist(patch: Parameters<typeof profileApi.updateProfile>[0]) {
    if (!isSignedIn) return;
    setBusy(true);
    setError(null);
    try {
      await profileApi.updateProfile(patch);
      await refreshMe();
    } catch {
      setError('Could not save that change. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleTheme(pref: ThemePref) {
    setThemePref(pref);
    applyTheme(pref);
    void persist({ theme: pref });
  }

  function toggleSport(sport: Sport) {
    const next = sports.includes(sport) ? sports.filter((s) => s !== sport) : [...sports, sport];
    setSports(next);
    void persist({ sports: next });
  }

  function toggleNotification(key: 'sessions' | 'messages' | 'promotions', value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void persist({ notificationPrefs: next });
  }

  async function handleSaveLocation() {
    setSavingLocation(true);
    setLocationSaved(false);
    await persist({ city: city.trim() || null, state: state.trim() || null });
    setSavingLocation(false);
    setLocationSaved(true);
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      // WS2 Amazon-style: sign out drops back to silent guest browsing, not a
      // login wall. Mirrors the Home log out path (signOut then re-guest).
      await signOut();
      await continueAsGuest();
      router.replace('/(tabs)');
    } catch {
      router.replace('/(auth)/splash');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing['4xl'] }}>
      {!isSignedIn ? (
        <View
          style={{
            gap: spacing.sm,
            padding: spacing.lg,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={[textStyle('h3'), { color: colors.text }]}>Sign in to personalize</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
            Create an account to save your sports, location and notification preferences. Appearance still works
            without one.
          </Text>
          <Button onPress={() => router.push('/(auth)/login')} style={{ alignSelf: 'flex-start' }}>
            <LogIn size={18} strokeWidth={1.75} color={colors.inkOnAccent} />
            <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Sign in</Text>
          </Button>
        </View>
      ) : null}

      {/* Appearance: local first (applies without a network round trip), then
          persisted for signed in users. Available to everyone. */}
      <Section title="Appearance">
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Palette size={18} strokeWidth={1.75} color={colors.textSecondary} />
            <Text style={[textStyle('body'), { color: colors.text }]}>Theme</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {THEME_OPTIONS.map(({ key, label, icon: Icon }) => {
              const active = themePref === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${label} theme`}
                  onPress={() => handleTheme(key)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    gap: spacing.xs,
                    paddingVertical: spacing.md,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accentTint : colors.surfaceMuted,
                  }}
                >
                  <Icon size={20} strokeWidth={1.75} color={active ? colors.accent : colors.textSecondary} />
                  <Text style={[textStyle('caption'), { color: active ? colors.accent : colors.textSecondary }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Section>

      {isSignedIn ? (
        <>
          <Section title="Preferred sports">
            <View style={{ padding: spacing.lg, gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Volleyball size={18} strokeWidth={1.75} color={colors.textSecondary} />
                <Text style={[textStyle('body'), { color: colors.text }]}>What you play</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {SPORTS.map((sport) => (
                  <Chip
                    key={sport}
                    label={SPORT_LABEL[sport]}
                    variant="select"
                    selected={sports.includes(sport)}
                    onPress={() => toggleSport(sport)}
                  />
                ))}
              </View>
            </View>
          </Section>

          <Section title="Location">
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <Input label="City" value={city} onChangeText={(value) => { setCity(value); setLocationSaved(false); }} />
              <Input label="State" value={state} onChangeText={(value) => { setState(value); setLocationSaved(false); }} />
              <Button
                variant="secondary"
                loading={savingLocation}
                onPress={() => void handleSaveLocation()}
                style={{ alignSelf: 'flex-start' }}
              >
                <Text style={[textStyle('label'), { color: colors.text }]}>Save location</Text>
              </Button>
              {locationSaved ? (
                <Text style={[textStyle('caption'), { color: colors.success }]}>Location saved.</Text>
              ) : null}
            </View>
          </Section>

          <Section title="Notifications">
            {NOTIFICATION_ROWS.map((row, index) => (
              <View
                key={row.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <Bell size={20} strokeWidth={1.75} color={colors.textSecondary} />
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={[textStyle('body'), { color: colors.text }]}>{row.label}</Text>
                  <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{row.body}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={(value) => toggleNotification(row.key, value)}
                  trackColor={{ true: colors.accent, false: colors.surfaceMuted }}
                  thumbColor={colors.card}
                  accessibilityLabel={row.label}
                />
              </View>
            ))}
          </Section>

          <Section title="Account">
            <ActionRow icon={UserRoundPen} label="Edit profile" onPress={() => router.push('/profile/edit')} />
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <ActionRow
                icon={UserRoundX}
                label="Blocked accounts"
                onPress={() => router.push('/account/blocked')}
              />
            </View>
            {!isCoach ? (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                <ActionRow
                  icon={UserRoundPlus}
                  label="Become a coach"
                  onPress={() =>
                    router.push({ pathname: '/(onboarding)/coach-setup/[step]', params: { step: '0' } })
                  }
                />
              </View>
            ) : null}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <ActionRow icon={LogOut} label="Sign out" tone="danger" onPress={() => void handleSignOut()} />
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <ActionRow
                icon={Trash2}
                label={deleting ? 'Deleting your account...' : 'Delete account'}
                tone="danger"
                onPress={() => {
                  if (!deleting) confirmDeleteAccount();
                }}
              />
            </View>
          </Section>
        </>
      ) : null}

      {/* Outside the signed-in branch on purpose: a guest must be able to read
          the policies and reach support before creating an account. */}
      <Section title="Legal and support">
        {LEGAL_LINKS.map((link, index) => (
          <View
            key={link.key}
            style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: colors.border }}
          >
            <ActionRow
              icon={link.icon}
              label={link.label}
              onPress={() => {
                void Linking.openURL(link.url).catch(() => {
                  Alert.alert('We could not open that', 'Please visit atlitos.com instead.');
                });
              }}
            />
          </View>
        ))}
      </Section>

      {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error}</Text> : null}
      {busy ? <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Saving...</Text> : null}
    </ScrollView>
  );
}
