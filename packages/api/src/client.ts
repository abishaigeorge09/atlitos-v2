import { type SupabaseClient, type SupabaseClientOptions, createClient } from "@supabase/supabase-js";
import type { Database } from "@atlitos/types";

/** A Supabase client typed against the generated Atlitos database schema. */
export type AtlitosClient = SupabaseClient<Database>;

/**
 * Typed Supabase client factory. Every app (mobile, portal-court,
 * portal-life, admin) calls this once with its own env-sourced url/anonKey
 * pair and passes the result through the domain hooks below, so no app ever
 * hand-rolls a `createClient<Database>()` call with its own type drift.
 *
 * `options` is the escape hatch each app needs for its own runtime: mobile
 * passes an AsyncStorage `auth.storage` adapter (React Native has no
 * `localStorage`), web apps generally do not need to pass anything.
 */
export function createAtlitosClient(
  url: string,
  anonKey: string,
  options?: SupabaseClientOptions<"public">,
): AtlitosClient {
  return createClient<Database>(url, anonKey, options);
}
