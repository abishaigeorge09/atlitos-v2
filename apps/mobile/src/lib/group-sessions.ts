import type { AtlitosClient, GroupMembership, GroupSession } from '@atlitos/api';
import { makeGroupsApi } from '@atlitos/api';

/** One group session, hydrated with the group name for the "Group" labeled
 * rows on the athlete Upcoming/Sessions lists (Track D, COACH-TRAININGS-GAP
 * item 17's sibling: athlete side of the same group session rows the coach
 * schedules). */
export interface MyGroupSessionEntry {
  session: GroupSession;
  groupName: string;
}

/**
 * All group sessions the signed in athlete can see, across every group they
 * hold a membership in (any status, a lapsed member still needs their past
 * session history). `sessions_select_group_participant` RLS (0081) already
 * narrows `groupSessions` to rows the caller participates in, this just
 * fans the read out across the athlete's own groups, never someone else's
 * (RLS is not scoping, CLAUDE.md): the group id set comes from the caller's
 * own `myMemberships()` read, not an unscoped groups browse.
 */
export async function fetchMyGroupSessions(
  client: AtlitosClient,
  memberships: GroupMembership[],
): Promise<MyGroupSessionEntry[]> {
  // Plain async function, not a component: use the factory, not the hook.
  const groups = makeGroupsApi(client);
  const byGroupId = new Map(memberships.map((m) => [m.groupId, m.group?.name ?? 'Group']));
  const groupIds = [...byGroupId.keys()];
  if (groupIds.length === 0) return [];

  // One query for every group, not one per group (see groupSessionsForGroups).
  const sessions = await groups.groupSessionsForGroups(groupIds);
  return sessions.map((session) => ({
    session,
    groupName: (session.groupId ? byGroupId.get(session.groupId) : undefined) ?? 'Group',
  }));
}
