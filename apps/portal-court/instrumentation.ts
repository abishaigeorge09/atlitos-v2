import * as Sentry from "@sentry/nextjs"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config")
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config")
}

// Captures errors thrown inside React Server Components, which otherwise
// surface as a generic digest string with no stack.
export const onRequestError = Sentry.captureRequestError
