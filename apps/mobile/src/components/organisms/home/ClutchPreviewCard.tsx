import { useClutch } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { Clip } from '@atlitos/types';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ClutchPostCard } from '@/components/molecules/ClutchPostCard';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home's Clutch preview (PRD-01 3.2): the single most recent published clip
 * from `useClutch().getFeed()`, boxed to a 4:5 card rather than the full
 * bleed feed layout Clutch itself uses. Mints its signed playback and poster
 * URL the same way the Clutch tab does (`(tabs)/clutch/index.tsx`
 * `mintPlayback`), since `ClutchPostCard`'s `feed` variant never renders a
 * bare storage path. Hides entirely on an empty feed or a failed read, this
 * is a teaser, never a Home level error state.
 */
export function ClutchPreviewCard({ reloadKey }: { reloadKey: number }) {
  const colors = useThemeColors();
  const clutch = useClutch(supabase);
  const isGuest = useSessionStore((state) => state.status === 'guest');

  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [clip, setClip] = useState<Clip | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | undefined>(undefined);
  const [posterUrl, setPosterUrl] = useState<string | undefined>(undefined);
  const [gateVisible, setGateVisible] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const page = await clutch.getFeed();
      const first = page.clips[0] ?? null;
      setClip(first);
      if (first) {
        try {
          const playback = await clutch.getPlaybackUrl(first.id);
          setPlaybackUrl(playback.url);
          setPosterUrl(playback.thumbUrl ?? undefined);
        } catch {
          // Card still renders with whatever poster the clip row carries.
        }
      }
    } catch {
      setClip(null);
    } finally {
      setState('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  function requireAuth(action: () => void) {
    if (isGuest) {
      setGateVisible(true);
      return;
    }
    action();
  }

  async function handleLike() {
    if (!clip) return;
    requireAuth(async () => {
      setClip((prev) =>
        prev ? { ...prev, likedByMe: !prev.likedByMe, likes: prev.likes + (prev.likedByMe ? -1 : 1) } : prev,
      );
      try {
        const result = await clutch.toggleLike(clip.id);
        setClip((prev) => (prev ? { ...prev, likedByMe: result.liked, likes: result.likesCount } : prev));
      } catch {
        setClip((prev) => (prev ? { ...prev, likedByMe: clip.likedByMe, likes: clip.likes } : prev));
      }
    });
  }

  function openClutch() {
    router.push('/(tabs)/clutch');
  }

  function openDetail() {
    if (!clip) return;
    router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: clip.id } });
  }

  if (state === 'loading') {
    return <Skeleton shape="card" height={280} />;
  }

  if (!clip) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <View
        className="overflow-hidden rounded-xl bg-text"
        style={{ aspectRatio: 4 / 5, width: '100%' }}
      >
        <ClutchPostCard
          clip={clip}
          variant="feed"
          active={false}
          playbackUrl={playbackUrl}
          posterUrl={posterUrl}
          onOpen={openDetail}
          onComment={openDetail}
          onLike={() => void handleLike()}
          onShare={() => requireAuth(openDetail)}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Clutch"
        onPress={openClutch}
        className="flex-row items-center justify-between"
      >
        <Text style={[textStyle('label'), { color: colors.text }]}>Open Clutch</Text>
        <ChevronRight size={16} color={colors.accent} strokeWidth={1.75} />
      </Pressable>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </View>
  );
}
