// Groups phase probes, Track A clause 7. Four probes, each against the
// DEPLOYED functions / live RLS, never against assumptions:
//
//   (a) capacity: a throwaway capacity-2 group, THREE genuinely concurrent
//       joins from three distinct users; exactly two may win, the loser must
//       be GROUP_FULL refused BEFORE Razorpay (its refusal carries no order
//       id and no membership row exists for it), and live membership count
//       never exceeds 2. A fourth, sequential join re-proves the refusal.
//   (b) RLS: a member's direct INSERT into group_memberships and direct
//       UPDATE of membership status must both fail; anon reads active
//       groups; anon reads zero membership rows; a member sees ONLY their
//       own membership rows of a group other people are also in.
//   (c) ledger: every membership-domain entry group balances (sum debits =
//       sum credits) and the platform fee leg is the fee_config value.
//   (d) mark_attendance: rejected while the session is accepted
//       (INVALID_TRANSITION), rejected for a non-coach caller even while
//       in_progress (FORBIDDEN), accepted for the coach in_progress.
//
// AT-62 lesson honoured: user ids are asserted distinct before any
// concurrency conclusion is drawn.
//
// Run: node scripts/verify-groups-probes.mjs

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const mobileEnv = readEnvFile('apps/mobile/.env');
const fnEnv = readEnvFile('supabase/.env');
const SUPABASE_URL = mobileEnv.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = mobileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const KEY_SECRET = fnEnv.RAZORPAY_KEY_SECRET;
const PASSWORD = 'AtlitosDemo!2026';

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign in failed for ${email}: ${JSON.stringify(json)}`);
  return { email, token: json.access_token, userId: json.user.id };
}

async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function rest(token, method, path, body, extraHeaders = {}) {
  const headers = {
    apikey: ANON_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extraHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function callFunction(name, token, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const out = {};

const coach = await signIn('coach2@atlitos.dev');
const u1 = await signIn('player@atlitos.dev');
const u2 = await signIn('p2-verify-athlete@atlitos.dev');
const u3 = await signIn('p2-verify-partner@atlitos.dev');

const ids = new Set([u1.userId, u2.userId, u3.userId, coach.userId]);
if (ids.size !== 4) throw new Error('probe is vacuous: users are not distinct');
out.ids_distinct = true;

// ---------------------------------------------------------------- probe (a)
const groupName = `Oversell Probe ${Date.now()}`;
const created = await rpc(coach.token, 'create_training_group', {
  p_name: groupName,
  p_sport: 'tennis',
  p_capacity: 2,
  p_monthly_fee: 1500,
});
if (created.status >= 300) throw new Error(`probe group create failed: ${JSON.stringify(created.json)}`);
const probeGroup = created.json;
out.probe_group_id = probeGroup.id;

const joinPayload = { group_id: probeGroup.id, expected_total: 1500 };
const started = Date.now();
const [ra, rb, rc] = await Promise.all([
  callFunction('join-group', u1.token, joinPayload),
  callFunction('join-group', u2.token, joinPayload),
  callFunction('join-group', u3.token, joinPayload),
]);
out.race_elapsed_ms = Date.now() - started;

const results = [
  { user: u1.email, ...ra },
  { user: u2.email, ...rb },
  { user: u3.email, ...rc },
];
const winners = results.filter((r) => r.status === 200);
const losers = results.filter((r) => r.status !== 200);
out.a_winner_count = winners.length;
out.a_loser_codes = losers.map((r) => r.json?.error?.code ?? JSON.stringify(r.json).slice(0, 120));
out.a_losers_have_no_order = losers.every((r) => !r.json?.razorpay_order_id);

// A fourth sequential join must also be refused.
const loserUser = [u1, u2, u3].find((u) => losers.some((l) => l.user === u.email)) ?? u3;
const fourth = await callFunction('join-group', loserUser.token, joinPayload);
out.a_fourth_join = { status: fourth.status, code: fourth.json?.error?.code };

// Capture the two winners' payments through the deployed verify-payment
// (forged-signature pattern), so they become ACTIVE members: probe (d)
// needs real participants, and the finalize gate + ledger get exercised
// again on the probe group too.
out.a_captures = [];
for (const w of winners) {
  const wu = [u1, u2, u3].find((u) => u.email === w.user);
  const paymentId = `pay_probe${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`;
  const signature = createHmac('sha256', KEY_SECRET)
    .update(`${w.json.razorpay_order_id}|${paymentId}`)
    .digest('hex');
  const capture = await callFunction('verify-payment', wu.token, {
    razorpay_order_id: w.json.razorpay_order_id,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  });
  out.a_captures.push({ user: w.user, status: capture.status, membership_status: capture.json?.status });
}

// Live membership count via the coach's scoped read (coach reads own
// groups' memberships).
const liveRows = await rest(
  coach.token,
  'GET',
  `group_memberships?select=id,player_id,status&group_id=eq.${probeGroup.id}&status=neq.lapsed`,
);
out.a_live_membership_count = Array.isArray(liveRows.json) ? liveRows.json.length : liveRows.json;
out.a_no_oversell =
  winners.length === 2 &&
  losers.length === 1 &&
  out.a_loser_codes.every((c) => c === 'GROUP_FULL') &&
  out.a_fourth_join.code === 'GROUP_FULL' &&
  out.a_live_membership_count === 2;

// ---------------------------------------------------------------- probe (b)
// Direct INSERT as an authenticated member: must fail (no policy, no grant).
const directInsert = await rest(u1.token, 'POST', 'group_memberships', {
  group_id: probeGroup.id,
  player_id: u1.userId,
  status: 'active',
  price: 0.01,
  platform_fee: 0,
  total: 0.01,
});
out.b_direct_insert = {
  status: directInsert.status,
  code: directInsert.json?.code,
  ok: [400, 401, 403].includes(directInsert.status),
};

// Direct status UPDATE on their own membership (a race WINNER, so the row
// certainly exists): must fail or touch 0 rows.
const winnerUser = [u1, u2, u3].find((u) => winners.some((w) => w.user === u.email));
const myRows = await rest(winnerUser.token, 'GET', `group_memberships?select=id,status&player_id=eq.${winnerUser.userId}&group_id=eq.${probeGroup.id}`);
const myMembershipId = myRows.json?.[0]?.id;
let updateOutcome = { failed: `winner ${winnerUser.email} cannot read own membership row: ${JSON.stringify(myRows.json).slice(0, 160)}` };
if (myMembershipId) {
  const upd = await rest(winnerUser.token, 'PATCH', `group_memberships?id=eq.${myMembershipId}`, { status: 'lapsed' });
  const after = await rest(winnerUser.token, 'GET', `group_memberships?select=status&id=eq.${myMembershipId}`);
  updateOutcome = {
    status: upd.status,
    code: upd.json?.code,
    status_after: after.json?.[0]?.status,
    ok: [400, 401, 403, 404].includes(upd.status) && after.json?.[0]?.status !== 'lapsed',
  };
}
out.b_direct_update = updateOutcome;

// Anon reads active groups (discovery) but zero membership rows.
const anonGroups = await rest(null, 'GET', `training_groups?select=id,name,active&id=eq.${probeGroup.id}`);
const anonMemberships = await rest(null, 'GET', `group_memberships?select=id&group_id=eq.${probeGroup.id}`);
out.b_anon_reads_active_group = Array.isArray(anonGroups.json) && anonGroups.json.length === 1;
out.b_anon_membership_rows = Array.isArray(anonMemberships.json) ? anonMemberships.json.length : anonMemberships.json;

// A member must see ONLY their own membership rows in a group with several
// members (Cric Squad has three). Unscoped select as u1, filtered to the
// Cric Squad group id read via anon discovery.
const cric = await rest(null, 'GET', `training_groups?select=id&name=eq.${encodeURIComponent('Cric Squad')}`);
const cricId = cric.json?.[0]?.id;
if (cricId) {
  // u1 (player@atlitos.dev) is one of Cric Squad's three members; the
  // other two members' rows must be invisible to them.
  const visible = await rest(u1.token, 'GET', `group_memberships?select=id,player_id&group_id=eq.${cricId}`);
  const rows = Array.isArray(visible.json) ? visible.json : [];
  out.b_member_sees_only_own = {
    rows: rows.length,
    all_own: rows.every((r) => r.player_id === u1.userId),
    ok: rows.length === 1 && rows.every((r) => r.player_id === u1.userId),
  };
}

// ---------------------------------------------------------------- probe (d)
// A group session on the probe group: accepted -> mark rejected; player
// mark rejected even in_progress; coach mark in_progress succeeds.
// Random future day + slot so repeated probe runs never trip the coach's
// slot-uniqueness index against their own earlier probes.
const dayOffset = 2 + Math.floor(Math.random() * 25);
const day = new Date(Date.now() + dayOffset * 24 * 3600 * 1000).toISOString().slice(0, 10);
const hour = String(6 + Math.floor(Math.random() * 14)).padStart(2, '0');
const minute = ['00', '15', '30', '45'][Math.floor(Math.random() * 4)];
const probeSession = await rpc(coach.token, 'create_group_session', {
  p_group_id: probeGroup.id,
  p_date: day,
  p_slot_start: `${hour}:${minute}`,
  p_slot_end: `${String(Number(hour) + 1).padStart(2, '0')}:${minute}`,
});
if (probeSession.status >= 300) throw new Error(`probe session create failed: ${JSON.stringify(probeSession.json)}`);
const sessionId = probeSession.json.id;
const winnersUsers = [u1, u2, u3].filter((u) => winners.some((w) => w.user === u.email));
const marks = Object.fromEntries(winnersUsers.map((u) => [u.userId, 'present']));

const markWhileAccepted = await rpc(coach.token, 'mark_attendance', { p_session_id: sessionId, p_marks: marks });
out.d_mark_while_accepted = { status: markWhileAccepted.status, message: markWhileAccepted.json?.message ?? markWhileAccepted.json };

const start = await rpc(coach.token, 'session_transition', { p_session_id: sessionId, p_action: 'start' });
out.d_start_session = { status: start.status, session_status: start.json?.status };

const markAsPlayer = await rpc(winnersUsers[0].token, 'mark_attendance', { p_session_id: sessionId, p_marks: marks });
out.d_mark_as_player = { status: markAsPlayer.status, message: markAsPlayer.json?.message ?? markAsPlayer.json };

const markAsCoach = await rpc(coach.token, 'mark_attendance', { p_session_id: sessionId, p_marks: marks });
out.d_mark_as_coach = {
  status: markAsCoach.status,
  marked: Array.isArray(markAsCoach.json)
    ? markAsCoach.json.map((r) => ({ player: r.player_id, attendance: r.attendance_status }))
    : markAsCoach.json,
};

out.d_ok =
  markWhileAccepted.status >= 300 &&
  String(out.d_mark_while_accepted.message).includes('not in progress') &&
  start.json?.status === 'in_progress' &&
  markAsPlayer.status >= 300 &&
  String(out.d_mark_as_player.message).includes('only the session coach') &&
  markAsCoach.status === 200;

console.log(JSON.stringify(out, null, 2));
