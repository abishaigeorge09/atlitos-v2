import { spacing } from '@atlitos/theme';
import { ScrollView } from 'react-native';

import { Chip } from '@/components/ui/chip';

/**
 * The Figma coach flow's shared filter chip row (nodes 1047:13612 Trainees,
 * 1047:14952 Requests, 1047:15461 Upcoming Sessions): All, 1 on 1, Group,
 * Online. One component so the three screens cannot drift. "Online" follows
 * the gap doc's representation, a session type whose name contains
 * "online" (`isOnlineSessionTypeName` in @atlitos/api); "Group" is the
 * training groups domain. Labels use no hyphens per the house style.
 */
export type SessionFilterKey = 'all' | 'one_on_one' | 'group' | 'online';

const FILTERS: Array<{ key: SessionFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'one_on_one', label: 'One on one' },
  { key: 'group', label: 'Group' },
  { key: 'online', label: 'Online' },
];

export interface SessionFilterChipsProps {
  active: SessionFilterKey;
  onChange: (key: SessionFilterKey) => void;
}

export function SessionFilterChips({ active, onChange }: SessionFilterChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
      }}
    >
      {FILTERS.map((filter) => (
        <Chip
          key={filter.key}
          variant="filter"
          label={filter.label}
          selected={active === filter.key}
          onPress={() => onChange(filter.key)}
        />
      ))}
    </ScrollView>
  );
}
