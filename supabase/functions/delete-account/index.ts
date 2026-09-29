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
import { AppleRequestError, appleConfigured, revokeAppleRefreshToken } from "../_shared/apple.ts";

// GoTrue has no "forever". 87600h is 10 years, the same literal
// admin-user-suspend uses for a suspension ban.
const DELETED_BAN_DURATION = "87600h";

// Buckets keyed `<bucket>/<user_id>/...` by the upload paths in 0006/0042 and
// the storage RLS policies. A prefix sweep covers these.
const USER_PREFIX_BUCKETS = ["avatars", "clips", "coach-certificates"] as const;

// Supabase's remove() takes a list; chunked so one huge account cannot build a
// request the storage API refuses.
const REMOVE_CHUNK = 100;

/**
 * What to remove, per bucket, planned BEFORE delete_my_account() runs because
 * that RPC deletes some of the rows that name the objects (clips, coach
 * certificates, trainee videos, venue photos).
 *
 * `prefixes` are folders listed recursively; `paths` are exact object names.
 * Every prefix is a key the caller owns: their user id, an application id
 * whose applicant_user_id is the caller, or a venue id whose partner_user_id
 * is the caller. Never an unscoped list.
 */
type StoragePlan = Map<string, { prefixes: Set<string>; paths: Set<string> }>;

function planFor(plan: StoragePlan, bucket: string) {
  let entry = plan.get(bucket);
  if (!entry) {
    entry = { prefixes: new Set(), paths: new Set() };
    plan.set(bucket, entry);
  }
  return entry;
}

/**
 * A path read from a row is only trusted when its first folder is a key the
 * caller owns. upa_evidence, venue_photos and coach_certificates carry a
 * client written storage_path, so without this a user could point a row at
 * someone else's object and have deletion remove it.
 */
function isOwnedPath(path: string, ownedKeys: Set<string>): boolean {
  const first = path.split("/")[0];
  return first !== "" && ownedKeys.has(first) && !path.includes("..");
}

/**
 * upa_applications.photo_url and gratitude_posts.photo_url hold either a bare
 * object path or the full public URL portal-life stores verbatim
 * (`.../storage/v1/object/public/<bucket>/<path>`). Returns the object path in
 * `bucket`, or null for anything else (fixture URLs on other hosts included).
 */
function objectPathFromPhotoValue(value: string | null, bucket: string): string | null {
  if (!value) return null;
  if (!/^https?:\/\//.test(value)) return value.replace(/^\/+/, "");
  const marker = `/public/${bucket}/`;
  const at = value.indexOf(marker);
  if (at === -1 || !value.includes("/storage/v1/")) return null;
  const rest = value.slice(at + marker.length).split("?")[0];
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/**
 * Lists a prefix RECURSIVELY. A flat `list()` returns a nested directory as a
 * single zero-byte folder entry, not the files inside it, and `avatars` really
 * does nest: uploadAvatar writes `<uid>/avatar.jpg` but uploadCover writes
 * `<uid>/cover/cover.jpg` (apps/mobile/src/lib/storage.ts). A non recursive
 * sweep would silently leave every cover photo behind.
 *
 * Returns null when the bucket does not exist, so a project without one of
 * these buckets is a no-op rather than a failure.
 */
async function listRecursive(
  admin: ReturnType<typeof serviceRoleClient>,
  bucket: string,
  prefix: string,
  failures: string[],
  depth = 0,
): Promise<string[] | null> {
  if (depth > 4) return [];

  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) {
    if (/bucket not found/i.test(error.message)) return null;
    // Bucket and message only. The prefix is an id of the deleting user.
    failures.push(`${bucket}: list ${error.message}`);
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
      paths.push(...((await listRecursive(admin, bucket, full, failures, depth + 1)) ?? []));
    }
  }
  return paths;
}

/**
 * Builds the storage plan while every row that names an object still exists.
 * Nothing is deleted here, so a refused deletion leaves no residue.
 *
 *   avatars, clips, coach-certificates   `<user_id>/...`
 *   clips (off prefix)                   coach_trainee_videos.storage_path for
 *                                        the user as PLAYER
 *                                        (`coach-videos/<coach>/<player>/...`,
 *                                        server written, 0125), and the user's
 *                                        own clips rows
 *   coach-certificates                   coach_certificates.storage_path
 *   upa-photos                           `<user_id>/...` (insert policy, 0049)
 *                                        and `<application_id>/...` (the
 *                                        legacy privileged scheme, 0116), plus
 *                                        upa_applications.photo_url
 *   upa-evidence                         `<application_id>/...` (0049), plus
 *                                        upa_evidence.storage_path
 *   gratitude-photos                     `<user_id>/...` (0049), plus
 *                                        gratitude_posts.photo_url on the
 *                                        user's applications
 *   venue-media                          `<venue_id>/...` for venues the user
 *                                        is partner on (0014), plus
 *                                        venue_photos.storage_path
 */
async function planUserStorage(
  admin: ReturnType<typeof serviceRoleClient>,
  userId: string,
): Promise<StoragePlan> {
  const plan: StoragePlan = new Map();

  for (const bucket of USER_PREFIX_BUCKETS) {
    planFor(plan, bucket).prefixes.add(userId);
  }

  // Off prefix clips paths, exactly as before 0142.
  const { data: traineeVideos } = await admin
    .from("coach_trainee_videos")
    .select("storage_path")
    .eq("player_id", userId);

  for (const row of traineeVideos ?? []) {
    const path = (row as { storage_path: string | null }).storage_path;
    if (path) planFor(plan, "clips").paths.add(path);
  }

  const { data: clips } = await admin
    .from("clips")
    .select("storage_path, thumb_path")
    .eq("owner_id", userId);

  for (const row of clips ?? []) {
    const clip = row as { storage_path: string | null; thumb_path: string | null };
    if (clip.storage_path) planFor(plan, "clips").paths.add(clip.storage_path);
    if (clip.thumb_path) planFor(plan, "clips").paths.add(clip.thumb_path);
  }

  // Coach certificates, the verification documents. Rows are deleted by the RPC.
  const userKeys = new Set([userId]);
  const { data: certificates } = await admin
    .from("coach_certificates")
    .select("storage_path")
    .eq("coach_id", userId);

  for (const row of certificates ?? []) {
    const path = (row as { storage_path: string | null }).storage_path;
    if (path && isOwnedPath(path, userKeys)) planFor(plan, "coach-certificates").paths.add(path);
  }

  // Atlitos Life. Applications are scoped by applicant_user_id, and every
  // derived path must sit under the user id or one of these application ids.
  const { data: applications } = await admin
    .from("upa_applications")
    .select("id, photo_url")
    .eq("applicant_user_id", userId);

  const appRows = (applications ?? []) as { id: string; photo_url: string | null }[];
  const appIds = appRows.map((row) => row.id);
  const upaKeys = new Set([userId, ...appIds]);

  planFor(plan, "upa-photos").prefixes.add(userId);
  planFor(plan, "gratitude-photos").prefixes.add(userId);
  for (const appId of appIds) {
    planFor(plan, "upa-photos").prefixes.add(appId);
    planFor(plan, "upa-evidence").prefixes.add(appId);
  }
  for (const row of appRows) {
    const path = objectPathFromPhotoValue(row.photo_url, "upa-photos");
    if (path && isOwnedPath(path, upaKeys)) planFor(plan, "upa-photos").paths.add(path);
  }

  if (appIds.length > 0) {
    const { data: evidence } = await admin
      .from("upa_evidence")
      .select("storage_path")
      .in("application_id", appIds);

    for (const row of evidence ?? []) {
      const path = (row as { storage_path: string | null }).storage_path;
      if (path && isOwnedPath(path, upaKeys)) planFor(plan, "upa-evidence").paths.add(path);
    }

    const { data: gratitude } = await admin
      .from("gratitude_posts")
      .select("photo_url")
      .in("upa_id", appIds);

    for (const row of gratitude ?? []) {
      const path = objectPathFromPhotoValue((row as { photo_url: string | null }).photo_url, "gratitude-photos");
      if (path && isOwnedPath(path, upaKeys)) planFor(plan, "gratitude-photos").paths.add(path);
    }
  }

  // Venue media, scoped by partner_user_id. venue_photos rows are deleted by
  // the RPC (0142), so their paths are read now.
  const { data: venues } = await admin
    .from("venues")
    .select("id")
    .eq("partner_user_id", userId);

  const venueIds = ((venues ?? []) as { id: string }[]).map((row) => row.id);
  if (venueIds.length > 0) {
    const venueKeys = new Set(venueIds);
    for (const venueId of venueIds) planFor(plan, "venue-media").prefixes.add(venueId);

    const { data: photos } = await admin
      .from("venue_photos")
      .select("storage_path")
      .in("venue_id", venueIds);

    for (const row of photos ?? []) {
      const path = (row as { storage_path: string | null }).storage_path;
      if (path && isOwnedPath(path, venueKeys)) planFor(plan, "venue-media").paths.add(path);
    }
  }

  return plan;
}

async function removeUserStorage(
  admin: ReturnType<typeof serviceRoleClient>,
  userId: string,
  plan: StoragePlan,
): Promise<{ removed: number; failures: string[] }> {
  let removed = 0;
  const failures: string[] = [];
  const counts: Record<string, number> = {};

  for (const [bucket, { prefixes, paths: exact }] of plan) {
    const paths = new Set(exact);
    let bucketMissing = false;
    for (const prefix of prefixes) {
      const listed = await listRecursive(admin, bucket, prefix, failures);
      if (listed === null) {
        bucketMissing = true;
        break;
      }
      for (const path of listed) paths.add(path);
    }
    if (bucketMissing || paths.size === 0) {
      counts[bucket] = 0;
      continue;
    }

    const all = [...paths];
    let bucketRemoved = 0;
    for (let i = 0; i < all.length; i += REMOVE_CHUNK) {
      const chunk = all.slice(i, i + REMOVE_CHUNK);
      const { data, error: removeError } = await admin.storage.from(bucket).remove(chunk);
      if (removeError) {
        if (/bucket not found/i.test(removeError.message)) break;
        failures.push(`${bucket}: remove ${removeError.message}`);
        continue;
      }
      // remove() reports the objects it actually deleted; an exact path that
      // no longer exists is simply absent from the result.
      bucketRemoved += Array.isArray(data) ? data.length : chunk.length;
    }
    counts[bucket] = bucketRemoved;
    removed += bucketRemoved;
  }

  // Counts only, never object names.
  console.log(`delete-account: storage removed for ${userId}: ${JSON.stringify(counts)}`);
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

    // Plan the storage sweep while the rows that name the objects still
    // exist. Nothing is deleted yet, so a refusal below leaves no residue.
    const storagePlan = await planUserStorage(admin, userId);

    // The stored Sign in with Apple refresh token (0139), read now and revoked
    // only after the RPC succeeds, so a refused deletion leaves the Apple
    // link intact.
    const { data: appleToken } = await admin
      .from("apple_sign_in_tokens")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle<{ refresh_token: string }>();

    // ---------------------------------------------------------------
    // The deletion itself. Caller's own JWT, never the service role, so
    // auth.uid() inside delete_my_account() is the real caller.
    // ---------------------------------------------------------------
    const { data: receipt, error: rpcError } = await callerClient.rpc("delete_my_account");

    if (rpcError) {
      throw appErrorFromPostgrestMessage(rpcError.message);
    }

    // Leg (c): Sign in with Apple revocation (Guideline 5.1.1(v), 0139). After
    // this, Settings, Apple ID, Sign in with Apple on the person's devices no
    // longer lists Atlitos. A 400 invalid_grant means the token was already
    // dead (removed by the person, or expired), which counts as done, so the
    // row goes either way. Any other failure is logged (status and Apple's
    // short error code only, never the token) and never fatal: the account is
    // already deleted, and the row is kept so the revoke can be retried.
    let appleRevoked: boolean | null = null;
    let appleError: string | null = null;
    if (appleToken?.refresh_token) {
      try {
        if (!appleConfigured()) {
          throw new Error("APPLE_NOT_CONFIGURED");
        }
        await revokeAppleRefreshToken(appleToken.refresh_token);
        appleRevoked = true;
        const { error: tokenDeleteError } = await admin.from("apple_sign_in_tokens").delete().eq("user_id", userId);
        if (tokenDeleteError) {
          console.error(`delete-account: Apple token row not removed for ${userId}: ${tokenDeleteError.code ?? "error"}`);
        }
      } catch (err) {
        appleRevoked = false;
        appleError =
          err instanceof AppleRequestError
            ? `APPLE_REVOKE_FAILED ${err.status}${err.appleError ? ` ${err.appleError}` : ""}`
            : err instanceof Error && err.message === "APPLE_NOT_CONFIGURED"
              ? "APPLE_NOT_CONFIGURED"
              : "APPLE_REVOKE_FAILED";
        console.error(`delete-account: Apple revoke did not complete for ${userId}: ${appleError}`);
      }
    }

    // Leg (b): the stored bytes. Runs before the GoTrue release so a storage
    // failure is still reported against a live, findable account id.
    const storage = await removeUserStorage(admin, userId, storagePlan);

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
      apple_revoked: appleRevoked,
      apple_error: appleError,
    });
  })
);
