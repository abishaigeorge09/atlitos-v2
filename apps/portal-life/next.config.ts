import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  org: "atlitos",
  project: "portal-life",
  // Only used when SENTRY_AUTH_TOKEN is set (source map upload at build time).
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
  // Browser events go through the app's own origin so an ad blocker on
  // ingest.sentry.io does not silently drop them.
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
  automaticVercelMonitors: false,
});
