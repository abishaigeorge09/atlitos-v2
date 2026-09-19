import { type SupabaseClient, type SupabaseClientOptions, createClient } from "@supabase/supabase-js";
import type { Database } from "@atlitos/types";

/** A Supabase client typed against the generated Atlitos database schema. */
export type AtlitosClient = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Request timeouts. SCALE-INGRESS.md Gap A (P0).
//
// React Native 0.76.9 builds its Android OkHttp client with
//   .connectTimeout(0, MILLISECONDS)
//   .readTimeout(0, MILLISECONDS)
//   .writeTimeout(0, MILLISECONDS)
// (OkHttpClientProvider.java:58-60). Zero means NO TIMEOUT, so a request whose
// connection is accepted and whose response is never sent hangs forever. That
// is exactly what a saturated GoTrue looks like from a phone: it queues rather
// than refuses.
//
// The consequence is not a slow app, it is a bricked one. `signInAnonymously()`
// never resolves AND never rejects, so `continueAsGuest()` never settles, the
// `.catch()` on the splash screen never runs, `enterGuestUnminted()` never
// fires, and the whole guest degrade path is bypassed. The splash spinner spins
// until the user force quits.
//
// The wrapper below is installed at the supabase client's `global.fetch`, which
// is the single choke point every PostgREST read, every RPC, every auth call,
// every storage call and every edge function invocation passes through. Doing it
// per call site would leave the next call site unprotected; doing it here cannot.
//
// AbortSignal.timeout() is deliberately NOT used: it is not present on Hermes
// across the RN versions this app ships on, and a missing static would throw at
// the first request rather than at build time. A hand rolled AbortController
// plus setTimeout is available everywhere React Native runs.
// ---------------------------------------------------------------------------

/** Auth (GoTrue) calls. Shortest budget because these sit on the launch
 * critical path: a hung one holds the user on the splash screen, and the
 * degrade behind it (public browse as an unminted guest) is strictly better
 * than waiting. */
export const AUTH_REQUEST_TIMEOUT_MS = 8_000;

/** Storage reads and writes. Long, because this covers real uploads on a
 * cellular connection, where 15 seconds is a normal transfer, not a fault. */
export const STORAGE_REQUEST_TIMEOUT_MS = 120_000;

/** Everything else: PostgREST, RPCs, edge functions. Sized above the
 * `authenticated` role's 8 second statement timeout (SCALE-CLIENT.md) plus
 * round trip, so a query that the database itself will kill is never cut off
 * early and reported as a network fault. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Thrown when a request exceeded its budget. A distinct `name` and `code`
 * so a caller can tell "we gave up waiting" apart from "the server said no",
 * which matters for retry decisions: a timeout is worth retrying, a 429 is
 * not. */
export class RequestTimeoutError extends Error {
  readonly code = "REQUEST_TIMEOUT" as const;
  readonly timeoutMs: number;
  readonly url: string;

  constructor(timeoutMs: number, url: string) {
    super(`Request timed out after ${timeoutMs} ms.`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RequestTimeoutOptions {
  /** PostgREST, RPC and edge function calls. */
  defaultMs?: number;
  /** GoTrue calls (`/auth/v1/...`). */
  authMs?: number;
  /** Storage calls (`/storage/v1/...`). */
  storageMs?: number;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function timeoutFor(url: string, options: Required<RequestTimeoutOptions>): number {
  if (url.includes("/auth/v1/")) return options.authMs;
  if (url.includes("/storage/v1/")) return options.storageMs;
  return options.defaultMs;
}

/**
 * Wraps a fetch implementation so every request carries an AbortController
 * backed deadline. A caller supplied `init.signal` (supabase-js storage passes
 * one for uploads) is honoured as well: whichever fires first wins, and the
 * caller's own abort is never reported as a timeout.
 */
export function withRequestTimeout(baseFetch: FetchLike, options?: RequestTimeoutOptions): FetchLike {
  const resolved: Required<RequestTimeoutOptions> = {
    defaultMs: options?.defaultMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    authMs: options?.authMs ?? AUTH_REQUEST_TIMEOUT_MS,
    storageMs: options?.storageMs ?? STORAGE_REQUEST_TIMEOUT_MS,
  };

  return async (input, init) => {
    const url = urlOf(input);
    const timeoutMs = timeoutFor(url, resolved);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const callerSignal = init?.signal ?? null;
    const forwardAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", forwardAbort);
    }

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      // Only claim a timeout when OUR timer is what aborted it. A caller
      // cancelling an upload, or a genuine network error, must surface as
      // itself.
      if (timedOut) throw new RequestTimeoutError(timeoutMs, url);
      throw error;
    } finally {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener("abort", forwardAbort);
    }
  };
}

/**
 * Typed Supabase client factory. Every app (mobile, portal-court,
 * portal-life, admin) calls this once with its own env-sourced url/anonKey
 * pair and passes the result through the domain hooks below, so no app ever
 * hand-rolls a `createClient<Database>()` call with its own type drift.
 *
 * `options` is the escape hatch each app needs for its own runtime: mobile
 * passes an AsyncStorage `auth.storage` adapter (React Native has no
 * `localStorage`), web apps generally do not need to pass anything.
 *
 * Every client this factory returns has request timeouts installed at
 * `global.fetch` (see the block above). That is deliberately not opt in: the
 * failure it prevents is a permanently hung splash screen, and an app that
 * forgets to opt in is the app that hangs. An app that genuinely needs
 * different budgets passes its own already-wrapped `global.fetch`, which is
 * honoured as the base rather than replaced.
 */
export function createAtlitosClient(
  url: string,
  anonKey: string,
  options?: SupabaseClientOptions<"public">,
): AtlitosClient {
  const suppliedFetch = options?.global?.fetch as FetchLike | undefined;
  // Not `suppliedFetch ?? fetch`: an unbound global `fetch` reference throws
  // "Illegal invocation" in a browser, which the portal apps run in.
  const baseFetch: FetchLike = suppliedFetch ?? ((input, init) => fetch(input, init));

  return createClient<Database>(url, anonKey, {
    ...options,
    global: {
      ...options?.global,
      fetch: withRequestTimeout(baseFetch) as typeof fetch,
    },
  });
}
