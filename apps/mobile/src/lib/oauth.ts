/**
 * Third party sign in, PRD-01 3.1.
 *
 * Two different mechanisms on purpose:
 *
 * Apple is NATIVE (`expo-apple-authentication`). App Store guideline 4.8
 * requires Sign in with Apple to be offered alongside other social logins,
 * and Apple requires its own button and sheet, not a web view. The native
 * sheet returns an identity token that Supabase verifies directly, so there
 * is no browser round trip and no redirect to register.
 *
 * Google is BROWSER based (`signInWithOAuth` + `expo-web-browser`). The
 * native Google SDK would give a slightly nicer sheet, but it needs its own
 * iOS client id, a URL scheme, a config plugin and a native rebuild, all of
 * which are separate from the Supabase provider config that has to exist
 * anyway. The browser flow needs only the Supabase dashboard, works the same
 * on both platforms, and can be swapped for the native SDK later without the
 * login screen changing: both paths land on a Supabase session.
 *
 * The client runs the default PKCE flow (see lib/supabase.ts, which does not
 * override `flowType`), so the redirect carries `?code=` and is redeemed with
 * `exchangeCodeForSession`. An implicit-flow token fragment is handled too,
 * so flipping `flowType` later does not silently break sign in.
 */
import type { ApiError } from '@atlitos/types';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { Sentry } from './sentry';
import { supabase } from './supabase';

/**
 * A user backing out of the Apple sheet or closing the browser tab is not an
 * error, it is a decision. Callers show nothing for `cancelled`.
 */
export type OAuthOutcome = 'signed-in' | 'cancelled';

function authError(message: string, code: ApiError['code'] = 'INTERNAL'): ApiError {
  return { code, message, status: 400 };
}

/** Where the provider sends the browser back to. Matches `scheme` in app.json. */
function redirectUrl(): string {
  return Linking.createURL('auth/callback');
}

/**
 * Apple hashes whatever nonce it is given into the identity token, and
 * Supabase re-hashes the raw value to check it. So Apple gets the digest and
 * Supabase gets the original; sending the same value to both fails
 * verification.
 */
async function makeNoncePair(): Promise<{ raw: string; hashed: string }> {
  const raw = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

/** True only where the native Apple sheet actually exists. */
export function isAppleSignInAvailable(): boolean {
  return Platform.OS === 'ios';
}

export async function signInWithApple(): Promise<OAuthOutcome> {
  if (!isAppleSignInAvailable()) {
    throw authError('Sign in with Apple is only available on iOS.', 'VALIDATION');
  }

  const { raw, hashed } = await makeNoncePair();

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
  } catch (err) {
    // The sheet throws rather than resolving when the user dismisses it.
    if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return 'cancelled';
    throw authError('Could not complete Sign in with Apple.');
  }

  if (!credential.identityToken) {
    throw authError('Apple did not return an identity token.');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: raw,
  });
  if (error) throw authError(error.message, 'INVALID_CREDENTIALS');

  // Both follow ups are best effort: the person is signed in either way.
  // The name is awaited (it is a local write the next screen reads); the
  // token exchange is a round trip to Apple through an edge function, so it
  // is fired and forgotten, and a failure only reaches Sentry.
  await saveAppleFullName(credential.fullName).catch((err: unknown) => captureQuietly(err, 'apple_full_name'));
  void storeAppleAuthorizationCode(credential.authorizationCode).catch((err: unknown) =>
    captureQuietly(err, 'apple_token_store'),
  );

  return 'signed-in';
}

/** Reports a best effort sign in follow up that failed, with no payload
 * beyond the step name (never the code or a token). */
function captureQuietly(err: unknown, step: string) {
  Sentry.captureException(err, { tags: { step } });
}

/**
 * Apple sends the person's name only on the FIRST authorization, never
 * again, and the identity token does not carry it. Without this the profile
 * name falls back to the local part of a private relay address. Written only
 * when Apple actually sent a name AND the profile still holds a fallback the
 * signup trigger made up (empty, the email's local part, or 'Guest'; see
 * handle_new_user in 0073). A name the person chose is never overwritten.
 */
async function saveAppleFullName(fullName: AppleAuthentication.AppleAuthenticationFullName | null) {
  const name = [fullName?.givenName, fullName?.familyName].filter(Boolean).join(' ').trim();
  if (!name) return;
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;

  const { data: row, error } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle();
  if (error) throw error;
  const current = (row?.name ?? '').trim();
  const localPart = (user.email ?? '').split('@')[0]?.trim() ?? '';
  const isFallback =
    current === '' || current === 'Guest' || (localPart !== '' && current.toLowerCase() === localPart.toLowerCase());
  if (!isFallback) return;

  await supabase.auth.updateUser({ data: { name, full_name: name } });
  const { error: updateError } = await supabase.from('users').update({ name }).eq('id', user.id);
  if (updateError) throw updateError;
}

/**
 * 0139, Guideline 5.1.1(v). The one time authorization code is exchanged
 * server side for a refresh token, so account deletion can revoke it and the
 * app disappears from the person's Sign in with Apple list.
 */
async function storeAppleAuthorizationCode(code: string | null) {
  if (!code) return;
  const { error } = await supabase.functions.invoke('apple-token-store', { body: { authorization_code: code } });
  if (error) throw error;
}

export async function signInWithGoogle(): Promise<OAuthOutcome> {
  const redirectTo = redirectUrl();

  // `skipBrowserRedirect` keeps supabase-js from trying to navigate itself,
  // which it cannot do on native. It hands back the URL to open instead.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw authError(error.message);
  if (!data?.url) throw authError('Google sign in is not configured for this project.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return 'cancelled';

  return completeOAuthRedirect(result.url);
}

/**
 * Turn the provider's redirect back into a session. Exported so a deep link
 * arriving outside the in-app browser (cold start from the system browser)
 * can be redeemed by the same code path.
 */
export async function completeOAuthRedirect(url: string): Promise<OAuthOutcome> {
  const parsed = Linking.parse(url);

  // Provider-side refusal, e.g. the user pressed Deny on the consent screen.
  const deniedReason = parsed.queryParams?.error_description ?? parsed.queryParams?.error;
  if (typeof deniedReason === 'string' && deniedReason.length > 0) {
    if (deniedReason.includes('access_denied')) return 'cancelled';
    throw authError(deniedReason, 'INVALID_CREDENTIALS');
  }

  // PKCE, the flow this client actually runs.
  const code = parsed.queryParams?.code;
  if (typeof code === 'string' && code.length > 0) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw authError(error.message, 'INVALID_CREDENTIALS');
    return 'signed-in';
  }

  // Implicit flow puts the tokens in the fragment, which `Linking.parse`
  // leaves in place. Only reachable if `flowType` is ever switched.
  const fragment = url.split('#')[1];
  if (fragment) {
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw authError(error.message, 'INVALID_CREDENTIALS');
      return 'signed-in';
    }
  }

  throw authError('Sign in did not return a session.');
}
