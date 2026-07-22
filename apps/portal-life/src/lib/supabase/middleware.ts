import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@atlitos/types";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

// Routes reachable without a session: the marketing landing and the auth
// pages. Everything else in the Life portal (apply, status, home, wishlist,
// gratitude, profile, account) requires an authenticated user.
const PUBLIC_PATHS = ["/", "/signin", "/signup"];

/**
 * Refreshes the Supabase session cookie on every request and gates every
 * authenticated route behind a session, per PRD-05 FR-9 and FR-25.
 * Unauthenticated requests to a protected path redirect to /signin with the
 * original path preserved as a redirect target.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (!isPublic && !user) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}
