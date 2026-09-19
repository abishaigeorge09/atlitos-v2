import { useClutch } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { ApiError, Sport } from '@atlitos/types';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { CheckCircle2, Film, TriangleAlert, Upload } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { useNavBarInset } from '@/components/ui/bottom-nav';
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
 *
 * RETRY (CT-6, P1-6, Phase 3 LAUNCH): the profile grid's Retry action on a
 * `failed` clip already ran retry_failed_clip (failed -> uploading) and its
 * own fresh mint before routing here with `retryClipId`/`retryCaption`/
 * `retrySport`, so this screen only needs to reuse that SAME clip id (never
 * create a second row) once the athlete picks a replacement file and posts;
 * `requestUploadUrl` with `clipId` set is the same reuse path an ordinary
 * dropped-upload retry already used.
 */
export default function ClutchUploadScreen() {
  const colors = useThemeColors();
  const navInset = useNavBarInset();
  const clutch = useClutch(supabase);
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const params = useLocalSearchParams<{ retryClipId?: string; retryCaption?: string; retrySport?: string }>();
  const retryClipId = typeof params.retryClipId === 'string' && params.retryClipId ? params.retryClipId : undefined;
  const retrySport: Sport | null = SPORTS.includes(params.retrySport as Sport) ? (params.retrySport as Sport) : null;

  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [caption, setCaption] = useState(params.retryCaption ?? '');
  const [sport, setSport] = useState<Sport | null>(retrySport);
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<ApiError | null>(null);

  if (requiresAuthGate) {
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

  /**
   * SCALE-MEDIA M-3. Extract a poster frame from the picked video and put it in
   * the signed thumb slot the upload ticket carries.
   *
   * Until this existed the app called `finalizeUpload(clipId)` with one
   * argument against a two argument signature, so `thumb_path` went over as
   * undefined and EVERY clip posted through the app had thumb_path NULL. That
   * is not cosmetic at scale: with no 284 KB poster, the only way for the feed
   * or a profile grid to show anything is to pull the 2.65 MB video, and the
   * batch thumb mint lands every id in `failed` because there is no object to
   * sign.
   *
   * A poster is strictly an optimisation, so every failure path here returns
   * null and the clip posts without one. It never blocks or fails the post.
   * `expo-video-thumbnails` is native only, so web returns null too and the
   * feed falls back to its existing poster-less rendering.
   */
  async function captureThumbnail(ticket: {
    bucket: string;
    thumbUploadUrl: string | null;
    thumbToken: string | null;
    thumbPath: string | null;
  }, videoUri: string): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    if (!ticket.thumbToken || !ticket.thumbPath) return null;
    try {
      // Frame at 0.5s rather than 0: the very first frame of a phone recording
      // is routinely black or still exposing.
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 500, quality: 0.7 });
      const thumbResponse = await fetch(uri);
      // ArrayBuffer, NOT blob(). React Native's Blob carries an empty `type`,
      // and supabase-js derives the PUT's Content-Type from the body when it
      // can, so a Blob upload lands in storage as text/plain no matter what
      // `contentType` below says. Verified on device 2026-08-14: a real upload
      // produced storage.objects rows with mimetype text/plain for BOTH the
      // mp4 and the jpg. An ArrayBuffer has no type of its own, so the option
      // is used.
      const thumbBody = await thumbResponse.arrayBuffer();
      const { error: thumbUploadError } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.thumbPath, ticket.thumbToken, thumbBody, {
          contentType: 'image/jpeg',
        });
      if (thumbUploadError) return null;
      return ticket.thumbPath;
    } catch {
      return null;
    }
  }

  async function handlePost() {
    if (!asset || !sport || !caption.trim()) return;
    setState('uploading');
    setError(null);
    try {
      const ticket = await clutch.requestUploadUrl({ caption: caption.trim(), sport, clipId: retryClipId });

      // Read the picked file and PUT it to the one-time signed Storage URL.
      // NATIVE PASS: swap this whole-file fetch for a resumable/streamed
      // upload with progress (VIDEO.md).
      const fileResponse = await fetch(asset.uri);
      // ArrayBuffer, not blob(); see the note in the thumbnail upload above.
      // A wrong stored Content-Type does not fail the upload, it fails the
      // PLAYBACK later, on someone else's device, which is the worst place to
      // find it.
      const fileBody = await fileResponse.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, fileBody, {
          contentType: asset.mimeType ?? 'video/mp4',
        });
      if (uploadError) throw uploadError;

      // M-3: the poster frame, then the finalize that records its path. The
      // second argument was the whole bug; it is now supplied.
      const thumbPath = await captureThumbnail(ticket, asset.uri);
      await clutch.finalizeUpload(ticket.clipId, thumbPath ?? undefined);
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
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: navInset + spacing.xl }}>
        {retryClipId ? (
          <View className="flex-row items-center gap-sm rounded-md bg-info-tint p-md">
            <Upload size={18} strokeWidth={1.75} color={colors.info} />
            <Text style={[textStyle('callout'), { color: colors.info, flex: 1 }]}>
              This clip is ready for a new upload. Pick a video to finish posting it.
            </Text>
          </View>
        ) : null}

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
