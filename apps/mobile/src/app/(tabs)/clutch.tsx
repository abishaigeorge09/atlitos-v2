import { spacing } from '@atlitos/theme';
import { Play } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { EmptyState } from '@/components/organisms/EmptyState';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Clutch tab. PRD-01 3.4 owns the full vertical clip feed once the clutch
 * domain migration lands (`useClutch` is still `TODO(P5)` in
 * packages/api/src/hooks.ts). Guest browsing is allowed read-only per FR-2;
 * the only mutating action a placeholder feed can offer honestly is Upload,
 * which is hard-gated for guest per FR-3/3.4. States: empty (no clips
 * available yet, true for every account right now), gated (guest tapping
 * Upload).
 */
export default function ClutchScreen() {
  const colors = useThemeColors();
  const status = useSessionStore((state) => state.status);
  const isGuest = status === 'guest';

  const [gateVisible, setGateVisible] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: spacing.lg }}>
        <Text style={[textStyle('h1'), { color: colors.text }]}>Clutch</Text>
      </View>

      <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
        <EmptyState
          icon={Play}
          title="No clips yet"
          body="Training and match highlights show up here once Clutch ships."
          ctaLabel="Upload a clip"
          onCtaPress={() => {
            if (isGuest) setGateVisible(true);
            // Signed-in upload flow lands with the clutch domain (P5).
          }}
        />
      </View>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
