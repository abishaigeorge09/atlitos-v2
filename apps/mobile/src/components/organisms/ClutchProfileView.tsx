import type { CreatorProfile } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { Clip, ClipStatus } from '@atlitos/types';
import { Film, TriangleAlert, UserPlus, Users } from 'lucide-react-native';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { ClutchPostCard } from '@/components/molecules/ClutchPostCard';
import { Button } from '@/components/ui/button';
import { StatusPill, type Status } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { Avatar } from '@/components/ui/avatar';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** Clip lifecycle status to the shared StatusPill vocabulary, for the own
 * profile grid where a clip can be pending/rejected, not only published. */
const CLIP_STATUS_PILL: Partial<Record<ClipStatus, Status>> = {
  uploading: 'pending',
  processing: 'pending',
  ready: 'underReview',
  rejected: 'cancelled',
  removed: 'cancelled',
};

export interface ClutchProfileViewProps {
  profile: CreatorProfile | null;
  clips: Clip[];
  state: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  /** Own profile hides the follow button, shows every clip status, and can
   * offer an upload CTA. A visitor sees the follow button and published only. */
  isOwn: boolean;
  followBusy?: boolean;
  onRetry: () => void;
  onToggleFollow?: () => void;
  onOpenClip: (clipId: string) => void;
  onUpload?: () => void;
}

function StatItem({ value, label }: { value: number; label: string }) {
  const colors = useThemeColors();
  return (
    <View className="items-center">
      <Text className="font-mono-semibold text-lg text-text">{value}</Text>
      <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

/**
 * Shared Clutch profile body for both the public creator profile (PRD-01 3.4
 * FR-46) and the athlete's own profile. Header (avatar, channel, stat row) +
 * a three-column clip grid. Follow routes through `toggle_follow` (owned by
 * the screen). Numeric stats and per-tile like counts render mono/tabular.
 */
export function ClutchProfileView({
  profile,
  clips,
  state,
  errorMessage,
  isOwn,
  followBusy,
  onRetry,
  onToggleFollow,
  onOpenClip,
  onUpload,
}: ClutchProfileViewProps) {
  const colors = useThemeColors();

  if (state === 'loading') {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state === 'error' || !profile) {
    return (
      <View className="flex-1 items-center justify-center gap-md p-lg">
        <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
        <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load profile</Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
          {errorMessage ?? 'Something went wrong. Please try again.'}
        </Text>
        <Button variant="secondary" onPress={onRetry}>
          <Text style={{ color: colors.text }}>Retry</Text>
        </Button>
      </View>
    );
  }

  return (
    <FlatList
      data={clips}
      keyExtractor={(item) => item.id}
      numColumns={3}
      columnWrapperStyle={{ gap: spacing.xs }}
      contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.xl }}
      ListHeaderComponent={
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <View className="flex-row items-center gap-lg">
            <Avatar uri={profile.avatarUrl ?? undefined} name={profile.name} size={80} />
            <View className="flex-1 flex-row items-center justify-around">
              <StatItem value={profile.clipCount} label="Clips" />
              <StatItem value={profile.followerCount} label="Followers" />
              <StatItem value={profile.followingCount} label="Following" />
            </View>
          </View>

          <View style={{ gap: spacing.xs }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>{profile.channel}</Text>
            {profile.name !== profile.channel ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{profile.name}</Text>
            ) : null}
          </View>

          {isOwn ? (
            onUpload ? (
              <Button onPress={onUpload}>
                <Film size={20} strokeWidth={1.75} color={colors.inkOnAccent} />
                <Text style={{ color: colors.inkOnAccent }}>Post a clip</Text>
              </Button>
            ) : null
          ) : (
            <Button
              variant={profile.followedByMe ? 'secondary' : 'primary'}
              loading={followBusy}
              onPress={onToggleFollow}
            >
              {profile.followedByMe ? (
                <Users size={20} strokeWidth={1.75} color={colors.text} />
              ) : (
                <UserPlus size={20} strokeWidth={1.75} color={colors.inkOnAccent} />
              )}
              <Text style={{ color: profile.followedByMe ? colors.text : colors.inkOnAccent }}>
                {profile.followedByMe ? 'Following' : 'Follow'}
              </Text>
            </Button>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
          <Film size={40} color={colors.textTertiary} strokeWidth={1.75} />
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {isOwn ? 'You have not posted any clips yet.' : 'No clips yet.'}
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const pill = isOwn ? CLIP_STATUS_PILL[item.status] : undefined;
        return (
          // maxWidth caps a lone last-row tile at one third instead of the
          // full-width stretch numColumns+flex-1 would otherwise give it.
          <View className="flex-1" style={{ maxWidth: '33%' }}>
            <ClutchPostCard clip={item} variant="thumb" onOpen={() => onOpenClip(item.id)} />
            {pill ? (
              <View className="absolute left-xs top-xs" pointerEvents="none">
                <StatusPill status={pill} />
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}
