import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@atlitos/types";

/**
 * Browser side Supabase client for client components (auth forms, sign out).
 * Reads the public env pair from .env.local, see PRD-03 FR-1 (Supabase Auth,
 * email or phone plus password).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
