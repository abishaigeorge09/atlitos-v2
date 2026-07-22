import { useNotifications } from '@atlitos/api';
import type { ApiError, NotificationPref, NotificationType } from '@atlitos/types';
import { NOTIFICATION_TYPES } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { notificationDisplay } from '@/lib/notification-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

interface Row {
  type: NotificationType;
  pushEnabled: boolean;
  emailEnabled: boolean;
}

// A type with no stored pref row is push+email enabled by default (0002
// column defaults); the screen shows that default rather than inventing a
// persisted value.
function toRows(prefs: NotificationPref[]): Row[] {
  const byType = new Map(prefs.map((pref) => [pref.notificationType, pref]));
  return NOTIFICATION_TYPES.map((type) => {
    const pref = byType.get(type);
    return {
      type,
      pushEnabled: pref ? pref.pushEnabled : true,
      emailEnabled: pref ? pref.emailEnabled : true,
    };
  });
}

/**
 * Notification preferences, `/notifications/preferences`. AT-147. Per
 * notification_type push and email opt-out, owner-scoped: `listPrefs` and
 * `setPref` both filter and write `user_id = me`, and the notification_prefs
 * RLS with-check refuses a row for any other user. A user only ever reads and
 * edits their own preferences.
 *
 * Push toggles what device push (P9 transport, stubbed today) and the
 * notify-dispatch fan-out will honor per type; the in-app notification list is
 * always delivered regardless, since the row write is the in-app leg.
 */
export default function NotificationPreferencesScreen() {
  const colors = useThemeColors();
  const notifications = useNotifications(supabase);

  const [state, setState] = useState<LoadState>('loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState<NotificationType | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const prefs = await notifications.listPrefs();
      setRows(toRows(prefs));
      setState('ready');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateRow(type: NotificationType, patch: Partial<Row>) {
    const current = rows.find((row) => row.type === type);
    if (!current) return;
    const next: Row = { ...current, ...patch };
    // Optimistic; revert on failure.
    setRows((previous) => previous.map((row) => (row.type === type ? next : row)));
    setSaving(type);
    try {
      await notifications.setPref(type, {
        pushEnabled: next.pushEnabled,
        emailEnabled: next.emailEnabled,
      });
    } catch {
      setRows((previous) => previous.map((row) => (row.type === type ? current : row)));
    } finally {
      setSaving(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Preferences" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} shape="card" height={64} />
          ))}
        </View>
      ) : state === 'error' ? (
        <EmptyState
          icon={TriangleAlert}
          title="Preferences could not load"
          body={error?.message ?? 'Something went wrong. Please try again.'}
          ctaLabel="Retry"
          onCtaPress={() => void load()}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
            Choose which updates reach you. In app notifications always show here. Push and email
            follow your choices below.
          </Text>

          <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
            {rows.map((row) => (
              <PrefRow
                key={row.type}
                row={row}
                busy={saving === row.type}
                onTogglePush={(value) => void updateRow(row.type, { pushEnabled: value })}
                onToggleEmail={(value) => void updateRow(row.type, { emailEnabled: value })}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PrefRow({
  row,
  busy,
  onTogglePush,
  onToggleEmail,
}: {
  row: Row;
  busy: boolean;
  onTogglePush: (value: boolean) => void;
  onToggleEmail: (value: boolean) => void;
}) {
  const colors = useThemeColors();
  const { icon: Icon, label } = notificationDisplay(row.type);

  return (
    <View className="gap-sm rounded-lg bg-surface p-md" style={{ opacity: busy ? 0.6 : 1 }}>
      <View className="flex-row items-center gap-md">
        <View className="h-9 w-9 items-center justify-center rounded-pill bg-surface-muted">
          <Icon size={18} strokeWidth={1.75} color={colors.textSecondary} />
        </View>
        <Text className="flex-1 font-sans-semibold text-base text-text">{label}</Text>
      </View>

      <View className="flex-row items-center justify-between" style={{ paddingLeft: spacing['3xl'] }}>
        <Text className="text-sm text-text-secondary">Push</Text>
        <Switch
          value={row.pushEnabled}
          onValueChange={onTogglePush}
          disabled={busy}
          trackColor={{ true: colors.accent, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>
      <View className="flex-row items-center justify-between" style={{ paddingLeft: spacing['3xl'] }}>
        <Text className="text-sm text-text-secondary">Email</Text>
        <Switch
          value={row.emailEnabled}
          onValueChange={onToggleEmail}
          disabled={busy}
          trackColor={{ true: colors.accent, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>
    </View>
  );
}
