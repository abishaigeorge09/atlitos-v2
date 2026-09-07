// ATLITOS v2 — SEC domain (cross-cutting security regressions). Catalog:
// docs/qa/test-catalog.json, IDs SEC-01..SEC-07.
//
// Surface: backend/SQL + edge functions. Gated to athlete-web the same way
// the other social-partition specs are, so the lane runs exactly once rather
// than five times over the five Playwright projects.
//
// These are ADVERSARIAL cases: each one drives a real signed-in client at an
// edge function the way an attacker would, not the way the app does. A case
// here passing means the server refused; it must never pass because the
// fixture was missing (CLAUDE.md's third RLS incident: an isolation assertion
// written against the wrong rows passes for the wrong reason). Every case
// below therefore asserts its two parties are actually distinct users before
// it trusts a refusal.

import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { serviceClient } from "../helpers/sql.mjs";
import { anonKey, EMAIL, signInAs } from "./support/rls.mjs";
import { createClient } from "@supabase/supabase-js";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "athlete-web", "SEC domain runs once, on athlete-web");
});

/** supabase-js hands an edge-function non-2xx back as a FunctionsHttpError
 * whose body is unread. Same unwrap packages/api's mapEdgeFunctionError does,
 * so a case can assert on the server's real `{ error: { code } }` contract
 * rather than on a generic transport message. */
async function edgeError(error) {
  const status = error?.context?.status ?? null;
  let code = null;
  try {
    const body = await error.context.json();
    code = body?.error?.code ?? null;
  } catch {
    // Non-JSON body (a gateway error, say). Status alone still discriminates.
  }
  return { status, code };
}

/** A published clip owned by SOMEBODY ELSE, with its private-bucket object
 * path. Readable by any caller through clips_select_published (0042); the
 * explicit status filter is CLAUDE.md's scoping rule, not a lean on RLS.
 * `notOwnerId` is excluded in the query AND re-asserted by the caller. */
async function someoneElsesClip(client, notOwnerId) {
  const { data, error } = await client
    .from("clips")
    .select("id, owner_id, storage_path")
    .eq("status", "published")
    .neq("owner_id", notOwnerId)
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("[SEC] no published clip owned by another user exists in the test project; seed one first.");
  }
  return data[0];
}

/** Mint an upload ticket for the caller's OWN new clip and land placeholder
 * bytes on it, so stream-webhook's objectExists gate is satisfied and the
 * case exercises the thumb_path branch rather than dying at the 409 before
 * it. Placeholder bytes are this repo's established fixture convention
 * (clutch.spec.ts CL-10). */
async function ownUploadedClip(client) {
  const { data: ticket, error } = await client.functions.invoke("stream-upload-url", {
    body: { caption: `e2e SEC ${randomUUID().slice(0, 8)}`, sport: "football" },
  });
  if (error) throw error;

  const bytes = new Blob([Buffer.from("ATLITOS E2E SEC PLACEHOLDER MP4 BYTES")], { type: "video/mp4" });
  const { error: uploadError } = await client.storage
    .from(ticket.bucket)
    .uploadToSignedUrl(ticket.path, ticket.token, bytes, { contentType: "video/mp4" });
  if (uploadError) throw uploadError;

  return ticket;
}

async function cleanupClip(clipId, objectPath) {
  const svc = serviceClient();
  await svc.storage.from("clips").remove([objectPath]).catch(() => {});
  await svc.from("clips").delete().eq("id", clipId);
}

test.describe("SEC — cross-cutting security regressions", () => {
  test("SEC-01 stream-webhook refuses a thumb_path outside the caller's own upload folder", async () => {
    const attacker = await signInAs(EMAIL.coach1);
    const victimClip = await someoneElsesClip(attacker.client, attacker.userId);

    // The assertion this whole case rests on. Without it a fixture that
    // happened to return the attacker's OWN clip would make the refusal
    // below meaningless (CLAUDE.md, incident 3).
    expect(victimClip.owner_id).not.toBe(attacker.userId);
    expect(victimClip.storage_path).toBeTruthy();

    const ticket = await ownUploadedClip(attacker.client);

    try {
      // The attack: finalize MY clip, but point its thumbnail at YOUR object
      // in the private clips bucket. Both signed-URL mints hand thumb_path
      // straight to storage under the service role, so an accepted write here
      // is an arbitrary read of any object in that bucket.
      const { data, error } = await attacker.client.functions.invoke("stream-webhook", {
        body: { clip_id: ticket.clipId, thumb_path: victimClip.storage_path },
      });

      expect(data, "cross-owner thumb_path must not be accepted").toBeNull();
      expect(await edgeError(error)).toMatchObject({ status: 403, code: "FORBIDDEN" });

      // Refused at the API is not enough: the column must be untouched, since
      // that column is what the mints read on every later call.
      const { data: row } = await attacker.client
        .from("clips")
        .select("thumb_path")
        .eq("id", ticket.clipId)
        .single();
      expect(row.thumb_path).toBeNull();

      // Traversal out of the own-folder prefix is refused the same way.
      const traversal = `${attacker.userId}/../${victimClip.storage_path}`;
      const { error: traversalError } = await attacker.client.functions.invoke("stream-webhook", {
        body: { clip_id: ticket.clipId, thumb_path: traversal },
      });
      expect(await edgeError(traversalError)).toMatchObject({ status: 403, code: "FORBIDDEN" });
    } finally {
      await cleanupClip(ticket.clipId, ticket.path);
    }
  });

  test("SEC-02 get-clip-playback-url never mints a thumbUrl for another owner's object", async () => {
    const attacker = await signInAs(EMAIL.coach1);
    const victimClip = await someoneElsesClip(attacker.client, attacker.userId);
    expect(victimClip.owner_id).not.toBe(attacker.userId);

    const ticket = await ownUploadedClip(attacker.client);

    try {
      // Plant the cross-owner path (refused by SEC-01's guard), then finalize
      // legitimately, then ask for playback on the attacker's OWN clip, which
      // the owner branch always grants. If the guard ever regresses, this is
      // where the victim's private video becomes a live signed URL.
      await attacker.client.functions.invoke("stream-webhook", {
        body: { clip_id: ticket.clipId, thumb_path: victimClip.storage_path },
      });
      await attacker.client.functions.invoke("stream-webhook", { body: { clip_id: ticket.clipId } });

      const { data: playback, error } = await attacker.client.functions.invoke("get-clip-playback-url", {
        body: { clip_id: ticket.clipId },
      });
      expect(error).toBeNull();
      expect(playback.thumbUrl, "no signed URL may be minted for another owner's object").toBeNull();

      // And the video URL that IS minted belongs to the attacker's own folder,
      // never the victim's, so the case cannot pass on a null thumb alone.
      expect(playback.url).toContain(`${attacker.userId}/`);
      expect(playback.url).not.toContain(victimClip.storage_path);
    } finally {
      await cleanupClip(ticket.clipId, ticket.path);
    }
  });
});

// ============================================================================
// SEC-03 / SEC-04 — coach trainee video storage-path injection (SEC-F3)
// ============================================================================

test.describe("SEC — coach trainee video path boundary (SEC-F3)", () => {
  test("SEC-03 a coach cannot insert a trainee video row with a chosen storage_path or a non-trainee", async () => {
    const coach = await signInAs(EMAIL.coach1);
    const victim = await someoneElsesClip(coach.client, coach.userId);
    expect(victim.owner_id).not.toBe(coach.userId);

    // (a) storage_path must be null on a client insert. Before 0089 this
    // succeeded and the chosen path was later handed to a service-role signed
    // URL mint, which is the whole exploit.
    const { data: withPath, error: pathError } = await coach.client
      .from("coach_trainee_videos")
      .insert({
        coach_id: coach.userId,
        player_id: coach.userId,
        storage_path: victim.storage_path,
        caption: "e2e SEC-03 path injection",
      })
      .select("id");

    expect(withPath ?? [], "a client-chosen storage_path must never be accepted").toHaveLength(0);
    expect(pathError, "insert with storage_path should be refused by RLS").toBeTruthy();

    // (b) player_id must name a real trainee. Pick a signed-in user who is
    // demonstrably NOT one of coach1's athletes, and prove that first, so the
    // refusal below cannot pass because the fixture was wrong.
    const stranger = await signInAs(EMAIL.partner);
    expect(stranger.userId).not.toBe(coach.userId);

    const { count: linkCount } = await coach.client
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("coach_id", coach.userId)
      .eq("player_id", stranger.userId);
    expect(linkCount ?? 0, "fixture: partner@ must not already be coach1's trainee").toBe(0);

    const { data: withStranger, error: strangerError } = await coach.client
      .from("coach_trainee_videos")
      .insert({
        coach_id: coach.userId,
        player_id: stranger.userId,
        caption: "e2e SEC-03 relationship injection",
      })
      .select("id");

    expect(withStranger ?? [], "video may not be attached to a non-trainee").toHaveLength(0);
    expect(strangerError, "insert for a non-trainee should be refused by RLS").toBeTruthy();
  });

  test("SEC-04 the signed URL mint refuses a trainee video row whose path escapes its own prefix", async () => {
    const coach = await signInAs(EMAIL.coach1);
    const victim = await someoneElsesClip(coach.client, coach.userId);
    expect(victim.owner_id).not.toBe(coach.userId);

    // Rows written BEFORE 0089 are still in the table with whatever path their
    // author chose; a policy change does not retract them. Seed exactly such a
    // row through the service role (bypassing the new policy on purpose, the
    // way a pre-existing row bypasses it by simply already existing) and prove
    // the READ half refuses it independently.
    const svc = serviceClient();
    const { data: seeded, error: seedError } = await svc
      .from("coach_trainee_videos")
      .insert({
        coach_id: coach.userId,
        player_id: coach.userId,
        storage_path: victim.storage_path,
        caption: "e2e SEC-04 pre-existing poisoned row",
      })
      .select("id")
      .single();
    if (seedError) throw seedError;

    try {
      const { data, error } = await coach.client.functions.invoke("get-coach-trainee-video-url", {
        body: { video_id: seeded.id },
      });
      expect(data, "a poisoned path must not mint a signed URL").toBeNull();
      expect(await edgeError(error)).toMatchObject({ status: 403 });
    } finally {
      await svc.from("coach_trainee_videos").delete().eq("id", seeded.id);
    }
  });
});

// ============================================================================
// SEC-05 — captured payments with unfinished downstream work (SEC-F2)
// ============================================================================

test.describe("SEC — payment finalization recovery (SEC-F2)", () => {
  test("SEC-05 a captured intent with no finalized_at is surfaced as backlog, and no live intent is stranded", async () => {
    const svc = serviceClient();

    // Part 1, the detector works. Seed a captured intent whose downstream work
    // never completed, exactly the state a mid-finalization crash leaves, and
    // prove payment_finalization_backlog() names it. A grace of 0 so the
    // freshly seeded row is in scope.
    const player = await signInAs(EMAIL.player);
    const { data: seeded, error: seedError } = await svc
      .from("payment_intents")
      .insert({
        user_id: player.userId,
        domain: "court",
        amount: 1,
        razorpay_order_id: `e2e_sec05_${randomUUID()}`,
        status: "captured",
        finalized_at: null,
      })
      .select("id")
      .single();
    if (seedError) throw seedError;

    try {
      const { data: backlog, error: backlogError } = await svc.rpc("payment_finalization_backlog", {
        p_grace: "00:00:00",
      });
      if (backlogError) throw backlogError;

      const ids = (backlog ?? []).map((r) => r.payment_intent_id);
      expect(ids, "a captured intent with null finalized_at must appear in the backlog").toContain(
        seeded.id,
      );
      const row = (backlog ?? []).find((r) => r.payment_intent_id === seeded.id);
      expect(row.has_ledger_group, "seeded intent has no ledger group").toBe(false);
    } finally {
      await svc.from("payment_intents").delete().eq("id", seeded.id);
    }

    // Part 2, the standing integrity assertion. Every REAL captured intent in a
    // domain that owes a ledger group at capture time must have one. This is the
    // condition SEC-F2 could silently break, and it is the check that would have
    // caught it in production. Sessions are excluded on purpose: PAYMENTS.md puts
    // the session accrual at completion, not capture, so a captured session
    // legitimately has no ledger group.
    const { data: captured, error: capturedError } = await svc
      .from("payment_intents")
      .select("id, domain, entity_id, finalized_at, created_at")
      .eq("status", "captured")
      .in("domain", ["court", "commerce", "donation", "membership"]);
    if (capturedError) throw capturedError;

    const stranded = [];
    for (const intent of captured ?? []) {
      const { count } = await svc
        .from("ledger_entries")
        .select("id", { count: "exact", head: true })
        .eq("payment_intent_id", intent.id);
      if ((count ?? 0) === 0) stranded.push(`${intent.domain}:${intent.id}`);
    }

    expect(
      stranded,
      "captured charges with no ledger group: money moved and nobody was credited",
    ).toEqual([]);
  });
});

// ============================================================================
// SEC-06 — suspension is an enforcement control, not a label (SEC-F4)
// ============================================================================

test.describe("SEC — suspended user enforcement (SEC-F4)", () => {
  test("SEC-06 suspending blocks the APIs and direct writes, reinstating restores them, both audited", async () => {
    const svc = serviceClient();
    const admin = await signInAs(EMAIL.admin);

    // A throwaway account, NOT one of the shared demo personas. Suspending
    // coach1@ or player@ would break every other spec running against this
    // project, and a security test that sabotages the fixture set is worse than
    // no test.
    const email = `e2e-sec06-${randomUUID().slice(0, 8)}@atlitos.dev`;
    const password = `Sec06!${randomUUID().slice(0, 12)}`;
    const { data: created, error: createError } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;
    const subjectId = created.user.id;

    const subjectClient = createClient(process.env.SUPABASE_URL ?? "", anonKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
      await svc.from("users").upsert({ id: subjectId, name: "SEC-06 subject", status: "active" });

      const signIn = await subjectClient.auth.signInWithPassword({ email, password });
      expect(signIn.error, "fixture: the throwaway account must sign in while active").toBeNull();

      // Baseline: an active account reaches a protected edge function. It is
      // refused for a business reason (no clip of its own), NOT for account
      // status, which is the distinction the suspension assertion rests on.
      const before = await subjectClient.functions.invoke("stream-upload-url", {
        body: { caption: "sec06 baseline", sport: "football" },
      });
      expect((await edgeError(before.error)).code).not.toBe("ACCOUNT_SUSPENDED");

      // Suspend, through the RPC an operator would use.
      const { error: suspendError } = await admin.client.rpc("admin_suspend_user", {
        p_user_id: subjectId,
        p_reason: "e2e SEC-06 suspension",
      });
      expect(suspendError).toBeNull();

      // 1. The edge layer refuses on the SAME token, with no refresh. This is
      //    the immediacy the token hook alone cannot provide.
      const after = await subjectClient.functions.invoke("stream-upload-url", {
        body: { caption: "sec06 after suspension", sport: "football" },
      });
      expect(after.data).toBeNull();
      expect(await edgeError(after.error)).toMatchObject({ status: 403, code: "ACCOUNT_SUSPENDED" });

      // 2. The RLS layer refuses a direct PostgREST write that no edge function
      //    guards.
      const { error: writeError } = await subjectClient
        .from("addresses")
        .insert({ user_id: subjectId, line1: "1 Test Road", city: "Hyderabad", state: "TS", pincode: "500001" });
      expect(writeError, "a suspended user must not create rows directly").toBeTruthy();

      // 3. Exactly one audit row, and it names the actor and the reason.
      const { data: suspendAudit } = await svc
        .from("audit_log")
        .select("actor_id, action, note, before, after")
        .eq("entity_id", subjectId)
        .eq("action", "user.suspend");
      expect(suspendAudit ?? []).toHaveLength(1);
      expect(suspendAudit[0].actor_id).toBe(admin.userId);
      expect(suspendAudit[0].note).toBe("e2e SEC-06 suspension");
      expect(suspendAudit[0].after).toMatchObject({ status: "suspended" });

      // 4. Idempotent: a second suspend writes no second audit row.
      await admin.client.rpc("admin_suspend_user", {
        p_user_id: subjectId,
        p_reason: "e2e SEC-06 duplicate",
      });
      const { count: auditCount } = await svc
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("entity_id", subjectId)
        .eq("action", "user.suspend");
      expect(auditCount, "re-suspending an already-suspended user must not write a second audit row").toBe(1);

      // 5. Reinstate restores access on the same token.
      const { error: reinstateError } = await admin.client.rpc("admin_reinstate_user", {
        p_user_id: subjectId,
        p_reason: "e2e SEC-06 reinstate",
      });
      expect(reinstateError).toBeNull();

      const restored = await subjectClient.functions.invoke("stream-upload-url", {
        body: { caption: "sec06 restored", sport: "football" },
      });
      expect((await edgeError(restored.error)).code).not.toBe("ACCOUNT_SUSPENDED");

      const { data: reinstateAudit } = await svc
        .from("audit_log")
        .select("action, before, after")
        .eq("entity_id", subjectId)
        .eq("action", "user.reinstate");
      expect(reinstateAudit ?? []).toHaveLength(1);
      expect(reinstateAudit[0].before).toMatchObject({ status: "suspended" });
    } finally {
      await svc.from("audit_log").delete().eq("entity_id", subjectId);
      await svc.auth.admin.deleteUser(subjectId).catch(() => {});
    }
  });

  test("SEC-06b an admin cannot suspend their own account", async () => {
    const admin = await signInAs(EMAIL.admin);
    const { error } = await admin.client.rpc("admin_suspend_user", {
      p_user_id: admin.userId,
      p_reason: "e2e SEC-06b self suspend",
    });
    expect(error, "self-suspension locks the operator out of the tool that undoes it").toBeTruthy();
    expect(error.message).toContain("FORBIDDEN");
  });
});

// ============================================================================
// SEC-07 — audit rows cannot diverge from the mutation (SEC-F5)
// ============================================================================

test.describe("SEC — audit accuracy (SEC-F5)", () => {
  test("SEC-07 every order.advance audit row records the status the order actually came from", async () => {
    const svc = serviceClient();

    // The pre-0091 edge function derived `before.status` from a lookup keyed on
    // the TARGET status, whose fallback returned "in_transit" for anything it
    // did not recognise. A `placed -> cancelled` advance therefore recorded a
    // before-status of in_transit for an order that had never shipped. The
    // audit row now comes from inside order_transition, which reads the real
    // prior status under the row lock, so every row must agree with the
    // timeline the same transaction wrote.
    const { data: rows, error } = await svc
      .from("audit_log")
      .select("entity_id, before, after, created_at")
      .eq("action", "order.advance")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const mismatches = [];
    for (const row of rows ?? []) {
      const { data: timeline } = await svc
        .from("order_timeline")
        .select("status, created_at")
        .eq("order_id", row.entity_id)
        .order("created_at", { ascending: true });

      const sequence = (timeline ?? []).map((t) => t.status);
      const toStatus = row.after?.status;
      const claimedBefore = row.before?.status;
      const index = sequence.indexOf(toStatus);
      // The entry immediately before the advanced-to status in the order's own
      // timeline is the truth this audit row is claiming.
      const actualBefore = index > 0 ? sequence[index - 1] : null;
      if (actualBefore && claimedBefore !== actualBefore) {
        mismatches.push(`${row.entity_id}: audit says ${claimedBefore}, timeline says ${actualBefore}`);
      }
    }

    expect(mismatches, "audit before-status must match the order's own timeline").toEqual([]);
  });
});
