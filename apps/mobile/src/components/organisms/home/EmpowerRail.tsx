import { useEmpower, type HubUpa } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { UPACard } from '@/components/ui/upa-card';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home's "Donate to Empower" rail (PRD-01 3.2, PRD-06). Reads the same
 * verified UPA list the Empower hub does, `useEmpower().listUpas()`, and
 * renders it as a horizontal rail of `hub` variant `UPACard`s so each card
 * carries its funding progress bar. Hides entirely on an empty list or a
 * failed read, matching every other optional Home section's fail quiet
 * contract.
 */
export function EmpowerRail({ reloadKey }: { reloadKey: number }) {
  const colors = useThemeColors();
  const empower = useEmpower(supabase);

  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [upas, setUpas] = useState<HubUpa[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const rows = await empower.listUpas();
      setUpas(rows.slice(0, 8));
    } catch {
      setUpas([]);
    } finally {
      setState('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (state === 'loading') {
    return (
      <View style={{ gap: spacing.sm }}>
        <Skeleton shape="line" width="50%" />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Skeleton shape="card" width={288} />
          <Skeleton shape="card" width={288} />
        </View>
      </View>
    );
  }

  if (upas.length === 0) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <View className="flex-row items-center justify-between">
        <Text style={[textStyle('h3'), { color: colors.text }]}>Donate to Empower</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See all Empower athletes"
          onPress={() => router.push('/home/empower')}
          className="flex-row items-center gap-xs"
        >
          <Text className="font-sans-semibold text-sm" style={{ color: colors.accent }}>
            See all
          </Text>
          <ChevronRight size={16} color={colors.accent} strokeWidth={1.75} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-md">
        {upas.map((upa) => (
          <UPACard
            key={upa.id}
            variant="hub"
            className="w-72"
            photoUri={upa.photoUrl ?? ''}
            name={upa.name}
            headline={upa.headline}
            raisedAmount={upa.raised}
            goalAmount={upa.goal}
            onDonatePress={() => router.push({ pathname: '/home/donate/[id]', params: { id: upa.id } })}
            onViewProfilePress={() => router.push({ pathname: '/home/upa/[id]', params: { id: upa.id } })}
          />
        ))}
      </ScrollView>
    </View>
  );
}
