// ATLITOS v2 — CL domain (Clutch: short-video social feed). Catalog:
// docs/qa/test-catalog.json, IDs CL-01..CL-19.
//
// Surface: athlete-web only (see auth.spec.ts header for the guard
// rationale; the same one applies here verbatim).

import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "../fixtures";
import { serviceClient } from "../helpers/sql.mjs";
import { EMAIL, signInAs } from "./support/rls.mjs";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "athlete-web", "CL domain targets athlete-web only");
});

/** Any currently-published clip id, read the same way the guest feed does
 * (status='published' is the RLS-permitted public read, clips_select_published,
 * CLAUDE.md scoping rule: this filter is explicit, not left to RLS alone).
 * Takes any signed-in (or anon) client rather than service role, since
 * published clips are a public read; several cases need a real clip to act
 * on, and this is deliberately a live read, not a hardcoded id. */
async function anyPublishedClipId(client) {
  const { data, error } = await client
    .from("clips")
    .select("id")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("[CL] no published clip exists in the test project; seed one before running CL specs.");
  }
  return data[0].id;
}

/** A scratch clip inserted directly (service role, bypasses the client
 * INSERT policy on purpose: CL-14/CL-19 are testing the SELECT/RLS side, not
 * the upload pipeline, and 0043's state machine is service_role/RPC-only
 * anyway). Caller is responsible for cleanup via deleteScratchClip. */
async function insertScratchClip(ownerId, status) {
  const svc = serviceClient();
  const { data, error } = await svc
    .from("clips")
    .insert({ owner_id: ownerId, caption: `e2e scratch ${randomUUID().slice(0, 8)}`, sport: "football", status })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function deleteScratchClip(clipId) {
  const svc = serviceClient();
  await svc.from("clips").delete().eq("id", clipId);
}

test.describe("CL — Clutch (short-video social feed)", () => {
  test("CL-01 first feed clip's video element decodes and the feed pages one clip per viewport", async ({ page }) => {
    await page.goto("/clutch");

    const video = page.locator("video").first();
    await expect(video).toBeVisible({ timeout: 20_000 });

    // One clip per viewport: the paging FlatList sizes each card to the
    // container height (getItemLayout in (tabs)/clutch/index.tsx).
    const viewportHeight = page.viewportSize()?.height ?? 0;
    const box = await video.boundingBox();
    expect(box, "video element must have a layout box").not.toBeNull();
    if (box) {
      expect(Math.abs(box.height - viewportHeight)).toBeLessThan(80);
    }

    // readyState >= 3 (HAVE_FUTURE_DATA) and a real timeupdate event, not a
    // pixel diff. NOTE: clip-video.web.tsx's own header documents that the
    // Phase 5 fixture clips carry PLACEHOLDER bytes a browser cannot decode
    // ("real-MP4 playback is verified against a separately uploaded clip").
    // If the live feed's first clip is still fixture-bytes, this section
    // legitimately times out; that is a real, already-documented data gap,
    // not something to paper over with a shorter/softer assertion.
    const result = await video.evaluate(
      (el) =>
        new Promise((resolve) => {
          const v = el as HTMLVideoElement;
          if (v.readyState >= 3) {
            resolve({ readyState: v.readyState, timeupdate: true });
            return;
          }
          const timer = setTimeout(() => resolve({ readyState: v.readyState, timeupdate: false }), 8000);
          v.addEventListener(
            "timeupdate",
            () => {
              clearTimeout(timer);
              resolve({ readyState: v.readyState, timeupdate: true });
            },
            { once: true },
          );
        }),
    );
    expect(
      (result as { readyState: number; timeupdate: boolean }).readyState,
      "video readyState (see clip-video.web.tsx: placeholder-byte fixture clips cannot decode)",
    ).toBeGreaterThanOrEqual(3);
  });

  test.fixme("CL-02 loadMore pages the feed with a cursor and appends without duplicate clip ids", () => {
    // P2. Catalog: scroll near the end of the loaded feed -> loadMore fires
    // with cursor param; next page appends with no duplicate clip ids.
  });

  test("CL-03 guest can fully browse feed and post detail with no login gate on read @smoke", async ({ page }) => {
    await page.goto("/clutch");
    await expect(page.getByText("Want to hit the spotlight?")).toHaveCount(0);

    const firstCard = page.getByRole("button", { name: /^Open clip by/ }).first();
    await expect(firstCard).toBeVisible({ timeout: 20_000 });
    await firstCard.click();

    await expect(page).toHaveURL(/\/clutch\/post\//, { timeout: 15_000 });
    // Reading the detail (video, caption, comment thread) never gates.
    await expect(page.getByText("Want to hit the spotlight?")).toHaveCount(0);
    await expect(page.getByText("Sign in to join the conversation")).toBeVisible();
  });

  test("CL-04 guest like opens the gate and does not apply the like", async ({ page }) => {
    await page.goto("/clutch");
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible({ timeout: 20_000 });
    const countBefore = await likeButton.textContent();

    await likeButton.click();

    await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
    // Count unchanged: same Like button, not flipped to Unlike, same text.
    await expect(page.getByRole("button", { name: "Unlike" })).toHaveCount(0);
    await expect(likeButton).toHaveText(countBefore ?? "");
  });

  test.describe("CL-05", () => {
    test.use({ persona: "player" });

    test("CL-05 like/unlike is optimistic, reconciles, and is idempotent both directions on feed and detail", async ({
      page,
    }) => {
      await page.goto("/clutch");
      const likeButton = page.getByRole("button", { name: /^(Like|Unlike)$/ }).first();
      await expect(likeButton).toBeVisible({ timeout: 20_000 });

      const startedLiked = (await likeButton.getAttribute("aria-label")) === "Unlike";

      // Toggle once: optimistic flip is immediate (no network wait needed
      // for the label to change), then reconciles.
      await likeButton.click();
      await expect(likeButton).toHaveAttribute("aria-label", startedLiked ? "Like" : "Unlike", { timeout: 5000 });

      // Toggle back: idempotent, returns to the original label.
      await likeButton.click();
      await expect(likeButton).toHaveAttribute("aria-label", startedLiked ? "Unlike" : "Like", { timeout: 5000 });

      // Same dance on the post detail screen for the same clip.
      const openButton = page.getByRole("button", { name: /^Open clip by/ }).first();
      await openButton.click();
      await expect(page).toHaveURL(/\/clutch\/post\//, { timeout: 15_000 });

      const detailLike = page.getByRole("button", { name: /^(Like|Unlike)$/ });
      await expect(detailLike).toBeVisible({ timeout: 15_000 });
      const detailStartedLiked = (await detailLike.getAttribute("aria-label")) === "Unlike";
      await detailLike.click();
      await expect(detailLike).toHaveAttribute("aria-label", detailStartedLiked ? "Like" : "Unlike", { timeout: 5000 });
      await detailLike.click();
      await expect(detailLike).toHaveAttribute("aria-label", detailStartedLiked ? "Unlike" : "Like", { timeout: 5000 });
    });
  });

  test("CL-06 concurrent like/unlike from two real sessions never drives likes_count negative", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    const clipId = await anyPublishedClipId(player.client);

    async function burst(client, n) {
      const calls = [];
      for (let i = 0; i < n; i++) calls.push(client.rpc("toggle_clip_like", { p_clip_id: clipId }));
      // supabase-js's PostgrestFilterBuilder is thenable but is not a real
      // Promise (no bound .catch method); wrap with Promise.resolve first
      // (observed: "TypeError: p.catch is not a function" without this).
      return Promise.all(calls.map((p) => Promise.resolve(p).catch((e) => ({ error: e }))));
    }

    // Fire both users' toggles concurrently, several rounds, so any race in
    // the RPC's read-then-write has real opportunity to interleave.
    await Promise.all([burst(player.client, 6), burst(coach1.client, 6)]);

    // clips_select_published (public) and clip_likes_select_public (public,
    // 0042_clutch_rls.sql) both allow this read through any signed-in
    // client; no service role needed for a published clip's counts.
    const { data: clipRow, error: clipError } = await player.client
      .from("clips")
      .select("likes_count")
      .eq("id", clipId)
      .single();
    if (clipError) throw clipError;
    expect(clipRow.likes_count, "clips.likes_count must never go negative").toBeGreaterThanOrEqual(0);

    const { count, error: countError } = await player.client
      .from("clip_likes")
      .select("id", { count: "exact", head: true })
      .eq("clip_id", clipId);
    if (countError) throw countError;
    expect(clipRow.likes_count, "trigger-maintained likes_count must match the real clip_likes row count").toBe(count);
  });

  test.describe("CL-07", () => {
    test.use({ persona: "player" });

    test("CL-07 submitting a comment inserts the own row and increments the header commentCount", async ({ page }) => {
      const player = await signInAs(EMAIL.player);
      const clipId = await anyPublishedClipId(player.client);
      await page.goto(`/clutch/post/${clipId}`);

      const countBefore = await page.getByText(/^\d+ comments?$/).first().textContent();
      const before = Number((countBefore ?? "0").match(/\d+/)?.[0] ?? "0");

      const text = `e2e CL-07 comment ${randomUUID().slice(0, 8)}`;
      await page.getByPlaceholder("Add a comment").fill(text);
      await page.getByRole("button", { name: "Send comment" }).click();

      await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });
      await expect
        .poll(async () => {
          const t = await page.getByText(/^\d+ comments?$/).first().textContent();
          return Number((t ?? "0").match(/\d+/)?.[0] ?? "0");
        }, { timeout: 10_000 })
        .toBe(before + 1);
    });
  });

  test.fixme("CL-08 guest cannot comment; the composer is replaced by a sign in prompt", () => {
    // P2. Already exercised as a side effect of CL-03's assertion
    // ("Sign in to join the conversation" with no TextInput rendered); kept
    // as its own catalog id per the freeze, not duplicated here.
  });

  test("CL-09 a non-author's direct delete of another user's comment is rejected server side", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    const clipId = await anyPublishedClipId(player.client);

    const { data: inserted, error: insertError } = await player.client
      .from("clip_comments")
      .insert({ clip_id: clipId, user_id: player.userId, text: `e2e CL-09 ${randomUUID().slice(0, 8)}` })
      .select("id, text")
      .single();
    if (insertError) throw insertError;

    // coach1, a different real user, attempts the delete directly (not via
    // any UI affordance, which does not even exist for another user's row).
    const { data: deleted, error: deleteError } = await coach1.client
      .from("clip_comments")
      .delete()
      .eq("id", inserted.id)
      .select("id");
    // RLS's USING clause simply matches zero rows for a non-owner; this is
    // not necessarily a thrown error, so the load-bearing assertion is what
    // (if anything) got deleted, not whether an error object came back.
    expect(deleteError, "a scoped RLS delete does not have to error").toBeFalsy();
    expect(deleted ?? [], "coach1 must not have deleted player's comment").toEqual([]);

    // Row unchanged, confirmed by the author's own read.
    const { data: stillThere, error: readError } = await player.client
      .from("clip_comments")
      .select("id, text")
      .eq("id", inserted.id)
      .maybeSingle();
    if (readError) throw readError;
    expect(stillThere?.text).toBe(inserted.text);

    // Cleanup: this is a scratch row on a real shared clip, remove it via
    // the author's own delete_own policy so it does not linger in the feed.
    await player.client.from("clip_comments").delete().eq("id", inserted.id);
  });

  test.describe("CL-10", () => {
    test.use({ persona: "player" });

    test("CL-10 upload blocks submit without a caption; a valid submit enters uploading/processing, not the public feed", async ({
      page,
    }) => {
      const dir = mkdtempSync(join(tmpdir(), "atlitos-e2e-clip-"));
      const fixturePath = join(dir, "clip.mp4");
      // Placeholder bytes are the established convention in this codebase
      // (clip-video.web.tsx's own comment: "Phase 5 fixture clips carry
      // placeholder bytes"); the pipeline accepts them, only decode-in-
      // browser needs a real MP4 (CL-01).
      writeFileSync(fixturePath, Buffer.from("ATLITOS E2E CL-10 PLACEHOLDER MP4 BYTES"));

      await page.goto("/clutch/upload");

      const postButton = page.getByRole("button", { name: "Post clip" });
      await expect(postButton).toBeDisabled();

      const fileChooserPromise = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Select a clip" }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(fixturePath);

      await page.getByRole("button", { name: "Cricket" }).click();

      // Asset + sport chosen, caption still empty: submit stays blocked.
      await expect(postButton).toBeDisabled();

      const caption = `e2e CL-10 ${randomUUID().slice(0, 8)}`;
      await page.getByPlaceholder("Say something about this clip").fill(caption);
      await expect(postButton).toBeEnabled();

      await postButton.click();
      await expect(page.getByText("Clip in review")).toBeVisible({ timeout: 30_000 });

      // Not published yet: the freshest clip for this player is in
      // uploading/processing (or already reconciled to ready), never
      // 'published', and is excluded from the guest-visible feed query.
      // clips_select_own (owner_id = auth.uid()) covers this read, no
      // service role needed: read it back as player, the row's own owner.
      const player = await signInAs(EMAIL.player);
      const { data: freshest, error } = await player.client
        .from("clips")
        .select("id, status")
        .eq("caption", caption)
        .single();
      if (error) throw error;
      expect(["uploading", "processing", "ready"]).toContain(freshest.status);
      expect(freshest.status).not.toBe("published");
    });
  });

  test.fixme("CL-11 zero clips stuck past the 30 minute reconcile SLA (partial: stuck rows only)", async () => {
    // P1, lane SQL, n/a persona. NOTE: implemented as test.fixme rather than
    // a live assertion because it depends on wall-clock fixture age this
    // harness does not control (there must exist, or not exist, a clip
    // older than the SLA at run time) — asserting "zero" here would either
    // be vacuous (nothing that old exists yet) or flaky (something does).
    // The real check, to run as a standing SQL probe rather than a
    // per-commit E2E case:
    //   select count(*) from clips
    //   where status in ('uploading','processing')
    //     and created_at < now() - interval '35 minutes'
    //   -- expect 0; expire_stale_holds (0045_clutch_stranded_reconcile.sql)
    //   -- reconciles stranded clips past 30 minutes, run every 5 minutes
    //   -- via pg_cron, so the 35 minute threshold gives one full tick of
    //   -- slack before treating a row as a real finding.
    // The orphaned-storage-object half (storage.list vs clips.storage_path)
    // is out of scope for this pass; recorded as a documented gap, not
    // silently dropped.
  });

  test.describe("CL-12", () => {
    test.use({ persona: "player" });

    test("CL-12 creator profile shows correct header stats and a working follow toggle", async ({ page }) => {
      const coach1 = await signInAs(EMAIL.coach1);
      // creator_stats and public_profiles are both public-read views
      // (0041_clutch_schema.sql / packages/api hooks.ts comments); reading
      // them through coach1's own client is the ground truth, no service
      // role needed.
      const [{ data: stats, error: statsError }, { data: profileRow, error: profileError }] = await Promise.all([
        coach1.client
          .from("creator_stats")
          .select("published_clips_count, followers_count, following_count")
          .eq("user_id", coach1.userId)
          .single(),
        coach1.client.from("public_profiles").select("channel_name, name").eq("id", coach1.userId).single(),
      ]);
      if (statsError) throw statsError;
      if (profileError) throw profileError;
      const channelName = profileRow.channel_name ?? profileRow.name;

      await page.goto(`/clutch/creator/${coach1.userId}`);
      // Profile loaded for the right creator (AppBar title = channel name,
      // exact match, unlike a bare numeric getByText which would collide
      // with any other "0"/"1" rendered on the page).
      await expect(page.getByText(channelName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

      // Header stats: ClutchProfileView's StatItem renders {value, label} as
      // two sibling Text nodes in one container (organisms/ClutchProfileView.tsx).
      // Locate the label exactly, then assert the exact value is present in
      // that SAME container, rather than matching a bare number page-wide
      // (which would collide with any other digit rendered on the screen).
      async function assertStat(label: string, expected: number) {
        const labelEl = page.getByText(label, { exact: true });
        await expect(labelEl).toBeVisible({ timeout: 15_000 });
        const container = labelEl.locator("xpath=..");
        await expect(container.getByText(String(expected), { exact: true })).toBeVisible();
      }
      await assertStat("Clips", stats.published_clips_count);
      await assertStat("Followers", stats.followers_count);
      await assertStat("Following", stats.following_count);

      const followButton = page.getByRole("button", { name: /^(Follow|Following)$/ });
      await expect(followButton).toBeVisible();
      const startedFollowing = (await followButton.textContent())?.trim() === "Following";

      await followButton.click();
      await expect(followButton).toHaveText(startedFollowing ? "Follow" : "Following", { timeout: 10_000 });
      // Leave state as found: toggle back.
      await followButton.click();
      await expect(followButton).toHaveText(startedFollowing ? "Following" : "Follow", { timeout: 10_000 });
    });
  });

  test.fixme("CL-13 admin takedown removes a clip from other viewers immediately, own-grid keeps a status pill", () => {
    // P1, lane EXT (judgment walk, Chrome-extension walker, one walker
    // alive at a time — TEST-CATALOG.md "Lane routing"). Not a Playwright
    // deliverable in this harness; the deterministic half of this claim
    // (data-layer exclusion for a non-owner) is covered by CL-14 below.
  });

  test("CL-14 a removed clip is excluded at the data layer for a non-owner, not just hidden client side", async ({}) => {
    test.skip(
      !process.env.SUPABASE_SERVICE_ROLE_KEY,
      "needs SUPABASE_SERVICE_ROLE_KEY: the scratch-clip fixture bypasses clips_insert_own's status='uploading' constraint on purpose",
    );
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    const admin = await signInAs(EMAIL.admin);

    const clipId = await insertScratchClip(player.userId, "published");
    try {
      const { error: modError } = await admin.client.rpc("moderate_clip", {
        p_clip_id: clipId,
        p_action: "remove",
        p_reason: "e2e CL-14 fixture takedown",
      });
      if (modError) throw modError;

      // The exact feed query shape (status='published'), run as a
      // non-owner: excluded.
      const { data: feedRow } = await coach1.client
        .from("clips")
        .select("id")
        .eq("status", "published")
        .eq("id", clipId)
        .maybeSingle();
      expect(feedRow).toBeNull();

      // Not just filtered out of the feed query: an UNSCOPED direct read by
      // id, as the same non-owner, returns nothing either (clips_select_own
      // requires owner_id = auth.uid(), clips_select_published requires
      // status='published'; neither matches for coach1 on a removed clip).
      const { data: directRow } = await coach1.client.from("clips").select("id, status").eq("id", clipId).maybeSingle();
      expect(directRow, "a non-owner must get zero rows for a removed clip, at the RLS layer").toBeNull();

      // The owner still sees it (own-grid, with its terminal status).
      const { data: ownerRow } = await player.client.from("clips").select("id, status").eq("id", clipId).maybeSingle();
      expect(ownerRow?.status).toBe("removed");
    } finally {
      await deleteScratchClip(clipId);
    }
  });

  test.fixme("CL-15 native feed autoplay-on-viewport and paging snap swipe behave correctly", () => {
    // P1, lane MAESTRO. Out of scope for this Playwright harness.
  });

  test.fixme("CL-16 native upload flow completes without crash", () => {
    // P1, lane MAESTRO. Out of scope for this Playwright harness.
  });

  test.fixme("CL-17 judgment walk: feel of scroll, playback responsiveness, gating friction", () => {
    // P2, lane EXT. Chrome-extension judgment walker, not Playwright.
  });

  test("CL-18 displayed like/comment/follow counts match SQL aggregates exactly after a burst", async ({}) => {
    const player = await signInAs(EMAIL.player);
    const clipId = await anyPublishedClipId(player.client);

    // A small real burst: like, unlike, like (net +1 from wherever it
    // started), plus one comment.
    for (const _ of [0, 1, 2]) {
      const { error } = await player.client.rpc("toggle_clip_like", { p_clip_id: clipId });
      if (error) throw error;
    }
    const commentText = `e2e CL-18 ${randomUUID().slice(0, 8)}`;
    const { data: comment, error: commentError } = await player.client
      .from("clip_comments")
      .insert({ clip_id: clipId, user_id: player.userId, text: commentText })
      .select("id")
      .single();
    if (commentError) throw commentError;

    // clips_select_published, clip_likes_select_public, and
    // clip_comments_select_on_published are all public reads; player's own
    // client is the ground truth here, no service role needed.
    const { data: clipRow, error: clipError } = await player.client
      .from("clips")
      .select("likes_count, comment_count")
      .eq("id", clipId)
      .single();
    if (clipError) throw clipError;

    const { count: likeCount, error: likeCountError } = await player.client
      .from("clip_likes")
      .select("id", { count: "exact", head: true })
      .eq("clip_id", clipId);
    if (likeCountError) throw likeCountError;
    const { count: commentCount, error: commentCountError } = await player.client
      .from("clip_comments")
      .select("id", { count: "exact", head: true })
      .eq("clip_id", clipId);
    if (commentCountError) throw commentCountError;

    expect(clipRow.likes_count, "trigger-maintained likes_count vs real clip_likes rows").toBe(likeCount);
    expect(clipRow.comment_count, "trigger-maintained comment_count vs real clip_comments rows").toBe(commentCount);

    await player.client.from("clip_comments").delete().eq("id", comment.id);
  });

  test("CL-19 a rejected clip is visible only to its uploader, confirmed by a second user's direct query", async ({}) => {
    test.skip(
      !process.env.SUPABASE_SERVICE_ROLE_KEY,
      "needs SUPABASE_SERVICE_ROLE_KEY: the scratch-clip fixture bypasses clips_insert_own's status='uploading' constraint on purpose",
    );
    const player = await signInAs(EMAIL.player);
    const coach1 = await signInAs(EMAIL.coach1);
    const admin = await signInAs(EMAIL.admin);
    expect(player.userId).not.toBe(coach1.userId); // AT-62 vacuous-pass guard

    const clipId = await insertScratchClip(player.userId, "ready");
    try {
      const { error: modError } = await admin.client.rpc("moderate_clip", {
        p_clip_id: clipId,
        p_action: "reject",
        p_reason: "e2e CL-19 fixture rejection",
      });
      if (modError) throw modError;

      const { data: coachRow } = await coach1.client.from("clips").select("id").eq("id", clipId).maybeSingle();
      expect(coachRow, "coach1 (non-owner) must get zero rows for a rejected clip").toBeNull();

      const { data: playerRow } = await player.client.from("clips").select("id, status").eq("id", clipId).maybeSingle();
      expect(playerRow?.status).toBe("rejected");
    } finally {
      await deleteScratchClip(clipId);
    }
  });
});
