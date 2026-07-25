import type { GroupMembership } from '@atlitos/api';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { Users } from 'lucide-react-native';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { GROUP_MEMBERSHIP_STATUS_PILL } from '@/lib/session-display';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** "24 Jul 2026" style, matching `lib/order-display.ts`'s date formatter. */
function formatMembershipDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Athlete Stats tab "My groups" section (Trainings Groups fares model,
 * COACH-TRAININGS-GAP items 2/9): the athlete's group memberships, one card
 * per group. Active renders "Active until <period_end>"; lapsed renders the
 * renew prompt (warning tint, Renew CTA) the ticket calls for. `pending`
 * rows (payment not yet captured, see `use-groups.ts` note 2) are excluded,
 * a pending membership means the join is still on the payment screen, not
 * something to surface as a standing card here. Renew reuses the exact
 * payment pattern `joinGroup` uses (see `coaching/group/renew.tsx`), never
 * a client side status write (CLAUDE.md financial invariant).
 */
export interface MyGroupsCardProps {
  memberships: GroupMembership[];
  onRenew: (membership: GroupMembership) => void;
}

export function MyGroupsCard({ memberships, onRenew }: MyGroupsCardProps) {
  const colors = useThemeColors();
  const rows = memberships.filter((m) => m.status === 'active' || m.status === 'lapsed');

  if (rows.length === 0) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[textStyle('h3'), { color: colors.text }]}>My groups</Text>
      {rows.map((membership) => {
        const lapsed = membership.status === 'lapsed';
        return (
          <View
            key={membership.id}
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: lapsed ? colors.danger : colors.border,
              backgroundColor: lapsed ? colors.dangerTint : colors.card,
              padding: spacing.lg,
              gap: spacing.sm,
            }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 flex-row items-center gap-xs">
                <Users size={16} strokeWidth={1.75} color={colors.textTertiary} />
                <Text style={[textStyle('label'), { color: colors.text }]} numberOfLines={1}>
                  {membership.group?.name ?? 'Group'}
                </Text>
              </View>
              <StatusPill status={GROUP_MEMBERSHIP_STATUS_PILL[membership.status]} />
            </View>

            <View className="flex-row items-center justify-between">
              <Text style={[textStyle('caption'), { color: lapsed ? colors.danger : colors.textSecondary }]}>
                {lapsed
                  ? membership.periodEnd
                    ? `Lapsed since ${formatMembershipDate(membership.periodEnd)}`
                    : 'Membership lapsed'
                  : membership.periodEnd
                    ? `Active until ${formatMembershipDate(membership.periodEnd)}`
                    : 'Active'}
              </Text>
              <Text style={[textStyle('numericSm'), { color: colors.text }]}>{formatINR(membership.total)}/mo</Text>
            </View>

            {lapsed ? (
              <Button size="sm" onPress={() => onRenew(membership)}>
                <Text style={{ color: colors.inkOnAccent }}>Renew</Text>
              </Button>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
