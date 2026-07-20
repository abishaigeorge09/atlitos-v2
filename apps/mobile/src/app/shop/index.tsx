import { Redirect } from 'expo-router';

/**
 * `/shop` is not a screen of its own in PRD-07 section 3; browse always
 * happens at `/shop/category/[sport]`. This sends the bare route to the
 * whole-catalog variant of that screen so the shop has one stable entry point
 * rather than a dead URL.
 */
export default function ShopIndexScreen() {
  return <Redirect href="/shop/category/all" />;
}
