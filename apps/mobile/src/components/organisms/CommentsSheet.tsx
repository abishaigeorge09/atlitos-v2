import { styles } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import { Send, X } from 'lucide-react-native';
import * as React from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

/**
 * SPEC.md organism #41. Bottom sheet, comment list + input.
 */
export interface CommentsSheetProps {
  comments: Comment[];
  onSubmit: (text: string) => void;
  onClose?: () => void;
}

export function CommentsSheet({ comments, onSubmit, onClose }: CommentsSheetProps) {
  const colors = useThemeColors();
  const [draft, setDraft] = React.useState('');

  const handleSend = () => {
    if (!draft.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSubmit(draft.trim());
    setDraft('');
  };

  return (
    <View
      style={{
        borderTopLeftRadius: radii['2xl'],
        borderTopRightRadius: radii['2xl'],
        backgroundColor: colors.surface,
        maxHeight: '80%',
      }}
    >
      <View
        style={[
          styles.between,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[textStyle('h3'), { color: colors.text }]}>Comments</Text>
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={onClose}
            style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={24} color={colors.textSecondary} strokeWidth={1.75} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={comments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        renderItem={({ item }) => (
          <View style={{ gap: spacing.xs }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Text style={[textStyle('label'), { color: colors.text }]}>{item.author}</Text>
              {/* textSecondary, not tertiary: the whole sheet is a
                  colors.surface fill, textTertiary fails AA contrast against
                  it in dark mode. */}
              <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{item.timestamp}</Text>
            </View>
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{item.text}</Text>
          </View>
        )}
      />

      <View
        style={[
          styles.row,
          {
            gap: spacing.sm,
            padding: spacing.lg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment"
          placeholderTextColor={colors.textTertiary}
          style={[
            textStyle('body'),
            {
              flex: 1,
              color: colors.text,
              backgroundColor: colors.surfaceMuted,
              borderRadius: radii.sm,
              paddingHorizontal: spacing.md,
              height: 44,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send comment"
          onPress={handleSend}
          style={{
            height: 44,
            width: 44,
            borderRadius: radii.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accent,
          }}
        >
          <Send size={20} color={colors.inkOnAccent} strokeWidth={1.75} />
        </Pressable>
      </View>
    </View>
  );
}
