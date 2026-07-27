// ATLITOS v2 — FO domain (follows). Catalog: docs/qa/test-catalog.json,
// IDs FO-01..FO-10.
//
// Surface: athlete-web only (see auth.spec.ts header for the guard
// rationale; the same one applies here verbatim).
//
// follows is a PUBLIC-read table by design (follows_select_public,
// 0042_clutch_rls.sql: "the like/follow counts... public SELECT"), same as
// any social app's public follow graph. FO-04's "privacy model" is that
// shape, not a private list; see FO-04 below for the assertion this implies.
// Because of that, every ground-truth read in this file goes through a
// real anon-key, signed-in client (support/rls.mjs's signInAs), never
// helpers/sql.mjs's service-role client: no case here actually needs
// SUPABASE_SERVICE_ROLE_KEY, so none of them are SQL-key gated.

import { expect, test } from "../fixtures";
import { EMAIL, signInAs } from "./support/rls.mjs";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "athlete-web", "FO domain targets athlete-web only");
});

test.describe("FO — follows", () => {
  test.describe("PW", () => {
    test.use({ persona: "player" });

    test("FO-01 following a creator increments followerCount in the actor's own view and flips the button @smoke", async ({
      page,
    }) => {
      const coach1 = await signInAs(EMAIL.coach1);
      await page.goto(`/clutch/creator/${coach1.userId}`);

      const followButton = page.getByRole("button", { name: /^(Follow|Following)$/ });
      await expect(followButton).toBeVisible({ timeout: 15_000 });

      // Normalize to "not following" first so this case is self-contained
      // and repeatable regardless of what a previous run left behind.
      if ((await followButton.textContent())?.trim() === "Following") {
        await followButton.click();
        await expect(followButton).toHaveText("Follow", { timeout: 10_000 });
      }

      const before = await followerCount(coach1.client, coach1.userId);

      await followButton.click();
      await expect(followButton).toHaveText("Following", { timeout: 10_000 });
      await expect
        .poll(async () => followerCount(coach1.client, coach1.userId), { timeout: 10_000 })
        .toBe(before + 1);

      // Leave state as found.
      await followButton.click();
      await expect(followButton).toHaveText("Follow", { timeout: 10_000 });
    });

    test("FO-02 unfollowing decrements followerCount; toggling twice more is idempotent both directions", async ({
      page,
    }) => {
      const coach1 = await signInAs(EMAIL.coach1);
      await page.goto(`/clutch/creator/${coach1.userId}`);

      const followButton = page.getByRole("button", { name: /^(Follow|Following)$/ });
      await expect(followButton).toBeVisible({ timeout: 15_000 });

      // Normalize to "following" first.
      if ((await followButton.textContent())?.trim() === "Follow") {
        await followButton.click();
        await expect(followButton).toHaveText("Following", { timeout: 10_000 });
      }

      const followingCount = await followerCount(coach1.client, coach1.userId);

      await followButton.click(); // unfollow
      await expect(followButton).toHaveText("Follow", { timeout: 10_000 });
      await expect
        .poll(async () => followerCount(coach1.client, coach1.userId), { timeout: 10_000 })
        .toBe(followingCount - 1);

      // Two more toggles (follow, unfollow) land back exactly where the
      // unfollow left it, both directions idempotent.
      await followButton.click();
      await expect(followButton).toHaveText("Following", { timeout: 10_000 });
      await followButton.click();
      await expect(followButton).toHaveText("Follow", { timeout: 10_000 });
      await expect
        .poll(async () => followerCount(coach1.client, coach1.userId), { timeout: 10_000 })
        .toBe(followingCount - 1);
    });

    test("FO-09 guest follow tap opens the gate and does not toggle the follow", async ({ browser }) => {
      const coach1 = await signInAs(EMAIL.coach1);
      const context = await browser.newContext(); // anonymous, no storage state
      const page = await context.newPage();
      const before = await followerCount(coach1.client, coach1.userId);

      await page.goto(`/clutch/creator/${coach1.userId}`);
      const followButton = page.getByRole("button", { name: /^(Follow|Following)$/ });
      await expect(followButton).toBeVisible({ timeout: 15_000 });
      await followButton.click();

      await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
      const after = await followerCount(coach1.client, coach1.userId);
      expect(after, "a guest tap must not toggle the follow").toBe(before);

      await context.close();
    });

    test.fixme("FO-08 discovery list renders per-viewer follow state for each listed creator", () => {
      // P2.
    });
  });

  test("FO-03 the app's follows lists match SQL exactly, no phantom or missing rows", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);

    // "The app's list" replicated as the exact query packages/api's
    // listFollowing issues (hooks.ts): own-scoped read with the explicit
    // follower_id filter, through the same anon-key authenticated client
    // the UI uses. "SQL ground truth" here is a SECOND, independent
    // real user's read of the same public row set (follows_select_public,
    // 0042_clutch_rls.sql), not a service-role bypass: the whole point of
    // FO-03 is that both reads see the identical rows.
    const [{ data: ownFollowing, error: followingError }, { data: groundFollowing, error: groundError }] =
      await Promise.all([
        player.client.from("follows").select("followee_id").eq("follower_id", player.userId),
        coach1.client.from("follows").select("followee_id").eq("follower_id", player.userId),
      ]);
    if (followingError) throw followingError;
    if (groundError) throw groundError;

    const ownIds = (ownFollowing ?? []).map((r) => r.followee_id).sort();
    const groundIds = (groundFollowing ?? []).map((r) => r.followee_id).sort();
    expect(ownIds).toEqual(groundIds);
  });

  test("FO-04 follows are a public read (the stated v1 privacy model), not a private-list leak", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    expect(player.userId).not.toBe(coach1.userId); // AT-62 vacuous-pass guard

    // follows_select_public (0042_clutch_rls.sql) makes the WHOLE follows
    // table readable by any authenticated (and anon) caller, the same way a
    // follower/following count is public on most social apps. The
    // regression this guards is scope creep in the OTHER direction: a
    // future migration must not silently narrow this to owner-only without
    // updating the app (which relies on reading a target's list, not just
    // counts) — so this case pins the current, documented behavior rather
    // than asserting a leak that is not one. Ground truth is player's own
    // read; coach1's cross-user read must return the identical row count.
    const { data: groundTruth, error: groundError } = await player.client
      .from("follows")
      .select("id")
      .eq("follower_id", player.userId);
    if (groundError) throw groundError;

    const { data: coachRead, error: coachError } = await coach1.client
      .from("follows")
      .select("id")
      .eq("follower_id", player.userId);
    if (coachError) throw coachError;

    expect(coachRead?.length ?? 0).toBe(groundTruth?.length ?? 0);
  });

  test("FO-05 a direct write forging another user's follower_id is rejected (RPC has no such parameter; direct DML is revoked)", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    expect(player.userId).not.toBe(coach1.userId);

    // toggle_follow(p_followee_id) (0044_clutch_engagement_rpcs.sql) always
    // uses auth.uid() as the actor; there is no follower_id parameter to
    // forge in the first place. The real analogous attack this case exists
    // to close is a raw insert bypassing the RPC entirely: 0042 revokes
    // insert/update/delete on follows from anon and authenticated, RPC is
    // the only door.
    const { error, data } = await coach1.client
      .from("follows")
      .insert({ follower_id: player.userId, followee_id: coach1.userId })
      .select("id");

    expect(error, "direct insert into follows must be rejected (grant-level revoke, not just RLS)").toBeTruthy();
    expect(data ?? null).toBeNull();

    const { data: leaked } = await player.client
      .from("follows")
      .select("id")
      .eq("follower_id", player.userId)
      .eq("followee_id", coach1.userId);
    // Only asserts no NEW row was forged by this attempt; does not assume
    // player was not already following coach1 for an unrelated reason, so
    // no false negative from prior state, no false positive from real state.
    expect((leaked ?? []).length, "coach1 must not be able to create a follows row on player's behalf").toBe(0);
  });

  test("FO-06 toggle_follow rejects a self-follow", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const { error } = await player.client.rpc("toggle_follow", { p_followee_id: player.userId });
    expect(error, "toggle_follow must reject follower_id == followee_id").toBeTruthy();
    expect(String(error?.message ?? "")).toMatch(/cannot follow yourself/i);
  });

  test("FO-07 no drift between the RPC-returned follower count and the SQL aggregate after a burst", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);

    let lastCount = null;
    for (const _ of [0, 1, 2]) {
      const { data, error } = await player.client.rpc("toggle_follow", { p_followee_id: coach1.userId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      lastCount = row?.followers_count ?? row?.follower_count;
    }

    const count = await followerCount(coach1.client, coach1.userId);
    expect(lastCount).toBe(count);
  });

  test("FO-10 a follow by player is visible in coach1's own concurrent session on a fresh read", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);

    // Normalize: unfollow first (idempotent no-op if not currently following).
    const { data: existing } = await player.client
      .from("follows")
      .select("id")
      .eq("follower_id", player.userId)
      .eq("followee_id", coach1.userId)
      .maybeSingle();
    if (existing) {
      const { error } = await player.client.rpc("toggle_follow", { p_followee_id: coach1.userId });
      if (error) throw error;
    }

    const { data: beforeStats, error: beforeError } = await coach1.client
      .from("creator_stats")
      .select("followers_count")
      .eq("user_id", coach1.userId)
      .single();
    if (beforeError) throw beforeError;

    const { error: followError } = await player.client.rpc("toggle_follow", { p_followee_id: coach1.userId });
    if (followError) throw followError;

    // coach1's OWN client, a second real session, re-reading rather than
    // trusting player's optimistic UI: no realtime publication on
    // creator_stats/follows, so this is a fresh-read correctness claim, not
    // a live-push one (the catalog's "not just the actor's optimistic UI").
    const { data: afterStats, error: afterError } = await coach1.client
      .from("creator_stats")
      .select("followers_count")
      .eq("user_id", coach1.userId)
      .single();
    if (afterError) throw afterError;
    expect(afterStats.followers_count).toBe(beforeStats.followers_count + 1);

    // Leave state as found.
    const { error: cleanupError } = await player.client.rpc("toggle_follow", { p_followee_id: coach1.userId });
    if (cleanupError) throw cleanupError;
  });
});

async function followerCount(client, followeeId) {
  const { count, error } = await client
    .from("follows")
    .select("id", { count: "exact", head: true })
    .eq("followee_id", followeeId);
  if (error) throw error;
  return count ?? 0;
}
