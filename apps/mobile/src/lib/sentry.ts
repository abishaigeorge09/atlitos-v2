import * as Sentry from '@sentry/react-native';

// Called once from the root layout, before anything renders. A missing DSN
// (local dev, a build without EXPO_PUBLIC_SENTRY_DSN set) leaves Sentry
// uninitialised rather than throwing, so the app still runs without it.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const sentryEnabled = Boolean(dsn) && !__DEV__;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? (__DEV__ ? 'development' : 'production'),
    tracesSampleRate: 0.1,
    enabled: !__DEV__,
  });
}

export { Sentry };
