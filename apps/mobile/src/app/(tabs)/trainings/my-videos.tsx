import { useMyTraineeVideos } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import type { ApiError } from '@atlitos/types';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Film, TriangleAlert, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * PRD-01, Track F handoff note: the athlete side of coach trainee video
 * review. Read only, this athlete's own review videos from every coach that
 * has posted one, newest first. Reached from the Trainings dashboard (Stats
 * tab, "My review videos" row), the least invasive spot since the athlete
 * side of Trainings has no per screen tab set to hang a Video Analytics tab
 * off of the way the coach's trainee profile does.
 */
export default function MyTraineeVideosScreen() {
  const colors = useThemeColors();
  const videos = useMyTraineeVideos(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof videos.list>>>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<ApiError | null>(null);
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
  });

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await videos.list();
      setRows(result);
      setState(result.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!playbackUrl) return;
    void player.replaceAsync(playbackUrl).then(() => player.play());
  }, [player, playbackUrl]);

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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="My review videos" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton shape="card" height={64} />
          <Skeleton shape="card" height={64} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Could not load videos</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : state === 'empty' ? (
        <EmptyState
          icon={Film}
          title="No data found"
          body="Videos your coach posts to review your training will show up here."
        />
      ) : (
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          {playbackError ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <TriangleAlert size={16} color={colors.danger} strokeWidth={1.75} />
              <Text style={[textStyle('caption'), { color: colors.danger, flex: 1 }]}>
                {playbackError.message ?? 'Could not load this video.'}
              </Text>
            </View>
          ) : null}
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
    </SafeAreaView>
  );
}
