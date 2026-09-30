import { useCoaching, type CoachListItem } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { SPORTS, type Sport } from '@atlitos/types';
import { router } from 'expo-router';
import { ArrowRight, Dumbbell } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { SPORT_ICON, SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** How many coach faces the strip shows before the "+N" count. */
const FACES = 4;
/** The sport glyph that stands in for the reference's ball. */
const GLYPH_SIZE = 150;

export interface FeaturedSportCardProps {
  reloadKey: number;
  /** A photo for the card. Until sport photography exists, the sport's glyph
   * is drawn large in its place, overlapping the headline the same way. */
  imageUrl?: string;
}

/**
 * Home's featured card, on the "JOIN THE STREET GAME" reference (founder,
 * 2026-09-30): a widely tracked sport eyebrow, a three line headline in the
 * condensed display face, a picture overlapping the headline's lower right,
 * and a full width outlined CTA with an icon. Beneath it, the reference's
 * face strip: up to four coach avatars for that sport, a "+N" count and an
 * arrow into the coach list. The strip hides itself when no coaches load, so
 * the card never promises people it cannot show.
 */
export function FeaturedSportCard({ reloadKey, imageUrl }: FeaturedSportCardProps) {
  const colors = useThemeColors();
  const coaching = useCoaching(supabase);
  const me = useSessionStore((state) => state.me);
  const city = useLocationStore((state) => state.city);

  const sport: Sport = me?.primarySport ?? me?.sports?.[0] ?? SPORTS[0];
  const Glyph = SPORT_ICON[sport];
  const [coaches, setCoaches] = useState<CoachListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let active = true;
    coaching
      .listCoaches({ sport, city: city || undefined, limit: 8 })
      .then((page) => {
        if (!active) return;
        setCoaches(page.items);
        setHasMore(page.nextCursor !== null);
      })
      .catch(() => {
        // Decoration: without coaches the strip simply does not render.
        if (active) setCoaches([]);
      });
    return () => {
      active = false;
    };
    // `coaching` is a fresh object each render; keyed on the inputs instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, city, reloadKey]);

  const openCoaches = () => router.push('/(tabs)/coaching');
  const faces = coaches.slice(0, FACES);
  const extra = coaches.length - faces.length;

  return (
    <View style={{ gap: spacing.sm }}>
      <View
        style={{
          overflow: 'hidden',
          borderRadius: radii['2xl'],
          backgroundColor: colors.card,
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <Text style={[textStyle('eyebrow'), { color: colors.textSecondary }]}>{SPORT_LABEL[sport]}</Text>

        <View style={{ minHeight: 190 }}>
          {/* The picture sits behind the headline's last line and runs off the
              card's right edge, as in the reference. */}
          <View
            pointerEvents="none"
            style={{ position: 'absolute', right: -spacing.lg, bottom: -spacing.md }}
          >
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={{ width: GLYPH_SIZE + spacing.xl, height: GLYPH_SIZE + spacing.xl }}
                resizeMode="contain"
              />
            ) : (
              <Glyph size={GLYPH_SIZE} strokeWidth={1.25} color={colors.accent} />
            )}
          </View>
          <Text style={[textStyle('displayHero'), { color: colors.text }]}>
            {'Train with\nthe best\ncoaches'}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Find a ${SPORT_LABEL[sport]} coach`}
          onPress={openCoaches}
          className="active:opacity-70"
          style={{
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.borderStrong,
            backgroundColor: colors.card,
          }}
        >
          <Dumbbell size={18} strokeWidth={1.75} color={colors.text} />
          <Text style={[textStyle('label'), { color: colors.text }]}>Find a coach</Text>
        </Pressable>
      </View>

      {faces.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See ${SPORT_LABEL[sport]} coaches`}
          onPress={openCoaches}
          className="active:opacity-80"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            padding: spacing.sm,
            borderRadius: radii.pill,
            backgroundColor: colors.card,
          }}
        >
          {faces.map((coach) => (
            <Avatar key={coach.userId} uri={coach.avatarUrl} name={coach.name} size={56} />
          ))}
          {extra > 0 ? (
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.borderStrong,
              }}
            >
              <Text style={[textStyle('numericSm'), { color: colors.text }]}>
                {hasMore ? `${extra}+` : `+${extra}`}
              </Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceMuted,
            }}
          >
            <ArrowRight size={22} strokeWidth={1.75} color={colors.text} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
