#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-learn-p7.mjs (AT-139, Track F verification)
// Runs against the LIVE project syzzfgaudpifwvbpycyi with REAL player/admin JWTs.
// Never types credentials interactively; uses the documented fixture password.
import { readFileSync } from 'node:fs';

const ROOT = '.';
function readEnvFile(p) {
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = readEnvFile(`${ROOT}/apps/mobile/.env`);
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = 'AtlitosDemo!2026';

// Fixtures
const DRILL_GATE = '660e8400-e29b-41d4-a716-446655440002'; // Backfoot pull shot, cricket, xp 100
const DRILL_INACTIVE = '660e8400-e29b-41d4-a716-446655440004'; // Slip fielding basics, active=false, xp 40
const DRILL_FORGE = '660e8400-e29b-41d4-a716-446655440003'; // Yorker (active) for smuggle test

async function signIn(email) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`signIn ${email} failed: ${JSON.stringify(j)}`);
  return { token: j.access_token, uid: j.user.id, refresh: j.refresh_token };
}
function h(token) {
  return { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
async function rest(method, path, token, body, extraHeaders) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method, headers: { ...h(token), ...(extraHeaders || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, code: json && json.code, msg: json && json.message, json };
}
async function rpc(name, token, args) {
  return rest('POST', `rpc/${name}`, token, args ?? {});
}

const R = {};
// ---- Player A (gate subject): player@atlitos.dev, fresh cricket ----
const A = await signIn('player@atlitos.dev');
R.playerA_id = A.uid;

// server truth: the drill's xp_value
R.gate_drill = await rest('GET', `drills?id=eq.${DRILL_GATE}&select=id,title,xp_value,active`, A.token);

// BEFORE
R.before = await rpc('get_learn_home', A.token);

// GATE: the ONE client write — own-row completion insert
R.completion_insert = await rest('POST', 'drill_completions', A.token,
  { user_id: A.uid, drill_id: DRILL_GATE }, { Prefer: 'return=representation' });

// AFTER
R.after = await rpc('get_learn_home', A.token);

// Prove the xp_events row was trigger-written (A reads own events)
R.xp_events_after = await rest('GET',
  `xp_events?user_id=eq.${A.uid}&drill_id=eq.${DRILL_GATE}&select=source,xp_amount,drill_id`, A.token);

// ---- UN-FORGEABILITY ----
R.forge_xp_events = await rest('POST', 'xp_events', A.token,
  { user_id: A.uid, drill_id: DRILL_GATE, source: 'drill_complete', xp_amount: 9999 });
R.forge_user_milestones = await rest('POST', 'user_milestones', A.token,
  { user_id: A.uid, milestone_id: '00000000-0000-0000-0000-000000000000' });
// smuggle an xp column on the completion
R.smuggle_xp = await rest('POST', 'drill_completions', A.token,
  { user_id: A.uid, drill_id: DRILL_FORGE, xp_value: 9999 });

// ---- IDEMPOTENCY: duplicate completion ----
R.dup_completion = await rest('POST', 'drill_completions', A.token,
  { user_id: A.uid, drill_id: DRILL_GATE });
R.after_dup = await rpc('get_learn_home', A.token);
R.xp_events_count_gate = await rest('GET',
  `xp_events?user_id=eq.${A.uid}&drill_id=eq.${DRILL_GATE}&select=id`, A.token,
  undefined, { Prefer: 'count=exact' });

// ---- CATALOG active filter ----
R.catalog_active = await rest('GET', 'drills?active=eq.true&select=id&limit=1000', A.token);
R.inactive_in_active = await rest('GET',
  `drills?active=eq.true&id=eq.${DRILL_INACTIVE}&select=id`, A.token); // app path -> empty
R.inactive_raw = await rest('GET', `drills?id=eq.${DRILL_INACTIVE}&select=id,active`, A.token); // permissive raw

// ---- ADMIN ----
const ADMIN = await signIn('admin@atlitos.dev');
R.admin_id = ADMIN.uid;
R.admin_create = await rpc('admin_upsert_drill', ADMIN.token, {
  p_id: null, p_title: 'P7 verify probe drill', p_description: 'Temporary drill created by AT-139 verification.',
  p_sport: 'cricket', p_skill_category: 'batting', p_difficulty: 'beginner', p_xp_value: 30,
});
const createdId = Array.isArray(R.admin_create.json) ? R.admin_create.json[0]?.id : R.admin_create.json?.id;
R.created_drill_id = createdId;
if (createdId) {
  R.admin_edit = await rpc('admin_upsert_drill', ADMIN.token, {
    p_id: createdId, p_title: 'P7 verify probe drill EDITED', p_description: 'Edited by AT-139.',
    p_sport: 'cricket', p_skill_category: 'batting', p_difficulty: 'beginner', p_xp_value: 35,
  });
  R.admin_deactivate = await rpc('admin_set_drill_active', ADMIN.token, { p_id: createdId, p_active: false });
}
// non-admin refusal
R.nonadmin_upsert = await rpc('admin_upsert_drill', A.token, {
  p_id: null, p_title: 'hacker drill', p_description: 'should be refused',
  p_sport: 'cricket', p_skill_category: 'batting', p_difficulty: 'beginner', p_xp_value: 999,
});
// xp_value <= 0
R.xp_value_zero = await rpc('admin_upsert_drill', ADMIN.token, {
  p_id: null, p_title: 'bad xp drill', p_description: 'should be rejected',
  p_sport: 'cricket', p_skill_category: 'batting', p_difficulty: 'beginner', p_xp_value: 0,
});

// ---- ISOLATION (real JWT path): A vs coach2 (holds player role) as B ----
const B = await signIn('coach2@atlitos.dev');
R.playerB_id = B.uid;
R.ids_differ = A.uid !== B.uid;
R.B_sees_A_completions = await rest('GET',
  `drill_completions?user_id=eq.${A.uid}&select=id`, B.token, undefined, { Prefer: 'count=exact' });
R.B_sees_A_xp = await rest('GET',
  `xp_events?user_id=eq.${A.uid}&select=id`, B.token, undefined, { Prefer: 'count=exact' });
R.B_sees_A_milestones = await rest('GET',
  `user_milestones?user_id=eq.${A.uid}&select=id`, B.token, undefined, { Prefer: 'count=exact' });
R.B_reads_roadmap = await rest('GET', 'roadmap_stages?select=id&limit=1000', B.token);
R.B_reads_catalog = await rest('GET', 'drills?active=eq.true&select=id&limit=1', B.token);

console.log(JSON.stringify(R, null, 2));
