import { radii, spacing } from '@atlitos/theme';
import { Bell, CalendarDays, ChevronDown, MessageSquareMore, UserRound } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { useLocationStore } from '@/store/location-store';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

export interface HomeHeaderProps {
  hasUnreadNotifications: boolean;
  onPressProfile: () => void;
  onPressLocation: () => void;
  onPressChat: () => void;
  onPressNotifications: () => void;
  onPressBookings: () => void;
}

/**
 * Home header, laid out on the Playo reference (founder, 2026-09-30): the
 * member's avatar, a greeting with their first name, the current city with a
 * chevron that opens the location picker, then chat, notifications and
 * bookings on the right. Colors come from the theme, so it follows light and
 * dark rather than Playo's green.
 */
export function HomeHeader({
  hasUnreadNotifications,
  onPressProfile,
  onPressLocation,
  onPressChat,
  onPressNotifications,
  onPressBookings,
}: HomeHeaderProps) {
  const colors = useThemeColors();
  const me = useSessionStore((state) => state.me);
  const city = useLocationStore((state) => state.city);
  const status = useLocationStore((state) => state.status);

  const firstName = me?.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hey ${firstName}!` : 'Hey there!';
  const place = status === 'loading' ? 'Finding your location' : city || 'Choose your city';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        onPress={onPressProfile}
        className="active:opacity-70"
      >
        {me ? (
          <Avatar uri={me.avatarUrl ?? undefined} name={me.name ?? undefined} size={40} />
        ) : (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceMuted,
            }}
          >
            <UserRound size={20} strokeWidth={1.75} color={colors.textSecondary} />
          </View>
        )}
      </Pressable>

      {/* The whole greeting block opens the city picker, not just the
          city line, so the target is generous (Playo does the same). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Location, ${place}. Change location`}
        onPress={onPressLocation}
        className="active:opacity-70"
        style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={[textStyle('h3'), { color: colors.text }]} numberOfLines={1}>
          {greeting}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, flexShrink: 1 }]} numberOfLines={1}>
            {place}
          </Text>
          <ChevronDown size={16} strokeWidth={2} color={colors.textSecondary} />
        </View>
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <HeaderIcon label="Messages" onPress={onPressChat}>
          <MessageSquareMore size={24} strokeWidth={1.75} color={colors.text} />
        </HeaderIcon>
        <HeaderIcon label="Notifications" onPress={onPressNotifications}>
          <Bell size={24} strokeWidth={1.75} color={colors.text} />
          {hasUnreadNotifications ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 10,
                right: 11,
                width: 8,
                height: 8,
                borderRadius: radii.pill,
                backgroundColor: colors.accent,
                borderWidth: 1.5,
                borderColor: colors.canvas,
              }}
            />
          ) : null}
        </HeaderIcon>
        <HeaderIcon label="My bookings" onPress={onPressBookings}>
          <CalendarDays size={24} strokeWidth={1.75} color={colors.text} />
        </HeaderIcon>
      </View>
    </View>
  );
}

function HeaderIcon({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
    >
      {children}
    </Pressable>
  );
}
