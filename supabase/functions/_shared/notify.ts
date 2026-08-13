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
// SCALE-REALTIME R-6 and R-7, 2026-08-14. Two defects were fixed here.
//
//   R-6, wrong batch dimension. `deliverToDevices` chunked at Expo's real
//   limit of 100 messages per request, but its only caller handled ONE user,
//   so every request carried that user's 1 or 2 tokens and the batching was
//   dead code. `notify-dispatch` then looped recipients SEQUENTIALLY with a
//   ~250 ms Expo round trip inside the loop: a ceiling of about 4 pushes per
//   second, 0.7% of Expo's own 600/s allowance, so a group of 50 staggered
//   over 12 seconds, 240 recipients crossed a 60 s client timeout, and 10,000
//   took 42 minutes. The fix is `pushContentToUsers`: recipients are the
//   batch dimension, prefs and tokens are read in bulk, requests are paced
//   against 600/s and bounded to EXPO_MAX_IN_FLIGHT concurrent.
//
//   R-7, no SQL-written notification ever reached a device. 0103
//   (notify_session_parties) and 0104 (sweep_group_memberships) insert into
//   public.notifications directly, and nothing relayed those rows to this
//   file, whose only caller was finalize-court-booking-payment. The relay is
//   now `notify-push-sweep`, a pg_cron job that claims unpushed rows and
//   calls `pushContentToUsers`. That direction was chosen over a per-row
//   database webhook deliberately; the reasoning is in
//   0107_notification_push_delivery.sql.
//
// Both depend on 0107's `pushed_at`, `push_attempts` and `push_claimed_at`
// columns. This file must not be deployed ahead of that migration.
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
  // 0102: the coaching pair. 'session' is emitted in-database by
  // session_transition_internal (0103) on accept, decline, start and complete;
  // 'membership' by sweep_group_memberships (0104). Both are listed here so a
  // future edge-function caller of notify-dispatch can carry them too.
  "session",
  "membership",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
}

/**
 * One notification's CONTENT, without a recipient. R-6's fix turns on this
 * split: a group session's whole roster shares one `NotificationContent`, so
 * the fan-out batches across recipients (Expo's actual batch dimension)
 * instead of across one user's devices.
 */
export interface NotificationContent {
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
}

/** The grouping key for "these recipients get the identical notification". */
export function contentKey(content: NotificationContent): string {
  return [content.type, content.title, content.body, content.deepLink].join("\0");
}

export type DeviceDeliveryStatus = "sent" | "failed" | "pruned";

export interface DeviceDeliveryResult {
  /** Whose device this is. Carried explicitly because one Expo request now
   * mixes tokens from up to 100 different users. */
  userId: string;
  token: string;
  platform: "ios" | "android";
  status: DeviceDeliveryStatus;
  /** Present when `status` is `"failed"` or `"pruned"`, the Expo ticket/
   * receipt error code or message, for observability. */
  detail?: string;
}

/**
 * The per-user rollup of one fan-out. Every recipient appears in exactly one
 * of the four id lists, and only `failed` is retryable.
 */
export interface FanoutResult {
  requested: number;
  /** At least one device took the push. */
  delivered: string[];
  /** Either prefs store opted this user out of this type. */
  suppressed: string[];
  /** No live device token, including one whose only token was just pruned. */
  noDevice: string[];
  /** Every device errored transiently. Retry these, do not mark them pushed. */
  failed: string[];
  deviceDeliveries: DeviceDeliveryResult[];
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
  id: string;
  notification_prefs: Partial<Record<Notification0087Category, boolean>> | null;
}

interface Prefs0002Row {
  user_id: string;
  push_enabled: boolean;
}

/**
 * Resolves, for a whole recipient set at once, which users have push
 * SUPPRESSED for this type across both prefs stores. Returns the suppressed
 * subset, so an absent row on either side is enabled by omission.
 *
 * Absent a 0002 row the column default is push-enabled; absent a 0087
 * category mapping (or a missing/malformed jsonb key) the category is treated
 * as enabled, matching the 0087 migration's own column default
 * (`{"sessions": true, "messages": true, "promotions": false}`). A read
 * failure on either store degrades to "enabled" for that store (never
 * silently drops a delivery leg 1 already committed), matching the prior
 * stub's fail-open behavior.
 *
 * This is the bulk form of what used to be one pair of round trips PER
 * RECIPIENT (SCALE-REALTIME R-6). Recipients are chunked into `IN` lists of
 * `PG_IN_CHUNK` because PostgREST puts the list in the query string and a
 * 10,000-element `in.()` would blow the URL length limit.
 */
const PG_IN_CHUNK = 200;

async function resolvePushSuppressed(
  service: SupabaseClient,
  userIds: string[],
  type: NotificationType,
): Promise<Set<string>> {
  const suppressed = new Set<string>();
  if (userIds.length === 0) return suppressed;

  for (const batch of chunk(userIds, PG_IN_CHUNK)) {
    const { data: prefs, error: prefError } = await service
      .from("notification_prefs")
      .select("user_id, push_enabled")
      .eq("notification_type", type)
      .in("user_id", batch)
      .returns<Prefs0002Row[]>();
    if (prefError) {
      console.error(
        `[notify] 0002 prefs read failed for ${batch.length} users, defaulting that store to enabled:`,
        prefError.message,
      );
    } else {
      for (const row of prefs ?? []) {
        if (!row.push_enabled) suppressed.add(row.user_id);
      }
    }
  }

  const category = TYPE_TO_0087_CATEGORY[type];
  if (!category) return suppressed;

  for (const batch of chunk(userIds, PG_IN_CHUNK)) {
    const { data: userRows, error: userError } = await service
      .from("users")
      .select("id, notification_prefs")
      .in("id", batch)
      .returns<Users0087PrefsRow[]>();
    if (userError) {
      console.error(
        `[notify] 0087 prefs read failed for ${batch.length} users, defaulting that store to enabled:`,
        userError.message,
      );
      continue;
    }
    for (const row of userRows ?? []) {
      // absent/undefined => default enabled, only an explicit false suppresses
      if (row.notification_prefs?.[category] === false) suppressed.add(row.id);
    }
  }

  return suppressed;
}

// ---------------------------------------------------------------------------
// Device-push transport: Expo Push API.
// ---------------------------------------------------------------------------

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request (PUSH_TOO_MANY_NOTIFICATIONS
 * above that). This is the real batch dimension: 100 MESSAGES, which means 100
 * device tokens belonging to up to 100 different users, not 100 devices
 * belonging to one user. */
const EXPO_BATCH_SIZE = 100;
/** Expo's project-wide allowance is 600 notifications per second; exceeding it
 * returns TOO_MANY_REQUESTS. The pacer below spends from this budget, so the
 * fan-out runs as fast as the provider permits and no faster. */
const EXPO_MESSAGES_PER_SECOND = 600;
/** How many Expo requests may be in flight at once. Six 100-message requests
 * in flight is 600 messages of work outstanding, which is exactly one second
 * of the provider's allowance, so concurrency never runs ahead of the pacer. */
const EXPO_MAX_IN_FLIGHT = 6;

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

function buildExpoMessage(token: string, content: NotificationContent): ExpoPushMessage {
  return {
    to: token,
    title: content.title,
    body: content.body,
    data: { deepLink: content.deepLink, type: content.type },
  };
}

/**
 * Paces batch launches against Expo's 600-per-second project allowance. Each
 * batch reserves `messages / 600` seconds of the budget before it is allowed
 * to start, so a 10,000-message blast paces itself over ~17 seconds rather
 * than either crawling (the old sequential loop) or tripping
 * TOO_MANY_REQUESTS. One instance per fan-out call, deliberately: an edge
 * function invocation is the only scope in which we can observe our own rate,
 * and two concurrent invocations sharing a process would each get their own
 * pacer, which is why the sweeper below runs one claim at a time.
 */
function createPacer(messagesPerSecond: number) {
  let nextStartMs = 0;
  return async function reserve(messages: number): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, nextStartMs);
    nextStartMs = start + (messages / messagesPerSecond) * 1000;
    const wait = start - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving the
 * result order. Bounded so a large fan-out cannot open 100 sockets at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
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
 * Delivers ONE notification content to MANY devices, which may belong to many
 * different users, via the Expo Push API. Every 100 tokens become one request
 * regardless of whose devices they are, requests are paced against the 600/s
 * project allowance and run at most `EXPO_MAX_IN_FLIGHT` at a time.
 *
 * A `DeviceNotRegistered` ticket error prunes that token from `push_tokens`
 * under the service role (the provider is telling us the install no longer
 * exists), so a stale token stops being tried on every future dispatch. Any
 * other per-ticket error is reported but the token is left in place
 * (transient provider/network issues should not silently unregister a live
 * device). Prunes are collected and deleted in ONE statement per batch rather
 * than one per token, for the same reason the sends are batched.
 */
async function deliverToDevices(
  service: SupabaseClient,
  tokens: PushTokenRow[],
  content: NotificationContent,
): Promise<DeviceDeliveryResult[]> {
  if (tokens.length === 0) return [];

  const pace = createPacer(EXPO_MESSAGES_PER_SECOND);
  const batches = chunk(tokens, EXPO_BATCH_SIZE);

  const perBatch = await mapWithConcurrency(batches, EXPO_MAX_IN_FLIGHT, async (batch) => {
    await pace(batch.length);
    const tickets = await sendExpoPushBatch(batch.map((t) => buildExpoMessage(t.token, content)));

    const results: DeviceDeliveryResult[] = [];
    const toPrune: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const t = batch[i];
      const ticket = tickets[i];
      if (ticket.status === "ok") {
        results.push({ userId: t.user_id, token: t.token, platform: t.platform, status: "sent" });
        continue;
      }

      const errorCode = ticket.details?.error;
      if (errorCode === "DeviceNotRegistered") {
        toPrune.push(t.token);
        results.push({
          userId: t.user_id,
          token: t.token,
          platform: t.platform,
          status: "pruned",
          detail: errorCode,
        });
      } else {
        results.push({
          userId: t.user_id,
          token: t.token,
          platform: t.platform,
          status: "failed",
          detail: ticket.message,
        });
      }
    }

    if (toPrune.length > 0) {
      const { error: deleteError } = await service
        .from("push_tokens")
        .delete()
        .in("token", toPrune);
      if (deleteError) {
        console.error(
          `[notify] failed to prune ${toPrune.length} DeviceNotRegistered tokens:`,
          deleteError.message,
        );
      }
    }

    return results;
  });

  return perBatch.flat();
}

/**
 * Reads every registered device for a recipient set in bulk. One SELECT per
 * `PG_IN_CHUNK` users, not one per user.
 */
async function readPushTokens(
  service: SupabaseClient,
  userIds: string[],
): Promise<PushTokenRow[]> {
  const tokens: PushTokenRow[] = [];
  for (const batch of chunk(userIds, PG_IN_CHUNK)) {
    const { data, error } = await service
      .from("push_tokens")
      .select("user_id, token, platform")
      .in("user_id", batch)
      .returns<PushTokenRow[]>();
    if (error) {
      console.error(
        `[notify] push_tokens read failed for ${batch.length} users:`,
        error.message,
      );
      continue;
    }
    tokens.push(...(data ?? []));
  }
  return tokens;
}

/**
 * THE fan-out primitive: pushes one content to many users, in a fixed number
 * of database round trips plus ceil(tokens / 100) Expo requests.
 *
 * It does NOT write notifications rows. Two callers want different things:
 * `dispatchNotificationFanout` writes the rows first and then calls this, for
 * an edge-function caller creating brand new notifications; the
 * `notify-push-sweep` function calls this alone, because the rows it is
 * pushing were written in-database by 0103/0104 and already exist.
 *
 * The per-user rollup is what makes the sweeper resumable: `delivered`,
 * `suppressed` and `noDevice` are all terminal (there is nothing further to
 * attempt), while `failed` means every one of that user's devices came back
 * with a transport or provider error, so the caller must leave that row
 * unmarked and let the next sweep retry it.
 */
export async function pushContentToUsers(
  service: SupabaseClient,
  content: NotificationContent,
  userIds: string[],
): Promise<FanoutResult> {
  const recipients = [...new Set(userIds)];
  const empty: FanoutResult = {
    requested: recipients.length,
    delivered: [],
    suppressed: [],
    noDevice: [],
    failed: [],
    deviceDeliveries: [],
  };
  if (recipients.length === 0) return empty;

  const suppressedSet = await resolvePushSuppressed(service, recipients, content.type);
  const eligible = recipients.filter((id) => !suppressedSet.has(id));
  const suppressed = recipients.filter((id) => suppressedSet.has(id));
  if (eligible.length === 0) {
    return { ...empty, suppressed };
  }

  const tokens = await readPushTokens(service, eligible);
  const withDevice = new Set(tokens.map((t) => t.user_id));
  const noDevice = eligible.filter((id) => !withDevice.has(id));

  const deviceDeliveries = await deliverToDevices(service, tokens, content);

  const sentTo = new Set<string>();
  for (const result of deviceDeliveries) {
    if (result.status === "sent") sentTo.add(result.userId);
  }
  // A pruned token is terminal for that device, but if it was the user's only
  // device they have no live install, which is `noDevice`, not `failed`: a
  // retry cannot help. Only a transport/provider error is retryable.
  const retryable = new Set<string>();
  for (const result of deviceDeliveries) {
    if (result.status === "failed" && !sentTo.has(result.userId)) retryable.add(result.userId);
  }

  const delivered = [...withDevice].filter((id) => sentTo.has(id));
  const failed = [...retryable];
  const goneQuiet = [...withDevice].filter((id) => !sentTo.has(id) && !retryable.has(id));

  return {
    requested: recipients.length,
    delivered,
    suppressed,
    noDevice: [...noDevice, ...goneQuiet],
    failed,
    deviceDeliveries,
  };
}

/**
 * Writes one notifications row per recipient in a SINGLE insert, then pushes
 * the shared content to all of them in ceil(tokens / 100) Expo requests.
 *
 * This is the batch path R-6 asked for. A 10,000-recipient announcement is
 * one insert, a handful of prefs and token reads, and ~100 Expo requests
 * paced over ~17 seconds, rather than 10,000 sequential dispatches over 42
 * minutes.
 *
 * Recipients are de-duplicated: the same user twice in one fan-out of
 * identical content is one notification, not two.
 */
export async function dispatchNotificationFanout(
  service: SupabaseClient,
  content: NotificationContent,
  userIds: string[],
): Promise<{ notificationIdByUser: Map<string, string>; push: FanoutResult }> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) {
    return {
      notificationIdByUser: new Map(),
      push: {
        requested: 0,
        delivered: [],
        suppressed: [],
        noDevice: [],
        failed: [],
        deviceDeliveries: [],
      },
    };
  }

  // `push_claimed_at` is set at insert time so the notify-push-sweep job
  // (0108) cannot claim these rows out from under a push already in flight
  // here. This path owns the first attempt; the sweeper takes over only if
  // this one fails and the claim goes stale. 0107 adds the column.
  const claimedAt = new Date().toISOString();

  const notificationIdByUser = new Map<string, string>();
  for (const batch of chunk(recipients, PG_IN_CHUNK)) {
    const { data: rows, error: insertError } = await service
      .from("notifications")
      .insert(
        batch.map((userId) => ({
          user_id: userId,
          type: content.type,
          title: content.title,
          body: content.body,
          deep_link: content.deepLink,
          push_claimed_at: claimedAt,
          push_attempts: 1,
        })),
      )
      .select("id, user_id")
      .returns<{ id: string; user_id: string }[]>();

    if (insertError || !rows) {
      throw new AppError(
        "INTERNAL",
        `Failed to write ${batch.length} notifications: ${insertError?.message ?? "no rows returned"}.`,
        500,
      );
    }
    for (const row of rows) notificationIdByUser.set(row.user_id, row.id);
  }

  const push = await pushContentToUsers(service, content, recipients);

  // Checkpoint every recipient the push leg is finished with. `failed` is
  // deliberately left unmarked and still claimed: the sweeper picks it up
  // once the claim goes stale, which is what makes a partial provider outage
  // resumable instead of a silent drop.
  const settled = [...push.delivered, ...push.suppressed, ...push.noDevice]
    .map((userId) => notificationIdByUser.get(userId))
    .filter((id): id is string => !!id);
  await markNotificationsPushed(service, settled);

  return { notificationIdByUser, push };
}

/**
 * Stamps `pushed_at` on notifications whose push leg is finished, in one
 * statement per `PG_IN_CHUNK` ids. This is the sweeper's checkpoint and the
 * reason a re-run cannot double-send: a stamped row is never claimed again.
 */
export async function markNotificationsPushed(
  service: SupabaseClient,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  const pushedAt = new Date().toISOString();
  for (const batch of chunk(notificationIds, PG_IN_CHUNK)) {
    const { error } = await service
      .from("notifications")
      .update({ pushed_at: pushedAt })
      .in("id", batch);
    if (error) {
      // Not fatal: the row stays unpushed and the sweeper retries it. The
      // cost of that is a duplicate device push, which is far cheaper than a
      // notification that never arrives.
      console.error(
        `[notify] failed to checkpoint ${batch.length} notifications as pushed:`,
        error.message,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

interface PushTokenRow {
  user_id: string;
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
  const { notificationIdByUser, push } = await dispatchNotificationFanout(
    service,
    {
      type: input.type,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
    },
    [input.userId],
  );

  const notificationId = notificationIdByUser.get(input.userId);
  if (!notificationId) {
    throw new AppError(
      "INTERNAL",
      `Failed to write notification for user ${input.userId}.`,
      500,
    );
  }

  return {
    notificationId,
    userId: input.userId,
    pushSuppressed: push.suppressed.includes(input.userId),
    deviceDeliveries: push.deviceDeliveries,
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
