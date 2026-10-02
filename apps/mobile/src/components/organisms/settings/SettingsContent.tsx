import { useProfile } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { SPORTS, type Sport } from '@atlitos/types';
import { router } from 'expo-router';
import {
  Bell,
  ChevronRight,
  FileText,
  LifeBuoy,
  LogIn,
  LogOut,
  Moon,
  Palette,
  ScrollText,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  UserRoundPen,
  UserRoundPlus,
  UserRoundX,
  Volleyball,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { applyTheme, resolveSystemScheme, type ThemePref } from '@/lib/apply-theme';
import { openSitePage, type SitePath } from '@/lib/site';
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

type ErrorSection = 'appearance' | 'sports' | 'location';

const THEME_OPTIONS: Array<{ key: ThemePref; label: string; icon: typeof Sun }> = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

/** Legal and support pages live on the landing site (apps/landing) so the app,
 * the store listing and the web all show one text. Apple reviewers look for the
 * privacy policy inside the app: this keeps it three taps from the You tab. */
const ABOUT_ROWS: Array<{ label: string; path: SitePath; icon: typeof Sun }> = [
  { label: 'Terms', path: '/terms', icon: FileText },
  { label: 'Privacy policy', path: '/privacy', icon: ShieldCheck },
  { label: 'Content policy', path: '/content-policy', icon: ScrollText },
  { label: 'Support', path: '/support', icon: LifeBuoy },
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
  const session = useSessionStore((s) => s.session);
  const me = useSessionStore((s) => s.me);
  const meLoading = useSessionStore((s) => s.meLoading);
  const meGaveUp = useSessionStore((s) => s.meGaveUp);
  const refreshMe = useSessionStore((s) => s.refreshMe);
  const signOut = useSessionStore((s) => s.signOut);
  const continueAsGuest = useSessionStore((s) => s.continueAsGuest);

  const isSignedIn = status === 'signed_in';
  // Trust `me` for the coach role only once it is loaded AND belongs to the
  // current session user, so the "Become a coach" row never appears (or hides)
  // based on a stale/previous user's profile while a new login resolves.
  const meReady = !meLoading && !!me && me.id === session?.user.id;
  const isCoach = meReady && (me.coachStatus === 'verified' || me.coachStatus === 'pending_review');
  // The editable personalization controls need the signed in user's own
  // profile. Unlike meReady this ignores meLoading, so the post save
  // refreshMe (which keeps `me` in place) does not unmount the controls.
  const profileLoaded = isSignedIn && !!me && me.id === session?.user.id;

  const [city, setCity] = useState(me?.city ?? '');
  const [state, setState] = useState(me?.state ?? '');
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ section: ErrorSection; message: string } | null>(null);

  // Optimistic mirrors so a toggle/chip reflects instantly while the write
  // lands; refreshMe reconciles from the row afterwards.
  // Light and dark only (founder, 2026-09-30). A saved 'system' shows as the
  // mode it resolved to at launch; picking either pins it.
  const [themePref, setThemePref] = useState<ThemePref>(me?.theme ?? 'system');
  const shownTheme: ThemePref = themePref === 'system' ? resolveSystemScheme() : themePref;
  const [sports, setSports] = useState<Sport[]>(me?.sports ?? []);
  const [primarySport, setPrimarySport] = useState<Sport | null>(me?.primarySport ?? me?.sports?.[0] ?? null);

  // Seed the editable state once per loaded profile. `me` is often still null
  // at mount (a fresh sign in, or a slow getMe), and the useState initialisers
  // above only run once, so without this a later tap would persist the empty
  // defaults over the user's saved sports and city. Keyed on the profile id so
  // the refreshMe after each save does not clobber in progress edits.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!profileLoaded || !me || seededFor.current === me.id) return;
    seededFor.current = me.id;
    setCity(me.city ?? '');
    setState(me.state ?? '');
    setThemePref(me.theme ?? 'system');
    // Keep the applied theme in step with the seeded selection, in case a
    // local pick was made before the profile loaded.
    applyTheme(me.theme ?? 'system');
    setSports(me.sports ?? []);
    setPrimarySport(me.primarySport ?? me.sports?.[0] ?? null);
  }, [profileLoaded, me]);

  /** Writes the patch and reports whether it landed, so callers can revert
   * optimistic state and only confirm success after the write resolves. */
  async function persist(patch: Parameters<typeof profileApi.updateProfile>[0], section: ErrorSection): Promise<boolean> {
    if (!profileLoaded) return false;
    setBusy(true);
    setError(null);
    try {
      await profileApi.updateProfile(patch);
      await refreshMe();
      return true;
    } catch {
      setError({ section, message: 'Could not save that change. Please try again.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function sectionError(section: ErrorSection) {
    return error?.section === section ? (
      <Text style={[textStyle('caption'), { color: colors.danger }]}>{error.message}</Text>
    ) : null;
  }

  async function handleTheme(pref: ThemePref) {
    const previous = themePref;
    setThemePref(pref);
    applyTheme(pref);
    // Guests keep appearance locally; only a loaded profile persists it.
    if (!profileLoaded) return;
    const ok = await persist({ theme: pref }, 'appearance');
    if (!ok) {
      setThemePref(previous);
      applyTheme(previous);
    }
  }

  // Sports edits write users.sports AND athlete_sports/is_primary together
  // through the RPC (0088), so Learn and the coach-search default follow the
  // edit. Every write carries the primary so the two models never drift.
  async function toggleSport(sport: Sport) {
    const isSelected = sports.includes(sport);
    // Keep at least one sport, matching onboarding. Deselecting the last one
    // does nothing rather than clearing Learn's primary sport.
    if (isSelected && sports.length === 1) return;

    const next = isSelected ? sports.filter((s) => s !== sport) : [...sports, sport];
    // Removing the current primary reassigns it to the first remaining sport;
    // adding the first ever sport makes it primary.
    const nextPrimary =
      primarySport && next.includes(primarySport) ? primarySport : (next[0] ?? null);
    if (!nextPrimary) return;
    const previousSports = sports;
    const previousPrimary = primarySport;
    setSports(next);
    setPrimarySport(nextPrimary);
    const ok = await persist({ sports: next, primarySport: nextPrimary }, 'sports');
    if (!ok) {
      setSports(previousSports);
      setPrimarySport(previousPrimary);
    }
  }

  async function handleSetPrimary(sport: Sport) {
    if (!sports.includes(sport) || sport === primarySport) return;
    const previousPrimary = primarySport;
    setPrimarySport(sport);
    const ok = await persist({ sports, primarySport: sport }, 'sports');
    if (!ok) setPrimarySport(previousPrimary);
  }

  async function handleSaveLocation() {
    setSavingLocation(true);
    setLocationSaved(false);
    const ok = await persist({ city: city.trim() || null, state: state.trim() || null }, 'location');
    setSavingLocation(false);
    setLocationSaved(ok);
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
    <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing['4xl'] }}>
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
              const active = shownTheme === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${label} theme`}
                  onPress={() => void handleTheme(key)}
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
          {sectionError('appearance')}
        </View>
      </Section>

      {isSignedIn && !profileLoaded ? (
        <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
          {meLoading || !meGaveUp
            ? 'Loading your sports, location and notification preferences.'
            : 'Could not load your preferences right now. Please try again later.'}
        </Text>
      ) : null}

      {profileLoaded ? (
        <>
          <Section title="Preferred sports">
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
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
                    onPress={() => void toggleSport(sport)}
                  />
                ))}
              </View>

              {sports.length > 0 ? (
                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Star size={16} strokeWidth={1.75} color={colors.textSecondary} />
                    <Text style={[textStyle('body'), { color: colors.text }]}>Primary sport</Text>
                  </View>
                  <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                    Your primary sport tunes your Learn roadmap and the coaches shown first.
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {sports.map((sport) => (
                      <Chip
                        key={sport}
                        label={SPORT_LABEL[sport]}
                        variant="filter"
                        selected={sport === primarySport}
                        onPress={() => void handleSetPrimary(sport)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              {sectionError('sports')}
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
              {sectionError('location')}
            </View>
          </Section>

          {/* BUG-071: this section had its own three switches (Session
              updates, Messages, Offers and news, users.notification_prefs,
              0087) that disagreed with Notifications, Preferences (per type
              push and email, notification_prefs, 0002). Push was suppressed
              when EITHER said no, so a switch could read on while nothing
              arrived, and Offers and news governed no notification at all.
              One place now: that screen reads and writes both stores. */}
          {isSignedIn ? (
            <Section title="Notifications">
              <ActionRow
                icon={Bell}
                label="Notification preferences"
                onPress={() => router.push('/notifications/preferences')}
              />
            </Section>
          ) : null}

          <Section title="Account">
            <ActionRow icon={UserRoundPen} label="Edit profile" onPress={() => router.push('/profile/edit')} />
            {/* RECONCILIATION 2026-09-14, from origin/main eca5992. A block with no
                undo is a trap; this is the only place a person can see who they
                blocked and reverse it. The screen is a drop in: it calls the
                LOCAL clutch.blockedUsers() and clutch.unblockUser(), which already
                run against blocked_users. His migrations were not taken. */}
            <ActionRow icon={UserRoundX} label="Blocked accounts" onPress={() => router.push('/account/blocked')} />
            {meReady && !isCoach ? (
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
            {/* Apple Guideline 5.1.1(v) and the Google Play account deletion
                policy: an account created in the app must be deletable from
                inside the app. This row only opens the confirmation screen;
                nothing is deleted until the word DELETE is typed there. */}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <ActionRow
                icon={Trash2}
                label="Delete account"
                tone="danger"
                onPress={() => router.push('/profile/delete-account')}
              />
            </View>
          </Section>
        </>
      ) : null}

      {/* Visible to guests too: the policies apply before an account exists. */}
      <Section title="About">
        {ABOUT_ROWS.map((row, index) => (
          <View key={row.path} style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: colors.border }}>
            <ActionRow icon={row.icon} label={row.label} onPress={() => openSitePage(row.path)} />
          </View>
        ))}
      </Section>

      {busy ? <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Saving...</Text> : null}
    </ScrollView>
  );
}
