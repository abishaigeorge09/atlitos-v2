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
// Each dispatch writes the notifications row (in-app delivery, fully
// implemented) and attempts the device-push leg, which is STUBBED behind
// `deliverToDevice()` in _shared/notify.ts and carried to P9. See that file's
// header for the two-leg model and the TODO(P9) transport seam.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import {
  assertServiceRoleRequest,
  dispatchNotification,
  parseNotificationInput,
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

    const dispatched = [];
    for (const input of inputs) {
      dispatched.push(await dispatchNotification(service, input));
    }

    return jsonResponse({ dispatched }, 200);
  })
);
