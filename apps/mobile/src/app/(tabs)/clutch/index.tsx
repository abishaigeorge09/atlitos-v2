import { useClutch } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { ApiError, Clip } from '@atlitos/types';
import { router } from 'expo-router';
import { Play, Plus, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClutchPostCard } from '@/components/molecules/ClutchPostCard';
import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/** Refresh a signed playback URL this many seconds before its 300s TTL so an
 * on-screen clip never stalls on an expired URL mid-watch. */
const PLAYBACK_REFRESH_LEAD_S = 15;

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

  const activeIdRef = useRef<string | null>(null);
  const refreshTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
        clearTimer(clipId);
        const refreshMs = Math.max(PLAYBACK_REFRESH_LEAD_S, playback.expiresIn - PLAYBACK_REFRESH_LEAD_S) * 1000;
        refreshTimers.current[clipId] = setTimeout(() => {
          // Only keep refreshing while this clip is still the active card.
          if (activeIdRef.current === clipId) void mintPlayback(clipId);
          else clearTimer(clipId);
        }, refreshMs);
      } catch {
        // Leave the poster in place; a card without a playback URL still
        // renders its thumbnail. Expected for placeholder fixture bytes.
      }
    },
    [clutch, clearTimer],
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
  }, [activeId, clips, playbackUrls, mintPlayback, clearTimer]);

  function requireAuth(action: () => void) {
    if (requiresAuthGate) {
      setGateVisible(true);
      return;
    }
    action();
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
    });
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
            onCtaPress={() => requireAuth(() => router.push('/(tabs)/clutch/upload'))}
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
          renderItem={({ item }) => (
            <View style={{ height: containerH }}>
              <ClutchPostCard
                clip={item}
                variant="feed"
                active={item.id === activeId}
                playbackUrl={playbackUrls[item.id]}
                posterUrl={posterUrls[item.id]}
                onOpen={() => openDetail(item.id)}
                onComment={() => openDetail(item.id)}
                onLike={() => void handleLike(item)}
                onShare={() => requireAuth(() => openDetail(item.id))}
              />
            </View>
          )}
        />
      ) : null}

      {/* Floating header: wordmark + upload. Sits above the feed, safe-area
          aware. Not part of the card, so it never nests inside a card tap. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: insets.top, left: 0, right: 0, paddingHorizontal: spacing.lg }}
        className="flex-row items-center justify-between"
      >
        <Text style={[textStyle('h2'), { color: colors.textInverse }]}>Clutch</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Upload a clip"
          onPress={() => requireAuth(() => router.push('/(tabs)/clutch/upload'))}
          className="min-h-11 min-w-11 flex-row items-center justify-center gap-xs rounded-pill bg-accent px-md"
        >
          <Plus size={20} strokeWidth={2} color={colors.inkOnAccent} />
          <Text style={{ color: colors.inkOnAccent }} className="font-sans-semibold text-sm">
            Post
          </Text>
        </Pressable>
      </View>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </View>
  );
}
