import { router } from 'expo-router';

const AFFILIATE_PREFIX = 'affiliate:';

/**
 * Opens a gear result. ai-search (and anything that stored its ids) prefixes
 * a retailer offer with `affiliate:`; those live at /shop/affiliate/[id] with
 * the prefix removed. Everything else is an owned catalogue product. Before
 * this, affiliate ids were pushed to /shop/product/[id] and opened an empty
 * page (launch runbook 5.3).
 */
export function openGear(id: string) {
  if (id.startsWith(AFFILIATE_PREFIX)) {
    router.push({ pathname: '/shop/affiliate/[id]', params: { id: id.slice(AFFILIATE_PREFIX.length) } });
    return;
  }
  router.push({ pathname: '/shop/product/[id]', params: { id } });
}
