// ATLITOS v2 — supabase/functions/_shared/clip-access.ts
//
// Shared helpers for the two Clutch signed-URL mints (AT-96) and the upload
// and finalize functions (AT-94/AT-95). They encode the one privacy rule the
// phase turns on (PHASE-5-STATUS.md): a clip video is only ever reachable
// through a freshly minted, short lived signed URL produced against the LIVE
// clip row, never a stored URL, and the mint refuses outright for a clip that
// is `removed` or `rejected`. Columns hold PATHS only; nothing here persists a
// resolved URL.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";
import { serviceRoleClient } from "./supabase.ts";

/** The private `clips` bucket (0042). No anon/public policy on storage.objects. */
export const CLIPS_BUCKET = "clips";

/** Signed playback/thumbnail URL lifetime, seconds. The takedown TTL bound. */
export const SIGNED_URL_TTL_SECONDS = 300;

/**
 * The live clip fields every access decision reads. Always fetched fresh at
 * mint time under the service role, so a `removed`/`rejected` row refuses
 * within the same request the takedown landed.
 */
export interface LiveClip {
  id: string;
  owner_id: string;
  status: string;
  storage_path: string | null;
  thumb_path: string | null;
}

/**
 * Validate the caller's own JWT WITHOUT throwing when it is absent or invalid.
 * `get_clip_playback_url` is public callable (a guest browsing the published
 * feed has no user session, FR-3/FR-42), so "no user" is a normal outcome, not
 * an error. Returns the user id on a valid session, else null. Mirrors
 * getAuthenticatedUser's GoTrue round trip (never trusts a decoded-only token).
 */
export async function getOptionalUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/**
 * Admin/moderator check by user id, under the service role. `has_role` reads
 * `auth.uid()`, which is null under the service role, so an edge function that
 * must decide against a KNOWN user id queries `user_roles` directly (the same
 * table `has_role`/`is_guest` and every RLS admin policy resolve against).
 */
export async function isAdminOrModerator(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "moderator"])
    .limit(1);
  if (error) {
    throw new AppError(
      "INTERNAL",
      `Failed to check moderator role: ${error.message}`,
      500,
    );
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Fetch the LIVE clip row. Service role, so it sees the true current status
 * regardless of RLS. Throws NOT_FOUND for an unknown id.
 */
export async function fetchLiveClip(
  supabase: SupabaseClient,
  clipId: string,
): Promise<LiveClip> {
  const { data, error } = await supabase
    .from("clips")
    .select("id, owner_id, status, storage_path, thumb_path")
    .eq("id", clipId)
    .maybeSingle<LiveClip>();

  if (error) {
    throw new AppError("INTERNAL", `Failed to load clip: ${error.message}`, 500);
  }
  if (!data) {
    throw new AppError("NOT_FOUND", "Clip not found.", 404);
  }
  return data;
}

/**
 * SEC-F1 / SEC-F3, the shared storage-path choke point.
 *
 * Every signed URL in this codebase is minted under the SERVICE ROLE against
 * the private `clips` bucket, so the object path is the only thing standing
 * between a caller and any byte in that bucket. Two separate doors let a
 * client put an arbitrary path into a column that is later minted:
 *
 *   1. `stream-webhook`'s `thumb_path` body field (SEC-F1), now prefix-guarded
 *      at the write, and guarded again here at the read.
 *   2. `coach_trainee_videos`'s direct INSERT policy (SEC-F3), which let a
 *      coach choose `storage_path` outright, bypassing the edge function that
 *      derives a safe one.
 *
 * Guarding only the writes leaves rows already poisoned before the fix, and
 * any future write path, still mintable. So the guard lives HERE, on the one
 * function all four mints route through, and the prefix is a REQUIRED
 * argument rather than an optional one: a new call site cannot forget it
 * without failing to compile.
 *
 * The prefix a caller passes must be derived from the row being minted
 * (`${clip.owner_id}/`, `coach-videos/${coach_id}/${player_id}/`), never from
 * the request body.
 */
export function assertPathUnderPrefix(objectPath: string, requiredPrefix: string): void {
  if (
    !requiredPrefix ||
    !objectPath.startsWith(requiredPrefix) ||
    objectPath.split("/").includes("..")
  ) {
    throw new AppError(
      "FORBIDDEN",
      "This media is not available.",
      403,
    );
  }
}

/**
 * Mint a short lived (TTL 300s) signed download URL for a clip object path,
 * against the private `clips` bucket, under the service role. Never stored.
 * Throws NOT_FOUND if the clip has no object yet (a clip still `uploading`
 * whose bytes never landed, or a fixture/placeholder-path row whose bytes were
 * never uploaded), so a caller never receives a dangling URL. A missing
 * storage object is an EXPECTED data condition for an un-uploaded clip, not a
 * server fault, so it surfaces as a clean 404, not a 500 (F2 in the P5 web
 * verification: get-clip-moderation-url used to 500 on a placeholder-byte
 * clip). Only a genuinely unexpected storage failure stays a 500.
 */
export async function mintSignedClipUrl(
  supabase: SupabaseClient,
  objectPath: string | null,
  requiredPrefix: string,
): Promise<string> {
  if (!objectPath) {
    throw new AppError("NOT_FOUND", "Clip has no stored video yet.", 404);
  }
  assertPathUnderPrefix(objectPath, requiredPrefix);
  const { data, error } = await supabase.storage
    .from(CLIPS_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    // supabase-storage reports an absent object as an "Object not found"
    // StorageApiError (HTTP 400/404 from the storage API). That is the clip
    // row existing while its bytes never landed, an expected 404, not a 500.
    if (error && isObjectNotFoundError(error)) {
      throw new AppError("NOT_FOUND", "Clip video is not available yet.", 404);
    }
    throw new AppError(
      "INTERNAL",
      `Failed to mint signed url: ${error?.message ?? "unknown error"}`,
      500,
    );
  }
  return data.signedUrl;
}

/**
 * True when a storage error means the object does not exist (as opposed to a
 * real outage or misconfig). supabase-storage's StorageApiError carries a
 * `statusCode` (string) and a message; a missing object is `"Object not found"`.
 * Matched primarily on the message so it is robust to the storage API's status
 * quirks, with an explicit 404 status as a secondary signal. A bare 400 is NOT
 * treated as not-found, so a genuine bad request still surfaces as a 500.
 */
function isObjectNotFoundError(error: { message?: string; statusCode?: string; status?: number }): boolean {
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("not found") || message.includes("not_found")) return true;
  const status = error.statusCode ?? (typeof error.status === "number" ? String(error.status) : undefined);
  return status === "404";
}

export { serviceRoleClient };
