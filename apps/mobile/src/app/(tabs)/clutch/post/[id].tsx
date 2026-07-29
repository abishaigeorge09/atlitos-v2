import { useClutch } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import type { ApiError, Clip, Comment } from '@atlitos/types';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  Heart,
  MessageCircle,
  Send,
  Share2,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClipVideo } from '@/components/molecules/clip-video';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Avatar } from '@/components/ui/avatar';
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
 * Clutch post viewer (PRD-01 3.4, FR-45; FB-004). Instagram Reels layout: the
 * clip plays full bleed 9:16 behind a scrim, with a top header (back, avatar,
 * username, sport line), a right action rail (like, comment, share), and a
 * mute toggle. Comments open in a bottom sheet from the comment action rather
 * than a long list pushing the video up.
 *
 * The clip plays from a fresh signed URL minted here (refreshed before its 300s
 * TTL, same rule as the feed). The OWNER opening their own clip always gets a
 * URL regardless of moderation status (the edge function widening for FB-004),
 * so a pending/processing/rejected own clip plays instead of a silent poster.
 * Guest can read the thread but like/comment gate to login (FR-3). Like routes
 * through `toggle_clip_like`; a comment is an own-row insert.
 */
export default function ClutchPostDetailScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clutch = useClutch(supabase);
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');

  const [clip, setClip] = useState<Clip | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'notFound'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string | undefined>(undefined);
  const [posterUrl, setPosterUrl] = useState<string | undefined>(undefined);
  const [gateVisible, setGateVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  // Autoplay policy means the video starts muted; the viewer taps to unmute.
  const [muted, setMuted] = useState(true);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mintPlayback = useCallback(async () => {
    if (!id) return;
    try {
      const playback = await clutch.getPlaybackUrl(id);
      setPlaybackUrl(playback.url);
      if (playback.thumbUrl) setPosterUrl(playback.thumbUrl);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      const refreshMs = Math.max(PLAYBACK_REFRESH_LEAD_S, playback.expiresIn - PLAYBACK_REFRESH_LEAD_S) * 1000;
      refreshTimer.current = setTimeout(() => void mintPlayback(), refreshMs);
    } catch {
      // A removed/rejected clip a non-owner cannot see (403), or placeholder
      // bytes, leaves the poster. The owner's own clip always mints (FB-004).
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
    if (requiresAuthGate) {
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

  function handleShare() {
    if (!clip) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const label = clip.caption ? clip.caption : `Clip by ${clip.channel}`;
    void Share.share({ message: label }).catch(() => {});
  }

  async function handleSend() {
    if (!id || !draft.trim()) return;
    if (requiresAuthGate) {
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

  // Loading / error / not-found share the dark full-bleed frame of the player
  // so there is no light flash before the video mounts.
  if (state !== 'ready' || !clip) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.text }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
              onPress={() => router.back()}
              style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={28} color={colors.textInverse} strokeWidth={2} />
            </Pressable>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg }}>
            {state === 'loading' ? (
              <ActivityIndicator color={colors.accent} />
            ) : state === 'notFound' ? (
              <>
                <MessageCircle size={40} color={colors.textInverse} strokeWidth={1.75} />
                <Text style={[textStyle('h3'), { color: colors.textInverse, textAlign: 'center' }]}>Clip unavailable</Text>
                <Text style={[textStyle('callout'), { color: colors.textInverse, textAlign: 'center', opacity: 0.8 }]}>
                  This clip may have been removed or is not published yet.
                </Text>
              </>
            ) : (
              <>
                <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
                <Text style={[textStyle('h3'), { color: colors.textInverse, textAlign: 'center' }]}>Couldn't load clip</Text>
                <Text style={[textStyle('callout'), { color: colors.textInverse, textAlign: 'center', opacity: 0.8 }]}>
                  {error?.message ?? 'Something went wrong. Please try again.'}
                </Text>
                <Button variant="secondary" onPress={() => void load()}>
                  <Text style={{ color: colors.text }}>Retry</Text>
                </Button>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.text }}>
      {/* Full-bleed 9:16 video, filling the viewport behind the overlays. */}
      <ClipVideo url={playbackUrl} thumbUrl={posterUrl ?? clip.thumbUrl} active muted={muted} />

      {/* Top scrim for header legibility over a bright frame. */}
      <View
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none', bottom: '78%', backgroundColor: colors.overlay }]}
      />
      {/* Bottom scrim for caption legibility. */}
      <View
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none', top: '55%', backgroundColor: colors.overlay }]}
      />

      <SafeAreaView style={StyleSheet.absoluteFill} edges={['top']} pointerEvents="box-none">
        {/* Top bar: back + "Post" title. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            paddingHorizontal: spacing.sm,
            paddingTop: spacing.sm,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            onPress={() => router.back()}
            style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronLeft size={28} color={colors.textInverse} strokeWidth={2} />
          </Pressable>
          <Text style={[textStyle('h3'), { color: colors.textInverse }]}>Post</Text>
        </View>

        {/* Header row: avatar + username + sport line. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${clip.channel}`}
          onPress={() => router.push({ pathname: '/(tabs)/clutch/creator/[id]', params: { id: clip.ownerId } })}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
          }}
        >
          <Avatar name={clip.channel} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={[textStyle('label'), { color: colors.textInverse }]} numberOfLines={1}>
              {clip.channel}
            </Text>
            <Text className="font-mono text-xs" style={{ color: colors.textInverse, opacity: 0.8 }} numberOfLines={1}>
              {clip.sport} · {timeAgo(clip.createdAt)}
            </Text>
          </View>
        </Pressable>
      </SafeAreaView>

      {/* Right action rail: like, comment, share. */}
      <SafeAreaView
        style={{ position: 'absolute', bottom: 0, right: 0 }}
        edges={['bottom']}
        pointerEvents="box-none"
      >
        <View style={{ alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.md, paddingBottom: spacing.lg }}>
          <Pressable
            onPress={handleLike}
            accessibilityRole="button"
            accessibilityLabel={clip.likedByMe ? 'Unlike' : 'Like'}
            className="min-h-11 min-w-11 items-center justify-center gap-xs"
          >
            <Heart
              size={30}
              strokeWidth={1.75}
              color={clip.likedByMe ? colors.danger : colors.textInverse}
              fill={clip.likedByMe ? colors.danger : 'transparent'}
            />
            <Text className="font-mono text-xs" style={{ color: colors.textInverse }}>
              {clip.likes}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setCommentsVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Comments"
            className="min-h-11 min-w-11 items-center justify-center gap-xs"
          >
            <MessageCircle size={30} strokeWidth={1.75} color={colors.textInverse} />
            <Text className="font-mono text-xs" style={{ color: colors.textInverse }}>
              {clip.commentCount}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Share"
            className="min-h-11 min-w-11 items-center justify-center gap-xs"
          >
            <Share2 size={30} strokeWidth={1.75} color={colors.textInverse} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Bottom-left caption + bottom-right mute toggle. */}
      <SafeAreaView
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
        edges={['bottom']}
        pointerEvents="box-none"
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: spacing.md,
            paddingLeft: spacing.md,
            paddingRight: spacing['6xl'],
            paddingBottom: spacing.lg,
          }}
        >
          <View style={{ flex: 1, gap: spacing.xs }}>
            {clip.caption ? (
              <Text style={{ color: colors.textInverse }} numberOfLines={3}>
                {clip.caption}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => setMuted((m) => !m)}
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute' : 'Mute'}
            hitSlop={8}
            style={{
              height: 40,
              width: 40,
              borderRadius: radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.overlay,
            }}
          >
            {muted ? (
              <VolumeX size={20} color={colors.textInverse} strokeWidth={1.75} />
            ) : (
              <Volume2 size={20} color={colors.textInverse} strokeWidth={1.75} />
            )}
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Comments sheet. Opened from the comment action so the thread never
          pushes the video up; the composer gates to login for a guest (FR-3). */}
      <Modal visible={commentsVisible} transparent animationType="slide" onRequestClose={() => setCommentsVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={() => setCommentsVisible(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              backgroundColor: colors.bg,
              borderTopLeftRadius: radii['2xl'],
              borderTopRightRadius: radii['2xl'],
              maxHeight: '75%',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={[textStyle('h3'), { color: colors.text }]}>
                {clip.commentCount === 1 ? '1 comment' : `${clip.commentCount} comments`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                onPress={() => setCommentsVisible(false)}
                style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={24} color={colors.textSecondary} strokeWidth={1.75} />
              </Pressable>
            </View>

            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              onEndReachedThreshold={0.5}
              onEndReached={() => void loadMoreComments()}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
              ListEmptyComponent={
                <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
                  <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                    No comments yet. Start the conversation.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={{ gap: spacing.xs }}>
                  <View className="flex-row items-center gap-sm">
                    <Text style={[textStyle('label'), { color: colors.text }]}>{item.username}</Text>
                    <Text className="font-mono text-xs" style={{ color: colors.textSecondary }}>
                      {timeAgo(item.createdAt)}
                    </Text>
                  </View>
                  <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{item.text}</Text>
                </View>
              )}
            />

            {requiresAuthGate ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setGateVisible(true)}
                style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}
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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </View>
  );
}
