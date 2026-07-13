import { Redirect } from 'expo-router';

/**
 * Root "/" only ever redirects to the splash screen, which does the real
 * session-based routing (PRD-01 3.1 "Splash: loading only (auto-route),
 * routes by session"). Keeping this a plain redirect (rather than putting
 * the routing logic here) means "/" always resolves to a real file for
 * expo-router, independent of the (auth) group's own layout logic.
 *
 * The Phase 1 spike proof content that used to live here (Card/Button
 * proof, "Dev tools" link) moved to src/app/dev/showcase.tsx, now reachable
 * from the Home tab's dev-only link (see (tabs)/index.tsx).
 */
export default function Index() {
  return <Redirect href="/(auth)/splash" />;
}
