import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

export interface RequestSupportFormProps {
  onSubmit: (subject: string, description: string) => void;
  submitting?: boolean;
}

/**
 * SPEC #31: subject input + description input, submit button. Used by
 * /account/help (FAQ + RequestSupportForm). Renders its own text inputs
 * rather than depending on the atoms wave's `Input` component, which is a
 * separate ticket; wiring this to the shared atom is a small follow up once
 * that component lands.
 */
export function RequestSupportForm({ onSubmit, submitting = false }: RequestSupportFormProps) {
  const colors = useThemeColors();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0 && !submitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSubmit(subject.trim(), description.trim());
  };

  return (
    <View className="gap-lg">
      <View className="gap-xs">
        <Text className="font-sans-semibold text-xs text-text-secondary">Subject</Text>
        <TextInput
          value={subject}
          onChangeText={setSubject}
          placeholder="What do you need help with"
          placeholderTextColor={colors.textTertiary}
          className="h-11 rounded-sm border border-border bg-surface-muted px-md text-base text-text"
        />
      </View>

      <View className="gap-xs">
        <Text className="font-sans-semibold text-xs text-text-secondary">Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Describe your issue in detail"
          placeholderTextColor={colors.textTertiary}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          className="min-h-32 rounded-sm border border-border bg-surface-muted p-md text-base text-text"
        />
      </View>

      <Button onPress={handleSubmit} disabled={!canSubmit}>
        <Text>{submitting ? 'Submitting' : 'Submit'}</Text>
      </Button>
    </View>
  );
}

export default RequestSupportForm;
