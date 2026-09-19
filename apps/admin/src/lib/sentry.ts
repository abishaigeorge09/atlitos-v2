import * as Sentry from "@sentry/react";

// Called once from main.tsx before the app renders. A missing DSN (local dev,
// a preview without the env var set) leaves Sentry uninitialised rather than
// throwing, so the app still runs without it.
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    release: import.meta.env.VITE_COMMIT_SHA as string | undefined,
    environment: (import.meta.env.VITE_SENTRY_ENV as string | undefined) ?? import.meta.env.MODE,
    tracesSampleRate: 0.1,
    enabled: import.meta.env.PROD,
  });
}
