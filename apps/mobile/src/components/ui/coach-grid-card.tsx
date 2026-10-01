import { sizedImageUrl } from '@atlitos/api';
import type { Sport } from '@atlitos/types';
import { formatINR, inkOnMedia, radii, spacing } from '@atlitos/theme';
import { BadgeCheck, MapPin, Star } from 'lucide-react-native';
import { useState } from 'react';
import { Image, PixelRatio, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SPORT_ICON, SPORT_LABEL, SPORT_TINT } from '@/lib/sport-display';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** The photo band's shape. 4:3 keeps a face and shoulders in frame at half
 * the screen width without making each card taller than it is wide. */
const PHOTO_ASPECT = 4 / 3;
/** Requested photo width in points: half an iPhone Pro Max screen, rounded
 * up, so one size serves every phone without fetching the origin upload. */
const PHOTO_POINTS = 220;

export interface CoachGridCardProps {
  avatarUri?: string;
  name: string;
  sport: Sport;
  experienceYears: number;
  rating: number;
  ratingCount: number;
  city?: string;
  /** Undefined when the coach has not priced a session type yet; the price
   * line then reads as not set rather than "From ₹0" (same rule as
   * CoachCard). */
  priceFrom?: number;
  onPress?: () => void;
}

/**
 * Two column coach discovery card (PRD-01 FR-20). Photo band on top with a
 * Verified badge (discovery only ever lists verified coaches, see
 * `coach_profiles_public`) and the sport glyph, then name, city, sport and
 * experience, rating, and the lowest session price. A coach with no photo
 * gets their sport's tint with a large initial instead, so a grid of new
 * coaches still reads as a grid of people rather than of grey boxes. A
 * coach with no ratings reads "New", never a zero star score (BUG-09).
 */
export function CoachGridCard({
  avatarUri,
  name,
  sport,
  experienceYears,
  rating,
  ratingCount,
  city,
  priceFrom,
  onPress,
}: CoachGridCardProps) {
  const colors = useThemeColors();
  const [photoFailed, setPhotoFailed] = useState(false);
  const tint = SPORT_TINT[sport];
  const SportIcon = SPORT_ICON[sport];
  const scale = Math.min(3, PixelRatio.get());
  const showPhoto = !!avatarUri && !photoFailed;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${SPORT_LABEL[sport]} coach`}
      onPress={onPress}
      // Plain style object; NativeWind's Pressable wrapper drops style
      // functions (see SportTileGrid). Press feedback is the class.
      className="active:opacity-90"
      style={{
        flex: 1,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        overflow: 'hidden',
      }}
    >
      <View style={{ aspectRatio: PHOTO_ASPECT, backgroundColor: colors[tint.bg] }}>
        {showPhoto ? (
          <Image
            source={{
              uri: sizedImageUrl(avatarUri, {
                width: PHOTO_POINTS * scale,
                height: Math.round((PHOTO_POINTS / PHOTO_ASPECT) * scale),
              }),
            }}
            onError={() => setPhotoFailed(true)}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[textStyle('title'), { color: colors[tint.ink] }]}>{name.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        <View
          style={{
            position: 'absolute',
            top: spacing.sm,
            right: spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            borderRadius: radii.pill,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            backgroundColor: colors.overlay,
          }}
        >
          <BadgeCheck size={12} strokeWidth={2} color={inkOnMedia} />
          <Text style={[textStyle('overline'), { color: inkOnMedia }]}>Verified</Text>
        </View>

        <View
          style={{
            position: 'absolute',
            left: spacing.sm,
            bottom: spacing.sm,
            height: 32,
            width: 32,
            borderRadius: radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.overlay,
          }}
        >
          <SportIcon size={16} strokeWidth={1.75} color={inkOnMedia} />
        </View>
      </View>

      <View style={{ padding: spacing.md, gap: spacing.xs }}>
        <Text numberOfLines={1} className="font-sans-semibold text-lg text-text">
          {name}
        </Text>

        {city ? (
          <View className="flex-row items-center gap-xs">
            <MapPin size={12} strokeWidth={1.75} color={colors.textTertiary} />
            <Text numberOfLines={1} style={[textStyle('caption'), { flex: 1, color: colors.textSecondary }]}>
              {city}
            </Text>
          </View>
        ) : null}

        <Text numberOfLines={1} style={[textStyle('caption'), { color: colors.textSecondary }]}>
          {SPORT_LABEL[sport]}, {experienceYears} yrs experience
        </Text>

        <View className="flex-row items-center justify-between pt-xs">
          {rating > 0 ? (
            <View className="flex-row items-center gap-xs">
              <Star size={14} strokeWidth={1.75} color={colors.warning} fill={colors.warning} />
              <Text style={[textStyle('numericSm'), { color: colors.text }]}>{rating.toFixed(1)}</Text>
              <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>({ratingCount})</Text>
            </View>
          ) : (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>New</Text>
          )}
          {priceFrom !== undefined ? (
            <Text style={[textStyle('numericSm'), { color: colors.accent }]}>{formatINR(priceFrom)}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
