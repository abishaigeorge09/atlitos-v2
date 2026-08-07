import { useClutch } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import type { ApiError, Clip, Comment } from '@atlitos/types';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  Flag,
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
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClipVideo } from '@/components/molecules/clip-video';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { ModerationSheet, type ModerationTarget } from '@/components/organisms/moderation/ModerationSheet';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const PLAYBACK_REFRESH_LEAD_S = 15;

/** Deep link into this exact clip (app scheme in app.json). Carried by the
 * share sheet so a tap reopens the same clip in the viewer. */
function clipDeepLink(clipId: string): string {
  return `atlitos://clutch/post/${clipId}`;
}

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
 * Clutch post viewer (PRD-01 3.4, FR-45; FB-004). Opened at the tapped clip and
 * SWIPEABLE: a vertical paging feed, not a single dead-end. It is self
 * sufficient, so no caller changes are needed: it fetches the published feed
 * page itself, prepends the tapped clip if the page does not include it (an
 * owner opening their own pending clip, which the public feed omits), and opens
 * the pager at that clip.
 *
 * Each page reuses the feed's machinery (clutch/index.tsx): getItemLayout on the
 * container height, onViewableItemsChanged to track the active card, a per-card
 * short-lived signed playback URL minted when it becomes active and prefetched
 * for the next, refreshed just before its 300s TTL, and dropped offscreen. Like,
 * save and comment state are keyed per card in the `clips` list, never a single
 * clip. The Instagram Reels overlay (FB-004) is preserved as the per-item chrome.
 */
export default function ClutchPostViewerScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clutch = useClutch(supabase);
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const myId = useSessionStore((state) => state.me?.id ?? null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'notFound'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialIndex, setInitialIndex] = useState(0);

  const [containerH, setContainerH] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playbackUrls, setPlaybackUrls] = useState<Record<string, string>>({});
  const [posterUrls, setPosterUrls] = useState<Record<string, string>>({});
  // Autoplay policy means muted first; the viewer taps to unmute. Shared across
  // pages so the choice persists as you swipe (IG Reels behaviour).
  const [muted, setMuted] = useState(true);
  const [gateVisible, setGateVisible] = useState(false);

  // Comments open in a single sheet for whichever clip the viewer tapped.
  const [commentsClip, setCommentsClip] = useState<Clip | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentCursor, setCommentCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [moderationTarget, setModerationTarget] = useState<ModerationTarget | null>(null);

  const activeIdRef = useRef<string | null>(null);
  const refreshTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearTimer = useCallback((clipId: string) => {
    const timer = refreshTimers.current[clipId];
    if (timer) {
      clearTimeout(timer);
      delete refreshTimers.current[clipId];
    }
  }, []);

  const mintPlayback = useCallback(
    async (clipId: string) => {
      try {
        const playback = await clutch.getPlaybackUrl(clipId);
        setPlaybackUrls((prev) => ({ ...prev, [clipId]: playback.url }));
        if (playback.thumbUrl) {
          setPosterUrls((prev) => ({ ...prev, [clipId]: playback.thumbUrl as string }));
        }
        clearTimer(clipId);
        const refreshMs = Math.max(PLAYBACK_REFRESH_LEAD_S, playback.expiresIn - PLAYBACK_REFRESH_LEAD_S) * 1000;
        refreshTimers.current[clipId] = setTimeout(() => {
          if (activeIdRef.current === clipId) void mintPlayback(clipId);
          else clearTimer(clipId);
        }, refreshMs);
      } catch {
        // A removed/rejected clip a non-owner cannot see (403), or placeholder
        // bytes, leaves the poster. The owner's own clip always mints (FB-004).
      }
    },
    [clutch, clearTimer],
  );

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      // The tapped clip AND the published feed page, in parallel. getClip
      // resolves an own pending clip the public feed omits; the feed gives the
      // pager something to swipe to.
      const [detail, page] = await Promise.all([clutch.getClip(id), clutch.getFeed()]);
      if (!detail) {
        setState('notFound');
        return;
      }
      const feed = page.clips;
      const inFeed = feed.some((c) => c.id === detail.id);
      // Prepend the tapped clip when the feed omits it, so it is always index 0
      // in that case; otherwise open at its position in the feed.
      const ordered = inFeed ? feed : [detail, ...feed];
      const startIndex = Math.max(0, ordered.findIndex((c) => c.id === detail.id));
      setClips(ordered);
      setCursor(page.nextCursor);
      setInitialIndex(startIndex);
      setActiveId(detail.id);
      activeIdRef.current = detail.id;
      setState('ready');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [clutch, id]);

  useEffect(() => {
    void load();
    const timers = refreshTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, [load]);

  async function loadMore() {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await clutch.getFeed(cursor);
      // Guard against a re-append of a clip already present (e.g. the prepended
      // tapped clip) so keys stay unique.
      setClips((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.clips.filter((c) => !seen.has(c.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // A failed page-append leaves the pager intact; the next scroll retries.
    } finally {
      setLoadingMore(false);
    }
  }

  const onViewableItemsChanged = useRef((info: { viewableItems: ViewToken[] }) => {
    const first = info.viewableItems[0]?.item as Clip | undefined;
    const nextActive = first?.id ?? null;
    activeIdRef.current = nextActive;
    setActiveId(nextActive);
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;

  // Mint for the active card, prefetch the next, drop far-offscreen URLs. Same
  // rule as the feed so a swipe reveals an already-playing card.
  useEffect(() => {
    if (!activeId) return;
    if (!playbackUrls[activeId]) void mintPlayback(activeId);

    const index = clips.findIndex((clip) => clip.id === activeId);
    const next = clips[index + 1];
    if (next && !playbackUrls[next.id]) void mintPlayback(next.id);

    const keep = new Set([activeId, clips[index + 1]?.id, clips[index - 1]?.id].filter(Boolean) as string[]);
    setPlaybackUrls((prev) => {
      let changed = false;
      const nextUrls: Record<string, string> = {};
      for (const [cid, url] of Object.entries(prev)) {
        if (keep.has(cid)) nextUrls[cid] = url;
        else {
          changed = true;
          clearTimer(cid);
        }
      }
      return changed ? nextUrls : prev;
    });
    setPosterUrls((prev) => {
      let changed = false;
      const nextUrls: Record<string, string> = {};
      for (const [cid, url] of Object.entries(prev)) {
        if (keep.has(cid)) nextUrls[cid] = url;
        else changed = true;
      }
      return changed ? nextUrls : prev;
    });
  }, [activeId, clips, playbackUrls, mintPlayback, clearTimer]);

  function requireAuth(action: () => void) {
    if (requiresAuthGate) {
      setGateVisible(true);
      return;
    }
    action();
  }

  function handleLike(clip: Clip) {
    requireAuth(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setClips((prev) =>
        prev.map((c) =>
          c.id === clip.id ? { ...c, likedByMe: !c.likedByMe, likes: c.likes + (c.likedByMe ? -1 : 1) } : c,
        ),
      );
      clutch
        .toggleLike(clip.id)
        .then((result) =>
          setClips((prev) =>
            prev.map((c) => (c.id === clip.id ? { ...c, likedByMe: result.liked, likes: result.likesCount } : c)),
          ),
        )
        .catch(() =>
          setClips((prev) =>
            prev.map((c) => (c.id === clip.id ? { ...c, likedByMe: clip.likedByMe, likes: clip.likes } : c)),
          ),
        );
    });
  }

  function handleSave(clip: Clip) {
    requireAuth(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, savedByMe: !c.savedByMe } : c)));
      clutch
        .toggleSaveClip(clip.id)
        .then((saved) =>
          setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, savedByMe: saved } : c))),
        )
        .catch(() =>
          setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, savedByMe: clip.savedByMe } : c))),
        );
    });
  }

  async function handleShare(clip: Clip) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const label = clip.caption ? clip.caption : `Clip by ${clip.channel}`;
    try {
      await Share.share({ message: label, url: clipDeepLink(clip.id) });
    } catch {
      // A dismissed share sheet is a no-op.
    }
  }

  // CT-C: report/block the clip's own owner, offered from the rail. Never
  // shown for the caller's own clip (requireAuth is not enough here: the
  // action targets an AUTHOR, so an own-clip tap is simply a no-op rather
  // than opening a sheet with no useful action in it).
  function openClipModeration(clip: Clip) {
    if (!myId || clip.ownerId === myId) return;
    requireAuth(() => {
      setModerationTarget({ type: 'clip', entityId: clip.id, userId: clip.ownerId, userName: clip.channel });
    });
  }

  // CT-C: report/block a comment's author, from a long-press on the row.
  // Never for the caller's own comment.
  function openCommentModeration(comment: Comment) {
    if (!myId || comment.userId === myId) return;
    requireAuth(() => {
      setModerationTarget({ type: 'comment', entityId: comment.id, userId: comment.userId, userName: comment.username });
    });
  }

  async function openComments(clip: Clip) {
    setCommentsClip(clip);
    setComments([]);
    setCommentCursor(null);
    try {
      const page = await clutch.getComments(clip.id);
      setComments(page.comments);
      setCommentCursor(page.nextCursor);
    } catch {
      // Leave the thread empty; the sheet still opens with the composer.
    }
  }

  async function loadMoreComments() {
    if (!commentsClip || !commentCursor) return;
    try {
      const page = await clutch.getComments(commentsClip.id, commentCursor);
      setComments((prev) => [...prev, ...page.comments]);
      setCommentCursor(page.nextCursor);
    } catch {
      // Leave the thread as-is; the next scroll retries.
    }
  }

  async function handleSend() {
    if (!commentsClip || !draft.trim()) return;
    if (requiresAuthGate) {
      setGateVisible(true);
      return;
    }
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const clipId = commentsClip.id;
    try {
      const created = await clutch.addComment(clipId, draft.trim());
      setComments((prev) => [...prev, created]);
      setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, commentCount: c.commentCount + 1 } : c)));
      setCommentsClip((c) => (c && c.id === clipId ? { ...c, commentCount: c.commentCount + 1 } : c));
      setDraft('');
    } catch {
      // Keep the draft so the athlete can retry without retyping.
    } finally {
      setSending(false);
    }
  }

  // Loading / error / not-found share the dark full-bleed frame so there is no
  // light flash before the video mounts.
  if (state !== 'ready') {
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
    <View
      style={{ flex: 1, backgroundColor: colors.text }}
      onLayout={(event) => setContainerH(event.nativeEvent.layout.height)}
    >
      {containerH > 0 ? (
        <FlatList
          data={clips}
          keyExtractor={(item) => item.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: containerH, offset: containerH * index, index })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReachedThreshold={0.5}
          onEndReached={() => void loadMore()}
          renderItem={({ item }) => (
            <View style={{ height: containerH }}>
              <ClipPage
                clip={item}
                active={item.id === activeId}
                playbackUrl={playbackUrls[item.id]}
                posterUrl={posterUrls[item.id]}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                onBack={() => router.back()}
                onOpenCreator={() =>
                  router.push({ pathname: '/(tabs)/clutch/creator/[id]', params: { id: item.ownerId } })
                }
                onLike={() => handleLike(item)}
                onComment={() => void openComments(item)}
                onShare={() => void handleShare(item)}
                onSave={() => handleSave(item)}
                onReport={item.ownerId === myId ? undefined : () => openClipModeration(item)}
              />
            </View>
          )}
        />
      ) : null}

      {/* Comments sheet for the tapped clip. Single modal at the screen level so
          the thread never pushes a video up; the composer gates a guest (FR-3). */}
      <Modal
        visible={commentsClip !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentsClip(null)}
      >
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={() => setCommentsClip(null)} />
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
                {commentsClip?.commentCount === 1 ? '1 comment' : `${commentsClip?.commentCount ?? 0} comments`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                onPress={() => setCommentsClip(null)}
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
                <Pressable
                  onLongPress={item.userId === myId ? undefined : () => openCommentModeration(item)}
                  accessibilityRole={item.userId === myId ? undefined : 'button'}
                  accessibilityLabel={item.userId === myId ? undefined : `Report or block ${item.username}`}
                  style={{ gap: spacing.xs }}
                >
                  <View className="flex-row items-center gap-sm">
                    <Text style={[textStyle('label'), { color: colors.text }]}>{item.username}</Text>
                    <Text className="font-mono text-xs" style={{ color: colors.textSecondary }}>
                      {timeAgo(item.createdAt)}
                    </Text>
                  </View>
                  <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{item.text}</Text>
                </Pressable>
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

      <ModerationSheet
        visible={moderationTarget !== null}
        target={moderationTarget}
        onClose={() => setModerationTarget(null)}
        onBlocked={() => {
          // A blocked owner's clips/comments come out of the NEXT feed/
          // comments fetch (packages/api filters, see hooks.ts CT-C notes).
          // Re-run both so the change is visible immediately rather than on
          // the viewer's next cold load.
          void load();
          if (commentsClip) void openComments(commentsClip);
        }}
      />
    </View>
  );
}

interface ClipPageProps {
  clip: Clip;
  active: boolean;
  playbackUrl?: string;
  posterUrl?: string;
  muted: boolean;
  onToggleMute: () => void;
  onBack: () => void;
  onOpenCreator: () => void;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  /** CT-C: report/block the clip's owner. Omitted for the caller's own clip. */
  onReport?: () => void;
}

/**
 * One full-bleed page of the viewer: the 9:16 video behind the Instagram Reels
 * chrome (FB-004) preserved from the single-clip viewer. Header (back, avatar,
 * sport line), right rail (like, comment, share, save), caption, and mute.
 */
function ClipPage({
  clip,
  active,
  playbackUrl,
  posterUrl,
  muted,
  onToggleMute,
  onBack,
  onOpenCreator,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: ClipPageProps) {
  const colors = useThemeColors();

  return (
    <View style={{ flex: 1, backgroundColor: colors.text }}>
      <ClipVideo url={playbackUrl} thumbUrl={posterUrl ?? clip.thumbUrl} active={active} muted={muted} />

      {/* Top scrim for header legibility. */}
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none', bottom: '78%', backgroundColor: colors.overlay }]} />
      {/* Bottom scrim for caption legibility. */}
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none', top: '55%', backgroundColor: colors.overlay }]} />

      <SafeAreaView style={StyleSheet.absoluteFill} edges={['top']} pointerEvents="box-none">
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
            onPress={onBack}
            style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronLeft size={28} color={colors.textInverse} strokeWidth={2} />
          </Pressable>
          <Text style={[textStyle('h3'), { color: colors.textInverse }]}>Clutch</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${clip.channel}`}
          onPress={onOpenCreator}
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

      {/* Right action rail: like, comment, share, save. */}
      <SafeAreaView style={{ position: 'absolute', bottom: 0, right: 0 }} edges={['bottom']} pointerEvents="box-none">
        <View style={{ alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.md, paddingBottom: spacing.lg }}>
          <Pressable
            onPress={onLike}
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
            onPress={onComment}
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
            onPress={onSave}
            accessibilityRole="button"
            accessibilityLabel={clip.savedByMe ? 'Remove from saved' : 'Save'}
            className="min-h-11 min-w-11 items-center justify-center gap-xs"
          >
            {clip.savedByMe ? (
              <BookmarkCheck size={30} strokeWidth={1.75} color={colors.accent} fill={colors.accent} />
            ) : (
              <Bookmark size={30} strokeWidth={1.75} color={colors.textInverse} />
            )}
          </Pressable>
          <Pressable
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Share"
            className="min-h-11 min-w-11 items-center justify-center gap-xs"
          >
            <Share2 size={30} strokeWidth={1.75} color={colors.textInverse} />
          </Pressable>
          {onReport ? (
            <Pressable
              onPress={onReport}
              accessibilityRole="button"
              accessibilityLabel="Report or block"
              className="min-h-11 min-w-11 items-center justify-center gap-xs"
            >
              <Flag size={26} strokeWidth={1.75} color={colors.textInverse} />
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>

      {/* Bottom-left caption + bottom-right mute toggle. */}
      <SafeAreaView style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }} edges={['bottom']} pointerEvents="box-none">
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
            onPress={onToggleMute}
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
    </View>
  );
}
