import { isMembershipRenewable, isMembershipUnpaid, type GroupMembership } from '@atlitos/api';
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
 * per group. `pending` rows (payment not yet captured, see `use-groups.ts`
 * note 2) are excluded, a pending membership means the join is still on the
 * payment screen, not something to surface as a standing card here. Renew
 * reuses the exact payment pattern `joinGroup` uses (see
 * `coaching/group/renew.tsx`), never a client side status write (CLAUDE.md
 * financial invariant).
 *
 * THREE STATES, and the Renew button now actually reaches one of them. Before
 * 0104 nothing ever moved a membership by time, so `lapsed` was unreachable
 * for a paid row and this button was dead code:
 *
 *   active   "Active until <period_end>", no CTA.
 *   expired  the paid month ended and the daily sweep flipped it. The seat is
 *            still held through the grace window, `renew_group_membership`
 *            accepts this state, so this is where Renew belongs.
 *   lapsed   the grace window passed and the seat was RELEASED. Renew is
 *            deliberately absent: `renew_group_membership` refuses a lapsed
 *            row (the seat has to be re contested through join, under the
 *            capacity guard), so offering the button here would offer an
 *            error. The copy says what to do instead.
 *
 * Which states are renewable is read from `isMembershipRenewable`, the mirror
 * of the RPC's own guard, never from a date comparison on the client.
 */
export interface MyGroupsCardProps {
  memberships: GroupMembership[];
  onRenew: (membership: GroupMembership) => void;
}

export function MyGroupsCard({ memberships, onRenew }: MyGroupsCardProps) {
  const colors = useThemeColors();
  const rows = memberships.filter((m) => m.status !== 'pending');

  if (rows.length === 0) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[textStyle('h3'), { color: colors.text }]}>My groups</Text>
      {rows.map((membership) => {
        // Both from the server's status, never from a date comparison here:
        // that comparison is exactly what made the coach's roster and this
        // card disagree about the same member.
        const unpaid = isMembershipUnpaid(membership.status);
        const canRenew = unpaid && isMembershipRenewable(membership.status);
        return (
          <View
            key={membership.id}
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: unpaid ? colors.danger : colors.border,
              backgroundColor: unpaid ? colors.dangerTint : colors.card,
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
              <Text style={[textStyle('caption'), { color: unpaid ? colors.danger : colors.textSecondary }]}>
                {membership.status === 'lapsed'
                  ? 'Seat released. Join the group again.'
                  : unpaid
                    ? membership.periodEnd
                      ? `Lapsed since ${formatMembershipDate(membership.periodEnd)}`
                      : 'Membership lapsed'
                    : membership.periodEnd
                      ? `Active until ${formatMembershipDate(membership.periodEnd)}`
                      : 'Active'}
              </Text>
              <Text style={[textStyle('numericSm'), { color: colors.text }]}>{formatINR(membership.total)}/mo</Text>
            </View>

            {canRenew ? (
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
