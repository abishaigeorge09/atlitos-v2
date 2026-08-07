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
//   2. DEVICE push, via the Expo Push API (Phase 4 Track D, launch plan
//      decision 7). `deliverToDevice()`'s single-token seam from P9 is
//      replaced by a batched call to `exp.host/--/api/v2/push/send`: it
//      resolves the user's push_tokens, honors BOTH notification-prefs
//      stores (decision 8), builds one Expo push message per token, and
//      posts them in <=100-message chunks. A token the provider reports
//      `DeviceNotRegistered` for is pruned from push_tokens (service role).
//      Transport failure (network error, malformed response, an individual
//      ticket error) never throws into the in-app leg: the notifications row
//      from leg 1 is already committed by the time leg 2 runs, and this
//      function's callers (RPCs, edge functions placing an order/booking/
//      chat message) must not fail their own operation because a push
//      provider hiccuped.
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

export type DeviceDeliveryStatus = "sent" | "failed" | "pruned";

export interface DeviceDeliveryResult {
  token: string;
  platform: "ios" | "android";
  status: DeviceDeliveryStatus;
  /** Present when `status` is `"failed"` or `"pruned"`, the Expo ticket/
   * receipt error code or message, for observability. */
  detail?: string;
}

export interface DispatchResult {
  notificationId: string;
  userId: string;
  /** How the device-push leg resolved. `pushSuppressed` when EITHER
   * notification-prefs store opted this type out (decision 8); otherwise one
   * entry per device token this user has registered. */
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
// Dual notification-prefs reconciliation (launch plan decision 8).
//
// Two stores exist and are reconciled here, at the delivery leg, rather than
// migrated into one: the per-type `notification_prefs` table (0002, full
// owner CRUD, the `/notifications/preferences` screen) and the coarser
// `users.notification_prefs` jsonb category map (0087, the Settings
// surface). A `NotificationType` maps to at most one 0087 category; an
// unmapped type is governed by the 0002 table alone. Push is suppressed when
// EITHER store opts the user out. Consolidating into a single store is
// recorded fast-follow debt (docs/DEBT.md), not built this phase.
// ---------------------------------------------------------------------------

/** The 0087 jsonb shape, `packages/api/src/hooks.ts` `MeRow.notificationPrefs`. */
type Notification0087Category = "sessions" | "messages" | "promotions";

const TYPE_TO_0087_CATEGORY: Partial<Record<NotificationType, Notification0087Category>> = {
  booking: "sessions",
  chat: "messages",
  // order, clip_moderation, donation, verification, transfer, support: no
  // 0087 category maps to these; they are governed by the 0002 table alone.
};

interface Users0087PrefsRow {
  notification_prefs: Partial<Record<Notification0087Category, boolean>> | null;
}

interface Prefs0002Row {
  push_enabled: boolean;
}

/**
 * Resolves whether push is enabled for this user+type across both prefs
 * stores. Absent a 0002 row the column default is push-enabled; absent a
 * 0087 category mapping (or a missing/malformed jsonb key) the category is
 * treated as enabled, matching the 0087 migration's own column default
 * (`{"sessions": true, "messages": true, "promotions": false}`). A read
 * failure on either store degrades to "enabled" for that store (never
 * silently drops a delivery leg 1 already committed), matching the prior
 * stub's fail-open behavior.
 */
async function resolvePushEnabled(
  service: SupabaseClient,
  userId: string,
  type: NotificationType,
): Promise<boolean> {
  const { data: pref, error: prefError } = await service
    .from("notification_prefs")
    .select("push_enabled")
    .eq("user_id", userId)
    .eq("notification_type", type)
    .maybeSingle<Prefs0002Row>();
  if (prefError) {
    console.error(
      `[notify-dispatch] 0002 prefs read failed for user ${userId}, defaulting that store to enabled:`,
      prefError.message,
    );
  }
  const table0002Enabled = pref ? pref.push_enabled : true;

  const category = TYPE_TO_0087_CATEGORY[type];
  let category0087Enabled = true;
  if (category) {
    const { data: userRow, error: userError } = await service
      .from("users")
      .select("notification_prefs")
      .eq("id", userId)
      .maybeSingle<Users0087PrefsRow>();
    if (userError) {
      console.error(
        `[notify-dispatch] 0087 prefs read failed for user ${userId}, defaulting that store to enabled:`,
        userError.message,
      );
    } else {
      const raw = userRow?.notification_prefs?.[category];
      category0087Enabled = raw !== false; // absent/undefined => default enabled
    }
  }

  return table0002Enabled && category0087Enabled;
}

// ---------------------------------------------------------------------------
// Device-push transport: Expo Push API.
// ---------------------------------------------------------------------------

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH_SIZE = 100;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { deepLink: string; type: NotificationType };
}

interface ExpoPushTicketOk {
  status: "ok";
  id: string;
}

interface ExpoPushTicketError {
  status: "error";
  message: string;
  details?: { error?: string };
}

type ExpoPushTicket = ExpoPushTicketOk | ExpoPushTicketError;

function buildExpoMessage(token: string, input: NotificationInput): ExpoPushMessage {
  return {
    to: token,
    title: input.title,
    body: input.body,
    data: { deepLink: input.deepLink, type: input.type },
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Posts one batch (<=100) of Expo push messages and returns one ticket per
 * message, in the same order. Never throws: a network failure or a
 * malformed response is mapped to an `"error"` ticket per message in the
 * batch, so the caller can still report a per-token result instead of
 * aborting the whole dispatch.
 */
async function sendExpoPushBatch(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Expo push API responded ${response.status}: ${text.slice(0, 300)}`);
    }

    const json = (await response.json()) as { data?: ExpoPushTicket[]; errors?: unknown[] };
    const tickets = json.data ?? [];
    if (tickets.length !== messages.length) {
      throw new Error(
        `Expo push API returned ${tickets.length} tickets for ${messages.length} messages.`,
      );
    }
    return tickets;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notify-dispatch] Expo push batch failed:", message);
    return messages.map(() => ({ status: "error", message } as ExpoPushTicketError));
  }
}

/**
 * Delivers one notification to every one of a user's registered devices via
 * the Expo Push API, batching in groups of <=100. A `DeviceNotRegistered`
 * ticket error prunes that token from `push_tokens` under the service role
 * (the provider is telling us the install no longer exists), so a stale
 * token stops being tried on every future dispatch. Any other per-ticket
 * error is reported but the token is left in place (transient provider/
 * network issues should not silently unregister a live device).
 */
async function deliverToDevices(
  service: SupabaseClient,
  tokens: PushTokenRow[],
  input: NotificationInput,
): Promise<DeviceDeliveryResult[]> {
  if (tokens.length === 0) return [];

  const results: DeviceDeliveryResult[] = [];
  for (const batch of chunk(tokens, EXPO_BATCH_SIZE)) {
    const messages = batch.map((t) => buildExpoMessage(t.token, input));
    const tickets = await sendExpoPushBatch(messages);

    for (let i = 0; i < batch.length; i++) {
      const t = batch[i];
      const ticket = tickets[i];
      if (ticket.status === "ok") {
        results.push({ token: t.token, platform: t.platform, status: "sent" });
        continue;
      }

      const errorCode = ticket.details?.error;
      if (errorCode === "DeviceNotRegistered") {
        const { error: deleteError } = await service
          .from("push_tokens")
          .delete()
          .eq("token", t.token);
        if (deleteError) {
          console.error(
            `[notify-dispatch] failed to prune DeviceNotRegistered token for user ${input.userId}:`,
            deleteError.message,
          );
        }
        results.push({
          token: t.token,
          platform: t.platform,
          status: "pruned",
          detail: errorCode,
        });
      } else {
        results.push({
          token: t.token,
          platform: t.platform,
          status: "failed",
          detail: ticket.message,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

interface PushTokenRow {
  token: string;
  platform: "ios" | "android";
}

/**
 * Writes the notifications row (in-app delivery) and attempts the device-push
 * leg over the Expo Push API. `service` MUST be a service-role client: the
 * notifications table has no authenticated INSERT grant, and running under
 * service role is what keeps a client from writing a notification for
 * someone else.
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

  // Leg 2: device push. Honor BOTH prefs stores first (decision 8: either
  // opt-out suppresses).
  const pushEnabled = await resolvePushEnabled(service, input.userId, input.type);
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

  const deviceDeliveries = await deliverToDevices(service, tokens ?? [], input);

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
