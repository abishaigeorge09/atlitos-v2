// Browser runtime.
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_COMMIT_SHA,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Session replay only on sessions that errored. This is the setting that
  // would have shown the infinite refetch loop as it happened rather than as a
  // description of it after the fact.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })],
  enabled: process.env.NODE_ENV === "production",
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
