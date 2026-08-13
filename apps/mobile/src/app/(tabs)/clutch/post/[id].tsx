import { useClutch } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import type { ApiError, Clip, Comment } from '@atlitos/types';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  EllipsisVertical,
  Flag,
  Heart,
  MessageCircle,
  Share2,
  Trash2,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  Share,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClipVideo } from '@/components/molecules/clip-video';
import { ClipActionsSheet } from '@/components/organisms/clutch/ClipActionsSheet';
import { ClutchCommentsSheet } from '@/components/organisms/clutch/ClutchCommentsSheet';
import { ConfirmSheet } from '@/components/organisms/ConfirmSheet';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { ModerationSheet, type ModerationTarget } from '@/components/organisms/moderation/ModerationSheet';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { usePendingAuthAction } from '@/hooks/use-pending-auth-action';
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
 *
 * B1. Owner controls. A creator who opens their OWN clip here (from their own
 * grid, from search, from the feed, or from a notification deep link) gets the
 * same `ClipActionsSheet` (comments toggle, delete) that `clutch/profile.tsx`'s
 * own grid offers (C1/C2), reached from the same rail slot the report/block
 * flag uses for everyone else's clips, since a caller can never report their
 * own. Deleting the clip currently on screen removes it from this pager's
 * `clips` list; if that was the only clip left, the viewer goes back rather
 * than being stranded on an empty pager.
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
  // A failed thread load must never render as an empty thread. See
  // ClutchCommentsSheet's loadError prop.
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentCursor, setCommentCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [moderationTarget, setModerationTarget] = useState<ModerationTarget | null>(null);

  // C3. The comment the viewer has asked to delete, held until they confirm.
  // Own comments only; the sheet only offers the affordance on rows the
  // viewer wrote, and the delete is own-row scoped again in the API and once
  // more in the clip_comments_delete_own policy.
  const [pendingCommentDelete, setPendingCommentDelete] = useState<Comment | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  // B1. Owner clip controls: which clip the ellipsis menu targets, and the
  // pending-delete confirm for that same clip.
  const [ownerMenuClip, setOwnerMenuClip] = useState<Clip | null>(null);
  const [pendingDeleteClip, setPendingDeleteClip] = useState<Clip | null>(null);
  const [ownerBusy, setOwnerBusy] = useState(false);
  // B2. Inline failure surface for the two owner actions: a FORBIDDEN or a
  // network failure used to be silently swallowed with no on screen message.
  const [ownerActionError, setOwnerActionError] = useState<string | null>(null);

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

  // F8 (P5 fix pass, PRD-01 FR-4): same class of bug as the main Clutch feed
  // (apps/mobile/src/app/(tabs)/clutch/index.tsx) - `requireAuth` used to
  // drop the gated action outright once the gate opened. See the hook's
  // docblock. Like, Save, opening the moderation sheet, and commenting are
  // all cheap, idempotent, non-money actions, safe to replay.
  const { requireAuth, clearPendingAction } = usePendingAuthAction(requiresAuthGate);

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
    }, () => setGateVisible(true));
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
    }, () => setGateVisible(true));
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
  // than opening a sheet with no useful action in it). The rail shows the
  // owner's ClipActionsSheet in this same slot instead, see openOwnerMenu.
  function openClipModeration(clip: Clip) {
    if (!myId || clip.ownerId === myId) return;
    requireAuth(() => {
      setModerationTarget({ type: 'clip', entityId: clip.id, userId: clip.ownerId, userName: clip.channel });
    }, () => setGateVisible(true));
  }

  // CT-C: report/block a comment's author, from a long-press on the row.
  // Never for the caller's own comment.
  function openCommentModeration(comment: Comment) {
    if (!myId || comment.userId === myId) return;
    requireAuth(() => {
      setModerationTarget({ type: 'comment', entityId: comment.id, userId: comment.userId, userName: comment.username });
    }, () => setGateVisible(true));
  }

  // B1. Owner clip options: comments toggle + delete, same ClipActionsSheet
  // clutch/profile.tsx's own grid uses (C1/C2).
  function openOwnerMenu(clip: Clip) {
    setOwnerActionError(null);
    setOwnerMenuClip(clip);
  }

  async function handleToggleComments() {
    if (!ownerMenuClip) return;
    const target = ownerMenuClip;
    const next = target.commentsEnabled === false;
    setOwnerBusy(true);
    setOwnerActionError(null);
    try {
      const enabled = await clutch.setCommentsEnabled(target.id, next);
      setClips((prev) => prev.map((c) => (c.id === target.id ? { ...c, commentsEnabled: enabled } : c)));
      setOwnerMenuClip((c) => (c && c.id === target.id ? { ...c, commentsEnabled: enabled } : c));
      setCommentsClip((c) => (c && c.id === target.id ? { ...c, commentsEnabled: enabled } : c));
      setOwnerMenuClip(null);
    } catch (err) {
      setOwnerActionError((err as ApiError).message || 'Could not update comments for this clip. Try again.');
    } finally {
      setOwnerBusy(false);
    }
  }

  async function handleConfirmDeleteClip() {
    if (!pendingDeleteClip) return;
    const target = pendingDeleteClip;
    setOwnerBusy(true);
    setOwnerActionError(null);
    try {
      await clutch.deleteMyClip(target.id);
      setPendingDeleteClip(null);
      setClips((prev) => {
        const next = prev.filter((c) => c.id !== target.id);
        // A pager left with nothing to swipe to cannot stay on screen; go
        // back rather than render an empty viewer.
        if (next.length === 0) router.back();
        return next;
      });
      if (commentsClip?.id === target.id) setCommentsClip(null);
      if (activeIdRef.current === target.id) {
        activeIdRef.current = null;
        setActiveId(null);
      }
    } catch (err) {
      setOwnerActionError((err as ApiError).message || 'Could not delete this clip. Try again.');
    } finally {
      setOwnerBusy(false);
    }
  }

  async function openComments(clip: Clip) {
    setCommentsClip(clip);
    setComments([]);
    setCommentCursor(null);
    setCommentsError(null);
    try {
      const page = await clutch.getComments(clip.id);
      setComments(page.comments);
      setCommentCursor(page.nextCursor);
    } catch (err) {
      // Do NOT swallow this. An empty catch here renders a clip with a full
      // thread as "No comments yet", which is a false statement to the user
      // and hides the real failure from anyone debugging it.
      setCommentsError((err as ApiError).message || 'Comments could not load. Pull to retry.');
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

  /** C3. Deletes the viewer's OWN comment. The optimistic drop and the header
   * decrement are applied together, because the `clip_comments_count_delete`
   * trigger decrements `clips.comment_count` server side in the same
   * transaction; leaving the header alone would show a count one higher than
   * the server's until the next load. On failure both are rolled back by
   * reloading the thread. */
  async function handleConfirmCommentDelete() {
    const target = pendingCommentDelete;
    if (!target) return;
    setDeletingCommentId(target.id);
    try {
      await clutch.deleteComment(target.id);
      setComments((prev) => prev.filter((c) => c.id !== target.id));
      setClips((prev) =>
        prev.map((c) => (c.id === target.clipId ? { ...c, commentCount: Math.max(0, c.commentCount - 1) } : c)),
      );
      setCommentsClip((c) =>
        c && c.id === target.clipId ? { ...c, commentCount: Math.max(0, c.commentCount - 1) } : c,
      );
      setPendingCommentDelete(null);
    } catch {
      // Leave the comment in place and let the next load reconcile.
      setPendingCommentDelete(null);
    } finally {
      setDeletingCommentId(null);
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
          // F1 (P5 fix pass): same bounded-window rule as the main Clutch
          // feed (apps/mobile/src/app/(tabs)/clutch/index.tsx) - this is the
          // IG-Reels-style single-clip viewer's own vertical pager, and it
          // has the identical unbounded-mount shape (a FlatList of full-bleed
          // video pages with no virtualization props).
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <View style={{ height: containerH }}>
              <ClipPage
                clip={item}
                active={item.id === activeId}
                // F1: only the active card and its minted neighbors hold a
                // real ClipVideo player; see ClutchPostCard's mountPlayer.
                mountPlayer={
                  item.id === activeId ||
                  playbackUrls[item.id] !== undefined ||
                  (activeId === null && index === initialIndex)
                }
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
                onOwnerMenu={item.ownerId === myId ? () => openOwnerMenu(item) : undefined}
              />
            </View>
          )}
        />
      ) : null}

      {/* Comments sheet for the tapped clip. Extracted to ClutchCommentsSheet,
          which owns the Portal + pixel cap + flexShrink layout that makes it
          open correctly at any thread length; see that file's docblock for
          the defects it fixes and the header/list count reconciliation. */}
      <ClutchCommentsSheet
        visible={commentsClip !== null}
        comments={comments}
        // Once the thread has fully loaded (no more pages), the list IS the
        // exact set the viewer can see, blocked authors already subtracted
        // by getComments; showing its length instead of the raw server total
        // is what keeps the header from disagreeing with the rows under it.
        // See ClutchCommentsSheet's docblock.
        commentCount={commentCursor === null ? comments.length : (commentsClip?.commentCount ?? 0)}
        currentUserId={myId}
        commentsEnabled={commentsClip?.commentsEnabled !== false}
        loadError={commentsError}
        requiresAuthGate={requiresAuthGate}
        draft={draft}
        sending={sending}
        deletingId={deletingCommentId}
        onDraftChange={setDraft}
        onSend={() => void handleSend()}
        onDeleteComment={setPendingCommentDelete}
        onReportComment={openCommentModeration}
        onEndReached={() => void loadMoreComments()}
        onRequestSignIn={() => setGateVisible(true)}
        onClose={() => setCommentsClip(null)}
      />

      <ConfirmSheet
        visible={pendingCommentDelete != null}
        icon={Trash2}
        destructive
        loading={deletingCommentId != null}
        title="Delete this comment"
        body="It will be removed for everyone. This cannot be undone."
        confirmLabel="Delete comment"
        onConfirm={() => void handleConfirmCommentDelete()}
        onCancel={() => setPendingCommentDelete(null)}
      />

      {/* B1. Owner controls, reachable from this screen directly, not only
          from the own grid (clutch/profile.tsx). */}
      <ClipActionsSheet
        visible={ownerMenuClip != null}
        commentsEnabled={ownerMenuClip?.commentsEnabled !== false}
        busy={ownerBusy}
        errorMessage={ownerActionError}
        onToggleComments={() => void handleToggleComments()}
        onDelete={() => {
          setOwnerActionError(null);
          setPendingDeleteClip(ownerMenuClip);
          setOwnerMenuClip(null);
        }}
        onClose={() => {
          setOwnerActionError(null);
          setOwnerMenuClip(null);
        }}
      />

      <ConfirmSheet
        visible={pendingDeleteClip != null}
        icon={Trash2}
        destructive
        loading={ownerBusy}
        title="Delete this clip"
        body="It comes off your profile and out of the feed. This cannot be undone."
        confirmLabel="Delete clip"
        errorMessage={ownerActionError}
        onConfirm={() => void handleConfirmDeleteClip()}
        onCancel={() => {
          setOwnerActionError(null);
          setPendingDeleteClip(null);
        }}
      />

      <LoginGateModal
        visible={gateVisible}
        onClose={() => setGateVisible(false)}
        onDismiss={clearPendingAction}
      />

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
  /** F1 (P5 fix pass): see ClutchPostCard's `mountPlayer`. Only true for the
   * active page and its minted neighbors; every other virtualized page shows
   * its poster only, never allocating a native video player. */
  mountPlayer: boolean;
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
  /** CT-C: report/block the clip's owner. Omitted for the caller's own clip;
   * `onOwnerMenu` takes this rail slot instead for that case. */
  onReport?: () => void;
  /** B1. Opens ClipActionsSheet (comments toggle, delete) for this clip.
   * Present only when the caller owns the clip, mutually exclusive with
   * `onReport`. */
  onOwnerMenu?: () => void;
}

/**
 * One full-bleed page of the viewer: the 9:16 video behind the Instagram Reels
 * chrome (FB-004) preserved from the single-clip viewer. Header (back, avatar,
 * sport line), right rail (like, comment, share, save, report/block or owner
 * options), caption, and mute.
 */
function ClipPage({
  clip,
  active,
  mountPlayer,
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
  onOwnerMenu,
}: ClipPageProps) {
  const colors = useThemeColors();

  return (
    <View style={{ flex: 1, backgroundColor: colors.text }}>
      {/* F1: only the near-visible window mounts a real player; every other
          virtualized page renders its poster only. */}
      {mountPlayer ? (
        <ClipVideo url={playbackUrl} thumbUrl={posterUrl ?? clip.thumbUrl} active={active} muted={muted} />
      ) : posterUrl ?? clip.thumbUrl ? (
        <Image
          source={{ uri: posterUrl ?? clip.thumbUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : null}

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
          <Avatar uri={clip.channelAvatarUrl ?? undefined} name={clip.channel} size={40} />
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

      {/* Right action rail: like, comment, share, save, report/block or
          owner options. */}
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
          ) : onOwnerMenu ? (
            <Pressable
              onPress={onOwnerMenu}
              accessibilityRole="button"
              accessibilityLabel="Clip options"
              className="min-h-11 min-w-11 items-center justify-center gap-xs"
            >
              <EllipsisVertical size={26} strokeWidth={1.75} color={colors.textInverse} />
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
