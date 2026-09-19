// ATLITOS v2 — supabase/functions/delete-account/index.ts
//
// POST with the caller's own JWT, no body. Apple App Store Guideline
// 5.1.1(v) and the Google Play account deletion policy: an account created
// inside the app must be deletable from inside the app.
//
// This function exists for the two things a Postgres RPC cannot reach:
//
//   leg (a)  the GoTrue account itself. Releasing the email and phone and
//            banning the user requires the Supabase Auth ADMIN API.
//   leg (b)  the storage OBJECTS. An RPC can delete a row in storage.objects
//            but not the bytes behind it.
//
// Everything else, the whole public-schema deletion and anonymisation, is
// `delete_my_account()` in 0098, called below through the CALLER'S OWN JWT
// (`userScopedClient`) so `auth.uid()` inside the SECURITY DEFINER function
// resolves to the real caller. This is the admin-user-suspend / AT-82 pattern.
// The RPC takes no user id at all, so this endpoint cannot be made to delete
// somebody else's account no matter what a client sends.
//
// ORDER MATTERS, and it is the opposite of admin-user-suspend's. The RPC runs
// FIRST. If it refuses (DELETION_BLOCKED for a payment still in flight, the
// last admin, a coach with upcoming sessions, a partner with upcoming
// bookings) GoTrue is never touched and the account is completely untouched.
// If the RPC succeeds and a later leg fails, the account is already
// tombstoned, PII is already scrubbed and every write is already refused by
// is_actor_active(), so the user IS deleted in every sense that matters. The
// residue is a still-usable sign in, which the response reports honestly as
// auth_released: false rather than claiming a clean success.
//
// The RPC is idempotent, so a client that retries after a dropped response
// gets the original receipt back instead of an error.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import { serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";

// GoTrue has no "forever". 87600h is 10 years, the same literal
// admin-user-suspend uses for a suspension ban.
const DELETED_BAN_DURATION = "87600h";

// Buckets keyed `<bucket>/<user_id>/...` by the upload paths in 0006/0042 and
// the storage RLS policies. A prefix sweep is enough for these two.
const USER_PREFIX_BUCKETS = ["avatars", "clips", "coach-certificates"] as const;

/**
 * Lists a prefix RECURSIVELY. A flat `list()` returns a nested directory as a
 * single zero-byte folder entry, not the files inside it, and `avatars` really
 * does nest: uploadAvatar writes `<uid>/avatar.jpg` but uploadCover writes
 * `<uid>/cover/cover.jpg` (apps/mobile/src/lib/storage.ts). A non recursive
 * sweep would silently leave every cover photo behind.
 */
async function listRecursive(
  admin: ReturnType<typeof serviceRoleClient>,
  bucket: string,
  prefix: string,
  failures: string[],
  depth = 0,
): Promise<string[]> {
  if (depth > 4) return [];

  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) {
    failures.push(`${bucket}/${prefix}: ${error.message}`);
    return [];
  }
  if (!data) return [];

  const paths: string[] = [];
  for (const entry of data) {
    const full = `${prefix}/${entry.name}`;
    // Supabase marks a real object with an id; a synthesised folder row has none.
    if (entry.id) {
      paths.push(full);
    } else {
      paths.push(...(await listRecursive(admin, bucket, full, failures, depth + 1)));
    }
  }
  return paths;
}

/**
 * Paths that do NOT sit under `<bucket>/<user_id>/`. Coach uploaded trainee
 * video lives at `clips/coach-videos/<coach_id>/<player_id>/<id>.mp4`
 * (coach-trainee-video-upload-url), so for a PLAYER deleting their account the
 * bytes are filed under somebody else's id. Collected BEFORE the RPC runs,
 * because the RPC deletes the rows that name them.
 */
async function collectOffPrefixPaths(
  admin: ReturnType<typeof serviceRoleClient>,
  userId: string,
): Promise<string[]> {
  const paths: string[] = [];

  const { data: traineeVideos } = await admin
    .from("coach_trainee_videos")
    .select("storage_path")
    .eq("player_id", userId);

  for (const row of traineeVideos ?? []) {
    const path = (row as { storage_path: string | null }).storage_path;
    if (path) paths.push(path);
  }

  const { data: clips } = await admin
    .from("clips")
    .select("storage_path, thumb_path")
    .eq("owner_id", userId);

  for (const row of clips ?? []) {
    const clip = row as { storage_path: string | null; thumb_path: string | null };
    if (clip.storage_path) paths.push(clip.storage_path);
    if (clip.thumb_path) paths.push(clip.thumb_path);
  }

  return paths;
}

async function removeUserStorage(
  admin: ReturnType<typeof serviceRoleClient>,
  userId: string,
  offPrefixClipPaths: string[],
): Promise<{ removed: number; failures: string[] }> {
  let removed = 0;
  const failures: string[] = [];

  for (const bucket of USER_PREFIX_BUCKETS) {
    const paths = await listRecursive(admin, bucket, userId, failures);
    if (bucket === "clips") {
      for (const path of offPrefixClipPaths) {
        if (!paths.includes(path)) paths.push(path);
      }
    }
    if (paths.length === 0) continue;

    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) {
      failures.push(`${bucket}: ${removeError.message}`);
      continue;
    }
    removed += paths.length;
  }

  return { removed, failures };
}

Deno.serve((req) =>
  withErrorHandling(req, async (req) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
      throw new AppError("VALIDATION", "Use POST.", 405);
    }

    const callerClient = userScopedClient(req);

    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired session.", 401);
    }
    const userId = authData.user.id;

    const admin = serviceRoleClient();

    // Read the off prefix storage paths while the rows that name them still
    // exist. Nothing is deleted yet, so a refusal below leaves no residue.
    const offPrefixClipPaths = await collectOffPrefixPaths(admin, userId);

    // ---------------------------------------------------------------
    // The deletion itself. Caller's own JWT, never the service role, so
    // auth.uid() inside delete_my_account() is the real caller.
    // ---------------------------------------------------------------
    const { data: receipt, error: rpcError } = await callerClient.rpc("delete_my_account");

    if (rpcError) {
      throw appErrorFromPostgrestMessage(rpcError.message);
    }

    // Leg (b): the stored bytes. Runs before the GoTrue release so a storage
    // failure is still reported against a live, findable account id.
    const storage = await removeUserStorage(admin, userId, offPrefixClipPaths);

    // Leg (a): release the identifiers and ban the GoTrue user. Releasing the
    // email and phone is what lets the same person register a fresh account
    // later; the ban is what stops the old credentials from working in the
    // meantime. Both are needed, neither alone is enough.
    const releasedEmail = `deleted+${userId}@accounts.atlitos.invalid`;

    const { error: releaseError } = await admin.auth.admin.updateUserById(userId, {
      email: releasedEmail,
      phone: "",
      user_metadata: {},
      ban_duration: DELETED_BAN_DURATION,
    });

    if (!releaseError) {
      await admin.rpc("account_deletion_mark_auth_released", { p_user_id: userId });
    }

    return jsonResponse({
      status: (receipt as { status?: string } | null)?.status ?? "deleted",
      receipt,
      auth_released: !releaseError,
      auth_error: releaseError?.message ?? null,
      storage_objects_removed: storage.removed,
      storage_failures: storage.failures,
    });
  })
);
