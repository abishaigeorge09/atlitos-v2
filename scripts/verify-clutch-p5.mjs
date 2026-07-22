#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-clutch-p5.mjs
// Track F (AT-106 / AT-107) Phase 5 Clutch verification, scripted-but-real,
// end to end through the DEPLOYED backend. Replaces the founder's native
// upload. Never types credentials: signs in with the documented fixture
// password via signInWithPassword.
//
// Priorities 1,2,4(RLS) run here over real HTTP against the live project.
// Priority 3 (reconcile) and 4(state-machine INVALID_TRANSITION) use privileged
// SQL run by the caller through the Supabase MCP, not this script.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const URL = "https://syzzfgaudpifwvbpycyi.supabase.co";
const ANON = "sb_publishable_w81GxOVCX2UVNoQ9NAGTaA_u2kuT29O";
const PW = "AtlitosDemo!2026";
const PLAYER = "player@atlitos.dev";   // athlete/uploader, id 58756043-...
const ADMIN = "admin@atlitos.dev";     // admin, id d247e386-...
const OTHER = "coach2@atlitos.dev";    // non-owner non-admin, id 883b6f5d-...
const MP4 = "/tmp/atlitos-clip.mp4";
const FN = (n) => `${URL}/functions/v1/${n}`;

const out = { steps: [] };
const rec = (k, v) => { out.steps.push([k, v]); console.log(`\n### ${k}\n`, JSON.stringify(v, null, 2)); };
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(email) {
  const c = anonClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return { client: c, token: data.session.access_token, uid: data.user.id };
}

// Raw edge-function POST with a chosen bearer (session token, anon for guest, or none).
async function callFn(name, body, bearer) {
  const headers = { "Content-Type": "application/json", apikey: ANON };
  if (bearer !== null) headers.Authorization = `Bearer ${bearer ?? ANON}`;
  const r = await fetch(FN(name), { method: "POST", headers, body: JSON.stringify(body) });
  let j = null; const txt = await r.text();
  try { j = JSON.parse(txt); } catch { j = txt; }
  return { status: r.status, body: j };
}

async function fetchUrl(u) {
  const r = await fetch(u);
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct: r.headers.get("content-type"), len: buf.length };
}

const main = async () => {
  const file = readFileSync(MP4);
  rec("mp4-source", { path: MP4, bytes: file.length });

  const player = await signIn(PLAYER);
  const admin = await signIn(ADMIN);
  const other = await signIn(OTHER);
  rec("ids", { player: player.uid, admin: admin.uid, other: other.uid,
    player_ne_other: player.uid !== other.uid, player_ne_admin: player.uid !== admin.uid });

  // ===== PRIORITY 1: scripted end-to-end pipeline =====
  const up = await callFn("stream-upload-url", { caption: "Track F scripted proof clip", sport: "football" }, player.token);
  rec("P1a stream-upload-url", up);
  const clipId = up.body.clipId, path = up.body.path, token = up.body.token;

  // PUT the real MP4 bytes via supabase-js uploadToSignedUrl.
  const upl = await player.client.storage.from(up.body.bucket).uploadToSignedUrl(path, token, file, { contentType: "video/mp4" });
  rec("P1b uploadToSignedUrl", { error: upl.error?.message ?? null, path: upl.data?.path ?? null });

  const fin1 = await callFn("stream-webhook", { clip_id: clipId }, player.token);
  rec("P1c stream-webhook #1", fin1);
  const fin2 = await callFn("stream-webhook", { clip_id: clipId }, player.token);
  rec("P1c stream-webhook #2 (idempotency)", fin2);

  const mod = await admin.client.rpc("moderate_clip", { p_clip_id: clipId, p_action: "approve", p_reason: null });
  rec("P1d moderate_clip approve", { error: mod.error?.message ?? null, status: mod.data?.status ?? null });

  // guest playback mint (anon only, no session) + real byte fetch
  const pbGuest = await callFn("get-clip-playback-url", { clip_id: clipId }, null);
  rec("P1e get-clip-playback-url (guest)", { status: pbGuest.status, hasUrl: !!pbGuest.body?.url, clipStatus: pbGuest.body?.status, expiresIn: pbGuest.body?.expiresIn });
  const preRemovalUrl = pbGuest.body?.url;
  const got = preRemovalUrl ? await fetchUrl(preRemovalUrl) : null;
  rec("P1e fetch signed url", { ...got, bytesMatch: got?.len === file.length });

  // feed query as guest (same shape useClutch runs)
  const feed = await anonClient().from("clips").select("id,status").eq("status", "published").order("created_at", { ascending: false });
  rec("P1f feed contains clip", { error: feed.error?.message ?? null, count: feed.data?.length, containsClip: !!feed.data?.find((c) => c.id === clipId) });

  // ===== PRIORITY 2: takedown teeth =====
  // pre-removal mint resolves
  const pb0 = await callFn("get-clip-playback-url", { clip_id: clipId }, null);
  const pb0fetch = pb0.body?.url ? await fetchUrl(pb0.body.url) : null;
  const staleUrl = pb0.body?.url;
  rec("P2 pre-removal guest mint+fetch", { mint: pb0.status, fetch: pb0fetch?.status });

  const rm = await admin.client.rpc("moderate_clip", { p_clip_id: clipId, p_action: "remove", p_reason: "Track F takedown teeth test" });
  rec("P2 moderate_clip remove", { error: rm.error?.message ?? null, status: rm.data?.status ?? null });

  const pbGuest2 = await callFn("get-clip-playback-url", { clip_id: clipId }, null);
  const pbOwner2 = await callFn("get-clip-playback-url", { clip_id: clipId }, player.token);
  const pbAdmin2 = await callFn("get-clip-playback-url", { clip_id: clipId }, admin.token);
  const modAdmin2 = await callFn("get-clip-moderation-url", { clip_id: clipId }, admin.token);
  rec("P2 post-removal mints (expect 403)", {
    guest: pbGuest2.status, owner: pbOwner2.status, admin: pbAdmin2.status, moderation: modAdmin2.status });

  // direct anon fetch of raw storage path (no signed token) -> expect 4xx
  const rawUrl = `${URL}/storage/v1/object/clips/${path}`;
  const rawPub = await fetch(rawUrl, { headers: { apikey: ANON } });
  const rawAuthed = await fetch(rawUrl, { headers: { apikey: ANON, Authorization: `Bearer ${player.token}` } });
  rec("P2 raw storage path fetch (expect 4xx)", { anon: rawPub.status, ownerAuthed: rawAuthed.status });

  // residual: the URL minted BEFORE removal, bounded by 300s TTL
  const stale = staleUrl ? await fetchUrl(staleUrl) : null;
  rec("P2 pre-removal URL residual (within TTL)", { fetch: stale?.status, note: "resolves until 300s TTL elapses; expected residual, documented honestly" });

  // ===== PRIORITY 4: RLS (non-vacuous) =====
  // fresh non-published clip owned by player (uploading), then owner vs non-owner reads
  const up2 = await callFn("stream-upload-url", { caption: "RLS visibility probe (unpublished)", sport: "tennis" }, player.token);
  const privClip = up2.body.clipId;
  const ownerSees = await player.client.from("clips").select("id,status").eq("id", privClip);
  const otherSees = await other.client.from("clips").select("id,status").eq("id", privClip);
  rec("P4 RLS non-published visibility", {
    privClip, owner: player.uid, nonOwner: other.uid, idsDiffer: player.uid !== other.uid,
    ownerCount: ownerSees.data?.length, nonOwnerCount: otherSees.data?.length });

  // published feed visible to non-owner too
  const otherFeed = await other.client.from("clips").select("id").eq("status", "published");
  rec("P4 RLS published visible to non-owner", { count: otherFeed.data?.length });

  // removed/rejected invisible to non-owner
  const removedId = clipId; // now removed, owned by player
  const otherRemoved = await other.client.from("clips").select("id").eq("id", removedId);
  rec("P4 RLS removed invisible to non-owner", { removedId, nonOwnerCount: otherRemoved.data?.length });

  // clip_likes / follows cannot be written directly by a client (RPC-only)
  const likeIns = await other.client.from("clip_likes").insert({ clip_id: "535154a7-fc90-4331-868d-9b4386ea01af", user_id: other.uid });
  const followIns = await other.client.from("follows").insert({ follower_id: other.uid, followee_id: player.uid });
  rec("P4 direct engagement write (expect denied)", {
    clip_likes_error: likeIns.error?.message ?? "NO ERROR (BAD)", clip_likes_code: likeIns.error?.code ?? null,
    follows_error: followIns.error?.message ?? "NO ERROR (BAD)", follows_code: followIns.error?.code ?? null });
  // the RPC path works (guest gate proven by anon)
  const likeRpc = await other.client.rpc("toggle_clip_like", { p_clip_id: "535154a7-fc90-4331-868d-9b4386ea01af" });
  rec("P4 toggle_clip_like RPC works", { error: likeRpc.error?.message ?? null, result: likeRpc.data });

  console.log("\n\n=== CLIP IDS ===", JSON.stringify({ pipelineClip: clipId, path, rlsProbeClip: privClip }));
};

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
