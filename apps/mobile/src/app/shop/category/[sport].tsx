import { Redirect, useLocalSearchParams } from 'expo-router';

type CategoryParams = {
  /** A `Sport`, or "all" for the whole catalog (the old route's shape). */
  sport: string;
};

/**
 * `/shop/category/[sport]` (Phase S3, PHASE-S3-STATUS.md hard decision 1).
 * This screen used to BE the shop; `/shop` now is, so every existing link
 * here (Home's `CategoriesRow`, old bookmarks, deep links) redirects to
 * `/shop`, carrying `sport` as a param that pre-selects the matching chip.
 * "all" (the old whole-catalog view) carries no sport param: `/shop`'s own
 * empty state is that view now.
 */
export default function CategoryBrowseRedirect() {
  const params = useLocalSearchParams<CategoryParams>();
  if (params.sport && params.sport !== 'all') {
    return <Redirect href={{ pathname: '/shop', params: { sport: params.sport } }} />;
  }
  return <Redirect href="/shop" />;
}
