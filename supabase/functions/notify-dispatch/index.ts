// ATLITOS v2 — supabase/functions/notify-dispatch/index.ts
//
// AT-146. The notification fan-out edge function. API-MAPPING.md
// `notify-dispatch`: "every RPC/edge function that writes a `notifications`
// row, fan-out to device push".
//
// POST body, one of:
//   { userId, type, title, body, deepLink }                  // single
//   { notifications: [ { userId, type, ... }, ... ] }        // batch
// (snake_case user_id / deep_link accepted too.)
//
// SERVICE-ROLE ONLY. The caller must present the service-role key as its
// bearer, because a dispatch writes an arbitrary `user_id` and the whole
// point of the notifications table's grant model (no authenticated INSERT,
// 0002_notifications.sql) is that a client can never author a notification
// for another user. `assertServiceRoleRequest` is that boundary. The intended
// callers are other edge functions invoking this over `functions.invoke`
// under their own service-role client.
//
// Each dispatch writes the notifications row (in-app delivery) and attempts
// the device-push leg over the Expo Push API. See _shared/notify.ts for the
// two-leg model.
//
// SCALE-REALTIME R-6. This used to be
//
//     for (const input of inputs) {
//       dispatched.push(await dispatchNotification(service, input));
//     }
//
// one full dispatch per recipient, each with its own Expo round trip, which
// capped the whole batch endpoint at about 4 pushes per second. Identical
// content is now GROUPED (a group session's roster shares one title and body,
// so it is one fan-out), and each group goes out as one bulk insert plus
// ceil(tokens / 100) paced Expo requests. The response shape is unchanged:
// one DispatchResult per input, in input order.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import {
  assertServiceRoleRequest,
  contentKey,
  dispatchNotificationFanout,
  parseNotificationInput,
  type DispatchResult,
  type NotificationContent,
  type NotificationInput,
} from "../_shared/notify.ts";

function parseBatch(raw: unknown): unknown[] {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.notifications)) {
    if (record.notifications.length === 0) {
      throw new AppError("VALIDATION", "notifications array must not be empty.", 400);
    }
    return record.notifications;
  }
  // Single-notification shape.
  return [record];
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    // Boundary: service-role callers only. A client bearing its own user JWT
    // cannot dispatch a notification for anyone.
    assertServiceRoleRequest(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("VALIDATION", "Request body must be valid JSON.", 400);
    }

    const inputs = parseBatch(body).map(parseNotificationInput);
    const service = serviceRoleClient();

    // Group by identical content, preserving first-seen order so the response
    // stays deterministic.
    const groups = new Map<string, { content: NotificationContent; userIds: string[] }>();
    for (const input of inputs) {
      const content: NotificationContent = {
        type: input.type,
        title: input.title,
        body: input.body,
        deepLink: input.deepLink,
      };
      const key = contentKey(content);
      const group = groups.get(key);
      if (group) group.userIds.push(input.userId);
      else groups.set(key, { content, userIds: [input.userId] });
    }

    const resultByKey = new Map<
      string,
      { ids: Map<string, string>; suppressed: Set<string>; deliveries: DispatchResult["deviceDeliveries"] }
    >();
    for (const [key, group] of groups) {
      const { notificationIdByUser, push } = await dispatchNotificationFanout(
        service,
        group.content,
        group.userIds,
      );
      resultByKey.set(key, {
        ids: notificationIdByUser,
        suppressed: new Set(push.suppressed),
        deliveries: push.deviceDeliveries,
      });
    }

    const dispatched: DispatchResult[] = inputs.map((input: NotificationInput) => {
      const key = contentKey(input);
      const result = resultByKey.get(key);
      const notificationId = result?.ids.get(input.userId);
      if (!result || !notificationId) {
        throw new AppError(
          "INTERNAL",
          `Failed to write notification for user ${input.userId}.`,
          500,
        );
      }
      return {
        notificationId,
        userId: input.userId,
        pushSuppressed: result.suppressed.has(input.userId),
        // Only this user's devices, so the per-input shape is unchanged even
        // though the Expo request it rode in carried other users' tokens.
        deviceDeliveries: result.deliveries.filter((d) => d.userId === input.userId),
      };
    });

    return jsonResponse({ dispatched }, 200);
  })
);
