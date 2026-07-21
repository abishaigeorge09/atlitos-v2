import { useClutch } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import type { ApiError, Clip, Comment } from '@atlitos/types';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Heart, MessageCircle, Send, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClipVideo } from '@/components/molecules/clip-video';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const PLAYBACK_REFRESH_LEAD_S = 15;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Clutch post detail + comments (PRD-01 3.4, FR-45). The clip plays from a
 * fresh signed URL (minted here, refreshed before its 300s TTL, same rule as
 * the feed); below it the comment thread with an inline composer. Guest can
 * read the thread but like/comment gate to login (FR-3). Like routes through
 * the `toggle_clip_like` RPC; a comment is an own-row insert.
 */
export default function ClutchPostDetailScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clutch = useClutch(supabase);
  const isGuest = useSessionStore((state) => state.status === 'guest');

  const [clip, setClip] = useState<Clip | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'notFound'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string | undefined>(undefined);
  const [gateVisible, setGateVisible] = useState(false);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mintPlayback = useCallback(async () => {
    if (!id) return;
    try {
      const playback = await clutch.getPlaybackUrl(id);
      setPlaybackUrl(playback.url);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      const refreshMs = Math.max(PLAYBACK_REFRESH_LEAD_S, playback.expiresIn - PLAYBACK_REFRESH_LEAD_S) * 1000;
      refreshTimer.current = setTimeout(() => void mintPlayback(), refreshMs);
    } catch {
      // A removed/rejected clip (403) or placeholder bytes leaves the poster.
    }
  }, [clutch, id]);

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const [detail, page] = await Promise.all([clutch.getClip(id), clutch.getComments(id)]);
      if (!detail) {
        setState('notFound');
        return;
      }
      setClip(detail);
      setComments(page.comments);
      setCursor(page.nextCursor);
      setState('ready');
      void mintPlayback();
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [clutch, id, mintPlayback]);

  useEffect(() => {
    void load();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [load]);

  async function loadMoreComments() {
    if (!id || !cursor) return;
    try {
      const page = await clutch.getComments(id, cursor);
      setComments((prev) => [...prev, ...page.comments]);
      setCursor(page.nextCursor);
    } catch {
      // Leave the thread as-is; the next scroll retries.
    }
  }

  function handleLike() {
    if (!clip) return;
    if (isGuest) {
      setGateVisible(true);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const prev = clip;
    setClip({ ...clip, likedByMe: !clip.likedByMe, likes: clip.likes + (clip.likedByMe ? -1 : 1) });
    void clutch
      .toggleLike(clip.id)
      .then((result) => setClip((c) => (c ? { ...c, likedByMe: result.liked, likes: result.likesCount } : c)))
      .catch(() => setClip(prev));
  }

  async function handleSend() {
    if (!id || !draft.trim()) return;
    if (isGuest) {
      setGateVisible(true);
      return;
    }
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const created = await clutch.addComment(id, draft.trim());
      setComments((prev) => [...prev, created]);
      setClip((c) => (c ? { ...c, commentCount: c.commentCount + 1 } : c));
      setDraft('');
    } catch {
      // Keep the draft so the athlete can retry without retyping.
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Clip" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : state === 'notFound' ? (
        <View className="flex-1 items-center justify-center gap-md p-lg">
          <MessageCircle size={40} color={colors.textTertiary} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Clip unavailable</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            This clip may have been removed or is not published yet.
          </Text>
        </View>
      ) : state === 'error' || !clip ? (
        <View className="flex-1 items-center justify-center gap-md p-lg">
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load clip</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            onEndReachedThreshold={0.5}
            onEndReached={() => void loadMoreComments()}
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            ListHeaderComponent={
              <View>
                {/* Player. Fresh signed URL, poster fallback. */}
                <View style={{ aspectRatio: 9 / 16, maxHeight: 420 }} className="overflow-hidden bg-text">
                  <ClipVideo url={playbackUrl} thumbUrl={clip.thumbUrl} active />
                </View>

                <View style={{ padding: spacing.lg, gap: spacing.sm }}>
                  <View className="flex-row items-center justify-between">
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({ pathname: '/(tabs)/clutch/creator/[id]', params: { id: clip.ownerId } })
                      }
                      className="flex-row items-center gap-sm"
                    >
                      <Text style={[textStyle('h3'), { color: colors.text }]}>{clip.channel}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={clip.likedByMe ? 'Unlike' : 'Like'}
                      onPress={handleLike}
                      className="min-h-11 flex-row items-center gap-xs px-sm"
                    >
                      <Heart
                        size={22}
                        strokeWidth={1.75}
                        color={clip.likedByMe ? colors.danger : colors.text}
                        fill={clip.likedByMe ? colors.danger : 'transparent'}
                      />
                      <Text className="font-mono text-sm text-text">{clip.likes}</Text>
                    </Pressable>
                  </View>

                  {clip.caption ? (
                    <Text style={[textStyle('body'), { color: colors.text }]}>{clip.caption}</Text>
                  ) : null}
                  <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                    {timeAgo(clip.createdAt)}
                  </Text>
                </View>

                <View
                  style={{
                    paddingHorizontal: spacing.lg,
                    paddingBottom: spacing.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Text style={[textStyle('label'), { color: colors.textSecondary }]}>
                    {clip.commentCount === 1 ? '1 comment' : `${clip.commentCount} comments`}
                  </Text>
                </View>
              </View>
            }
            ListEmptyComponent={
              <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                  No comments yet. Start the conversation.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs }}>
                <View className="flex-row items-center gap-sm">
                  <Text style={[textStyle('label'), { color: colors.text }]}>{item.username}</Text>
                  <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                    {timeAgo(item.createdAt)}
                  </Text>
                </View>
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{item.text}</Text>
              </View>
            )}
          />

          {/* Composer. A guest sees a gate prompt instead of the input. */}
          {isGuest ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setGateVisible(true)}
              style={{
                padding: spacing.lg,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <Text style={[textStyle('callout'), { color: colors.accent, textAlign: 'center' }]}>
                Sign in to join the conversation
              </Text>
            </Pressable>
          ) : (
            <View
              style={{
                flexDirection: 'row',
                gap: spacing.sm,
                padding: spacing.lg,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a comment"
                placeholderTextColor={colors.textTertiary}
                editable={!sending}
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
                disabled={sending || !draft.trim()}
                onPress={() => void handleSend()}
                style={{
                  height: 44,
                  width: 44,
                  borderRadius: radii.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.accent,
                  opacity: sending || !draft.trim() ? 0.5 : 1,
                }}
              >
                <Send size={20} color={colors.inkOnAccent} strokeWidth={1.75} />
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
