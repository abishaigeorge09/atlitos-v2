import { Redirect } from 'expo-router';

/**
 * Root "/" only ever redirects to the splash screen, which does the real
 * session-based routing (PRD-01 3.1 "Splash: loading only (auto-route),
 * routes by session"). Keeping this a plain redirect (rather than putting
 * the routing logic here) means "/" always resolves to a real file for
 * expo-router, independent of the (auth) group's own layout logic.
 */
export default function Index() {
  return <Redirect href="/(auth)/splash" />;
}
