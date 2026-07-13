import { spacing } from '@atlitos/theme';
import { LandPlot } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Courts tab. PRD-01 3.5 owns sport select, court list/detail and booking
 * once the courts domain migration lands (`useCourts` is still `TODO(P2)`
 * in packages/api/src/hooks.ts). Browsing is guest-open with no gate per
 * FR-2 (there is nothing to gate yet, this is a read-only placeholder).
 * States: empty (no courts near this location yet, true everywhere until
 * P2 ships real venue data).
 */
export default function CourtsScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: spacing.lg }}>
        <Text style={[textStyle('h1'), { color: colors.text }]}>Courts</Text>
      </View>

      <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
        <EmptyState
          icon={LandPlot}
          title="Courts near you are coming soon"
          body="Sport select, court listings and slot booking land here in the next phase."
        />
      </View>
    </SafeAreaView>
  );
}
