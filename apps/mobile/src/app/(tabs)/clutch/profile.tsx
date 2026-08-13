import { useClutch, type CreatorProfile } from '@atlitos/api';
import type { ApiError, Clip } from '@atlitos/types';
import { router } from 'expo-router';
import { LogIn, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClipActionsSheet } from '@/components/organisms/clutch/ClipActionsSheet';
import { ClutchProfileView } from '@/components/organisms/ClutchProfileView';
import { ConfirmSheet } from '@/components/organisms/ConfirmSheet';
import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { useClipPosters } from '@/hooks/use-clip-posters';
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
  // The clip whose owner menu is open, then the same clip held through the
  // delete confirm. Destroying a clip is confirmed before anything happens.
  const [menuClip, setMenuClip] = useState<Clip | null>(null);
  const [confirmDeleteClip, setConfirmDeleteClip] = useState<Clip | null>(null);
  const [busy, setBusy] = useState(false);
  // B2. A failed delete or comments toggle used to vanish into `error`, which
  // `ClutchProfileView` only renders when the WHOLE screen is in its error
  // state, a state this per action failure never set. With 0100/0101 still
  // unapplied, and even after they ship, a FORBIDDEN or a network failure
  // showed nothing at all: the button just looked dead. This is shown inline
  // on whichever sheet the action was attempted from, and is separate from
  // `error`, which stays reserved for the initial load failing.
  const [actionError, setActionError] = useState<string | null>(null);
  // M-4: this grid passed no poster at all, so every tile rendered blank.
  const { posterUrls } = useClipPosters(clips);

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

  /** C1. Soft deletes the athlete's own clip through `delete_my_clip` (0100).
   * The clip is dropped from the grid locally rather than reloading, so the
   * result is immediate; `getMyClips` filters `deleted_at is null` on the next
   * load, so the two agree.
   *
   * Nothing here writes `clips.status`: the client has no UPDATE grant on
   * clips at all (0042), which is exactly why this needed an RPC. */
  async function handleConfirmDeleteClip() {
    const target = confirmDeleteClip;
    if (!target) return;
    setBusy(true);
    setActionError(null);
    try {
      await clutch.deleteMyClip(target.id);
      setClips((prev) => prev.filter((c) => c.id !== target.id));
      setConfirmDeleteClip(null);
    } catch (err) {
      // B2. Stay on the confirm sheet with the reason shown, rather than
      // closing it. A dismissed sheet with no message is indistinguishable
      // from a delete that quietly succeeded.
      setActionError((err as ApiError).message || 'Could not delete this clip. Try again.');
    } finally {
      setBusy(false);
    }
  }

  /** C2. Opens or closes the clip's comment thread through
   * `set_clip_comments_enabled` (0101). Closing refuses new comments in the
   * RLS policy, not only in the UI. */
  async function handleToggleComments() {
    const target = menuClip;
    if (!target) return;
    const next = target.commentsEnabled === false;
    setBusy(true);
    setActionError(null);
    try {
      const enabled = await clutch.setCommentsEnabled(target.id, next);
      setClips((prev) => prev.map((c) => (c.id === target.id ? { ...c, commentsEnabled: enabled } : c)));
      setMenuClip(null);
    } catch (err) {
      // B2. Stay on the menu with the reason shown, same rationale as the
      // delete path above.
      setActionError((err as ApiError).message || 'Could not update comments for this clip. Try again.');
    } finally {
      setBusy(false);
    }
  }

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
        posterUrls={posterUrls}
        onRetry={() => void load()}
        onUpload={() => router.push('/(tabs)/clutch/upload')}
        onOpenClip={(clipId) => router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: clipId } })}
        onOpenClipMenu={(clip) => {
          setActionError(null);
          setMenuClip(clip);
        }}
      />

      <ClipActionsSheet
        visible={menuClip != null}
        commentsEnabled={menuClip?.commentsEnabled !== false}
        busy={busy}
        errorMessage={actionError}
        onToggleComments={() => void handleToggleComments()}
        onDelete={() => {
          setActionError(null);
          setConfirmDeleteClip(menuClip);
          setMenuClip(null);
        }}
        onClose={() => {
          setActionError(null);
          setMenuClip(null);
        }}
      />

      <ConfirmSheet
        visible={confirmDeleteClip != null}
        icon={Trash2}
        destructive
        loading={busy}
        title="Delete this clip"
        body="It comes off your profile and out of the feed. This cannot be undone."
        confirmLabel="Delete clip"
        errorMessage={actionError}
        onConfirm={() => void handleConfirmDeleteClip()}
        onCancel={() => {
          setActionError(null);
          setConfirmDeleteClip(null);
        }}
      />
    </SafeAreaView>
  );
}
