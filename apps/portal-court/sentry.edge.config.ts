// Edge runtime, which middleware.ts runs in. A separate init is required:
// the edge runtime does not share the server one.
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_COMMIT_SHA,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
})
