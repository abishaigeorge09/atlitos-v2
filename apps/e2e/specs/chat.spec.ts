// ATLITOS v2 — CH domain (chat + realtime messaging). Catalog:
// docs/qa/test-catalog.json, IDs CH-01..CH-13.
//
// Surface: athlete-web only (see auth.spec.ts header for the guard
// rationale; the same one applies here verbatim).

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "../fixtures";
import { anonKey, EMAIL, signInAs } from "./support/rls.mjs";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(HERE, "..", "state");
const REPO_ROOT = join(HERE, "..", "..", "..");

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "athlete-web", "CH domain targets athlete-web only");
});

/** Ensures a real coaching chat_threads row exists between player@ and
 * coach1@, via the exact real-product path (session_links_pair backs the
 * INSERT policy's WITH CHECK, so there is no other way in): reuse an
 * existing session if any, else book one for real through book-session, then
 * open (or reuse) the thread through the same insert use-chat.ts's
 * openCoachingThread performs. Adapted from scripts/verify-realtime.mjs
 * (ensureSessionBetween/ensureThread), trimmed to just what these specs need. */
async function ensureCoachingThread(player, coach) {
  const { data: exists, error: existsError } = await player.client.rpc("session_exists_between", {
    p_user_a: player.userId,
    p_user_b: coach.userId,
  });
  if (existsError) throw existsError;

  let sessionId;
  if (exists) {
    const { data: rows, error } = await player.client
      .from("sessions")
      .select("id")
      .eq("player_id", player.userId)
      .eq("coach_id", coach.userId)
      .limit(1);
    if (error) throw error;
    sessionId = rows[0].id;
  } else {
    const { data: sessionType, error: stError } = await coach.client
      .from("session_types")
      .select("id, price")
      .eq("coach_id", coach.userId)
      .limit(1)
      .single();
    if (stError) throw stError;

    const { data: busy, error: busyError } = await player.client.rpc("get_coach_busy_slots", {
      p_coach_id: coach.userId,
      p_from: new Date().toISOString().split("T")[0],
      p_to: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
    });
    if (busyError) throw busyError;
    const busySet = new Set((busy ?? []).map((row) => `${row.date}|${row.slot_start.slice(0, 5)}`));

    let date = null;
    for (let i = 1; i <= 7 && !date; i++) {
      const candidate = new Date(Date.now() + i * 86400000).toISOString().split("T")[0];
      if (!busySet.has(`${candidate}|11:00`)) date = candidate;
    }
    if (!date) throw new Error("[CH] no free slot found for coach1 in the next 7 days");

    const { data, error } = await player.client.functions.invoke("book-session", {
      body: {
        session_type_id: sessionType.id,
        frequency: "one_time",
        date,
        slot_start: "11:00",
        focus_area: "e2e CH fixture",
        location: "N/A",
        expected_total: Number(sessionType.price),
      },
    });
    if (error) throw new Error(`[CH] book-session failed: ${error.message ?? JSON.stringify(error)}`);
    sessionId = data.session_id;
  }

  const participantA = player.userId < coach.userId ? player.userId : coach.userId;
  const participantB = player.userId < coach.userId ? coach.userId : player.userId;
  const { data: existingThread, error: threadReadError } = await player.client
    .from("chat_threads")
    .select("id")
    .eq("participant_a", participantA)
    .eq("participant_b", participantB)
    .eq("context_type", "coaching")
    .eq("context_id", sessionId)
    .maybeSingle();
  if (threadReadError) throw threadReadError;
  if (existingThread) return existingThread.id;

  const { data: created, error: createError } = await player.client
    .from("chat_threads")
    .insert({ participant_a: participantA, participant_b: participantB, context_type: "coaching", context_id: sessionId })
    .select("id")
    .single();
  if (createError) throw createError;
  return created.id;
}

test.describe("CH — chat + realtime messaging", () => {
  test("CH-01 two-context realtime: player sends, coach1 receives live, no duplicate on reconcile @realtime", async ({
    browser,
    seed,
  }) => {
    await seed.resetCoachingFixtures();
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    const threadId = await ensureCoachingThread(player, coach1);

    const playerContext = await browser.newContext({ storageState: join(STATE_DIR, "player.json") });
    const coach1Context = await browser.newContext({ storageState: join(STATE_DIR, "coach1.json") });
    try {
      const playerPage = await playerContext.newPage();
      const coach1Page = await coach1Context.newPage();

      await playerPage.goto(`/chat/${threadId}`);
      await coach1Page.goto(`/chat/${threadId}`);
      await expect(playerPage.getByLabel("Message input")).toBeVisible({ timeout: 15_000 });
      await expect(coach1Page.getByLabel("Message input")).toBeVisible({ timeout: 15_000 });

      const text = `e2e CH-01 ${Date.now()}`;
      await playerPage.getByLabel("Message input").fill(text);
      await playerPage.getByRole("button", { name: "Send message" }).click();

      // Optimistic append on the sender side: near-immediate, no network
      // round trip required for player to see their own text.
      await expect(playerPage.getByText(text)).toBeVisible({ timeout: 5000 });

      // Receiver sees it arrive over Realtime (postgres_changes INSERT),
      // not a manual reload. Hard timeout, per the harness contract.
      await expect
        .poll(async () => (await coach1Page.getByText(text).count()) > 0, {
          timeout: 15_000,
          message: "coach1 never received player's message over Realtime",
        })
        .toBe(true);

      // No duplicate on reconcile, either side: exactly one bubble each.
      await expect(playerPage.getByText(text)).toHaveCount(1);
      await expect(coach1Page.getByText(text)).toHaveCount(1);
    } finally {
      await playerContext.close();
      await coach1Context.close();
    }
  });

  test("CH-02 a group message is received by all members with correct sender-name attribution @realtime", async ({
    browser,
    seed,
  }) => {
    await seed.resetGroupsDemo();

    const coach1 = await signInAs(EMAIL.coach1);
    const player = await signInAs(EMAIL.player);
    const partner = await signInAs(EMAIL.partner);

    // No service role needed: coach1 owns the group (training_groups_select_coach)
    // and is a seated member of its chat thread (chat_threads_select_group_member,
    // 0078_group_chat_and_notes.sql), and public_profiles is a public read.
    const { data: group, error: groupError } = await coach1.client
      .from("training_groups")
      .select("id")
      .eq("coach_id", coach1.userId)
      .eq("name", "Cric Squad")
      .single();
    if (groupError) throw groupError;
    const { data: thread, error: threadError } = await coach1.client
      .from("chat_threads")
      .select("id")
      .eq("context_type", "group")
      .eq("context_id", group.id)
      .single();
    if (threadError) throw threadError;
    const { data: coachRow, error: coachRowError } = await coach1.client
      .from("public_profiles")
      .select("name")
      .eq("id", coach1.userId)
      .single();
    if (coachRowError) throw coachRowError;

    const playerContext = await browser.newContext({ storageState: join(STATE_DIR, "player.json") });
    const partnerContext = await browser.newContext({ storageState: join(STATE_DIR, "partner.json") });
    try {
      const playerPage = await playerContext.newPage();
      const partnerPage = await partnerContext.newPage();
      await playerPage.goto(`/chat/${thread.id}`);
      await partnerPage.goto(`/chat/${thread.id}`);
      await expect(playerPage.getByText(/members?$/)).toBeVisible({ timeout: 15_000 });
      await expect(partnerPage.getByText(/members?$/)).toBeVisible({ timeout: 15_000 });

      // The third member (coach1) sends via the exact real insert
      // use-chat.ts's sendMessage performs, under coach1's own JWT.
      const text = `e2e CH-02 ${Date.now()}`;
      const { error: sendError } = await coach1.client
        .from("chat_messages")
        .insert({ thread_id: thread.id, sender_id: coach1.userId, text });
      if (sendError) throw sendError;

      for (const page of [playerPage, partnerPage]) {
        await expect
          .poll(async () => (await page.getByText(text).count()) > 0, {
            timeout: 15_000,
            message: "a group member never received the message over Realtime",
          })
          .toBe(true);
        // Sender-name attribution above the bubble.
        await expect(page.getByText(coachRow.name).first()).toBeVisible();
      }
    } finally {
      await playerContext.close();
      await partnerContext.close();
    }
  });

  test.fixme("CH-03 player's unread badge increments without a manual reload", () => {
    // P1 in the catalog, MISSING-FEATURE as of this freeze, same status
    // vocabulary the catalog itself defines for exactly this situation
    // (docs/qa/TEST-CATALOG.md "Status column"). packages/api/src/use-chat.ts
    // says so explicitly: "ChatThread.unreadCount always resolves to 0 here:
    // the chat schema has no read-receipt column yet (no read_at on either
    // table)". mapThreadRow hardcodes `unreadCount: 0` for both 1:1 and
    // group threads (hooks.ts confirms no equivalent field exists in the
    // Clutch/chat API either), and there is no badge element anywhere in
    // ChatThreadList.tsx's ThreadRow or bottom-nav.tsx. There is nothing to
    // increment; this is a real, pre-existing product gap, not a harness
    // limitation. Recorded as a REAL FINDING.
  });

  test.fixme("CH-04 scrolling up loads older messages with no duplicate or gapped pages", () => {
    // P2.
  });

  test("CH-05 a non-participant's direct SELECT of a thread they do not belong to returns zero rows", async ({ seed }) => {
    await seed.resetCoachingFixtures();
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    const coach2 = await signInAs(EMAIL.coach2);
    const threadId = await ensureCoachingThread(player, coach1);

    const { data, error } = await coach2.client.from("chat_threads").select("id").eq("id", threadId);
    if (error) throw error;
    expect(data ?? [], "coach2 (not a participant) must get zero rows, not another member's data").toEqual([]);
  });

  test("CH-06 a non-participant's direct INSERT into a thread they do not belong to is rejected", async ({ seed }) => {
    await seed.resetCoachingFixtures();
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    const coach2 = await signInAs(EMAIL.coach2);
    const threadId = await ensureCoachingThread(player, coach1);

    const { data, error } = await coach2.client
      .from("chat_messages")
      .insert({ thread_id: threadId, sender_id: coach2.userId, text: "e2e CH-06 should be rejected" })
      .select("id");
    expect(error, "insert into a thread coach2 does not belong to must be rejected server side").toBeTruthy();
    expect(data ?? null).toBeNull();
  });

  test.describe("CH-07", () => {
    test.use({ persona: "player" });

    test("CH-07 a send while offline is not silently lost, and completes on reconnect", async ({ page, seed }) => {
      await seed.resetCoachingFixtures();
      const player = await signInAs(EMAIL.player);
      const coach1 = await signInAs(EMAIL.coach1);
      const threadId = await ensureCoachingThread(player, coach1);

      await page.goto(`/chat/${threadId}`);
      await expect(page.getByLabel("Message input")).toBeVisible({ timeout: 15_000 });

      const text = `e2e CH-07 offline ${Date.now()}`;
      await page.context().setOffline(true);
      await page.getByLabel("Message input").fill(text);
      await page.getByRole("button", { name: "Send message" }).click();

      // sendMessage's catch path (ChatThreadScreen.handleSend) drops the
      // optimistic bubble and restores the draft into the composer on
      // failure, rather than leaving a phantom "sent" bubble behind — the
      // message text is not lost, it is back in the input, editable, ready
      // to resend the moment connectivity returns.
      await expect
        .poll(async () => (await page.getByLabel("Message input").inputValue()) === text, {
          timeout: 10_000,
          message: "draft text must be restored to the composer after a failed offline send, not silently dropped",
        })
        .toBe(true);

      await page.context().setOffline(false);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect
        .poll(async () => (await page.getByText(text).count()) > 0, {
          timeout: 15_000,
          message: "resend after reconnect must land the message in the thread",
        })
        .toBe(true);
    });
  });

  test("CH-08 scripts/verify-realtime.mjs (chat portions) exits green @realtime", async () => {
    test.setTimeout(120_000);

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [join(REPO_ROOT, "scripts", "verify-realtime.mjs")],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, SUPABASE_ANON_KEY: anonKey() },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 110_000,
        },
      );
      expect(stdout).toContain("Overall verdict for chat: Realtime instant push is PROVEN");
      expect(stdout).toContain("RLS scoping is PROVEN SAFE");
    } catch (err) {
      // The script's own stdout/stderr carries the actual failing assertion
      // (per-part PASS/FAIL lines); surface it rather than just "exit 1".
      const e = err;
      throw new Error(`[CH-08] verify-realtime.mjs failed (exit ${e.code}):\n${e.stdout ?? ""}\n${e.stderr ?? ""}`);
    }
  });

  test.fixme("CH-09 an empty thread list and an empty opened thread both render a clear empty state", () => {
    // P3.
  });

  test.fixme("CH-10 native 1:1 chat send/receive works without crash", () => {
    // P1, lane MAESTRO. Out of scope for this Playwright harness.
  });

  test.fixme("CH-11 native group roster sheet opens with correct members and sender names", () => {
    // P2, lane MAESTRO. Out of scope for this Playwright harness.
  });

  test.fixme("CH-12 block-user affordance in chat", () => {
    // P3, lane EXT. Catalog's own note: "no block-user feature found in code
    // as of this catalog freeze; case is a placeholder pending confirmation,
    // catalog as gap not executable pass/fail". Nothing for this harness to
    // drive.
  });

  test("CH-13 opening/listing a thread with a non-session party is server-side gated, not just missing a UI link", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const coach2 = await signInAs(EMAIL.coach2);

    // Precondition per the catalog: no session between player and coach2,
    // so no thread should exist (and none can legally be created,
    // session_links_pair backs the INSERT policy).
    const { data: sessionExists, error: sessionError } = await player.client.rpc("session_exists_between", {
      p_user_a: player.userId,
      p_user_b: coach2.userId,
    });
    if (sessionError) throw sessionError;
    test.skip(sessionExists === true, "a session already exists between player and coach2 in this environment; precondition not met");

    // Listing: no thread with coach2 shows up in player's own thread list.
    const { data: threads, error: listError } = await player.client
      .from("chat_threads")
      .select("id, participant_a, participant_b")
      .or(`participant_a.eq.${coach2.userId},participant_b.eq.${coach2.userId}`);
    if (listError) throw listError;
    expect(threads ?? [], "no chat_threads row should exist between player and coach2").toEqual([]);

    // Direct open attempt (bypassing the UI's lack of a link): a hand
    // rolled insert forging a thread with coach2 is rejected server side by
    // the INSERT policy's session_links_pair check, not merely absent from
    // the UI.
    const participantA = player.userId < coach2.userId ? player.userId : coach2.userId;
    const participantB = player.userId < coach2.userId ? coach2.userId : player.userId;
    const { data: forged, error: forgeError } = await player.client
      .from("chat_threads")
      .insert({
        participant_a: participantA,
        participant_b: participantB,
        context_type: "coaching",
        context_id: player.userId, // no real session id available; any id fails session_links_pair
      })
      .select("id");
    expect(forgeError, "opening a thread with a non-session party must be rejected server side").toBeTruthy();
    expect(forged ?? null).toBeNull();
  });
});
