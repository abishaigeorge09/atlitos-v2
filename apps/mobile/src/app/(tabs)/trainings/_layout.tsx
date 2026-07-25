import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

export const unstable_settings = {
  initialRouteName: '(shell)',
};

/**
 * Stack for the Trainings tab (PRD-01 3.3, PRD-02 3.2 to 3.9). `(shell)` is
 * the module root: a fixed shell layout (module title + TrainingsSubNav)
 * over a nested tab navigator holding the five per role tabs, so switching
 * tabs swaps only the content below the shell and never grows this stack.
 * Every other screen here is a drill in pushed on top of the shell
 * (requests, upcoming, availability, trainee/[id], session/[id],
 * group/[id], group-session/[id], earnings payout
 * setup and transfer, chat-thread/[id], verification); each renders its own
 * in-screen back header via AppBar, matching the `courts` route group's
 * nested-stack pattern, so no screen here gets a second native header on
 * top of that.
 */
export default function TrainingsLayout() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
