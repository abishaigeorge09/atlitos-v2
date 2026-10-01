import { useShop, type AffiliateProduct } from '@atlitos/api';
import { radii } from '@atlitos/theme';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { HomeSection, HomeSectionSkeleton } from '@/components/organisms/home/HomeSection';
import { GearResultTile } from '@/components/ui/gear-result-tile';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';

const TILE_WIDTH = 156;
const MAX_PRODUCTS = 12;

/** Same freshness rule as the shop grid: never checked reads as 90 days. */
function hoursSince(iso: string | null): number {
  if (iso === null) return 24 * 90;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}

/**
 * Home "Gear for your game" rail (PRD-07 FR-40, the affiliate catalog). The
 * athlete's primary sport first; when that sport has no gear (or there is no
 * primary sport) it shows the whole catalog instead, titled honestly as
 * "Training gear". Tiles are the shop's own GearResultTile so price, store
 * and freshness read exactly as they do in the shop. Out of stock products
 * are left out of a promotional rail. Hides itself on an empty catalog or a
 * read error.
 */
export function HomeGearRail({ reloadKey, onLoaded }: { reloadKey: number; onLoaded?: (ok: boolean) => void }) {
  const shop = useShop(supabase);
  const primarySport = useSessionStore((state) => state.me?.primarySport ?? null);

  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [products, setProducts] = useState<AffiliateProduct[]>([]);
  const [forSport, setForSport] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      let list: AffiliateProduct[] = primarySport ? await shop.listAffiliateProducts({ sport: primarySport }) : [];
      let sportMatch = list.some((product) => product.cheapest !== null);
      if (!sportMatch) list = await shop.listAffiliateProducts({});
      setForSport(sportMatch);
      setProducts(list.filter((product) => product.cheapest !== null).slice(0, MAX_PRODUCTS));
      onLoaded?.(true);
    } catch {
      setProducts([]);
      onLoaded?.(false);
    } finally {
      setState('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primarySport]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (state === 'loading') return <HomeSectionSkeleton cardWidth={TILE_WIDTH} cardHeight={260} />;
  if (products.length === 0) return null;

  const sportLabel = forSport && primarySport ? SPORT_LABEL[primarySport].toLowerCase() : null;

  return (
    <HomeSection
      title={sportLabel ? `Gear for ${sportLabel}` : 'Training gear'}
      subtitle="Prices compared across official stores"
      seeAllLabel="See all gear"
      onSeeAll={() =>
        router.push(sportLabel && primarySport ? { pathname: '/shop', params: { sport: primarySport } } : '/shop')
      }
    >
      {products.map((product) => (
        <View key={product.id} style={{ width: TILE_WIDTH, borderRadius: radii.md, overflow: 'hidden' }}>
          <GearResultTile
            imageUri={product.imageUrl ?? undefined}
            brand={product.brand}
            title={product.title}
            fromPrice={product.cheapest?.price ?? null}
            retailer={product.cheapest?.retailer ?? null}
            storeCount={product.retailerCount}
            checkedHoursAgo={hoursSince(product.cheapest?.lastCheckedAt ?? null)}
            onPress={() => router.push({ pathname: '/shop/affiliate/[id]', params: { id: product.id } })}
          />
        </View>
      ))}
    </HomeSection>
  );
}
