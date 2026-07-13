import { createBrowserClient } from "@supabase/ssr";
import type { Database as AppDatabase } from "@atlitos/types";

/**
 * Browser side Supabase client for client components (auth forms, sign out,
 * and every RLS-scoped courts/payments read/write this app's dashboard
 * pages make with the signed-in partner's own JWT). Reads the public env
 * pair from .env.local, see PRD-03 FR-1 (Supabase Auth, email or phone plus
 * password). Typed against the generated `Database` (regenerated after
 * migrations 0009-0015 landed; the interim `courts-database.types.ts`
 * bridging file this comment used to reference has been removed per its
 * own header's instructions).
 */
export function createClient() {
  return createBrowserClient<AppDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
