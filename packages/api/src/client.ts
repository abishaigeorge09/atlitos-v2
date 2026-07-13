import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import type { Database } from "@atlitos/types";

/** A Supabase client typed against the generated Atlitos database schema. */
export type AtlitosClient = SupabaseClient<Database>;

/**
 * Typed Supabase client factory. Every app (mobile, portal-court,
 * portal-life, admin) calls this once with its own env-sourced url/anonKey
 * pair and passes the result through the domain hooks below, so no app ever
 * hand-rolls a `createClient<Database>()` call with its own type drift.
 */
export function createAtlitosClient(url: string, anonKey: string): AtlitosClient {
  return createClient<Database>(url, anonKey);
}
