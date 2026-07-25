import { useCoachTraineeVideos } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import type { ApiError } from '@atlitos/types';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Film, TriangleAlert, Upload, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/organisms/EmptyState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ListState = 'loading' | 'error' | 'ready';
type UploadState = 'idle' | 'picking' | 'uploading' | 'error';

/**
 * PRD-02 Player Profile "Video Analytics" tab, design node 1047:16588
 * (docs/design/COACH-TRAININGS-GAP.md gap #8/#18). Coach side: a list of the
 * review videos this coach has posted for one trainee, playback via a fresh
 * signed URL per open (never a stored URL, mirrors Clutch), and an upload
 * flow (expo-image-picker video, `coach-trainee-video-upload-url` mint,
 * PUT to the signed URL). Exported as a standalone organism so the trainee
 * profile tab shell (Track C) mounts it directly as the tab's content, no
 * AppBar or screen chrome of its own.
 */
export interface TraineeVideoAnalyticsProps {
  playerId: string;
}

export function TraineeVideoAnalytics({ playerId }: TraineeVideoAnalyticsProps) {
  const colors = useThemeColors();
  const videos = useCoachTraineeVideos(supabase);

  const [listState, setListState] = useState<ListState>('loading');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof videos.listForTrainee>>>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadError, setUploadError] = useState<ApiError | null>(null);

  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<ApiError | null>(null);
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
  });

  // The signed playback url is minted fresh on each open (never cached), so
  // swap it into the already-created player rather than recreating it, same
  // as ClipVideo's replaceAsync pattern.
  useEffect(() => {
    if (!playbackUrl) return;
    void player.replaceAsync(playbackUrl).then(() => player.play());
  }, [player, playbackUrl]);

  const load = useCallback(async () => {
    setListState('loading');
    setError(null);
    try {
      const result = await videos.listForTrainee(playerId);
      setRows(result);
      setListState('ready');
    } catch (err) {
      setError(err as ApiError);
      setListState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pickVideo() {
    setUploadState('picking');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
    if (!result.canceled && result.assets[0]) {
      setAsset(result.assets[0]);
    }
    setUploadState('idle');
  }

  async function handleUpload() {
    if (!asset) return;
    setUploadState('uploading');
    setUploadError(null);
    try {
      const ticket = await videos.requestUploadUrl(playerId, caption.trim() || undefined);
      const fileResponse = await fetch(asset.uri);
      const fileBody = await fileResponse.blob();
      const { error: uploadErr } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, fileBody, {
          contentType: asset.mimeType ?? 'video/mp4',
        });
      if (uploadErr) throw uploadErr;

      setAsset(null);
      setCaption('');
      setUploadState('idle');
      await load();
    } catch (err) {
      setUploadError(err as ApiError);
      setUploadState('error');
    }
  }

  async function openVideo(videoId: string) {
    setPlaybackError(null);
    try {
      const playback = await videos.getPlaybackUrl(videoId);
      setPlaybackUrl(playback.url);
    } catch (err) {
      setPlaybackError(err as ApiError);
    }
  }

  function closePlayback() {
    player.pause();
    setPlaybackUrl(null);
  }

  return (
    <View style={{ gap: spacing.lg, padding: spacing.lg }}>
      {/* Upload composer. */}
      <View style={{ gap: spacing.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={asset ? 'Change video' : 'Select a video to upload'}
          onPress={() => void pickVideo()}
          disabled={uploadState === 'uploading'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.borderStrong,
            backgroundColor: colors.surfaceMuted,
            padding: spacing.md,
          }}
        >
          <Film size={20} color={colors.textTertiary} strokeWidth={1.75} />
          <Text style={[textStyle('callout'), { color: colors.textSecondary, flex: 1 }]}>
            {asset ? (asset.fileName ?? 'Video selected') : 'Select a review video'}
          </Text>
        </Pressable>

        {asset ? (
          <>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Add a note for this video, optional"
              placeholderTextColor={colors.textTertiary}
              editable={uploadState !== 'uploading'}
              style={[
                textStyle('body'),
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: radii.md,
                  padding: spacing.md,
                },
              ]}
            />
            {uploadState === 'error' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <TriangleAlert size={16} color={colors.danger} strokeWidth={1.75} />
                <Text style={[textStyle('caption'), { color: colors.danger, flex: 1 }]}>
                  {uploadError?.message ?? 'Upload failed. Please try again.'}
                </Text>
              </View>
            ) : null}
            <Button loading={uploadState === 'uploading'} onPress={() => void handleUpload()}>
              {uploadState === 'uploading' ? (
                <ActivityIndicator color={colors.inkOnAccent} />
              ) : (
                <Upload size={18} strokeWidth={1.75} color={colors.inkOnAccent} />
              )}
              <Text style={{ color: colors.inkOnAccent }}>Upload video</Text>
            </Button>
          </>
        ) : null}
      </View>

      {/* List. */}
      {listState === 'loading' ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton shape="card" height={64} />
          <Skeleton shape="card" height={64} />
        </View>
      ) : listState === 'error' ? (
        <View style={{ alignItems: 'center', gap: spacing.sm, padding: spacing.lg }}>
          <TriangleAlert size={32} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Could not load videos.'}
          </Text>
          <Button variant="secondary" size="sm" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No data found"
          body="Upload a review video for this trainee and it will show up here."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {rows.map((video) => (
            <Pressable
              key={video.id}
              accessibilityRole="button"
              accessibilityLabel="Play review video"
              onPress={() => void openVideo(video.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.md,
              }}
            >
              <View
                style={{
                  height: 44,
                  width: 44,
                  borderRadius: radii.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.surfaceMuted,
                }}
              >
                <Film size={20} color={colors.textSecondary} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={[textStyle('callout'), { color: colors.text }]}>
                  {video.caption ?? 'Review video'}
                </Text>
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{video.createdAt}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {playbackError ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TriangleAlert size={16} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('caption'), { color: colors.danger, flex: 1 }]}>
            {playbackError.message ?? 'Could not load this video.'}
          </Text>
        </View>
      ) : null}

      {/* Playback modal. */}
      <Modal visible={playbackUrl != null} animationType="slide" onRequestClose={closePlayback}>
        <View style={{ flex: 1, backgroundColor: colors.text }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close video"
            onPress={closePlayback}
            style={{ position: 'absolute', top: spacing.xl, right: spacing.lg, zIndex: 1, padding: spacing.sm }}
          >
            <X size={24} color={colors.bg} strokeWidth={1.75} />
          </Pressable>
          {playbackUrl ? (
            <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

export default TraineeVideoAnalytics;
