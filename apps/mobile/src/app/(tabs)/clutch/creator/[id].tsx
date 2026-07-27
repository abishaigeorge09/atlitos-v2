import { useClutch, type CreatorProfile } from '@atlitos/api';
import type { ApiError, Clip } from '@atlitos/types';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClutchProfileView } from '@/components/organisms/ClutchProfileView';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Public creator profile (PRD-01 3.4 FR-46): header stats + published clip
 * grid + Follow. Follow routes through the `toggle_follow` RPC; a guest tap
 * gates to login (FR-3). Reads a creator's clips filtered to `published` in
 * the data lane (never their pending clips).
 */
export default function ClutchCreatorScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clutch = useClutch(supabase);
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const myId = useSessionStore((state) => state.me?.id ?? null);

  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const [creator, creatorClips] = await Promise.all([clutch.getCreator(id), clutch.getCreatorClips(id)]);
      setProfile(creator);
      setClips(creatorClips);
      setState(creator ? 'ready' : 'error');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [clutch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFollow() {
    if (!profile) return;
    if (requiresAuthGate) {
      setGateVisible(true);
      return;
    }
    setFollowBusy(true);
    const prev = profile;
    setProfile({
      ...profile,
      followedByMe: !profile.followedByMe,
      followerCount: profile.followerCount + (profile.followedByMe ? -1 : 1),
    });
    try {
      const result = await clutch.toggleFollow(profile.id);
      setProfile((p) =>
        p ? { ...p, followedByMe: result.following, followerCount: result.followerCount } : p,
      );
    } catch {
      setProfile(prev);
    } finally {
      setFollowBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title={profile?.channel ?? 'Creator'} onPressBack={() => router.back()} />
      <ClutchProfileView
        profile={profile}
        clips={clips}
        state={state}
        errorMessage={error?.message}
        isOwn={myId != null && myId === id}
        followBusy={followBusy}
        onRetry={() => void load()}
        onToggleFollow={() => void toggleFollow()}
        onOpenClip={(clipId) => router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: clipId } })}
      />
      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
