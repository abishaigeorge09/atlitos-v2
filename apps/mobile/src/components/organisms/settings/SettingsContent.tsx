import { useProfile } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { SPORTS, type Sport } from '@atlitos/types';
import { router } from 'expo-router';
import {
  Bell,
  ChevronRight,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Sun,
  UserRoundPlus,
  UserRoundPen,
  Volleyball,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { applyTheme, type ThemePref } from '@/lib/apply-theme';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

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
          </Section>
        </>
      ) : null}

      {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error}</Text> : null}
      {busy ? <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Saving...</Text> : null}
    </ScrollView>
  );
}
