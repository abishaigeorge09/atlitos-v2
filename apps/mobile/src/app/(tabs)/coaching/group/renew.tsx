import { useGroups } from '@atlitos/api';
import { useLocalSearchParams } from 'expo-router';

import { GroupMembershipPayScreen } from '@/components/organisms/trainings/GroupMembershipPayScreen';
import { supabase } from '@/lib/supabase';

type RenewParams = {
  membershipId: string;
  groupName: string;
  monthlyFee: string;
};

/**
 * Renew a lapsed (or about to lapse) membership, manual v1 through the same
 * one time payment rails `joinGroup` uses (founder ratified fares model, no
 * autopay): `renewMembership` (0079) re-links the SAME membership row to a
 * new intent and re-prices server side. Reached from the Trainings Stats
 * tab's My groups Renew button (`MyGroupsCard`) and My sessions.
 */
export default function RenewMembershipScreen() {
  const groups = useGroups(supabase);
  const params = useLocalSearchParams<RenewParams>();
  const monthlyFee = Number(params.monthlyFee);

  return (
    <GroupMembershipPayScreen
      appBarTitle="Renew membership"
      groupName={params.groupName}
      detailLine="Renew for another month"
      reserve={() => groups.renewMembership(params.membershipId, monthlyFee)}
      confirmedTitle="Membership renewed"
      confirmedBody={`Your next month of ${params.groupName} is paid.`}
      payingDescription={`${params.groupName} membership renewal`}
    />
  );
}
