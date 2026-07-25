// Groups phase seed, Track A clause 6. Seeds through the REAL rails, not
// service-role inserts, so every row it leaves behind is one the product
// itself could have produced:
//
//   1. coach1@atlitos.dev creates "Cric Squad" via the create_training_group
//      RPC (0080). Idempotent: an existing group with that name is reused.
//   2. player@atlitos.dev, p2-verify-athlete@atlitos.dev, and
//      partner@atlitos.dev each join through the DEPLOYED join-group edge
//      function (real Razorpay test order) and the payment is captured
//      through the DEPLOYED verify-payment function with a signature forged
//      with the same RAZORPAY_KEY_SECRET the server verifies against, the
//      verify-oversell-probe.mjs pattern. So the memberships are ACTIVE with
//      REAL linked payment intents and the finalize gate's carve-out ledger
//      groups exist.
//   3. coach1 schedules one group session (accepted) via create_group_session,
//      participants auto-seeded from the active members.
//   4. A few chat messages land in the group thread (auto-created by the
//      0078 trigger, members auto-seated on activation) via plain PostgREST
//      inserts under each sender's own JWT, i.e. the same door the app uses.
//
// Run: node scripts/seed-groups-demo.mjs

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

const COACH = 'coach1@atlitos.dev';
const MEMBERS = ['player@atlitos.dev', 'p2-verify-athlete@atlitos.dev', 'partner@atlitos.dev'];
const GROUP_NAME = 'Cric Squad';
const MONTHLY_FEE = 2000;

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

async function rest(token, method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
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

/** Join + capture through the deployed rails; tolerates ALREADY_MEMBER. */
async function joinAndPay(user, groupId, expectedTotal) {
  const join = await callFunction('join-group', user.token, {
    group_id: groupId,
    expected_total: expectedTotal,
  });
  if (join.status !== 200) {
    const code = join.json?.error?.code;
    if (code === 'ALREADY_MEMBER') return { email: user.email, outcome: 'already_member' };
    throw new Error(`join-group failed for ${user.email}: ${JSON.stringify(join.json)}`);
  }
  const orderId = join.json.razorpay_order_id;
  const paymentId = `pay_seed${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`;
  const signature = createHmac('sha256', KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const capture = await callFunction('verify-payment', user.token, {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  });
  if (capture.status !== 200) {
    throw new Error(`verify-payment failed for ${user.email}: ${JSON.stringify(capture.json)}`);
  }
  return {
    email: user.email,
    outcome: 'joined_and_paid',
    membership_id: join.json.membership_id,
    razorpay_order_id: orderId,
    membership_status_after_capture: capture.json.status,
  };
}

const out = {};

const coach = await signIn(COACH);
const members = [];
for (const email of MEMBERS) members.push(await signIn(email));

// 1. Group (idempotent by name).
const existing = await rest(
  coach.token,
  'GET',
  `training_groups?select=*&coach_id=eq.${coach.userId}&name=eq.${encodeURIComponent(GROUP_NAME)}`,
);
let group = Array.isArray(existing.json) ? existing.json[0] : undefined;
if (!group) {
  const created = await rpc(coach.token, 'create_training_group', {
    p_name: GROUP_NAME,
    p_sport: 'cricket',
    p_capacity: 8,
    p_monthly_fee: MONTHLY_FEE,
    p_skill_level: 'Intermediate',
    p_attendance_policy:
      'Be on the ground 10 minutes before the session starts. Tell your coach in the group chat if you cannot make it. Missing a session does not change your monthly fee.',
  });
  if (created.status >= 300) throw new Error(`create_training_group failed: ${JSON.stringify(created.json)}`);
  group = created.json;
}
out.group = { id: group.id, name: group.name, sport: group.sport, capacity: group.capacity, monthly_fee: group.monthly_fee };

// 2. Members join and pay through the deployed rails.
out.memberships = [];
for (const member of members) {
  out.memberships.push(await joinAndPay(member, group.id, Number(group.monthly_fee)));
}

// 3. One group session in accepted state, tomorrow morning.
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
const session = await rpc(coach.token, 'create_group_session', {
  p_group_id: group.id,
  p_date: tomorrow,
  p_slot_start: '07:00',
  p_slot_end: '08:30',
  p_focus_area: 'Batting drills and fielding',
  p_location: 'Marina Ground, Chennai',
});
if (session.status >= 300) {
  const msg = JSON.stringify(session.json);
  if (msg.includes('SLOT_TAKEN')) {
    out.session = 'already_scheduled (SLOT_TAKEN, reusing existing)';
  } else {
    throw new Error(`create_group_session failed: ${msg}`);
  }
} else {
  out.session = { id: session.json.id, status: session.json.status, date: session.json.date };
}

// 4. Chat: the 0078 trigger created the thread and seated everyone active.
const thread = await rest(
  coach.token,
  'GET',
  `chat_threads?select=id&context_type=eq.group&context_id=eq.${group.id}`,
);
const threadId = thread.json?.[0]?.id;
if (!threadId) throw new Error(`no group chat thread found: ${JSON.stringify(thread.json)}`);
out.thread_id = threadId;

const messages = [
  [coach, 'Welcome to Cric Squad. First session is tomorrow at 7 in the morning, Marina Ground.'],
  [members[0], 'Looking forward to it, coach.'],
  [members[1], 'Same here, see everyone there.'],
  [coach, 'Bring your own gloves, pads are provided.'],
];
out.messages = [];
for (const [sender, text] of messages) {
  const sent = await rest(sender.token, 'POST', 'chat_messages', {
    thread_id: threadId,
    sender_id: sender.userId,
    text,
  });
  out.messages.push({ from: sender.email, status: sent.status });
  if (sent.status >= 300) out.messages[out.messages.length - 1].error = sent.json;
}

console.log(JSON.stringify(out, null, 2));
