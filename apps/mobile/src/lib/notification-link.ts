import type { Href } from 'expo-router';

/**
 * Turns a stored `notifications.deep_link` into an app route, or `null` when
 * the link has no screen in this app (BUG-074). Shared by the in-app
 * notifications list and a tapped push, so both land on the same screen.
 *
 * - `atlitos://x` (the app scheme) becomes `/x`.
 * - `/clutch/clip/<id>` is the path `moderate_clip` (0043) wrote until 0143;
 *   the screen is `clutch/post/[id]`. Rows written before 0143, and pushes
 *   already sitting on devices, still carry the old path.
 * - `/dashboard` and `/wishlist/...` are donation links for the Empower life
 *   portal (web). The app has no such screens, so there is nothing to open.
 */
const WEB_ONLY_PREFIXES = ['/dashboard', '/wishlist'];

export function resolveNotificationLink(deepLink: string): Href | null {
  let path = deepLink.trim();
  if (path.startsWith('atlitos://')) path = `/${path.slice('atlitos://'.length)}`;
  if (!path.startsWith('/')) return null;

  const legacyClip = path.match(/^\/clutch\/clip\/([^/?#]+)/);
  if (legacyClip) return `/clutch/post/${legacyClip[1]}` as Href;

  if (WEB_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return null;

  return path as Href;
}
