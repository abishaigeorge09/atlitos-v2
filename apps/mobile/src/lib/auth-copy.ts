import type { ApiError } from '@atlitos/types';

/**
 * Maps known auth error shapes to friendly, plain copy (Track D defect 6).
 * The @atlitos/api error mappers already collapse raw GoTrue/PostgREST
 * errors into `ApiError` codes; this is the last mile that turns a code (or
 * the few raw-message shapes the mappers cannot classify) into a sentence a
 * person can act on. Unknown errors get a generic line, with the raw message
 * appended only in __DEV__ builds. House style: no hyphens or em dashes in
 * any of these strings.
 */

const GENERIC = 'Something went wrong, please try again.';

export function friendlyAuthMessage(error: unknown): string {
  const err = (error ?? {}) as Partial<ApiError>;
  const raw = typeof err.message === 'string' ? err.message : '';
  const lower = raw.toLowerCase();

  let friendly: string | null = null;

  if (err.code === 'INVALID_CREDENTIALS' || lower.includes('invalid login credentials')) {
    friendly = 'That login does not match our records. Check your details and try again.';
  } else if (lower.includes('email not confirmed')) {
    friendly = 'Confirm your email first. Open the link we sent to your inbox, then log in.';
  } else if (lower.includes('anonymous sign')) {
    friendly = 'Guest browsing is unavailable right now. Log in or create an account to continue.';
  } else if (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('network error')
  ) {
    friendly = 'We could not reach the server. Check your connection and try again.';
  } else if (err.code === 'OTP_EXPIRED') {
    friendly = 'That code has expired. Request a new one and try again.';
  } else if (err.code === 'OTP_INVALID') {
    friendly = 'That code does not match. Check the digits and try again.';
  } else if (err.code === 'RATE_LIMITED') {
    friendly = 'Too many attempts. Wait a moment, then try again.';
  } else if (err.code === 'EMAIL_TAKEN') {
    friendly = 'This email is already registered. Log in instead.';
  } else if (err.code === 'PHONE_TAKEN') {
    friendly = 'This phone number is already registered. Log in instead.';
  } else if (err.code === 'UNAUTHENTICATED') {
    friendly = 'Your session has ended. Log in again to continue.';
  }

  if (friendly) return friendly;
  if (__DEV__ && raw) return `${GENERIC} (${raw})`;
  return GENERIC;
}
