import { useClutch } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { ApiError, Sport } from '@atlitos/types';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { CheckCircle2, Film, TriangleAlert, Upload } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const SPORTS: Sport[] = ['football', 'cricket', 'badminton', 'tennis'];
const MAX_CAPTION = 140;

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

/**
 * Clutch upload (PRD-01 3.4, FR-44: caption AND sport are both required
 * before posting). Flow: pick a clip, write a caption, tag a sport, Post. Post
 * calls `stream-upload-url` for a one-time signed Storage URL, PUTs the MP4
 * with supabase-js `uploadToSignedUrl`, then `stream-webhook` finalizes the
 * clip to `ready` (into the moderation queue). Uploading never writes the
 * `clips` row from the client, the edge function owns that. Guest-gated (FR-3).
 */
export default function ClutchUploadScreen() {
  const colors = useThemeColors();
  const clutch = useClutch(supabase);
  const isGuest = useSessionStore((state) => state.status === 'guest');

  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [sport, setSport] = useState<Sport | null>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<ApiError | null>(null);

  if (isGuest) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Post a clip" onPressBack={() => router.back()} />
        <View className="flex-1 items-center justify-center gap-md p-lg">
          <Film size={40} color={colors.textTertiary} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Sign in to post</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Create an account to share your highlights on Clutch.
          </Text>
        </View>
        <LoginGateModal visible onClose={() => router.back()} />
      </SafeAreaView>
    );
  }

  async function pickVideo() {
    // NATIVE PASS: camera capture (launchCameraAsync) and a smoother on-device
    // picker live here; the library picker is the web-verifiable path.
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
    if (result.canceled) return;
    const picked = result.assets[0];
    if (picked) {
      setAsset(picked);
      setState('idle');
      setError(null);
    }
  }

  const canPost = asset != null && caption.trim().length > 0 && sport != null && state !== 'uploading';

  async function handlePost() {
    if (!asset || !sport || !caption.trim()) return;
    setState('uploading');
    setError(null);
    try {
      const ticket = await clutch.requestUploadUrl({ caption: caption.trim(), sport });

      // Read the picked file and PUT it to the one-time signed Storage URL.
      // NATIVE PASS: swap this whole-file fetch for a resumable/streamed
      // upload with progress, and capture a client-side thumbnail to pass as
      // thumb_path to finalizeUpload (VIDEO.md).
      const fileResponse = await fetch(asset.uri);
      const fileBody = await fileResponse.blob();
      const { error: uploadError } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, fileBody, {
          contentType: asset.mimeType ?? 'video/mp4',
        });
      if (uploadError) throw uploadError;

      await clutch.finalizeUpload(ticket.clipId);
      setState('done');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Post a clip" onPressBack={() => router.back()} />
        <View className="flex-1 items-center justify-center gap-md p-lg">
          <CheckCircle2 size={48} color={colors.success} strokeWidth={1.75} />
          <Text style={[textStyle('h2'), { color: colors.text, textAlign: 'center' }]}>Clip in review</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Your clip is being reviewed. It goes live on Clutch once approved. You can find it on your profile.
          </Text>
          <View style={{ gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.md }}>
            <Button onPress={() => router.replace('/(tabs)/clutch/profile')}>
              <Text style={{ color: colors.inkOnAccent }}>View my clips</Text>
            </Button>
            <Button variant="secondary" onPress={() => router.replace('/(tabs)/clutch')}>
              <Text style={{ color: colors.text }}>Back to feed</Text>
            </Button>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Post a clip" onPressBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        {/* 1. Clip picker / preview. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={asset ? 'Change clip' : 'Select a clip'}
          onPress={() => void pickVideo()}
          disabled={state === 'uploading'}
          style={{ aspectRatio: 9 / 16, maxHeight: 320 }}
          className="items-center justify-center overflow-hidden rounded-lg border border-border-strong bg-surface-muted"
        >
          {asset ? (
            <>
              <Image source={{ uri: asset.uri }} className="absolute inset-0 h-full w-full" resizeMode="cover" />
              <View className="absolute bottom-md rounded-pill bg-surface px-md py-xs">
                <Text className="font-sans-semibold text-sm text-text">Change clip</Text>
              </View>
            </>
          ) : (
            <View className="items-center gap-sm">
              <Film size={48} color={colors.textTertiary} strokeWidth={1.75} />
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Select a clip</Text>
            </View>
          )}
        </Pressable>

        {/* 2. Caption (required). */}
        <View style={{ gap: spacing.xs }}>
          <View className="flex-row items-center justify-between">
            <Text style={[textStyle('label'), { color: colors.text }]}>Caption</Text>
            <Text className="font-mono text-xs text-text-tertiary">
              {caption.length}/{MAX_CAPTION}
            </Text>
          </View>
          <TextInput
            value={caption}
            onChangeText={(next) => setCaption(next.slice(0, MAX_CAPTION))}
            placeholder="Say something about this clip"
            placeholderTextColor={colors.textTertiary}
            multiline
            editable={state !== 'uploading'}
            style={[
              textStyle('body'),
              {
                color: colors.text,
                backgroundColor: colors.surfaceMuted,
                borderRadius: spacing.sm,
                padding: spacing.md,
                minHeight: 80,
                textAlignVertical: 'top',
              },
            ]}
          />
        </View>

        {/* 3. Sport tag (required). */}
        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('label'), { color: colors.text }]}>Sport</Text>
          <View className="flex-row flex-wrap gap-sm">
            {SPORTS.map((option) => (
              <Chip
                key={option}
                label={SPORT_LABEL[option]}
                variant="select"
                selected={sport === option}
                disabled={state === 'uploading'}
                onPress={() => setSport(option)}
              />
            ))}
          </View>
        </View>

        {state === 'error' ? (
          <View className="flex-row items-center gap-sm rounded-md bg-danger-tint p-md">
            <TriangleAlert size={20} color={colors.danger} strokeWidth={1.75} />
            <Text style={[textStyle('callout'), { color: colors.danger, flex: 1 }]}>
              {error?.message ?? 'Upload failed. Please try again.'}
            </Text>
          </View>
        ) : null}

        <Button disabled={!canPost} loading={state === 'uploading'} onPress={() => void handlePost()}>
          {state === 'uploading' ? (
            <>
              <ActivityIndicator color={colors.inkOnAccent} />
              <Text style={{ color: colors.inkOnAccent }}>Uploading</Text>
            </>
          ) : (
            <>
              <Upload size={20} strokeWidth={1.75} color={colors.inkOnAccent} />
              <Text style={{ color: colors.inkOnAccent }}>Post clip</Text>
            </>
          )}
        </Button>
        <Text style={[textStyle('caption'), { color: colors.textTertiary, textAlign: 'center' }]}>
          A caption and a sport are required. Clips are reviewed before they go live.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
