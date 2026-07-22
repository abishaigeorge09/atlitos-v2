// ATLITOS v2 — supabase/functions/_shared/notify.ts
//
// AT-146. The notification fan-out orchestration, shared by the
// `notify-dispatch` edge function (its HTTP entry) and by any other edge
// function that would rather call the row write + delivery inline than pay an
// HTTP round trip. API-MAPPING.md `notify-dispatch`: "every RPC/edge function
// that writes a `notifications` row, fan-out to device push".
//
// One notification has two legs:
//
//   1. IN-APP delivery (fully implemented here). The `notifications` row IS
//      the in-app notification: the mobile surface reads the table
//      owner-scoped and subscribes to it over Realtime, so writing the row is
//      the delivery. This runs under the service role, which is the ONLY
//      writer of a notifications row (0002_notifications.sql grants no
//      authenticated INSERT), so a client can never forge a notification for
//      another user through this path.
//
//   2. DEVICE push, APNs/FCM (STUBBED, carried to P9). Real device delivery
//      needs native transport credentials (an APNs key / FCM server key) and
//      a real provider call, neither of which exists until the native ship
//      stage. `deliverToDevice()` below is the seam: it resolves the user's
//      push_tokens, honors notification_prefs, and hands each token to a
//      transport that today only logs. It does NOT pretend the push was
//      delivered. See the TODO(P9) inside it.
//
// SQL RPCs that already write a notifications row directly (moderate_clip in
// 0043, record_donation_from_draft in 0054, and the verification RPCs wired
// in 0066) get in-app delivery for free by that insert; they do not route
// through this function. This function is the path for callers that also want
// the device-push leg attempted, or that live in an edge function rather than
// in-database.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";

/** Kept in lockstep with public.notification_type (0002_notifications.sql)
 * and packages/types NOTIFICATION_TYPES. */
export const NOTIFICATION_TYPES = [
  "booking",
  "order",
  "chat",
  "clip_moderation",
  "donation",
  "verification",
  "transfer",
  "support",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
}

export interface DeviceDeliveryResult {
  token: string;
  platform: "ios" | "android";
  /** "stubbed" until the P9 transport lands; never "sent" today, so nothing
   * downstream can mistake the stub for a delivered push. */
  status: "stubbed";
}

export interface DispatchResult {
  notificationId: string;
  userId: string;
  /** How the device-push leg resolved. `pushSuppressed` when the user's
   * notification_prefs opted this type out; otherwise one entry per device
   * token, each currently `stubbed`. */
  pushSuppressed: boolean;
  deviceDeliveries: DeviceDeliveryResult[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("VALIDATION", `${field} must be a non-empty string.`, 400);
  }
  return value;
}

/** Validates and normalizes one untrusted notification payload. */
export function parseNotificationInput(raw: unknown): NotificationInput {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "notification must be a JSON object.", 400);
  }
  const record = raw as Record<string, unknown>;
  const userId = record.userId ?? record.user_id;
  const deepLink = record.deepLink ?? record.deep_link;

  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    throw new AppError("VALIDATION", "userId must be a valid uuid.", 400);
  }
  const type = record.type;
  if (typeof type !== "string" || !NOTIFICATION_TYPES.includes(type as NotificationType)) {
    throw new AppError(
      "VALIDATION",
      `type must be one of: ${NOTIFICATION_TYPES.join(", ")}.`,
      400,
    );
  }

  return {
    userId,
    type: type as NotificationType,
    title: requireNonEmpty(record.title, "title"),
    body: requireNonEmpty(record.body, "body"),
    deepLink: requireNonEmpty(deepLink, "deepLink"),
  };
}

// ---------------------------------------------------------------------------
// Device-push seam. STUB, carried to P9.
// ---------------------------------------------------------------------------

/**
 * TODO(P9): real device push. Replace this body with the APNs (iOS) / FCM
 * (Android) transport once native credentials exist (docs/phases/
 * PHASE-8-STATUS.md handoff: "Device push delivery through notify-dispatch's
 * stubbed seam"). It must:
 *   - build the platform-specific payload from `input`,
 *   - POST to APNs for `ios` tokens and FCM for `android` tokens,
 *   - prune tokens the provider reports as unregistered from push_tokens,
 *   - return a real per-token delivered/failed status.
 * Today it only logs and reports `stubbed`, so nothing treats a push as sent
 * when no push was actually sent.
 */
function deliverToDevice(
  token: string,
  platform: "ios" | "android",
  input: NotificationInput,
): DeviceDeliveryResult {
  console.log(
    `[notify-dispatch] devicePush STUB (P9): would deliver ${input.type} ` +
      `to ${platform} token ${token.slice(0, 8)}… for user ${input.userId}`,
  );
  return { token, platform, status: "stubbed" };
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

interface PrefRow {
  push_enabled: boolean;
}

interface PushTokenRow {
  token: string;
  platform: "ios" | "android";
}

/**
 * Writes the notifications row (in-app delivery) and attempts the device-push
 * leg (stubbed). `service` MUST be a service-role client: the notifications
 * table has no authenticated INSERT grant, and running under service role is
 * what keeps a client from writing a notification for someone else.
 */
export async function dispatchNotification(
  service: SupabaseClient,
  input: NotificationInput,
): Promise<DispatchResult> {
  // Leg 1: write the row. This is the in-app delivery.
  const { data: row, error: insertError } = await service
    .from("notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      deep_link: input.deepLink,
    })
    .select("id, user_id")
    .single<{ id: string; user_id: string }>();

  if (insertError || !row) {
    throw new AppError(
      "INTERNAL",
      `Failed to write notification for user ${input.userId}: ${insertError?.message ?? "no row returned"}.`,
      500,
    );
  }

  // Leg 2: device push (stubbed). Honor the user's per-type opt-out first.
  const { data: pref, error: prefError } = await service
    .from("notification_prefs")
    .select("push_enabled")
    .eq("user_id", input.userId)
    .eq("notification_type", input.type)
    .maybeSingle<PrefRow>();
  if (prefError) {
    // A prefs read failure must not swallow an already-written in-app
    // notification; log and treat as default-on rather than fail the dispatch.
    console.error(
      `[notify-dispatch] prefs read failed for user ${input.userId}, defaulting push on:`,
      prefError.message,
    );
  }

  // Absent a pref row the default is push-enabled (0002 column default).
  const pushEnabled = pref ? pref.push_enabled : true;
  if (!pushEnabled) {
    return {
      notificationId: row.id,
      userId: row.user_id,
      pushSuppressed: true,
      deviceDeliveries: [],
    };
  }

  const { data: tokens, error: tokenError } = await service
    .from("push_tokens")
    .select("token, platform")
    .eq("user_id", input.userId)
    .returns<PushTokenRow[]>();
  if (tokenError) {
    console.error(
      `[notify-dispatch] push_tokens read failed for user ${input.userId}:`,
      tokenError.message,
    );
  }

  const deviceDeliveries = (tokens ?? []).map((t) =>
    deliverToDevice(t.token, t.platform, input)
  );

  return {
    notificationId: row.id,
    userId: row.user_id,
    pushSuppressed: false,
    deviceDeliveries,
  };
}

/**
 * Guards the HTTP entry: only a caller holding the service-role key may
 * dispatch, because dispatch writes an arbitrary `user_id`. This is the
 * "clients don't forge notifications" boundary, CLAUDE.md financial-invariant
 * shape applied to notifications. Compares the bearer against the service-role
 * key an internal edge-function caller already carries in its env; a client
 * bearing only its own user JWT is rejected.
 */
export function assertServiceRoleRequest(req: Request): void {
  const header = req.headers.get("Authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || bearer !== serviceKey) {
    throw new AppError(
      "FORBIDDEN",
      "notify-dispatch is a service-role-only endpoint.",
      403,
    );
  }
}
