import * as WebBrowser from 'expo-web-browser';

/** Public site that hosts the legal and support pages (apps/landing). One text
 * for the app, the store listing and the web. */
export const SITE_URL = 'https://www.atlitos.com';

export type SitePath = '/terms' | '/privacy' | '/content-policy' | '/support' | '/refund-policy' | '/delete-account';

/** Opens a site page in the in app browser sheet (SFSafariViewController). */
export function openSitePage(path: SitePath) {
  void WebBrowser.openBrowserAsync(`${SITE_URL}${path}`);
}
