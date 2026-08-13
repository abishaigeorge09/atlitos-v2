import { useClutch } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { ApiError, Clip } from '@atlitos/types';
import { router } from 'expo-router';
import { Play, Plus, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClutchPostCard } from '@/components/molecules/ClutchPostCard';
import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { usePendingAuthAction } from '@/hooks/use-pending-auth-action';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/** Refresh a signed playback URL this many seconds before its 300s TTL so an
 * on-screen clip never stalls on an expired URL mid-watch. */
const PLAYBACK_REFRESH_LEAD_S = 15;

/** SCALE-MEDIA M-1. Bounded retry for a failed playback mint. Four attempts
 * from a 2s base doubles to 2, 4, 8, 16 seconds, capped at 30, each with up to
 * 50 percent added jitter so devices sharing one throttle key do not retry in
 * lockstep and re-exhaust the window together. A RATE_LIMITED refusal waits
 * out the server's own `retry_after_seconds` instead of the base. */
const MINT_MAX_ATTEMPTS = 4;
const MINT_RETRY_BASE_MS = 2000;
const MINT_RETRY_MAX_MS = 30000;
const MINT_RETRY_JITTER = 0.5;

/** Deep link into a single clip in the viewer. `atlitos://` is the app scheme
 * (app.json); the share sheet carries it so a tap reopens the exact clip. */
function clipDeepLink(clipId: string): string {
  return `atlitos://clutch/post/${clipId}`;
}

/**
 * Clutch feed (PRD-01 3.4, FR-42/FR-43). Full-bleed vertical video feed, one
 * clip per viewport, paging snap. Guest browsing is read-only (FR-2); like,
 * comment, and upload gate to login (FR-3).
 *
 * SIGNED-URL PLAYBACK: every card plays a SHORT-LIVED signed MP4 URL minted
 * per visible clip from `get-clip-playback-url` (never stored on the row,
 * never a raw private-bucket path). The URL is minted when a clip becomes the
 * active card (and prefetched for the next one), then refreshed on a timer
 * just before its 300s TTL while it is still on screen. Offscreen URLs are
 * dropped so nothing hangs onto a stale one.
 */
export default function ClutchFeedScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const clutch = useClutch(supabase);
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');

  const [state, setState] = useState<LoadState>('loading');
  const [clips, setClips] = useState<Clip[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);

  const [containerH, setContainerH] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playbackUrls, setPlaybackUrls] = useState<Record<string, string>>({});
  // Signed poster URL per card. thumb_path is a raw private-bucket path (blank
  // as an <Image> source), so the poster the card shows is the SIGNED thumb URL
  // get-clip-playback-url mints alongside the video, never clip.thumbUrl.
  const [posterUrls, setPosterUrls] = useState<Record<string, string>>({});
  // Cards whose playback mint is currently failing (M-1). Drives the card's
  // visible, non-blocking "could not load" state instead of a black rectangle.
  const [mintFailed, setMintFailed] = useState<Record<string, true>>({});

  const activeIdRef = useRef<string | null>(null);
  const refreshTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Consecutive failed mint attempts per clip, so the backoff is bounded and a
  // card that keeps failing stops asking rather than retrying forever.
  const mintAttempts = useRef<Record<string, number>>({});

  const clearTimer = useCallback((id: string) => {
    const timer = refreshTimers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete refreshTimers.current[id];
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
        // A success clears the card's failure state and its attempt count, so
        // a card that recovers is not still counting toward the retry cap.
        mintAttempts.current[clipId] = 0;
        setMintFailed((prev) => {
          if (!prev[clipId]) return prev;
          const next = { ...prev };
          delete next[clipId];
          return next;
        });
        clearTimer(clipId);
        const refreshMs = Math.max(PLAYBACK_REFRESH_LEAD_S, playback.expiresIn - PLAYBACK_REFRESH_LEAD_S) * 1000;
        refreshTimers.current[clipId] = setTimeout(() => {
          // Only keep refreshing while this clip is still the active card.
          if (activeIdRef.current === clipId) void mintPlayback(clipId);
          else clearTimer(clipId);
        }, refreshMs);
      } catch (err) {
        // SCALE-MEDIA M-1. This catch used to be empty, with a comment saying
        // the poster stayed in place. It does not: the SAME call mints the
        // poster, so a failure leaves no video URL AND no poster URL, and the
        // card renders as a bare black rectangle. Worse, the refresh timer was
        // armed only inside the try after a success, so a card that failed
        // once never retried while it was on screen. The feed silently stopped
        // working and looked exactly like a broken app.
        //
        // Now: a bounded retry with exponential backoff and jitter, and a
        // visible non-blocking state on the card once the retries are spent.
        // Jitter matters specifically because the throttle is shared: without
        // it, every device behind one carrier NAT that got a 429 in the same
        // second would retry in the same second and re-exhaust the window.
        const apiError = err as ApiError;
        const attempt = (mintAttempts.current[clipId] ?? 0) + 1;
        mintAttempts.current[clipId] = attempt;

        if (attempt > MINT_MAX_ATTEMPTS) {
          setMintFailed((prev) => ({ ...prev, [clipId]: true }));
          clearTimer(clipId);
          return;
        }

        // A throttle refusal waits out the window the server named rather than
        // hammering it further; anything else backs off from a short base.
        const baseMs =
          apiError?.code === 'RATE_LIMITED'
            ? Math.max(MINT_RETRY_BASE_MS, (apiError.retryAfterSeconds ?? 60) * 1000)
            : MINT_RETRY_BASE_MS;
        const backoffMs = Math.min(MINT_RETRY_MAX_MS, baseMs * 2 ** (attempt - 1));
        const jitterMs = Math.random() * backoffMs * MINT_RETRY_JITTER;

        // Shown while the retry is pending too, so the card says something
        // rather than sitting black in silence.
        setMintFailed((prev) => ({ ...prev, [clipId]: true }));
        clearTimer(clipId);
        refreshTimers.current[clipId] = setTimeout(() => {
          if (activeIdRef.current === clipId) void mintPlayback(clipId);
          else clearTimer(clipId);
        }, backoffMs + jitterMs);
      }
    },
    [clutch, clearTimer],
  );

  /** Manual retry from the card's own affordance: resets the attempt budget so
   * a user who waited out a throttle gets a full set of tries again. */
  const retryMint = useCallback(
    (clipId: string) => {
      mintAttempts.current[clipId] = 0;
      setMintFailed((prev) => {
        const next = { ...prev };
        delete next[clipId];
        return next;
      });
      void mintPlayback(clipId);
    },
    [mintPlayback],
  );

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const page = await clutch.getFeed();
      setClips(page.clips);
      setCursor(page.nextCursor);
      setState(page.clips.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [clutch]);

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
      setClips((prev) => [...prev, ...page.clips]);
      setCursor(page.nextCursor);
    } catch {
      // A failed page-append leaves the existing feed intact; the next scroll
      // retries. Not surfaced as a full-screen error.
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

  // Mint a fresh signed URL for the active card, and prefetch the next one, so
  // a swipe reveals a card that is already playing.
  useEffect(() => {
    if (!activeId) return;
    if (!playbackUrls[activeId]) void mintPlayback(activeId);

    const index = clips.findIndex((clip) => clip.id === activeId);
    const next = clips[index + 1];
    if (next && !playbackUrls[next.id]) void mintPlayback(next.id);

    // Drop URLs and timers for clips that are no longer near the active card,
    // so nothing holds a stale short-lived URL.
    const keep = new Set([activeId, clips[index + 1]?.id, clips[index - 1]?.id].filter(Boolean) as string[]);
    setPlaybackUrls((prev) => {
      let changed = false;
      const nextUrls: Record<string, string> = {};
      for (const [id, url] of Object.entries(prev)) {
        if (keep.has(id)) nextUrls[id] = url;
        else {
          changed = true;
          clearTimer(id);
        }
      }
      return changed ? nextUrls : prev;
    });
    setPosterUrls((prev) => {
      let changed = false;
      const nextUrls: Record<string, string> = {};
      for (const [id, url] of Object.entries(prev)) {
        if (keep.has(id)) nextUrls[id] = url;
        else changed = true;
      }
      return changed ? nextUrls : prev;
    });
    // M-1: a scrolled-away card drops its failure state and its attempt count
    // too, so returning to it starts clean rather than showing a stale error
    // or arriving with the retry budget already spent.
    setMintFailed((prev) => {
      let changed = false;
      const next: Record<string, true> = {};
      for (const id of Object.keys(prev)) {
        if (keep.has(id)) next[id] = true;
        else {
          changed = true;
          mintAttempts.current[id] = 0;
        }
      }
      return changed ? next : prev;
    });
  }, [activeId, clips, playbackUrls, mintPlayback, clearTimer]);

  // F8 (P5 fix pass, PRD-01 FR-4): `requireAuth` used to gate an action by
  // opening LoginGateModal and dropping the closure outright: a guest tapped
  // Like, the gate opened, they logged in, and the like never applied.
  // `usePendingAuthAction` queues and replays it instead; see its own
  // docblock. Like, Save, and the upload-tab navigation are the only gated
  // actions in this file, all cheap and idempotent to replay, never a charge
  // or a state-machine transition.
  const { requireAuth, clearPendingAction } = usePendingAuthAction(requiresAuthGate);

  function closeGate() {
    setGateVisible(false);
  }

  async function handleLike(clip: Clip) {
    requireAuth(async () => {
      // Optimistic flip; reconcile with the RPC's authoritative count.
      setClips((prev) =>
        prev.map((c) =>
          c.id === clip.id ? { ...c, likedByMe: !c.likedByMe, likes: c.likes + (c.likedByMe ? -1 : 1) } : c,
        ),
      );
      try {
        const result = await clutch.toggleLike(clip.id);
        setClips((prev) =>
          prev.map((c) => (c.id === clip.id ? { ...c, likedByMe: result.liked, likes: result.likesCount } : c)),
        );
      } catch {
        // Roll back on failure.
        setClips((prev) =>
          prev.map((c) =>
            c.id === clip.id ? { ...c, likedByMe: clip.likedByMe, likes: clip.likes } : c,
          ),
        );
      }
    }, () => setGateVisible(true));
  }

  async function handleSave(clip: Clip) {
    requireAuth(async () => {
      // Optimistic flip of the bookmark; reconcile with the toggle's result.
      setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, savedByMe: !c.savedByMe } : c)));
      try {
        const saved = await clutch.toggleSaveClip(clip.id);
        setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, savedByMe: saved } : c)));
      } catch {
        // Roll back on failure.
        setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, savedByMe: clip.savedByMe } : c)));
      }
    }, () => setGateVisible(true));
  }

  async function handleShare(clip: Clip) {
    const label = clip.caption ? clip.caption : `Clip by ${clip.channel}`;
    try {
      await Share.share({ message: label, url: clipDeepLink(clip.id) });
    } catch {
      // A dismissed or failed share sheet is a no-op.
    }
  }

  function openDetail(clipId: string) {
    router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: clipId } });
  }

  return (
    <View
      className="flex-1 bg-text"
      onLayout={(event) => setContainerH(event.nativeEvent.layout.height)}
    >
      {state === 'loading' ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textInverse} />
        </View>
      ) : state === 'error' ? (
        <View className="flex-1 items-center justify-center gap-md p-lg">
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.textInverse, textAlign: 'center' }]}>
            Couldn't load Clutch
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textInverse, textAlign: 'center', opacity: 0.8 }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : state === 'empty' ? (
        <View className="flex-1 items-center justify-center">
          <EmptyState
            icon={Play}
            title="No clips yet"
            body="Match and training highlights show up here. Be the first to post one."
            ctaLabel="Upload a clip"
            onCtaPress={() => requireAuth(() => router.push('/(tabs)/clutch/upload'), () => setGateVisible(true))}
          />
        </View>
      ) : containerH > 0 ? (
        <FlatList
          data={clips}
          keyExtractor={(item) => item.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: containerH, offset: containerH * index, index })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReachedThreshold={0.5}
          onEndReached={() => void loadMore()}
          // F1 (P5 fix pass): bound how much of the feed React Native keeps
          // mounted at all. The RN default windowSize (21 "screens") plus a
          // feed where every card is a real video player is what produced
          // ~10 to 21 concurrent native players (Android OOM'd first because
          // Media3 allocates a heavier per-item MediaSession than AVPlayer,
          // but the same unbounded-mount shape is wrong on iOS too). 5
          // screens (roughly 2 above/below the active one) plus a small batch
          // size keeps the feed responsive on fling without holding the
          // world in memory. removeClippedSubviews frees the native views
          // for cards scrolled well out of range.
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <View style={{ height: containerH }}>
              <ClutchPostCard
                clip={item}
                variant="feed"
                active={item.id === activeId}
                // F1: only the active card and its minted neighbors (the
                // same "keep" window the playback-URL effect above already
                // computes) get a real ClipVideo/useVideoPlayer instance.
                // Every other rendered-but-offscreen card shows its poster
                // image only, so it never allocates a native decoder.
                mountPlayer={
                  item.id === activeId ||
                  playbackUrls[item.id] !== undefined ||
                  (activeId === null && index === 0)
                }
                playbackUrl={playbackUrls[item.id]}
                posterUrl={posterUrls[item.id]}
                // M-1: a failed mint now says so on the card and offers a
                // retry, instead of leaving a black rectangle with no poster,
                // no error and no way forward.
                playbackFailed={mintFailed[item.id] === true}
                onRetryPlayback={() => retryMint(item.id)}
                onOpen={() => openDetail(item.id)}
                onComment={() => openDetail(item.id)}
                onLike={() => void handleLike(item)}
                onSave={() => void handleSave(item)}
                onShare={() => void handleShare(item)}
              />
            </View>
          )}
        />
      ) : null}

      {/* Floating header: wordmark + upload. Sits above the feed, safe-area
          aware. Not part of the card, so it never nests inside a card tap. */}
      <View
        style={{ pointerEvents: 'box-none', position: 'absolute', top: insets.top, left: 0, right: 0, paddingHorizontal: spacing.lg }}
        className="flex-row items-center justify-between"
      >
        <Text style={[textStyle('h2'), { color: colors.textInverse }]}>Clutch</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Upload a clip"
          onPress={() => requireAuth(() => router.push('/(tabs)/clutch/upload'), () => setGateVisible(true))}
          className="min-h-11 min-w-11 flex-row items-center justify-center gap-xs rounded-pill bg-accent px-md"
        >
          <Plus size={20} strokeWidth={2} color={colors.inkOnAccent} />
          <Text style={{ color: colors.inkOnAccent }} className="font-sans-semibold text-sm">
            Post
          </Text>
        </Pressable>
      </View>

      <LoginGateModal visible={gateVisible} onClose={closeGate} onDismiss={clearPendingAction} />
    </View>
  );
}
