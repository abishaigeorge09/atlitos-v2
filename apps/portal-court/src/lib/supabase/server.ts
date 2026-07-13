import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database as AppDatabase } from "@atlitos/types";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * Server side Supabase client for server components, route handlers and
 * server actions. Reads and writes the auth cookie set by the middleware
 * session refresh, see PRD-03 FR-1 and FR-7 (verified gated dashboard).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<AppDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll called from a Server Component with no writable response,
            // safe to ignore when the middleware session refresh already runs.
          }
        },
      },
    },
  );
}
