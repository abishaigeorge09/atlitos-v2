import { usePush } from '@atlitos/api';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import {
  addNotificationTapListener,
  configureNotificationHandler,
  deletePushTokenWithAccessToken,
  registerForPushTokenAsync,
} from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';

/**
 * `use-push-registration`: the one place that wires device push token
 * lifecycle to the session, called once from the root layout. Phase 4 Track
 * D, CT-D, PRD-01 FR-61/62.
 *
 * - On becoming `signed_in`, requests permission, resolves the device's
 *   Expo push token, and upserts it into `push_tokens` (owner-scoped write,
 *   `use-push.ts`). Registration targets real signed-in accounts, not guest
 *   sessions: push notifications are for booking/order/chat/verification
 *   events that only exist once a player or coach account exists.
 * - On sign-out (`session` goes null after having held a token), deletes
 *   that token row so a device that has moved to signed-out state stops
 *   being a delivery target for the account that just left it. The cleanup
 *   uses the just-departed session's access token directly
 *   (`deletePushTokenWithAccessToken`), because by the time `status` is
 *   observably `signed_out` the shared client has already dropped its
 *   session to the anon key and a delete through it would be RLS-refused.
 * - Registers the tap listener once for the app's lifetime: a tap on any
 *   push routes through `expo-router`'s `router.push(deepLink)`, the same
 *   navigation the in-app `/notifications` list already uses
 *   (`apps/mobile/src/app/notifications/index.tsx`), so a push and its
 *   in-app row land on the identical screen.
 */
export function usePushRegistration(): void {
  const status = useSessionStore((state) => state.status);
  const session = useSessionStore((state) => state.session);
  const registeredTokenRef = useRef<string | null>(null);
  const lastAccessTokenRef = useRef<string | null>(null);
  const push = usePush(supabase);

  useEffect(() => {
    configureNotificationHandler();
  }, []);

  useEffect(() => {
    const subscription = addNotificationTapListener((deepLink) => {
      router.push(deepLink as Href);
    });
    return () => subscription.remove();
  }, []);

  // Tracks the most recent non-null session's access token, so the sign-out
  // cleanup below always has a token to delete with even though `session`
  // itself has already gone null by the time `status` observably changes.
  useEffect(() => {
    if (session?.access_token) {
      lastAccessTokenRef.current = session.access_token;
    }
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function syncForSignedIn() {
      const result = await registerForPushTokenAsync();
      if (cancelled || !result) return;
      try {
        await push.register({ token: result.token, platform: result.platform });
        registeredTokenRef.current = result.token;
      } catch (err) {
        // Non fatal: a failed registration just means this device does not
        // receive push until the next successful sync (next app start, or
        // next time this effect re-runs on a session change).
        console.log('[push] token registration write failed:', err);
      }
    }

    async function cleanupOnSignOut() {
      const token = registeredTokenRef.current;
      const accessToken = lastAccessTokenRef.current;
      if (!token || !accessToken) return;
      registeredTokenRef.current = null;
      await deletePushTokenWithAccessToken(token, accessToken);
    }

    if (status === 'signed_in') {
      void syncForSignedIn();
    } else if (status === 'signed_out') {
      void cleanupOnSignOut();
    }

    return () => {
      cancelled = true;
    };
  }, [status]);
}
