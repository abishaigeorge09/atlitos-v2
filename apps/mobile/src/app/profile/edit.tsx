import { toApiError, useProfile } from '@atlitos/api';
import { spacing, radii } from '@atlitos/theme';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImageIcon, LogIn } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { uploadAvatar, uploadCover } from '@/lib/storage';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const BIO_MAX = 160;
const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const AVATAR_SIZE = 80 as const;
/** Cover preview height, derived from the spacing scale (no raw literal). */
const COVER_PREVIEW_HEIGHT = spacing['4xl'] * 3;

type HandleCheck = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

/**
 * Edit profile: bio (160 chars, mono counter), handle (validated slug with a
 * live availability check against public_profiles), avatar and cover photo
 * pickers uploading through lib/storage.ts into the public avatars bucket
 * (cover under the owner folder's cover/ prefix). Saves through
 * useProfile.updateProfile (own row only), then refreshes the session's me.
 */
export default function EditProfileScreen() {
  const colors = useThemeColors();
  const profileApi = useProfile(supabase);
  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);
  const refreshMe = useSessionStore((state) => state.refreshMe);
  const isGuest = status === 'guest';

  const [bio, setBio] = useState(me?.bio ?? '');
  const [handle, setHandle] = useState(me?.handle ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me?.avatarUrl ?? null);
  const [coverUrl, setCoverUrl] = useState<string | null>(me?.coverUrl ?? null);
  const [handleCheck, setHandleCheck] = useState<HandleCheck>('idle');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedHandle = handle.trim().toLowerCase();
  const handleChanged = normalizedHandle !== (me?.handle ?? '');

  // Live availability check, debounced. Runs only for a syntactically valid,
  // actually-changed handle; keeping your current handle is always fine.
  useEffect(() => {
    if (!handleChanged || normalizedHandle.length === 0) {
      setHandleCheck('idle');
      return;
    }
    if (!HANDLE_RE.test(normalizedHandle)) {
      setHandleCheck('invalid');
      return;
    }
    setHandleCheck('checking');
    let cancelled = false;
    const timer = setTimeout(() => {
      profileApi
        .isHandleAvailable(normalizedHandle)
        .then((available) => {
          if (!cancelled) setHandleCheck(available ? 'available' : 'taken');
        })
        .catch(() => {
          if (!cancelled) setHandleCheck('idle');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // profileApi wraps the module-singleton supabase client; excluding it
    // avoids refiring on every render (it is not memoized).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedHandle, handleChanged]);

  const handleHint = useMemo(() => {
    switch (handleCheck) {
      case 'checking':
        return { text: 'Checking availability.', color: colors.textSecondary };
      case 'available':
        return { text: 'This handle is available.', color: colors.success };
      case 'taken':
        return { text: 'That handle is taken. Try another one.', color: colors.danger };
      case 'invalid':
        return {
          text: 'Use 3 to 24 characters, lowercase letters, numbers and underscores.',
          color: colors.danger,
        };
      default:
        return null;
    }
  }, [handleCheck, colors]);

  async function pickImage(kind: 'avatar' | 'cover') {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library access was not granted.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: kind === 'avatar' ? [1, 1] : [3, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0] || !me) return;

    const setUploading = kind === 'avatar' ? setAvatarUploading : setCoverUploading;
    setUploading(true);
    try {
      const url =
        kind === 'avatar'
          ? await uploadAvatar(me.id, result.assets[0].uri)
          : await uploadCover(me.id, result.assets[0].uri);
      if (kind === 'avatar') setAvatarUrl(url);
      else setCoverUrl(url);
    } catch {
      setError('Could not upload the photo right now. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!me) return;
    if (handleChanged && normalizedHandle.length > 0 && !HANDLE_RE.test(normalizedHandle)) {
      setHandleCheck('invalid');
      return;
    }
    if (handleCheck === 'taken') return;

    setSaving(true);
    setError(null);
    try {
      await profileApi.updateProfile({
        bio: bio.trim().length > 0 ? bio.trim() : null,
        avatarUrl,
        coverUrl,
        ...(handleChanged && normalizedHandle.length > 0 ? { handle: normalizedHandle } : {}),
      });
      await refreshMe();
      router.back();
    } catch (err) {
      setError(toApiError(err).message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (isGuest || !me) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Edit profile" onPressBack={() => router.back()} />
        <View className="flex-1 items-center justify-center">
          <EmptyState
            icon={LogIn}
            title="Sign in to edit your profile"
            body="Create an account to set your handle, bio and photos."
            ctaLabel="Sign in"
            onCtaPress={() => router.push('/(auth)/login')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Edit profile" onPressBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing['3xl'] }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('label'), { color: colors.text }]}>Cover photo</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change cover photo"
            onPress={() => void pickImage('cover')}
            style={{
              height: COVER_PREVIEW_HEIGHT,
              borderRadius: radii.lg,
              overflow: 'hidden',
              backgroundColor: colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : null}
            {coverUploading ? (
              <View
                style={{
                  position: 'absolute',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  right: spacing.sm,
                  bottom: spacing.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  borderRadius: radii.pill,
                  backgroundColor: colors.overlay,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                }}
              >
                <ImageIcon size={14} strokeWidth={1.75} color={colors.textInverse} />
                <Text style={[textStyle('caption'), { color: colors.textInverse }]}>Change</Text>
              </View>
            )}
          </Pressable>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('label'), { color: colors.text }]}>Profile photo</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <Avatar uri={avatarUrl ?? undefined} name={me.name} size={AVATAR_SIZE} />
            <Button
              variant="secondary"
              size="sm"
              loading={avatarUploading}
              onPress={() => void pickImage('avatar')}
            >
              <Camera size={16} strokeWidth={1.75} color={colors.text} />
              <Text style={[textStyle('label'), { color: colors.text }]}>Change photo</Text>
            </Button>
          </View>
        </View>

        <View style={{ gap: spacing.xs }}>
          <Input
            label="Handle"
            value={handle}
            onChangeText={(value) => setHandle(value.toLowerCase())}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="yourhandle"
            error={handleCheck === 'taken' || handleCheck === 'invalid' ? ' ' : undefined}
          />
          {handleHint ? (
            <Text style={[textStyle('caption'), { color: handleHint.color }]}>{handleHint.text}</Text>
          ) : (
            <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
              Your public name, shown as @{normalizedHandle || 'yourhandle'}.
            </Text>
          )}
        </View>

        <View style={{ gap: spacing.xs }}>
          <Input
            type="multiline"
            label="Bio"
            value={bio}
            onChangeText={(value) => setBio(value.slice(0, BIO_MAX))}
            maxLength={BIO_MAX}
            placeholder="Tell people what you play and where."
          />
          <Text style={[textStyle('numericSm'), { color: colors.textSecondary, textAlign: 'right' }]}>
            {bio.length}/{BIO_MAX}
          </Text>
        </View>

        {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error}</Text> : null}

        <Button
          loading={saving}
          disabled={avatarUploading || coverUploading || handleCheck === 'taken' || handleCheck === 'invalid'}
          onPress={() => void handleSave()}
        >
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Save changes</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
