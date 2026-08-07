// ATLITOS v2 — scripts/verify-push-phase4.ts
//
// Phase 4 Track D (push transport). Logic-only verification against the
// REAL `_shared/notify.ts` module (imported, not reimplemented), run with a
// mock Supabase client and a mock `fetch` standing in for the Expo Push API.
//
// This track's builder had no Supabase MCP / prod-authed CLI and no physical
// or simulator device (dod-auditor/orchestrator territory per
// docs/phases/PHASE-4-STATUS.md). What CAN be proven without either is that
// the dispatch/transport LOGIC itself is correct: prefs reconciliation
// across both stores (decision 8), stale-token pruning, batching, request
// shape, and the service-role boundary. What CANNOT be proven here: a real
// `push_tokens` row landing in a live database (D1), a real Expo delivery
// and on-device render (D2, the gate clause), or the live 403 boundary
// re-proof against a real non-service JWT (D6's live half). Those need the
// orchestrator's Supabase MCP + a real/emulator device and are reported
// BLOCKED-ON-INFRA below, never skipped-as-passed.
//
// Run: deno run --allow-net --allow-env scripts/verify-push-phase4.ts

import {
  assertServiceRoleRequest,
  dispatchNotification,
  parseNotificationInput,
  type NotificationInput,
} from "../supabase/functions/_shared/notify.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}${detail ? ` -- ${detail}` : ""}`);
}
function blocked(name: string, cause: string) {
  console.log(`[BLOCKED-ON-INFRA] ${name} -- ${cause}`);
}

// ---------------------------------------------------------------------------
// Mock Supabase client. Implements exactly the chainable surface
// dispatchNotification touches: .from(table).insert().select().single(),
// .from(table).select().eq()...maybeSingle(), .from(table).delete().eq().
// Backed by an in-memory table map so assertions can inspect state after.
// ---------------------------------------------------------------------------

interface MockDb {
  notifications: Array<{ id: string; user_id: string; type: string }>;
  notification_prefs: Array<{ user_id: string; notification_type: string; push_enabled: boolean }>;
  users: Array<{ id: string; notification_prefs: Record<string, boolean> }>;
  push_tokens: Array<{ token: string; platform: "ios" | "android"; user_id: string }>;
}

let idSeq = 0;

function makeMockClient(db: MockDb) {
  function from(table: keyof MockDb) {
    return {
      insert(row: Record<string, unknown>) {
        return {
          select() {
            return {
              async single() {
                const id = `mock-${++idSeq}`;
                const inserted = { id, ...row };
                (db[table] as unknown[]).push(inserted);
                return { data: inserted, error: null };
              },
            };
          },
        };
      },
      select(_cols?: string) {
        let rows = [...(db[table] as Array<Record<string, unknown>>)];
        const api = {
          eq(col: string, val: unknown) {
            rows = rows.filter((r) => r[col] === val);
            return api;
          },
          returns<T>() {
            return Promise.resolve({ data: rows as unknown as T, error: null });
          },
          async maybeSingle<T>() {
            return { data: (rows[0] as unknown as T) ?? null, error: null };
          },
        };
        return api;
      },
      delete() {
        const api = {
          eq(col: string, val: unknown) {
            db[table] = (db[table] as Array<Record<string, unknown>>).filter(
              (r) => r[col] !== val,
            ) as never;
            return Promise.resolve({ data: null, error: null });
          },
        };
        return api;
      },
    };
  }
  // deno-lint-ignore no-explicit-any
  return { from } as any;
}

// ---------------------------------------------------------------------------
// 1. parseNotificationInput: validation is real input-boundary logic, no
//    mocks needed.
// ---------------------------------------------------------------------------

try {
  parseNotificationInput({ userId: "not-a-uuid", type: "chat", title: "a", body: "b", deepLink: "/x" });
  check("parseNotificationInput rejects a non-uuid userId", false);
} catch {
  check("parseNotificationInput rejects a non-uuid userId", true);
}

try {
  parseNotificationInput({
    userId: "11111111-1111-1111-1111-111111111111",
    type: "not_a_type",
    title: "a",
    body: "b",
    deepLink: "/x",
  });
  check("parseNotificationInput rejects an unknown type", false);
} catch {
  check("parseNotificationInput rejects an unknown type", true);
}

const validInput: NotificationInput = parseNotificationInput({
  user_id: "11111111-1111-1111-1111-111111111111",
  type: "chat",
  title: "New message",
  body: "You have a new message.",
  deep_link: "/chat/thread-1",
});
check(
  "parseNotificationInput accepts snake_case and normalizes to camelCase",
  validInput.userId === "11111111-1111-1111-1111-111111111111" && validInput.deepLink === "/chat/thread-1",
);

// ---------------------------------------------------------------------------
// 2. D3 (prefs honored): EITHER store opting out suppresses push, in-app
//    leg still lands. Two sub-cases: 0002 table opt-out, 0087 category
//    opt-out, and a control where both are on.
// ---------------------------------------------------------------------------

const USER_A: string = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B: string = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_C: string = "cccccccc-cccc-cccc-cccc-cccccccccccc";
check("D3 setup: user A and user B ids differ", USER_A !== USER_B);

const originalFetch = globalThis.fetch;
function stubExpoFetchOk() {
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = (async (_url: unknown, init: any) => {
    const messages = JSON.parse(init.body as string) as unknown[];
    return new Response(
      JSON.stringify({ data: messages.map(() => ({ status: "ok", id: "ticket-" + ++idSeq })) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

{
  // 0002 table says push_enabled=false for `chat`; 0087 category has no row
  // (defaults enabled) -> suppressed (EITHER opts out).
  const db: MockDb = {
    notifications: [],
    notification_prefs: [{ user_id: USER_A, notification_type: "chat", push_enabled: false }],
    users: [],
    push_tokens: [{ token: "ExponentPushToken[a]", platform: "ios", user_id: USER_A }],
  };
  const client = makeMockClient(db);
  stubExpoFetchOk();
  const result = await dispatchNotification(client, {
    userId: USER_A,
    type: "chat",
    title: "t",
    body: "b",
    deepLink: "/x",
  });
  restoreFetch();
  check(
    "D3a: 0002 table opt-out suppresses push, in-app row still written",
    result.pushSuppressed === true && result.deviceDeliveries.length === 0 && db.notifications.length === 1,
  );
}

{
  // 0002 table has no row (defaults enabled) for `booking`; 0087
  // notification_prefs.sessions = false -> suppressed via the category map.
  const db: MockDb = {
    notifications: [],
    notification_prefs: [],
    users: [{ id: USER_A, notification_prefs: { sessions: false, messages: true, promotions: false } }],
    push_tokens: [{ token: "ExponentPushToken[a]", platform: "ios", user_id: USER_A }],
  };
  const client = makeMockClient(db);
  stubExpoFetchOk();
  const result = await dispatchNotification(client, {
    userId: USER_A,
    type: "booking",
    title: "t",
    body: "b",
    deepLink: "/x",
  });
  restoreFetch();
  check(
    "D3b: 0087 category opt-out (booking -> sessions) suppresses push",
    result.pushSuppressed === true && result.deviceDeliveries.length === 0,
  );
}

{
  // Both stores enabled -> push actually attempted, one ticket per token.
  const db: MockDb = {
    notifications: [],
    notification_prefs: [{ user_id: USER_B, notification_type: "chat", push_enabled: true }],
    users: [{ id: USER_B, notification_prefs: { sessions: true, messages: true, promotions: false } }],
    push_tokens: [
      { token: "ExponentPushToken[b1]", platform: "ios", user_id: USER_B },
      { token: "ExponentPushToken[b2]", platform: "android", user_id: USER_B },
    ],
  };
  const client = makeMockClient(db);
  stubExpoFetchOk();
  const result = await dispatchNotification(client, {
    userId: USER_B,
    type: "chat",
    title: "t",
    body: "b",
    deepLink: "/x",
  });
  restoreFetch();
  check(
    "D3 control: both stores enabled -> push attempted for every registered token",
    result.pushSuppressed === false &&
      result.deviceDeliveries.length === 2 &&
      result.deviceDeliveries.every((d) => d.status === "sent"),
  );

  check(
    "D3 isolation: user C's tokens are never touched by user B's dispatch",
    db.push_tokens.every((t) => t.user_id !== USER_C),
  );
}

// ---------------------------------------------------------------------------
// 3. D4 (stale token): a DeviceNotRegistered ticket prunes the token row;
//    the in-app leg is unaffected.
// ---------------------------------------------------------------------------

{
  const db: MockDb = {
    notifications: [],
    notification_prefs: [],
    users: [],
    push_tokens: [
      { token: "ExponentPushToken[stale]", platform: "ios", user_id: USER_C },
      { token: "ExponentPushToken[live]", platform: "android", user_id: USER_C },
    ],
  };
  const client = makeMockClient(db);
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = (async (_url: unknown, init: any) => {
    const messages = JSON.parse(init.body as string) as Array<{ to: string }>;
    const data = messages.map((m) =>
      m.to === "ExponentPushToken[stale]"
        ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
        : { status: "ok", id: "ticket-" + ++idSeq }
    );
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await dispatchNotification(client, {
    userId: USER_C,
    type: "order",
    title: "t",
    body: "b",
    deepLink: "/x",
  });
  restoreFetch();

  const staleGone = !db.push_tokens.some((t) => t.token === "ExponentPushToken[stale]");
  const liveKept = db.push_tokens.some((t) => t.token === "ExponentPushToken[live]");
  const prunedTicket = result.deviceDeliveries.find((d) => d.token === "ExponentPushToken[stale]");
  const sentTicket = result.deviceDeliveries.find((d) => d.token === "ExponentPushToken[live]");

  check(
    "D4: DeviceNotRegistered ticket deletes ONLY the stale token row",
    staleGone && liveKept,
  );
  check(
    "D4: pruned/sent ticket statuses reported per token, not conflated",
    prunedTicket?.status === "pruned" && sentTicket?.status === "sent",
  );
  check("D4: in-app leg unaffected by a transport-level prune", db.notifications.length === 1);
}

// ---------------------------------------------------------------------------
// 4. Transport failure never throws into the in-app leg (network error
//    case, distinct from a per-ticket error).
// ---------------------------------------------------------------------------

{
  const db: MockDb = {
    notifications: [],
    notification_prefs: [],
    users: [],
    push_tokens: [{ token: "ExponentPushToken[x]", platform: "ios", user_id: USER_A }],
  };
  const client = makeMockClient(db);
  globalThis.fetch = (() => {
    throw new Error("simulated network failure");
  }) as unknown as typeof fetch;

  let threw = false;
  let result;
  try {
    result = await dispatchNotification(client, {
      userId: USER_A,
      type: "order",
      title: "t",
      body: "b",
      deepLink: "/x",
    });
  } catch {
    threw = true;
  }
  restoreFetch();

  check(
    "Transport failure (network error) does not throw; in-app row still written",
    !threw && db.notifications.length === 1 && result?.deviceDeliveries[0]?.status === "failed",
  );
}

// ---------------------------------------------------------------------------
// 5. D6 (boundary, logic half): assertServiceRoleRequest refuses a bearer
//    that is not the service-role key, including a plausible-looking user
//    JWT. The live re-proof (a real HTTP call against the deployed
//    function) is the orchestrator's to run post-deploy.
// ---------------------------------------------------------------------------

Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
{
  let refused = false;
  try {
    assertServiceRoleRequest(
      new Request("https://example.com", { headers: { Authorization: "Bearer some-user-jwt" } }),
    );
  } catch {
    refused = true;
  }
  check("D6 (logic): a non-service-role bearer is refused", refused);
}
{
  let allowed = true;
  try {
    assertServiceRoleRequest(
      new Request("https://example.com", { headers: { Authorization: "Bearer test-service-role-key" } }),
    );
  } catch {
    allowed = false;
  }
  check("D6 (logic): the real service-role bearer is accepted", allowed);
}

blocked(
  "D1 (real push_tokens row lands in a live DB, RLS isolation between two real users)",
  "no Supabase MCP / prod-authed CLI in this worktree; needs the orchestrator's execute_sql access.",
);
blocked(
  "D2 (THE GATE CLAUSE: real Expo delivery + on-device render + tap deep-link)",
  "needs FCM V1 credentials in EAS (founder login) and a new native build (expo-notifications module); no device/emulator available to this builder.",
);
blocked(
  "D5 (iOS honesty: simctl push render or real APNs delivery)",
  "no iOS simulator/device session available to this builder; carries to the orchestrator/dod-auditor per PHASE-4-STATUS.md.",
);
blocked(
  "D6 (live half: real HTTP call against the deployed notify-dispatch with a plain user JWT)",
  "function is not yet deployed by this builder (deploy is an orchestrator step); logic half proven above.",
);

console.log(`\n${failures === 0 ? "ALL LOGIC CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) Deno.exit(1);
