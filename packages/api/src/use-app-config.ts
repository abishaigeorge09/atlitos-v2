import { useMemo } from "react";

import type { AtlitosClient } from "./client";

/**
 * `useAppConfig` (Phase S3, Track F, PRD-07 FR-53). Reads `app_config`, the
 * generic key/value/public table from `XXXX_app_config_owned_shop_flag.sql`.
 * RLS on that table is permissive-OR shaped in spirit even though today only
 * one policy exists (`public = true` readable by anon/authenticated), so per
 * CLAUDE.md's scoping rule every read here carries its own explicit
 * `.eq("public", true)` rather than leaning on the policy alone: a future
 * admin-only row must never leak through a query that forgot the filter.
 *
 * Never throws. A missing key, a network failure, or a non-public row all
 * resolve to `undefined` (or the caller's `fallback` for `getBoolean`), so a
 * config read can never be the reason a screen shows an error state. Config
 * off is safer than config crash for a flag whose false is deny-by-default
 * (FR-53: no cart, no owned products).
 *
 * Cached in memory for 5 minutes per key, keyed by the key string only (this
 * repo runs one Supabase project per environment, so no client-identity
 * component is needed in the cache key). The cache is module scope, not
 * component scope, so two components reading the same key within the window
 * share one network round trip's answer instead of racing two.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

async function fetchAppConfigValue(client: AtlitosClient, key: string): Promise<unknown> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const { data, error } = await client
      .from("app_config")
      .select("value")
      .eq("key", key)
      .eq("public", true)
      .maybeSingle<{ value: unknown }>();
    if (error) {
      // Never throw: a config read failure must not take a screen down.
      return undefined;
    }
    const value = data?.value;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    return undefined;
  }
}

export interface UseAppConfigResult {
  /** Raw value for `key`, or `undefined` when the row does not exist, is not
   * public, or the read failed. Never throws. */
  get(key: string): Promise<unknown>;
  /** `value === true` (or the JSON literal `true`) for `key`, else `fallback`.
   * Never throws. */
  getBoolean(key: string, fallback: boolean): Promise<boolean>;
}

/**
 * Memoized on [client] for a stable identity across renders, matching every
 * other hook in this package (see `useProfile`'s doc comment on why: a fresh
 * object literal every render breaks any effect that honestly lists it as a
 * dependency).
 */
export function useAppConfig(client: AtlitosClient): UseAppConfigResult {
  return useMemo(
    () => ({
      async get(key: string): Promise<unknown> {
        return fetchAppConfigValue(client, key);
      },
      async getBoolean(key: string, fallback: boolean): Promise<boolean> {
        const value = await fetchAppConfigValue(client, key);
        if (typeof value === "boolean") return value;
        return fallback;
      },
    }),
    [client],
  );
}
