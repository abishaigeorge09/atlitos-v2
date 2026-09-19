// ATLITOS v2 — supabase/functions/_shared/sentry.ts
//
// One shared error-reporting helper for every edge function, so a caught
// error in a money-critical function reaches the same Sentry project
// (`edge-functions`, docs/OBSERVABILITY.md) that the portals and mobile
// report into, instead of only existing as a `console.error` line nobody
// reads until something is already broken.
//
// Deliberately dependency-free: a hand-rolled envelope POST rather than an
// npm/deno Sentry SDK, because a Deno edge function's cold start budget is
// small and the only thing needed here is "send one event and move on",
// never tracing, breadcrumbs or session replay.
//
// This never sits in front of the function's own control flow: every call
// site here is inside an existing `catch` block, called AFTER the ledger or
// transition logic has already decided its own response. A missing or
// misconfigured SENTRY_DSN secret makes this a silent no-op, never a thrown
// error, so a reporting failure can never turn into a payment failure.

interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId || !url.host) return null;
    return { publicKey, host: url.host, projectId };
  } catch {
    return null;
  }
}

/**
 * Posts one error event to Sentry as a minimal envelope. Fire and forget:
 * callers should not (and do not need to) await this for correctness, only
 * to make sure it fires before the function's response returns in a
 * short-lived Deno isolate.
 */
export async function captureEdgeError(
  err: unknown,
  context: { fn: string; [key: string]: unknown },
): Promise<void> {
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) return; // Not yet configured for this project; no-op, not fatal.

  const parsed = parseDsn(dsn);
  if (!parsed) {
    console.error("captureEdgeError: SENTRY_DSN is set but not a valid DSN URL.");
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();

  const envelopeHeader = JSON.stringify({ event_id: eventId, sent_at: now, dsn });
  const itemHeader = JSON.stringify({ type: "event" });
  const event = JSON.stringify({
    event_id: eventId,
    timestamp: Math.floor(Date.now() / 1000),
    platform: "other",
    level: "error",
    environment: Deno.env.get("SENTRY_ENV") ?? "production",
    server_name: context.fn,
    message: { formatted: `${context.fn}: ${message}` },
    exception: stack
      ? { values: [{ type: err instanceof Error ? err.name : "Error", value: message, stacktrace: { frames: parseStack(stack) } }] }
      : undefined,
    tags: { fn: context.fn },
    extra: context,
  });

  const body = `${envelopeHeader}\n${itemHeader}\n${event}\n`;

  try {
    const res = await fetch(`https://${parsed.host}/api/${parsed.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=atlitos-edge/1.0, sentry_key=${parsed.publicKey}`,
      },
      body,
    });
    if (!res.ok) {
      console.error(`captureEdgeError: Sentry ingest returned ${res.status} for ${context.fn}.`);
    }
  } catch (sendErr) {
    // Never let a reporting failure surface as a function failure.
    console.error("captureEdgeError: failed to reach Sentry ingest:", sendErr);
  }
}

/** Turns a JS stack string into the frame shape Sentry's event schema expects. */
function parseStack(stack: string): Array<{ function: string }> {
  return stack
    .split("\n")
    .slice(1)
    .map((line) => ({ function: line.trim() }));
}
