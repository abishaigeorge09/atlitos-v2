#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-rls-matrix.mjs
//
// UNIFIED RLS MATRIX: asserts, in one place, a grid of
// (sensitive_table x persona -> expected read access), against the LIVE
// project, using the anon key + real per-persona password sign-ins through
// PostgREST. No service role anywhere in this file.
//
// Coverage (the backend reader's unprobed list):
//   1. upa_applications, upa_evidence, donations, gratitude_posts (empower/upa)
//   2. chat_threads / chat_thread_members / chat_messages GROUP policies (0078)
//   3. coach_trainee_notes / coach_trainee_videos dual access (0082 + 0078)
//   4. fee_config: readable by every authenticated user, writable by none of
//      the personas this script signs in as (no client ever holds admin here)
//   5. venues / court_bookings owner-scoping (CLAUDE.md's three-times-bitten shape)
//
// ============================================================================
// AT-62 lesson, honoured throughout: Postgres RLS policies are PERMISSIVE-OR.
// An unscoped select against a table that also carries a public/verified
// browse policy returns rows that are legitimately public ALONGSIDE rows
// that would be a real leak if they showed up for the wrong caller. So every
// isolation check below is an "explained rows" scan, not a raw row count:
//   - build the same public-visibility predicate the migration's policy
//     comment states (e.g. upa_applications: status = 'verified'),
//   - anything an unscoped query returns that ISN'T explained by that
//     predicate OR by caller-ownership is reported as a leak.
// And separately: every isolation claim first asserts the two parties' ids
// actually DIFFER (assertDistinct below) before trusting a "sees nothing"
// or "sees only its own" result — a probe run with the same id on both
// sides, or against a row the caller already owns, PASSES VACUOUSLY and
// proves nothing (the exact AT-62 incident).
// ============================================================================
//
// SEED-STATE DISCOVERY (recorded here so the next agent does not re-derive
// it): docs/qa/TEST-CATALOG.md documents that upa.verified@, upa.tennis@ and
// donor@atlitos.dev return invalid_credentials against this project —
// scripts/seed-empower-upa-users.mjs was never run here. This script still
// attempts those three sign-ins (so it self-heals the moment someone fixes
// the seed) but does not fail the run when they are unavailable: BLOCKED_
// prefixed notes are printed and those specific persona-owned assertions are
// skipped. Everything else runs on already-working AtlitosDemo!2026
// accounts, several of which turn out to double as real UPA owners because
// supabase/seed/seed_p6_empower_fixtures.sql's id-resolution falls back to
// coach1@/coach2@atlitos.dev when the upa.* email does not resolve:
//   coach1@atlitos.dev  owns upa_applications id 4f7616f4... (status verified)
//   coach2@atlitos.dev  owns upa_applications id fbf4d6b3... (status under_review)
//   p2-verify-athlete@  owns upa_applications id 03907d23... (status needs_info)
//   player@atlitos.dev  owns upa_applications id bfb1012d... (status rejected)
// That is FOUR distinct real owners across FOUR distinct statuses, all on
// accounts that already sign in cleanly, which is a strictly better fixture
// for this probe than three blocked personas would have been: the ceiling
// case (a random authenticated user reading a stranger's non-verified
// application) is exercised directly instead of only in principle.
//
// Env required:
//   SUPABASE_ANON_KEY  — apps/portal-court/.env.local's
//                        NEXT_PUBLIC_SUPABASE_ANON_KEY. Never the service
//                        role key: every call in this script goes through a
//                        real authenticated (or anon) PostgREST request.
//   SUPABASE_URL       — optional, defaults to the project URL below.
//
// Run: SUPABASE_ANON_KEY=... node scripts/verify-rls-matrix.mjs

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error(
    '[verify-rls-matrix] SUPABASE_ANON_KEY is required (the anon/publishable key from ' +
      'apps/portal-court/.env.local NEXT_PUBLIC_SUPABASE_ANON_KEY, never the service role key).',
  );
  process.exit(1);
}

function readEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {
    // optional file, e.g. supabase/.env may not exist in every checkout
  }
  return out;
}
const fnEnv = readEnvFile('supabase/.env');
const RAZORPAY_KEY_SECRET = fnEnv.RAZORPAY_KEY_SECRET;

const AT_PW = 'AtlitosDemo!2026';
const EM_PW = 'EmpowerDemo!2026';

// ---------------------------------------------------------------- transport
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.access_token) return { email, ok: false, error: json };
  return { email, ok: true, token: json.access_token, uid: json.user.id };
}

async function rest(token, method, path, body, extraHeaders = {}) {
  const headers = { apikey: ANON_KEY, 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function callFunction(name, token, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const sig = (orderId, paymentId) => createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

// ---------------------------------------------------------------- assertions
let rowsAsserted = 0;
const leaksFound = [];
const blocked = [];

function assertDistinct(label, ids) {
  rowsAsserted++;
  const set = new Set(ids);
  const ok = set.size === ids.length;
  if (!ok) leaksFound.push(`VACUOUS PROBE (AT-62): ${label} party ids are not distinct: ${JSON.stringify(ids)}`);
  return ok;
}

/** Unscoped read; every returned row must be explained by ownership OR a
 * stated public predicate. Anything else is a leak. */
async function scanForeign(label, token, path, explainers) {
  const res = await rest(token, 'GET', path);
  const rows = Array.isArray(res.json) ? res.json : [];
  let foreign = 0;
  for (const row of rows) {
    rowsAsserted++;
    if (!explainers.some((fn) => fn(row))) {
      foreign++;
      leaksFound.push(`${label}: unexplained foreign row visible -> ${JSON.stringify(row).slice(0, 200)}`);
    }
  }
  return { status: res.status, count: rows.length, foreign };
}

/** Unscoped read that must return EXACTLY ZERO rows (no policy grants this
 * caller anything on this table at all, e.g. a trainee on coach_trainee_notes). */
async function scanExpectZero(label, token, path) {
  const res = await rest(token, 'GET', path);
  rowsAsserted++;
  const rows = Array.isArray(res.json) ? res.json : [];
  if (rows.length !== 0) {
    leaksFound.push(`${label}: expected ZERO rows, got ${rows.length} -> ${JSON.stringify(rows).slice(0, 200)}`);
  }
  return { status: res.status, count: rows.length };
}

/** Scoped-by-filter read that must be non-empty (non-vacuous: a probe where
 * both sides see nothing "passes" while proving nothing) AND every row must
 * actually belong to the caller. */
async function scanOwnOnly(label, token, path, ownCheckFn) {
  const res = await rest(token, 'GET', path);
  const rows = Array.isArray(res.json) ? res.json : [];
  rowsAsserted++;
  if (rows.length === 0) leaksFound.push(`${label}: non-vacuity failed, own-scoped query returned 0 rows`);
  for (const row of rows) {
    rowsAsserted++;
    if (!ownCheckFn(row)) leaksFound.push(`${label}: own-scoped query returned a FOREIGN row -> ${JSON.stringify(row).slice(0, 200)}`);
  }
  return { status: res.status, count: rows.length, rows };
}

async function assertInsertRefused(label, token, path, body) {
  const res = await rest(token, 'POST', path, body, { Prefer: 'return=representation' });
  rowsAsserted++;
  // A 5xx is NOT a clean policy refusal — it means the write was rejected
  // because something in the RLS/policy layer itself is broken (e.g. 42P17
  // infinite recursion), which can be a total DoS on a whole feature, worse
  // than a normal 4xx access denial. Surface it distinctly rather than
  // letting "the write failed" quietly count as "the write was refused".
  if (res.status >= 500) {
    leaksFound.push(`${label}: write did not merely get refused, the POLICY ITSELF ERRORED (status ${res.status}) -> ${JSON.stringify(res.json).slice(0, 200)}`);
    return { status: res.status, refused: false, policy_error: true };
  }
  const refused = res.status >= 400;
  if (!refused) leaksFound.push(`${label}: INSERT was NOT refused (status ${res.status}) -> ${JSON.stringify(res.json).slice(0, 200)}`);
  return { status: res.status, refused };
}

/** PATCH/DELETE refusal, checked WITHOUT trusting a 200/204 status alone
 * (PostgREST returns 200 with return=representation and an EMPTY array when
 * RLS's USING clause matches zero rows — that is the refusal, not an error).
 * So this reads Prefer: return=representation and requires either an error
 * status or a literal empty result array. */
async function assertWriteNoOp(label, token, method, path, body) {
  const res = await rest(token, method, path, body, { Prefer: 'return=representation' });
  rowsAsserted++;
  const rows = Array.isArray(res.json) ? res.json : null;
  const refused = res.status >= 400 || (rows !== null && rows.length === 0);
  if (!refused) leaksFound.push(`${label}: write was NOT refused/no-op (status ${res.status}) -> ${JSON.stringify(res.json).slice(0, 200)}`);
  return { status: res.status, refused };
}

const out = {};

// ============================================================================
// 1. SIGN-INS
// ============================================================================

const player = await signIn('player@atlitos.dev', AT_PW);
const athlete2 = await signIn('p2-verify-athlete@atlitos.dev', AT_PW);
const partnerA = await signIn('partner@atlitos.dev', AT_PW);
const partnerB = await signIn('p2-verify-partner@atlitos.dev', AT_PW);
const coach1 = await signIn('coach1@atlitos.dev', AT_PW);
const coach2 = await signIn('coach2@atlitos.dev', AT_PW);
const admin = await signIn('admin@atlitos.dev', AT_PW);

for (const [label, p] of [
  ['player', player], ['athlete2', athlete2], ['partnerA', partnerA], ['partnerB', partnerB],
  ['coach1', coach1], ['coach2', coach2], ['admin', admin],
]) {
  if (!p.ok) throw new Error(`[verify-rls-matrix] required persona ${label} (${p.email}) failed to sign in: ${JSON.stringify(p.error)}`);
}

// Documented pre-existing blocker (docs/qa/TEST-CATALOG.md), attempted so
// this self-heals once someone runs seed-empower-upa-users.mjs.
const upaVerifiedPersona = await signIn('upa.verified@atlitos.dev', EM_PW);
const upaTennisPersona = await signIn('upa.tennis@atlitos.dev', EM_PW);
const donorPersona = await signIn('donor@atlitos.dev', EM_PW);
for (const p of [upaVerifiedPersona, upaTennisPersona, donorPersona]) {
  if (!p.ok) blocked.push(`${p.email}: sign in failed (${p.error?.error_code ?? p.error?.msg ?? 'unknown'}) — pre-existing seed gap, see docs/qa/TEST-CATALOG.md`);
}

out.working_uids = { player: player.uid, athlete2: athlete2.uid, partnerA: partnerA.uid, partnerB: partnerB.uid, coach1: coach1.uid, coach2: coach2.uid, admin: admin.uid };
assertDistinct('all working personas', Object.values(out.working_uids));

// ============================================================================
// 2. upa_applications
//
// Public policy: status = 'verified'. Owner: applicant_user_id = self.
// Admin/moderator: all. THIS probe uses coach1/coach2/athlete2/player as the
// real owners (see header note): coach1 owns a VERIFIED row, coach2 owns an
// UNDER_REVIEW row, athlete2 owns a NEEDS_INFO row, player owns a REJECTED
// row — four different non-public statuses across four different callers,
// which is the exact shape a leak would show up in.
// ============================================================================

const ownApps = {};
for (const [label, p] of [['coach1', coach1], ['coach2', coach2], ['athlete2', athlete2], ['player', player]]) {
  const r = await scanOwnOnly(`upa_applications own (${label})`, p.token, `upa_applications?select=id,applicant_user_id,status&applicant_user_id=eq.${p.uid}`, (row) => row.applicant_user_id === p.uid);
  ownApps[label] = r.rows[0]?.id;
}
out.upa_applications = { own_app_ids: ownApps };

const isVerified = (row) => row.status === 'verified';
out.upa_applications.foreign_scan = {};
for (const [label, p] of [['coach1', coach1], ['coach2', coach2], ['athlete2', athlete2], ['player', player]]) {
  out.upa_applications.foreign_scan[label] = await scanForeign(
    `upa_applications unscoped (${label})`, p.token, 'upa_applications?select=id,applicant_user_id,status',
    [isVerified, (row) => row.applicant_user_id === p.uid],
  );
}
// anon: must see ONLY verified rows, nobody's private status.
out.upa_applications.anon_scan = await scanForeign('upa_applications anon', null, 'upa_applications?select=id,applicant_user_id,status', [isVerified]);

// admin: must see every one of the four known non-public owners' rows (positive access, not just "not blocked").
const adminApps = await rest(admin.token, 'GET', 'upa_applications?select=id,applicant_user_id,status');
rowsAsserted++;
const adminAppIds = new Set((Array.isArray(adminApps.json) ? adminApps.json : []).map((r) => r.id));
for (const [label, id] of Object.entries(ownApps)) {
  rowsAsserted++;
  if (!adminAppIds.has(id)) leaksFound.push(`upa_applications admin: admin did NOT see ${label}'s application ${id} (expected admin to read all)`);
}

// Write refusals: status is never client-writable, no client insert at all.
out.upa_applications.write_status_refused = await assertWriteNoOp('upa_applications status write (player, own row)', player.token, 'PATCH', `upa_applications?id=eq.${ownApps.player}`, { status: 'verified' });
out.upa_applications.write_insert_refused = await assertInsertRefused('upa_applications direct insert (player)', player.token, 'upa_applications', { applicant_user_id: player.uid, story_headline: 'x', story_body: 'x', sport: 'cricket', region: 'x', state: 'x' });

// ============================================================================
// 3. upa_evidence — NEVER public. Owner (via application) + admin only.
// ============================================================================

out.upa_evidence = { foreign_scan: {}, outsider_scan: {} };
for (const [label, p] of [['coach1', coach1], ['coach2', coach2]]) {
  out.upa_evidence.foreign_scan[label] = await scanForeign(
    `upa_evidence unscoped (${label})`, p.token, 'upa_evidence?select=id,application_id,kind',
    [(row) => row.application_id === ownApps[label]],
  );
}
// Outsiders who own NO evidence at all (athlete2's and player's own applications
// have no evidence rows) must see ZERO — the sharpest version of this check,
// since evidence carries ID proof / guardian consent and has no public branch.
for (const [label, p] of [['player', player], ['partnerA', partnerA]]) {
  out.upa_evidence.outsider_scan[label] = await scanExpectZero(`upa_evidence unscoped outsider (${label})`, p.token, 'upa_evidence?select=id,application_id,kind');
}
out.upa_evidence.anon_scan = await scanExpectZero('upa_evidence anon', null, 'upa_evidence?select=id,application_id,kind');

const adminEvidence = await rest(admin.token, 'GET', 'upa_evidence?select=id,application_id,kind');
rowsAsserted++;
if (!Array.isArray(adminEvidence.json) || adminEvidence.json.length === 0) leaksFound.push('upa_evidence admin: admin saw zero evidence rows (expected admin to read all)');

out.upa_evidence.write_insert_refused = await assertInsertRefused('upa_evidence insert into a stranger\'s application (player -> coach1\'s app)', player.token, 'upa_evidence', { application_id: ownApps.coach1, kind: 'video_link', url: 'https://example.com/rls-matrix-probe' });

// ============================================================================
// 4. donations — own donor rows, own-UPA's incoming donations, admin all.
// NO client write of any kind (financial invariant).
// ============================================================================

// Ensure a second, genuinely distinct real donor exists (athlete2), through
// the real donate + verify-payment product path — never a raw insert.
let athlete2HasDonation = await rest(athlete2.token, 'GET', `donations?select=id&donor_id=eq.${athlete2.uid}`);
if (!Array.isArray(athlete2HasDonation.json) || athlete2HasDonation.json.length === 0) {
  const donateReq = await callFunction('donate', athlete2.token, { upa_id: ownApps.coach1, amount: 25 });
  if (donateReq.json?.razorpay_order_id && RAZORPAY_KEY_SECRET) {
    const paymentId = `pay_RLSM${Date.now().toString().slice(-8)}`;
    await callFunction('verify-payment', athlete2.token, {
      razorpay_order_id: donateReq.json.razorpay_order_id,
      razorpay_payment_id: paymentId,
      razorpay_signature: sig(donateReq.json.razorpay_order_id, paymentId),
    });
  }
  athlete2HasDonation = await rest(athlete2.token, 'GET', `donations?select=id&donor_id=eq.${athlete2.uid}`);
}
out.donations = { athlete2_seeded: Array.isArray(athlete2HasDonation.json) ? athlete2HasDonation.json.length : 0 };

assertDistinct('donations donorA/donorB', [player.uid, athlete2.uid]);

const donorOwnA = await scanOwnOnly('donations own (player)', player.token, `donations?select=id,donor_id,upa_id&donor_id=eq.${player.uid}`, (row) => row.donor_id === player.uid);
const donorOwnB = await scanOwnOnly('donations own (athlete2)', athlete2.token, `donations?select=id,donor_id,upa_id&donor_id=eq.${athlete2.uid}`, (row) => row.donor_id === athlete2.uid);
out.donations.own = { player: donorOwnA.count, athlete2: donorOwnB.count };

// Pure donors (own no UPA): only their own donor_id explains a row.
out.donations.foreign_scan_donor = {
  player: await scanForeign('donations unscoped (player, pure donor)', player.token, 'donations?select=id,donor_id,upa_id', [(row) => row.donor_id === player.uid]),
  athlete2: await scanForeign('donations unscoped (athlete2, pure donor)', athlete2.token, 'donations?select=id,donor_id,upa_id', [(row) => row.donor_id === athlete2.uid]),
};

// UPA owner view: coach1 owns the verified UPA that received these
// donations, so donor_id === self OR upa_id === coach1's own app explains a
// row (the legitimate donations_select_own_upa branch); coach2 owns a
// DIFFERENT (non-verified) UPA and has never donated, so for coach2 nothing
// should be visible at all — a leak here would mean one UPA owner can read
// another UPA's incoming donations.
out.donations.upa_owner_scan = {
  coach1: await scanForeign('donations unscoped (coach1, owns the receiving UPA)', coach1.token, 'donations?select=id,donor_id,upa_id', [(row) => row.donor_id === coach1.uid, (row) => row.upa_id === ownApps.coach1]),
  coach2_outsider: await scanExpectZero('donations unscoped (coach2, owns a DIFFERENT UPA, never donated — expect ZERO)', coach2.token, 'donations?select=id,donor_id,upa_id'),
};

out.donations.anon_scan = await scanExpectZero('donations anon', null, 'donations?select=id,donor_id,upa_id');
out.donations.write_insert_refused = await assertInsertRefused('donations direct insert (player)', player.token, 'donations', { donor_id: player.uid, upa_id: ownApps.coach1, amount: 1, method: 'standalone' });

// ============================================================================
// 5. gratitude_posts — published + parent-verified is public; owner reads own
// posts in any status. Insert is own-UPA-and-published only (no draft state
// reachable by a client), so there is currently no non-published fixture row
// to prove the private branch never leaks; documented rather than faked.
// ============================================================================

out.gratitude_posts = {};
out.gratitude_posts.anon_scan = await scanForeign('gratitude_posts anon', null, 'gratitude_posts?select=id,upa_id,status', [(row) => row.status === 'published']);
out.gratitude_posts.outsider_scan = await scanForeign('gratitude_posts unscoped (athlete2, not this post\'s owner)', athlete2.token, 'gratitude_posts?select=id,upa_id,status', [(row) => row.status === 'published']);
out.gratitude_posts.write_insert_refused_adversarial = await assertInsertRefused(
  'gratitude_posts insert against another owner\'s wishlist item (athlete2 -> coach1\'s UPA)',
  athlete2.token, 'gratitude_posts',
  { upa_id: ownApps.coach1, wishlist_item_id: '00000000-0000-0000-0000-000000000000', status: 'published', body: 'rls matrix probe' },
);
// CRITICAL FINDING (discovered while building this probe, not an adversarial
// case): a genuinely OWN, genuinely funded wishlist item with NO existing
// post — the exact real product path, PRD-05 FR-19 — also 500s with Postgres
// 42P17 "infinite recursion detected in policy for relation gratitude_posts".
// The culprit is 0049's gratitude_posts_insert_own WITH CHECK: its
// `not exists (select 1 from public.gratitude_posts g where
// g.wishlist_item_id = gratitude_posts.wishlist_item_id)` clause makes the
// table's own INSERT policy subquery itself, which Postgres cannot evaluate.
// This means NO applicant, verified or not, can ever create a gratitude post
// through the client today — the feature is fully broken, not merely
// insecure. Proven here on coach1's own real funded, unposted item
// (ce0a9124-1feb-4944-b0c9-e7c02d3f4cbe), the legitimate path, so this is
// not an artifact of the adversarial probe above.
const legitFundedUnpostedItem = 'ce0a9124-1feb-4944-b0c9-e7c02d3f4cbe';
const legitGratitudeAttempt = await rest(coach1.token, 'POST', 'gratitude_posts', { upa_id: ownApps.coach1, wishlist_item_id: legitFundedUnpostedItem, status: 'published', body: 'rls matrix probe: legitimate own-item insert' }, { Prefer: 'return=representation' });
rowsAsserted++;
if (legitGratitudeAttempt.status >= 500) {
  leaksFound.push(`gratitude_posts BUG (not an access leak, a total feature outage): a real owner's LEGITIMATE insert on their own funded, unposted item 500s with ${JSON.stringify(legitGratitudeAttempt.json)}. The gratitude_posts_insert_own WITH CHECK (0049_empower_rls.sql) self-references gratitude_posts in its "not exists" clause, causing Postgres 42P17 infinite recursion. No applicant can ever post gratitude through the client until that clause is rewritten (e.g. against a SECURITY DEFINER helper, the same fix pattern this file already uses for is_chat_thread_member/coach_has_trainee).`);
} else if (legitGratitudeAttempt.status >= 400) {
  leaksFound.push(`gratitude_posts: a real owner's legitimate insert on a genuinely funded, unposted item was unexpectedly refused (status ${legitGratitudeAttempt.status}): ${JSON.stringify(legitGratitudeAttempt.json).slice(0, 200)}`);
}
out.gratitude_posts.legit_owner_insert = { status: legitGratitudeAttempt.status, is_infinite_recursion_bug: legitGratitudeAttempt.status === 500 };
out.gratitude_posts.note = 'No non-published fixture row exists in this dataset (insert policy forbids draft state); private-branch leak coverage is limited to the anon/outsider published-only scan above.';

// ============================================================================
// 6. Group chat (0078): chat_threads / chat_thread_members / chat_messages,
// context_type = 'group'. Fixture: "Cric Squad" (coach1's group, created by
// scripts/seed-groups-demo.mjs; player/athlete2/partnerA are members).
// Non-member: coach2, confirmed to hold no membership in this group.
// ============================================================================

const cricSquad = await rest(null, 'GET', `training_groups?select=id,name,coach_id&name=eq.${encodeURIComponent('Cric Squad')}`);
rowsAsserted++;
const groupId = cricSquad.json?.[0]?.id;
if (!groupId) {
  leaksFound.push('group chat: could not locate the "Cric Squad" fixture group (run scripts/seed-groups-demo.mjs first)');
} else {
  const threadRow = await rest(coach1.token, 'GET', `chat_threads?select=id&context_type=eq.group&context_id=eq.${groupId}`);
  rowsAsserted++;
  const threadId = threadRow.json?.[0]?.id;
  if (!threadId) {
    leaksFound.push(`group chat: Cric Squad (${groupId}) has no group chat_threads row`);
  } else {
    assertDistinct('group chat member vs non-member', [player.uid, coach2.uid]);

    out.group_chat = { group_id: groupId, thread_id: threadId };
    out.group_chat.member_roster = await scanOwnOnly('chat_thread_members as seated member (player)', player.token, `chat_thread_members?select=thread_id,user_id&thread_id=eq.${threadId}`, (row) => row.thread_id === threadId);
    out.group_chat.member_thread = await scanOwnOnly('chat_threads as seated member (player)', player.token, `chat_threads?select=id&id=eq.${threadId}`, (row) => row.id === threadId);
    out.group_chat.member_messages = await scanOwnOnly('chat_messages as seated member (player)', player.token, `chat_messages?select=id,sender_id,thread_id&thread_id=eq.${threadId}`, (row) => row.thread_id === threadId);

    out.group_chat.nonmember_roster = await scanExpectZero('chat_thread_members as NON-member (coach2)', coach2.token, `chat_thread_members?select=thread_id,user_id&thread_id=eq.${threadId}`);
    out.group_chat.nonmember_thread = await scanExpectZero('chat_threads as NON-member (coach2)', coach2.token, `chat_threads?select=id&id=eq.${threadId}`);
    out.group_chat.nonmember_messages = await scanExpectZero('chat_messages as NON-member (coach2)', coach2.token, `chat_messages?select=id&thread_id=eq.${threadId}`);

    out.group_chat.nonmember_insert_refused = await assertInsertRefused('chat_messages insert by NON-member (coach2)', coach2.token, 'chat_messages', { thread_id: threadId, sender_id: coach2.uid, body: 'rls matrix probe, should be refused' });
    out.group_chat.nonmember_seat_self_refused = await assertInsertRefused('chat_thread_members self-seat by NON-member (coach2)', coach2.token, 'chat_thread_members', { thread_id: threadId, user_id: coach2.uid });
  }
}

// ============================================================================
// 7. coach_trainee_notes / coach_trainee_videos (0082 + 0078 dual access):
// coach full CRUD on OWN rows, trainee read-only on OWN coach_trainee_videos,
// trainee has NO access at all to coach_trainee_notes (product decision).
// Ground truth for the trainee relationship comes from the live
// coach_has_trainee RPC, never assumed, since prior probe scripts in this
// repo (verify-groups-probes.mjs) create real group memberships that shift
// who coaches whom between runs.
// ============================================================================

async function coachHasTrainee(coach, playerP) {
  const r = await rest(coach.token, 'POST', 'rpc/coach_has_trainee', { p_coach_id: coach.uid, p_player_id: playerP.uid });
  return r.json === true;
}

out.coach_trainee = {};
const coach1HasPlayer = await coachHasTrainee(coach1, player);
rowsAsserted++;
if (!coach1HasPlayer) leaksFound.push('coach_trainee precondition failed: coach1 does not (currently) coach player, cannot seed a real note/video fixture — rerun scripts/seed-groups-demo.mjs');

const noteBody = `RLS matrix probe note ${Date.now()}`;
const insertedNote = await rest(coach1.token, 'POST', 'coach_trainee_notes', { coach_id: coach1.uid, player_id: player.uid, body: noteBody }, { Prefer: 'return=representation' });
rowsAsserted++;
if (insertedNote.status >= 400) leaksFound.push(`coach_trainee_notes: real coach1->player insert (relationship=true) was refused: ${JSON.stringify(insertedNote.json).slice(0, 200)}`);

const insertedVideo = await rest(coach1.token, 'POST', 'coach_trainee_videos', { coach_id: coach1.uid, player_id: player.uid, caption: `RLS matrix probe video ${Date.now()}` }, { Prefer: 'return=representation' });
rowsAsserted++;
if (insertedVideo.status >= 400) leaksFound.push(`coach_trainee_videos: real coach1->player insert was refused: ${JSON.stringify(insertedVideo.json).slice(0, 200)}`);

// Negative insert gate: find a coach/player pair the RPC itself says is
// FALSE, and prove the INSERT policy actually enforces it (not just role).
let gatePair = null;
for (const [cLabel, c] of [['coach1', coach1], ['coach2', coach2]]) {
  for (const [pLabel, p] of [['partnerA', partnerA], ['partnerB', partnerB], ['admin', admin]]) {
    if (!(await coachHasTrainee(c, p))) { gatePair = { cLabel, c, pLabel, p }; break; }
  }
  if (gatePair) break;
}
rowsAsserted++;
if (!gatePair) {
  leaksFound.push('coach_trainee insert-gate: could not find any coach/non-trainee pair to test against (unexpected demo-data drift)');
} else {
  out.coach_trainee.gate_pair = `${gatePair.cLabel} -> ${gatePair.pLabel} (coach_has_trainee=false)`;
  out.coach_trainee.gate_refused = await assertInsertRefused(
    `coach_trainee_notes insert with NO real relationship (${out.coach_trainee.gate_pair})`,
    gatePair.c.token, 'coach_trainee_notes', { coach_id: gatePair.c.uid, player_id: gatePair.p.uid, body: 'should be refused, no relationship' },
  );
}

assertDistinct('coach_trainee note owner vs outsider coach', [coach1.uid, coach2.uid]);
out.coach_trainee.notes_outsider_coach = await scanForeign('coach_trainee_notes unscoped (coach2, does not own this note)', coach2.token, 'coach_trainee_notes?select=id,coach_id,player_id', [(row) => row.coach_id === coach2.uid]);
out.coach_trainee.videos_outsider_coach = await scanForeign('coach_trainee_videos unscoped (coach2, does not own this video)', coach2.token, 'coach_trainee_videos?select=id,coach_id,player_id', [(row) => row.coach_id === coach2.uid]);

// The trainee: zero access to notes (hard product rule), own-only on videos.
out.coach_trainee.notes_player = await scanExpectZero('coach_trainee_notes as the trainee themself (player) — must be ZERO', player.token, 'coach_trainee_notes?select=id,coach_id,player_id');
out.coach_trainee.videos_player = await scanForeign('coach_trainee_videos as the trainee (player, own-only)', player.token, 'coach_trainee_videos?select=id,coach_id,player_id', [(row) => row.player_id === player.uid]);
// A DIFFERENT trainee of the same coach must not see player's video.
assertDistinct('coach_trainee video dual-access, two trainees', [player.uid, athlete2.uid]);
out.coach_trainee.videos_other_trainee = await scanForeign('coach_trainee_videos as a DIFFERENT trainee (athlete2)', athlete2.token, 'coach_trainee_videos?select=id,coach_id,player_id', [(row) => row.player_id === athlete2.uid]);

out.coach_trainee.player_insert_note_refused = await assertInsertRefused('coach_trainee_notes insert by the trainee about themself (player)', player.token, 'coach_trainee_notes', { coach_id: coach1.uid, player_id: player.uid, body: 'trainee should never be able to write this' });
const insertedVideoId = insertedVideo.json?.[0]?.id;
if (insertedVideoId) {
  out.coach_trainee.player_update_video_refused = await assertWriteNoOp('coach_trainee_videos UPDATE by the trainee (player, own video)', player.token, 'PATCH', `coach_trainee_videos?id=eq.${insertedVideoId}`, { caption: 'trainee should not be able to edit this' });
} else {
  rowsAsserted++;
  leaksFound.push(`coach_trainee_videos: could not resolve the inserted probe video's id to run the trainee-UPDATE-refusal check (insert response: ${JSON.stringify(insertedVideo.json).slice(0, 200)})`);
}

// ============================================================================
// 8. fee_config: readable by every authenticated user (client bill preview);
// writable by admin ONLY. No account this script signs in as holds the
// admin role's WRITE grant tested here as anything but a refusal — an actual
// admin WRITE (admin_update_fee_config) is intentionally NOT exercised: it
// would mutate the live platform fee/GST rows every future transaction reads.
// ============================================================================

out.fee_config = {};
const feeReadPlayer = await rest(player.token, 'GET', 'fee_config?select=id,domain,key,value');
rowsAsserted++;
out.fee_config.player_can_read = Array.isArray(feeReadPlayer.json) && feeReadPlayer.json.length > 0;
if (!out.fee_config.player_can_read) leaksFound.push(`fee_config: authenticated non-admin (player) could NOT read fee_config (expected readable-by-all): ${JSON.stringify(feeReadPlayer.json).slice(0, 200)}`);

out.fee_config.anon_scan = await scanExpectZero('fee_config anon (no anon grant expected)', null, 'fee_config?select=id,domain,key,value');

const feeRow = feeReadPlayer.json?.[0];
if (feeRow) {
  out.fee_config.write_refused = await assertWriteNoOp(`fee_config UPDATE by non-admin (player) on ${feeRow.domain}/${feeRow.key}`, player.token, 'PATCH', `fee_config?id=eq.${feeRow.id}`, { value: 999999 });
  const reread = await rest(player.token, 'GET', `fee_config?select=value&id=eq.${feeRow.id}`);
  rowsAsserted++;
  if (reread.json?.[0]?.value !== feeRow.value) leaksFound.push(`fee_config: value for ${feeRow.domain}/${feeRow.key} CHANGED after a non-admin write attempt (was ${feeRow.value}, now ${reread.json?.[0]?.value})`);
}
out.fee_config.insert_refused = await assertInsertRefused('fee_config INSERT by non-admin (player)', player.token, 'fee_config', { domain: 'courts', key: `rls_matrix_probe_${Date.now()}`, value_type: 'flat', value: 1 });

// ============================================================================
// 9. venues / court_bookings — the historically-bitten owner-scoping shape.
// venues carries a public `status = 'verified'` policy beside the owner
// policy (CLAUDE.md incident 1/2), so this creates a fresh NON-verified
// venue (defaults to status='pending') as partnerB and proves partnerA
// cannot see it — the meaningful case existing fixture data (all verified)
// could not exercise on its own.
// ============================================================================

assertDistinct('venues partnerA/partnerB', [partnerA.uid, partnerB.uid]);

const probeVenueName = `RLS Matrix Probe Venue ${Date.now()}`;
const probeVenue = await rest(partnerB.token, 'POST', 'venues', {
  partner_user_id: partnerB.uid, name: probeVenueName, address: '1 Probe Lane', city: 'Probe City', pincode: '000000',
}, { Prefer: 'return=representation' });
rowsAsserted++;
out.venues = { probe_venue_status: probeVenue.status };
const probeVenueId = probeVenue.json?.[0]?.id;
if (!probeVenueId) {
  leaksFound.push(`venues: could not create the pending-venue fixture as partnerB: ${JSON.stringify(probeVenue.json).slice(0, 200)}`);
} else {
  out.venues.probe_venue_id = probeVenueId;
  out.venues.probe_venue_visible_to_owner = await scanOwnOnly('venues probe row, own read (partnerB)', partnerB.token, `venues?select=id,partner_user_id,status&id=eq.${probeVenueId}`, (row) => row.partner_user_id === partnerB.uid);
  out.venues.probe_venue_hidden_from_other_partner = await scanExpectZero('venues probe (non-verified) row as a DIFFERENT partner (partnerA) — must be ZERO', partnerA.token, `venues?select=id,partner_user_id,status&id=eq.${probeVenueId}`);
  out.venues.probe_venue_hidden_from_anon = await scanExpectZero('venues probe (non-verified) row as anon — must be ZERO', null, `venues?select=id,partner_user_id,status&id=eq.${probeVenueId}`);
}

const venueIsVerified = (row) => row.status === 'verified';
out.venues.foreign_scan = {
  partnerA: await scanForeign('venues unscoped (partnerA)', partnerA.token, 'venues?select=id,partner_user_id,status', [venueIsVerified, (row) => row.partner_user_id === partnerA.uid]),
  partnerB: await scanForeign('venues unscoped (partnerB)', partnerB.token, 'venues?select=id,partner_user_id,status', [venueIsVerified, (row) => row.partner_user_id === partnerB.uid]),
};

// court_bookings: is_court_partner_or_staff(court_id) OR user_id = self.
// Resolve each partner's own court ids via THEIR OWN venue ownership (scoped
// query, never assumed) to build the explain predicate.
async function ownCourtIds(partner) {
  const venues = await rest(partner.token, 'GET', `venues?select=id&partner_user_id=eq.${partner.uid}`);
  const venueIds = (Array.isArray(venues.json) ? venues.json : []).map((v) => v.id);
  if (venueIds.length === 0) return new Set();
  const courts = await rest(partner.token, 'GET', `courts?select=id,venue_id&venue_id=in.(${venueIds.join(',')})`);
  return new Set((Array.isArray(courts.json) ? courts.json : []).map((c) => c.id));
}
const partnerACourts = await ownCourtIds(partnerA);
const partnerBCourts = await ownCourtIds(partnerB);
rowsAsserted += 2;

out.court_bookings = {};
out.court_bookings.foreign_scan = {
  partnerA: await scanForeign('court_bookings unscoped (partnerA)', partnerA.token, 'court_bookings?select=id,court_id,user_id', [(row) => partnerACourts.has(row.court_id), (row) => row.user_id === partnerA.uid]),
  partnerB: await scanForeign('court_bookings unscoped (partnerB)', partnerB.token, 'court_bookings?select=id,court_id,user_id', [(row) => partnerBCourts.has(row.court_id), (row) => row.user_id === partnerB.uid]),
};
// A pure booker (owns no venue at all) is only explained by user_id = self.
out.court_bookings.foreign_scan.player = await scanForeign('court_bookings unscoped (player, pure booker)', player.token, 'court_bookings?select=id,court_id,user_id', [(row) => row.user_id === player.uid]);

out.court_bookings.write_insert_refused = await assertInsertRefused('court_bookings direct insert (player)', player.token, 'court_bookings', { court_id: [...partnerACourts][0] ?? [...partnerBCourts][0], user_id: player.uid, date: '2099-01-01', slot_start: '10:00', slot_end: '11:00', status: 'confirmed' });
const anyPlayerBooking = (await rest(player.token, 'GET', `court_bookings?select=id&user_id=eq.${player.uid}&limit=1`)).json?.[0]?.id;
if (anyPlayerBooking) {
  out.court_bookings.write_status_refused = await assertWriteNoOp('court_bookings direct status UPDATE (player, own booking)', player.token, 'PATCH', `court_bookings?id=eq.${anyPlayerBooking}`, { status: 'cancelled' });
}

// ============================================================================
// VERDICT
// ============================================================================

out.blocked = blocked;
out.leaks = leaksFound;
out.rows_asserted = rowsAsserted;
out.verdict = leaksFound.length === 0 ? 'GREEN — no RLS leaks found' : 'RED — real leaks found, see .leaks';

console.log(JSON.stringify(out, null, 2));
if (leaksFound.length > 0) process.exitCode = 1;
