import { useMemo } from "react";
import type { AtlitosClient } from "./client";
import { mapPostgrestError } from "./errors";

/**
 * `@atlitos/api`'s Home lane. Its own small file rather than growing
 * `hooks.ts`, matching how `use-shop.ts` and `use-empower.ts` split their
 * lanes out. Currently just the promo carousel read (PRD-01 3.2, Track B of
 * this phase); other Home sections read through their own domain's existing
 * hook (`useShop`, `useClutch`, `useEmpower`).
 *
 * `promo_banners` (0071) is reference content with no per-user data, the same
 * class as `categories`, so there is no owner filter to apply, only the
 * explicit `.eq("active", true)` mirroring the RLS policy (the same shape
 * `listProducts`/`listUpas` use for their own public-browse tables).
 */

const PROMO_MEDIA_BUCKET = "product-media";

export interface PromoBanner {
  id: string;
  title: string;
  body: string | null;
  ctaLabel: string | null;
  ctaRoute: string | null;
  imageUrl: string | null;
  sort: number;
}

interface PromoBannerRow {
  id: string;
  title: string;
  body: string | null;
  cta_label: string | null;
  cta_route: string | null;
  image_path: string | null;
  sort: number;
}

export function useHome(client: AtlitosClient) {
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
    /** Active promo banners, sorted low to high. Empty on a read error rather
     * than throwing, the Home carousel hides itself on an empty list. */
    async listPromoBanners(): Promise<PromoBanner[]> {
      const { data, error } = await client
        .from("promo_banners")
        .select("id, title, body, cta_label, cta_route, image_path, sort")
        .eq("active", true)
        .order("sort", { ascending: true })
        .returns<PromoBannerRow[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        ctaLabel: row.cta_label,
        ctaRoute: row.cta_route,
        imageUrl: row.image_path
          ? client.storage.from(PROMO_MEDIA_BUCKET).getPublicUrl(row.image_path).data.publicUrl
          : null,
        sort: row.sort,
      }));
    },
  }), [client]);
}

export type UseHomeResult = ReturnType<typeof useHome>;
