import { useCoaching, type CoachListItem } from '@atlitos/api';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { HomeSection, HomeSectionSkeleton } from '@/components/organisms/home/HomeSection';
import { CoachGridCard } from '@/components/ui/coach-grid-card';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { useSessionStore } from '@/store/session-store';

const CARD_WIDTH = 176;
const MAX_COACHES = 10;

/**
 * Home "Train with a coach" rail (PRD-01 3.2, FR-20 discovery). The same
 * verified coach list as Trainings > Coaches (`listCoaches`, the athlete's
 * city sorted first, unpriced coaches already dropped), rendered with the
 * same CoachGridCard at a fixed width. Hides itself on an empty list or a
 * read error.
 */
export function HomeCoachesRail({ reloadKey, onLoaded }: { reloadKey: number; onLoaded?: (ok: boolean) => void }) {
  const coaching = useCoaching(supabase);
  const city = useLocationStore((state) => state.city);
  const isCoach = useSessionStore((state) => state.me?.roles.includes('coach') ?? false);

  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [coaches, setCoaches] = useState<CoachListItem[]>([]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    try {
      const page = await coaching.listCoaches({ city });
      setCoaches(page.items.slice(0, MAX_COACHES));
      if (!options?.silent) onLoaded?.(true);
    } catch {
      // A failed background refresh keeps what is already on screen.
      if (!options?.silent) {
        setCoaches([]);
        onLoaded?.(false);
      }
    } finally {
      setState('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Prices and coaches change elsewhere (a coach edits a session type in
  // Trainings), so returning to Home refreshes quietly. The first focus is
  // the mount, which the effect above already loads.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      void load({ silent: true });
    }, [load]),
  );

  if (state === 'loading') return <HomeSectionSkeleton cardWidth={CARD_WIDTH} cardHeight={250} />;
  if (coaches.length === 0) return null;

  return (
    <HomeSection
      title="Train with a coach"
      subtitle="Verified coaches, book an appointment"
      seeAllLabel="See all coaches"
      // A coach's Trainings module has no Coaches tab (it opens their own
      // dashboard), so the full list is for athletes only.
      onSeeAll={isCoach ? undefined : () => router.push('/trainings/coaches')}
    >
      {coaches.map((coach) => (
        <View key={coach.userId} style={{ width: CARD_WIDTH }}>
          <CoachGridCard
            avatarUri={coach.avatarUrl}
            name={coach.name}
            sport={coach.sport}
            experienceYears={coach.experienceYears}
            rating={coach.rating}
            ratingCount={coach.ratingCount}
            city={coach.city}
            priceFrom={coach.priceFrom}
            onPress={() => router.push({ pathname: '/home/coach/[id]', params: { id: coach.userId } })}
          />
        </View>
      ))}
    </HomeSection>
  );
}
