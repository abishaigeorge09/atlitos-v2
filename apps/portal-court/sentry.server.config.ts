// Server runtime. Loaded by instrumentation.ts.
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // The commit SHA, so an issue points at the change that introduced it and
  // Sentry can mark it regressed if it comes back.
  release: process.env.NEXT_PUBLIC_COMMIT_SHA,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
  // Low, because tracing is for seeing slow paths, not for a performance budget.
  tracesSampleRate: 0.1,
  // Local runs would otherwise fill the free quota with noise nobody reads.
  enabled: process.env.NODE_ENV === "production",
})
