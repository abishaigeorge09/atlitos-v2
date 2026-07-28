import { cn } from '@/lib/utils';
import { Calendar, MapPin, Target } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 18: SessionCard. date, time slot, coach/player name, session
 * type, focus area, location. `request` variant adds Accept (primary) /
 * Decline (ghost, danger tone) actions, the locked Accept/Decline pair
 * pattern from the Button atom's doc comment.
 */
export type SessionCardVariant = 'upcoming' | 'request' | 'history';

export interface SessionCardProps {
  date: string;
  timeSlot: string;
  personName: string;
  sessionType: string;
  focusArea: string;
  location: string;
  variant?: SessionCardVariant;
  onPress?: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  className?: string;
}

function InfoRow({ icon: Icon, text }: { icon: typeof Calendar; text: string }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-xs">
      <Icon size={16} strokeWidth={1.75} color={colors.textTertiary} />
      <Text className="font-sans text-sm text-text-secondary">{text}</Text>
    </View>
  );
}

function SessionCard({
  date,
  timeSlot,
  personName,
  sessionType,
  focusArea,
  location,
  variant = 'upcoming',
  onPress,
  onAccept,
  onDecline,
  className,
}: SessionCardProps) {
  return (
    // Pressable overlay card, see docs/design/DESIGN-LANGUAGE.md. The card is a
    // plain View so the request variant's Accept and Decline buttons are
    // siblings of the card level press target, not nested inside it. Tapping
    // Accept therefore cannot also open the session.
    <View
      className={cn(
        'gap-md rounded-xl border border-border bg-card p-lg',
        variant === 'history' && 'opacity-80',
        className,
      )}
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${personName}, ${date}, ${timeSlot}`}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View style={{ pointerEvents: 'none' }} className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-lg text-text">{personName}</Text>
        <Text className="font-mono text-sm text-text-secondary">{sessionType}</Text>
      </View>

      <View style={{ pointerEvents: 'none' }} className="gap-xs">
        <InfoRow icon={Calendar} text={`${date}, ${timeSlot}`} />
        <InfoRow icon={Target} text={focusArea} />
        <InfoRow icon={MapPin} text={location} />
      </View>

      {variant === 'request' ? (
        <View style={{ pointerEvents: 'box-none', zIndex: 1 }} className="flex-row gap-sm pt-xs">
          <Button variant="primary" size="sm" className="flex-1" onPress={onAccept}>
            <Text>Accept</Text>
          </Button>
          <Button variant="ghost" tone="danger" size="sm" className="flex-1" onPress={onDecline}>
            <Text>Decline</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}

export { SessionCard };
