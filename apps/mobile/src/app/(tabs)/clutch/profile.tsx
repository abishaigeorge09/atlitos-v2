import { useClutch, type CreatorProfile } from '@atlitos/api';
import type { ApiError, Clip } from '@atlitos/types';
import { router } from 'expo-router';
import { LogIn } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClutchProfileView } from '@/components/organisms/ClutchProfileView';
import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * The athlete's own Clutch profile (PRD-01 3.4). Same header + grid as the
 * public creator view, but shows the athlete's clips in ANY status (a pending
 * or rejected clip carries a StatusPill), offers the upload CTA, and never a
 * follow button. Guests have no own profile, so this gates to sign in.
 */
export default function ClutchOwnProfileScreen() {
  const colors = useThemeColors();
  const clutch = useClutch(supabase);
  const status = useSessionStore((state) => state.status);
  const myId = useSessionStore((state) => state.me?.id ?? null);
  const isGuest = status === 'guest';

  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!myId) return;
    setState('loading');
    setError(null);
    try {
      const [creator, myClips] = await Promise.all([clutch.getCreator(myId), clutch.getMyClips()]);
      setProfile(creator);
      setClips(myClips);
      setState(creator ? 'ready' : 'error');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [clutch, myId]);

  useEffect(() => {
    if (myId) void load();
  }, [load, myId]);

  if (isGuest || !myId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="My clips" onPressBack={() => router.back()} />
        <View className="flex-1 items-center justify-center">
          <EmptyState
            icon={LogIn}
            title="Sign in to see your clips"
            body="Create an account to post highlights and build your channel."
            ctaLabel="Sign in"
            onCtaPress={() => router.push('/(auth)/login')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="My clips" onPressBack={() => router.back()} />
      <ClutchProfileView
        profile={profile}
        clips={clips}
        state={state}
        errorMessage={error?.message}
        isOwn
        onRetry={() => void load()}
        onUpload={() => router.push('/(tabs)/clutch/upload')}
        onOpenClip={(clipId) => router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: clipId } })}
      />
    </SafeAreaView>
  );
}
