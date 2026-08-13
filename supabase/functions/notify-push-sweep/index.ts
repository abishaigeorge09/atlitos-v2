// ATLITOS v2 — supabase/functions/notify-push-sweep/index.ts
//
// SCALE-REALTIME R-7. The relay that makes an in-database notification reach
// a device.
//
// THE GAP IT CLOSES. `notifications` has two writers and only one of them
// ever pushed. Edge functions call `dispatchNotification` (one caller in the
// whole repo, finalize-court-booking-payment.ts:157) and get the device leg.
// SQL writes the row directly, which is what 0043 moderate_clip, 0054
// record_donation_from_draft, 0066 verification, 0103 notify_session_parties
// and 0104 sweep_group_memberships all do, and got nothing. So an athlete
// whose coach started a session learned nothing, and the 03:30 IST membership
// reminder, whose entire purpose is reaching someone who has not opened the
// app, reached nobody.
//
// WHY A SWEEPER AND NOT A DATABASE WEBHOOK. Both were considered; the full
// argument, including what a webhook would cost, is in the header of
// 0110_notification_push_delivery.sql. In one line: the sweeper is idempotent
// because `pushed_at` is a checkpoint, it survives a failed dispatch because
// an unmarked row is simply claimed again, and it batches across recipients
// for free because a group session's whole roster shares one title and body
// and therefore collapses into ONE Expo request. A per-row webhook is none of
// those things: it fires once, per row, with no record of failure, which
// re-creates R-6's one-request-per-recipient shape at the top of the funnel.
//
// SERVICE-ROLE ONLY, same boundary as notify-dispatch: this reads and pushes
// arbitrary users' notifications. The pg_cron job in 0111 calls it with the
// service-role key from the vault.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import {
  assertServiceRoleRequest,
  contentKey,
  markNotificationsPushed,
  pushContentToUsers,
  type NotificationContent,
  type NotificationType,
} from "../_shared/notify.ts";

/** How many unpushed rows one invocation claims. 500 rows is at most 500
 * device tokens, so at most 5 Expo requests when they share content and 500
 * when they do not, which the pacer spreads over a second either way. The job
 * runs every 30 seconds, so this sustains 1,000 pushes a minute of backlog
 * drain, against a derived steady state of 6,700 notifications a DAY. */
const DEFAULT_CLAIM_LIMIT = 500;

/** A notification older than this is checkpointed WITHOUT pushing. After a
 * long outage, waking someone at 04:00 with "your session started" from six
 * hours ago is worse than silence; the in-app row is still there. */
const MAX_PUSH_AGE_MS = 30 * 60 * 1000;

interface ClaimedRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  deep_link: string;
  created_at: string;
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    assertServiceRoleRequest(request);

    let limit = DEFAULT_CLAIM_LIMIT;
    try {
      const body = await request.json();
      if (body && typeof body === "object" && typeof (body as { limit?: unknown }).limit === "number") {
        limit = Math.max(1, Math.min(2000, Math.floor((body as { limit: number }).limit)));
      }
    } catch {
      // An empty body is the normal cron call. Defaults apply.
    }

    const service = serviceRoleClient();

    // Claiming is a single UPDATE ... FOR UPDATE SKIP LOCKED inside the RPC,
    // so two overlapping invocations can never claim the same row and a
    // crashed invocation's rows return on their own once the claim goes
    // stale. This is the whole idempotency story.
    const { data: claimed, error: claimError } = await service.rpc(
      "claim_notification_push_batch",
      { p_limit: limit },
    );

    if (claimError) {
      throw new AppError(
        "INTERNAL",
        `Failed to claim a notification push batch: ${claimError.message}.`,
        500,
      );
    }

    const rows = (claimed ?? []) as ClaimedRow[];
    if (rows.length === 0) {
      return jsonResponse(
        { claimed: 0, pushed: 0, suppressed: 0, noDevice: 0, retrying: 0, expired: 0 },
        200,
      );
    }

    // Rows too old to be worth pushing are checkpointed, never sent.
    const cutoff = Date.now() - MAX_PUSH_AGE_MS;
    const expired: string[] = [];
    const fresh: ClaimedRow[] = [];
    for (const row of rows) {
      if (Date.parse(row.created_at) < cutoff) expired.push(row.id);
      else fresh.push(row);
    }

    // Group by identical content. A group session transition writes one row
    // per roster member with the same title, body and deep link, so a group
    // of 50 becomes ONE Expo request rather than 50.
    const groups = new Map<string, { content: NotificationContent; rows: ClaimedRow[] }>();
    for (const row of fresh) {
      const content: NotificationContent = {
        type: row.type,
        title: row.title,
        body: row.body,
        deepLink: row.deep_link,
      };
      const key = contentKey(content);
      const group = groups.get(key);
      if (group) group.rows.push(row);
      else groups.set(key, { content, rows: [row] });
    }

    let pushed = 0;
    let suppressed = 0;
    let noDevice = 0;
    let retrying = 0;
    const settled: string[] = [...expired];

    for (const group of groups.values()) {
      const userIds = group.rows.map((r) => r.user_id);
      const result = await pushContentToUsers(service, group.content, userIds);

      pushed += result.delivered.length;
      suppressed += result.suppressed.length;
      noDevice += result.noDevice.length;
      retrying += result.failed.length;

      // Terminal for this row: delivered, opted out, or no live install.
      // `failed` is left unmarked and still claimed, so the next sweep past
      // the stale-claim window retries it. Nothing is dropped and nothing is
      // sent twice inside the window.
      const done = new Set([...result.delivered, ...result.suppressed, ...result.noDevice]);
      for (const row of group.rows) {
        if (done.has(row.user_id)) settled.push(row.id);
      }
    }

    await markNotificationsPushed(service, settled);

    return jsonResponse(
      {
        claimed: rows.length,
        pushed,
        suppressed,
        noDevice,
        retrying,
        expired: expired.length,
      },
      200,
    );
  })
);
