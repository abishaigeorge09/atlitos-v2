import { useClutch } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import { UserRoundX } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * Blocked accounts, with an unblock control.
 *
 * App Store guideline 1.2 requires the ability to BLOCK; it does not require an
 * unblock. This screen exists anyway because a block with no undo is a trap: a
 * member who taps it by accident, or changes their mind, otherwise has no way
 * back and no way to even see who they blocked. The block itself is deliberately
 * invisible to the other person, so this list is the only place it surfaces.
 */
export default function BlockedAccountsScreen() {
  const colors = useThemeColors();
  const clutch = useClutch(supabase);

  const [state, setState] = useState<LoadState>('loading');
  const [blocked, setBlocked] = useState<Array<{ id: string; name: string }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await clutch.blockedUsers();
      setBlocked(rows);
      setState(rows.length === 0 ? 'empty' : 'populated');
    } catch {
      setState('error');
    }
  }, [clutch]);

  useEffect(() => {
    void load();
  }, [load]);

  function confirmUnblock(entry: { id: string; name: string }) {
    Alert.alert(
      `Unblock ${entry.name}?`,
      'You will start seeing their posts and comments again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: () => void unblock(entry) },
      ],
    );
  }

  async function unblock(entry: { id: string; name: string }) {
    setBusyId(entry.id);
    try {
      await clutch.unblockUser(entry.id);
      // Drop it locally rather than refetching: the read is owner scoped and
      // the row is definitively gone.
      setBlocked((current) => {
        const next = current.filter((row) => row.id !== entry.id);
        setState(next.length === 0 ? 'empty' : 'populated');
        return next;
      });
    } catch {
      Alert.alert('We could not unblock that account', 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Blocked accounts" />

      {state === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : state === 'error' ? (
        <EmptyState
          icon={UserRoundX}
          title="We could not load this"
          body="Check your connection and try again."
          ctaLabel="Try again"
          onCtaPress={() => {
            setState('loading');
            void load();
          }}
        />
      ) : state === 'empty' ? (
        <EmptyState
          icon={UserRoundX}
          title="You have not blocked anyone"
          body="Blocked accounts show up here, and you can unblock them at any time."
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
            You do not see posts or comments from these accounts. They are not told that
            you blocked them.
          </Text>
          {blocked.map((entry) => (
            <View
              key={entry.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={[textStyle('body'), { color: colors.text, flex: 1 }]} numberOfLines={1}>
                {entry.name}
              </Text>
              <Pressable
                onPress={() => confirmUnblock(entry)}
                disabled={busyId === entry.id}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${entry.name}`}
                hitSlop={8}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm }}
              >
                <Text style={[textStyle('label'), { color: colors.accent }]}>
                  {busyId === entry.id ? 'Unblocking...' : 'Unblock'}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
