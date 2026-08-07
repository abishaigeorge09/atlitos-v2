import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

import type { PushPlatform } from '@atlitos/api';

/**
 * Push transport, device side. Phase 4 Track D, CT-D, PRD-01 FR-61/62. Pairs
 * with `supabase/functions/_shared/notify.ts` (server leg, Expo Push API)
 * and `packages/api/src/use-push.ts` (the `push_tokens` CRUD). This module
 * is plain functions, no React, so it can be unit-reasoned about and reused
 * from the `use-push-registration` hook without a component tree.
 *
 * Never throws into a caller that did not explicitly ask for the error: a
 * user who denies notification permission, or a simulator with no push
 * capability, must not break app start. Every native call here is
 * try/caught and degrades to `null`/no-op.
 */

const EXPO_PROJECT_ID = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;

/**
 * Foreground presentation. Without a handler, expo-notifications drops a
 * push that arrives while the app is in the foreground; this shows it as a
 * banner + list entry, matching the platform default users expect for chat/
 * booking/order pushes (FR-62).
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function nativePlatform(): PushPlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null; // web has no expo-notifications transport
}

/**
 * Requests notification permission (no-op re-prompt if already decided) and
 * resolves the device's Expo push token. Returns `null` on web, on a denied
 * permission, or on any native/network failure (offline device, simulator
 * without push capability, missing EAS project id in a local dev build) so
 * callers can treat "no token" as a normal, non-fatal outcome rather than an
 * error to surface to the user.
 */
export async function registerForPushTokenAsync(): Promise<{
  token: string;
  platform: PushPlatform;
} | null> {
  const platform = nativePlatform();
  if (!platform) return null;
  if (!EXPO_PROJECT_ID) {
    console.log('[push] no EAS projectId configured, skipping token registration.');
    return null;
  }

  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
    });
    return { token, platform };
  } catch (err) {
    console.log('[push] token registration failed, continuing without push:', err);
    return null;
  }
}

/**
 * Subscribes to notification taps. `deepLink` lives in `data.deepLink`
 * (the payload shape `_shared/notify.ts` sends, CT-D: `{ to, title, body,
 * data: { deepLink, type } }`), so this hands the caller a plain string to
 * route with `expo-router`'s `router.push`, matching the in-app
 * `/notifications` list's existing tap behavior
 * (`apps/mobile/src/app/notifications/index.tsx`).
 */
export function addNotificationTapListener(
  onTap: (deepLink: string) => void,
): EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | { deepLink?: unknown }
      | undefined;
    if (typeof data?.deepLink === 'string' && data.deepLink.length > 0) {
      onTap(data.deepLink);
    }
  });
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Deletes one `push_tokens` row directly over PostgREST using an explicit
 * access token, rather than through the shared `supabase` client instance.
 * This exists for the sign-out cleanup path only: by the time
 * `session-store`'s `signOut()` has run and the app's `status` observably
 * flips away from `signed_in`, the shared client's in-memory session has
 * already been cleared to the anon key, so a delete issued through it would
 * be RLS-refused (0 rows, not the caller's own). Supabase access tokens are
 * stateless JWTs valid until their own `exp`, so the token this app held a
 * moment before sign-out is still good enough to authorize deleting the
 * exact row it registered. Never throws: a failed cleanup here just leaves
 * one orphaned token row, pruned server side the next time the transport
 * gets a `DeviceNotRegistered` response for it (see `_shared/notify.ts`).
 */
export async function deletePushTokenWithAccessToken(
  token: string,
  accessToken: string,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/push_tokens?token=eq.${encodeURIComponent(token)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
  } catch (err) {
    console.log('[push] sign-out token cleanup request failed:', err);
  }
}
