import { useAppConfig } from '@atlitos/api';
import { Redirect, Stack, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the shop route group (PRD-07 section 3: "all screens live in the
 * consumer Expo app under the shop and account route groups"). Every screen
 * here renders its own in-screen back header via AppBar, matching the
 * `(auth)`/`(onboarding)`/`courts` stacks, so nothing gets a second native
 * header stacked on top of that.
 *
 * Phase S3, FR-53/hard decision 4: while `shop.owned_enabled` is false, every
 * owned route under this stack redirects to `/shop` instead of rendering.
 * One layout-level check, per PHASE-S3-STATUS.md scope row 4's "in one place
 * if the router allows": `useSegments()`'s second segment names the file
 * directly under `shop/` (`cart`, `checkout`, `orders`, `order`,
 * `order-success`, `product`), which is exactly the owned-route set
 * (`/shop/cart`, `/shop/checkout/*`, `/shop/orders*`, `/shop/order/*`,
 * `/shop/order-success`, `/shop/product/*`); `index`, `category` and
 * `affiliate` are never in this set and are unaffected. `undefined` (the
 * flag read has not resolved yet) renders nothing rather than a false
 * redirect, matching FR-53's deny-by-default posture without a flash of the
 * owned screen first.
 */
const OWNED_SEGMENTS = new Set(['cart', 'checkout', 'orders', 'order', 'order-success', 'product']);

export default function ShopLayout() {
  const colors = useThemeColors();
  const appConfig = useAppConfig(supabase);
  // Cast: expo-router's generated route typegen types this as a fixed-length
  // tuple for the CURRENT route only, which is narrower than the runtime
  // value (this layout renders for every route in the group, so the actual
  // length varies). `string[]` is what the value always structurally is.
  const segments = useSegments() as string[];
  const [ownedEnabled, setOwnedEnabled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    appConfig
      .getBoolean('shop.owned_enabled', false)
      .then(setOwnedEnabled)
      .catch(() => setOwnedEnabled(false));
  }, [appConfig]);

  const currentSegment = segments[1];
  const onOwnedRoute = typeof currentSegment === 'string' && OWNED_SEGMENTS.has(currentSegment);

  if (onOwnedRoute && ownedEnabled === false) {
    return <Redirect href="/shop" />;
  }
  // ownedEnabled === undefined on an owned route: render nothing (not the
  // owned screen, not a redirect) until the flag resolves.
  if (onOwnedRoute && ownedEnabled === undefined) {
    return null;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
