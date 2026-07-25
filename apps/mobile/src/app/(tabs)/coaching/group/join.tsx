import { useGroups } from '@atlitos/api';
import { useLocalSearchParams } from 'expo-router';

import { GroupMembershipPayScreen } from '@/components/organisms/trainings/GroupMembershipPayScreen';
import { supabase } from '@/lib/supabase';

type JoinParams = {
  groupId: string;
  groupName: string;
  coachName: string;
  monthlyFee: string;
  attendancePolicy: string;
};

/**
 * Join a group, month 1. Reached from the coach profile's Groups section
 * (`coaching/coach/[id].tsx`) exactly like `book/pay.tsx` is reached from
 * the session type/frequency/slot picker: this screen owns the mutating
 * step, `joinGroup` (0079), which creates the pending membership under the
 * group's capacity lock and returns a Razorpay order.
 */
export default function JoinGroupScreen() {
  const groups = useGroups(supabase);
  const params = useLocalSearchParams<JoinParams>();
  const monthlyFee = Number(params.monthlyFee);

  return (
    <GroupMembershipPayScreen
      appBarTitle="Join group"
      groupName={params.groupName}
      detailLine={`with ${params.coachName}, monthly membership`}
      attendancePolicy={params.attendancePolicy || undefined}
      reserve={() => groups.joinGroup(params.groupId, monthlyFee)}
      confirmedTitle="You are in"
      confirmedBody={`Month 1 of ${params.groupName} is paid. The coach will confirm your spot.`}
      payingDescription={`${params.groupName} membership`}
    />
  );
}
